import { NextResponse } from "next/server";
import { apiError, readJson, requireContext, writeAudit } from "@/lib/http";

export async function GET() {
  const result = await requireContext();
  if ("response" in result) return result.response;
  return NextResponse.json({ recordings_enabled: result.context.profile.recordings_enabled });
}

export async function PATCH(request: Request) {
  const result = await requireContext();
  if ("response" in result) return result.response;
  const body = await readJson(request);
  if (typeof body?.recordings_enabled !== "boolean") return apiError("Vælg, om du må lytte til samtaleoptagelser.");
  const { context } = result;
  const { error } = await context.supabase.from("profiles")
    .update({ recordings_enabled: body.recordings_enabled })
    .eq("id", context.user.id).eq("team_id", context.profile.team_id);
  if (error) {
    console.error("Recording access preference update failed", error.message);
    return apiError("Indstillingen for samtaleoptagelser kunne ikke gemmes.", 500);
  }
  await writeAudit(context, "recording_access_updated", "profile", context.user.id, {
    recordings_enabled: body.recordings_enabled,
  });
  return NextResponse.json({ recordings_enabled: body.recordings_enabled });
}
