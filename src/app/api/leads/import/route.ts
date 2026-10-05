import { NextResponse } from "next/server";
import { apiError, readJson, requireContext, writeAudit } from "@/lib/http";
import { normalizePhone } from "@/lib/leads";

const allowedFields = new Set([
  "company_name", "cvr", "contact_person", "phone", "email", "website",
  "address", "city", "industry", "employee_count", "notes",
]);

export async function POST(request: Request) {
  const result = await requireContext();
  if ("response" in result) return result.response;
  const body = await readJson(request);
  if (!body || !Array.isArray(body.rows) || !body.mapping || typeof body.mapping !== "object") return apiError("CSV-data eller kolonnemapping mangler.");
  if (body.rows.length > 10_000) return apiError("Importen er begrænset til 10.000 rækker ad gangen.", 413);
  const rowOffset = typeof body.row_offset === "number" && Number.isInteger(body.row_offset) && body.row_offset >= 0
    ? body.row_offset : 0;
  const mapping = body.mapping as Record<string, unknown>;
  const rows: Record<string, unknown>[] = [];
  const errors: { row: number; reason: string }[] = [];
  const phones = new Set<string>();
  const companies = new Set<string>();
  const sourceRowByPhone = new Map<string, number>();
  const { context } = result;

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
    const fresh = chunk.filter((row, localIndex) => {
      const duplicate = existingPhones.has(row.phone) || existingCompanies.has((row.company_name as string).toLocaleLowerCase("da-DK"));
      if (duplicate) errors.push({
        row: sourceRowByPhone.get(row.phone as string) ?? rowOffset + offset + localIndex + 2,
        reason: "Virksomhed eller telefonnummer findes allerede",
      });
      return !duplicate;
    }).map((row) => ({
      ...row,
      team_id: context.profile.team_id,
      assigned_user_id: context.user.id,
      created_by: context.user.id,
      status: "new",
    }));
    if (!fresh.length) continue;
    const { data, error } = await context.supabase.from("leads").insert(fresh).select("id");
    if (error) {
      console.error("Lead import insert failed", error.message);
      return NextResponse.json({ error: "Importen blev delvist gennemført.", imported: inserted, errors }, { status: 500 });
    }
    inserted += data.length;
  }
  await writeAudit(context, "imported", "lead", null, { imported: inserted, rejected: errors.length });
  return NextResponse.json({ imported: inserted, rejected: errors.length, errors });
}
