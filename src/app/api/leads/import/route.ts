import { NextResponse } from "next/server";
import { apiError, readJson, requireContext, writeAudit } from "@/lib/http";
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
  const rows: Record<string, unknown>[] = [];
  const errors: { row: number; reason: string }[] = [];
  const phones = new Set<string>();
  const companies = new Set<string>();
  const sourceRowByPhone = new Map<string, number>();
  const { context } = result;
  const { data: leadList, error: listError } = await context.supabase.from("lead_lists")
    .select("id, campaign_id").eq("id", body.lead_list_id).eq("team_id", context.profile.team_id).maybeSingle();
  if (listError || !leadList) return apiError("Leadlisten blev ikke fundet i dit team.", listError ? 500 : 404);

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
      const hasPhone = typeof row.phone === "string" && row.phone.trim() !== "";
      errors.push({ row: rowNumber, reason: hasPhone ? `Ugyldigt telefonnummer (${(row.phone as string).slice(0, 40)})` : "Telefonnummer mangler" });
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
  let moved = 0;
  for (let offset = 0; offset < rows.length; offset += 250) {
    const chunk = rows.slice(offset, offset + 250);
    const [phoneResult, companyResult] = await Promise.all([
      context.supabase.from("leads").select("id, phone, company_name, lead_list_id, status").is("deleted_at", null)
        .in("phone", chunk.map((row) => row.phone as string)),
      context.supabase.from("leads").select("id, phone, company_name, lead_list_id, status").is("deleted_at", null)
        .in("company_name", chunk.map((row) => row.company_name as string)),
    ]);
    if (phoneResult.error || companyResult.error) {
      console.error("Import duplicate lookup failed", phoneResult.error?.message ?? companyResult.error?.message);
      return apiError("Dublettkontrollen fejlede. Ingen flere rækker blev importeret.", 500);
    }
    type ExistingLead = { id: string; phone: string; company_name: string; lead_list_id: string | null; status: string };
    const byPhone = new Map((phoneResult.data ?? []).map((item) => [item.phone as string, item as ExistingLead]));
    const byCompany = new Map((companyResult.data ?? [])
      .map((item) => [(item.company_name as string).toLocaleLowerCase("da-DK"), item as ExistingLead]));
    // Companies the team already has are moved into the chosen campaign and list
    // instead of being skipped, so a list can be re-imported into a new campaign.
    const moveIds: string[] = [];
    const fresh: Record<string, unknown>[] = chunk.filter((row, localIndex) => {
      const existing = byPhone.get(row.phone as string) ?? byCompany.get((row.company_name as string).toLocaleLowerCase("da-DK"));
      if (!existing) return true;
      const sourceRow = sourceRowByPhone.get(row.phone as string) ?? rowOffset + offset + localIndex + 2;
      if (existing.lead_list_id === leadList.id) {
        errors.push({ row: sourceRow, reason: "Virksomheden findes allerede i denne leadliste" });
      } else if (existing.status === "do_not_call") {
        errors.push({ row: sourceRow, reason: "Virksomheden er markeret som 'Ring ikke'" });
      } else if (!moveIds.includes(existing.id)) {
        moveIds.push(existing.id);
      }
      return false;
    }).map((row) => ({
      ...row,
      team_id: context.profile.team_id,
      campaign_id: leadList.campaign_id,
      lead_list_id: leadList.id,
      assigned_user_id: null,
      created_by: context.user.id,
      status: "new",
    }));
    if (moveIds.length) {
      const { error: moveError } = await context.supabase.from("leads")
        .update({ campaign_id: leadList.campaign_id, lead_list_id: leadList.id })
        .in("id", moveIds).eq("team_id", context.profile.team_id);
      if (moveError) {
        console.error("Lead import move failed", moveError.code, moveError.message);
        return apiError("Eksisterende virksomheder kunne ikke flyttes til kampagnen.", 500);
      }
      moved += moveIds.length;
    }
    if (!fresh.length) continue;
    async function insertWithIsolation(batch: typeof fresh): Promise<boolean> {
      if (!batch.length) return true;
      // No RETURNING: the leads read policy cannot see rows during their own INSERT.
      const { error } = await context.supabase.from("leads").insert(batch);
      if (!error) {
        inserted += batch.length;
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
        moved,
        rejected: errors.length,
        errors,
      }, { status: 500 });
    }
  }
  await writeAudit(context, "imported", "lead", null, { imported: inserted, moved, rejected: errors.length });
  return NextResponse.json({ imported: inserted, moved, rejected: errors.length, errors });
}
