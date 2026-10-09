import { NextResponse } from "next/server";
import { requirePartnerUser } from "@/lib/partner";

export async function GET() {
  const result = await requirePartnerUser();
  if ("response" in result) return result.response;
  return NextResponse.json({ data: { customer: true } });
}
