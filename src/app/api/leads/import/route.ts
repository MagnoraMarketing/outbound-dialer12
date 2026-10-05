import { NextResponse } from "next/server";
import { apiError, createSupabaseAdminClient, readJson, requireContext, writeAudit } from "@/lib/http";
import { normalizePhone } from "@/lib/leads";

const allowedFields = new Set([
  "company_name", "cvr", "contact_person", "phone", "email", "website",
  "address", "city", "industry", "employee_count", "notes",
]);

function isRowConstraintError(code: string | undefined) {
  return ["22001", "22003", "22P02", "23502", "23505", "23514"].includes(code ?? "");
}

function rowConstraintMessage(code: string | undefined) {
  if (code === "23505") return "Virksomheden eller telefonnummeret findes allerede.";
  if (code === "22001") return "Et felt indeholder for mange tegn.";
  if (code === "23502") return "Et obligatorisk felt mangler.";
  return "Et af datafelterne har en ugyldig værdi.";
}

export async function POST(request: Request) {
  const result = await requireContext();
  if ("response" in result) return result.response;
  if (result.context.profile.role !== "admin") return apiError("Kun administratorer kan importere leads.", 403);
  const body = await readJson(request);
  if (!body || !Array.isArray(body.rows) || !body.mapping || typeof body.mapping !== "object") return apiError("CSV-data eller kolonnemapping mangler.");
  if (body.rows.length > 10_000) return apiError("Importen er begrænset til 10.000 rækker ad gangen.", 413);
  const rowOffset = typeof body.row_offset === "number" && Number.isInteger(body.row_offset) && body.row_offset >= 0
    ? body.row_offset : 0;
  const mapping = body.mapping as Record<string, unknown>;
  if (typeof body.lead_list_id !== "string") return apiError("Vælg en kampagne og leadliste før import.");
  if (typeof body.assigned_user_id !== "string") return apiError("Vælg den bruger, som skal have leadlisten.");
  const rows: Record<string, unknown>[] = [];
  const errors: { row: number; reason: string }[] = [];
  const phones = new Set<string>();
  const companies = new Set<string>();
  const sourceRowByPhone = new Map<string, number>();
  const { context } = result;
  const { data: leadList, error: listError } = await context.supabase.from("lead_lists")
    .select("id, campaign_id").eq("id", body.lead_list_id).eq("team_id", context.profile.team_id).maybeSingle();
  if (listError || !leadList) return apiError("Leadlisten blev ikke fundet i dit team.", listError ? 500 : 404);
  let assignedUser: { id: string };
  try {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin.from("profiles").select("id")
      .eq("id", body.assigned_user_id).eq("team_id", context.profile.team_id).maybeSingle();
    if (error || !data) return apiError("Den valgte bruger blev ikke fundet i dit team.", error ? 500 : 404);
    assignedUser = data;
    const { error: campaignAssignmentError } = await admin.from("campaign_assignments").upsert({
      team_id: context.profile.team_id,
      campaign_id: leadList.campaign_id,
      user_id: assignedUser.id,
    }, { onConflict: "team_id,campaign_id,user_id" });
    if (campaignAssignmentError) {
      console.error("Campaign assignment creation failed", campaignAssignmentError.message);
      return apiError("Kampagnen kunne ikke tildeles brugeren.", 500);
    }
    const { error: listAssignmentError } = await admin.from("lead_list_assignments").upsert({
      team_id: context.profile.team_id,
      lead_list_id: leadList.id,
      user_id: assignedUser.id,
    }, { onConflict: "team_id,lead_list_id,user_id" });
    if (listAssignmentError) {
      console.error("Lead list assignment creation failed", listAssignmentError.message);
      return apiError("Leadlisten kunne ikke tildeles brugeren.", 500);
    }
  } catch (error) {
    console.error("Lead import admin setup failed", error);
    return apiError("Import kræver, at SUPABASE_SERVICE_ROLE_KEY er konfigureret.", 503);
  }

  for (const [index, raw] of body.rows.entries()) {
    const rowNumber = rowOffset + index + 2;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      errors.push({ row: rowNumber, reason: "Ugyldig række" });
      continue;
    }
    const source = raw as Record<string, unknown>;
    const row: Record<string, unknown> = {};
    for (const [field, column] of Object.entries(mapping)) {
      if (allowedFields.has(field) && typeof column === "string" && typeof source[column] === "string") {
        row[field] = (source[column] as string).trim();
      }
    }
    const phone = normalizePhone(row.phone);
    const companyName = typeof row.company_name === "string" ? row.company_name.trim() : "";
    const normalizedCompany = companyName.toLocaleLowerCase("da-DK");
    if (!row.company_name || typeof row.company_name !== "string") {
      errors.push({ row: rowNumber, reason: "Firmanavn mangler" });
    } else if (!phone) {
      errors.push({ row: rowNumber, reason: "Ugyldigt telefonnummer" });
    } else if (phones.has(phone) || companies.has(normalizedCompany)) {
      errors.push({ row: rowNumber, reason: "Virksomhed eller telefonnummer findes allerede i filen" });
    } else {
      const employeeCount = row.employee_count ? Number(row.employee_count) : null;
      if (employeeCount !== null && (!Number.isInteger(employeeCount) || employeeCount < 0)) {
        errors.push({ row: rowNumber, reason: "Ugyldigt antal medarbejdere" });
        continue;
      }
      phones.add(phone);
      companies.add(normalizedCompany);
      sourceRowByPhone.set(phone, rowNumber);
      row.company_name = companyName;
      row.phone = phone;
      row.employee_count = employeeCount;
      rows.push(row);
    }
  }

  let inserted = 0;
  for (let offset = 0; offset < rows.length; offset += 250) {
    const chunk = rows.slice(offset, offset + 250);
    const [phoneResult, companyResult] = await Promise.all([
      context.supabase.from("leads").select("phone").is("deleted_at", null)
        .in("phone", chunk.map((row) => row.phone as string)),
      context.supabase.from("leads").select("company_name").is("deleted_at", null)
        .in("company_name", chunk.map((row) => row.company_name as string)),
    ]);
    if (phoneResult.error || companyResult.error) {
      console.error("Import duplicate lookup failed", phoneResult.error?.message ?? companyResult.error?.message);
      return apiError("Dublettkontrollen fejlede. Ingen flere rækker blev importeret.", 500);
    }
    const existingPhones = new Set((phoneResult.data ?? []).map((item) => item.phone));
    const existingCompanies = new Set((companyResult.data ?? []).map((item) => item.company_name.toLocaleLowerCase("da-DK")));
    const fresh: Record<string, unknown>[] = chunk.filter((row, localIndex) => {
      const duplicate = existingPhones.has(row.phone) || existingCompanies.has((row.company_name as string).toLocaleLowerCase("da-DK"));
      if (duplicate) errors.push({
        row: sourceRowByPhone.get(row.phone as string) ?? rowOffset + offset + localIndex + 2,
        reason: "Virksomhed eller telefonnummer findes allerede",
      });
      return !duplicate;
    }).map((row) => ({
      ...row,
      team_id: context.profile.team_id,
      lead_list_id: leadList.id,
      assigned_user_id: assignedUser.id,
      created_by: context.user.id,
      status: "new",
    }));
    if (!fresh.length) continue;
    async function insertWithIsolation(batch: typeof fresh): Promise<boolean> {
      if (!batch.length) return true;
      const { data, error } = await context.supabase.from("leads").insert(batch).select("id");
      if (!error) {
        inserted += data.length;
        return true;
      }
      console.error("Lead import insert failed", { code: error.code, message: error.message, rows: batch.length });
      if (isRowConstraintError(error.code)) {
        if (batch.length === 1) {
          errors.push({
            row: sourceRowByPhone.get(batch[0].phone as string) ?? 0,
            reason: rowConstraintMessage(error.code),
          });
          return true;
        }
        const midpoint = Math.floor(batch.length / 2);
        const firstSucceeded = await insertWithIsolation(batch.slice(0, midpoint));
        if (!firstSucceeded) return false;
        return insertWithIsolation(batch.slice(midpoint));
      }
      return false;
    }

    const succeeded = await insertWithIsolation(fresh);
    if (!succeeded) {
      return NextResponse.json({
        error: "Importen blev stoppet af en databasefejl. Allerede importerede rækker er gemt; se antal og rækkefejl nedenfor.",
        imported: inserted,
        rejected: errors.length,
        errors,
      }, { status: 500 });
    }
  }
  await writeAudit(context, "imported", "lead", null, { imported: inserted, rejected: errors.length });
  return NextResponse.json({ imported: inserted, rejected: errors.length, errors });
}
