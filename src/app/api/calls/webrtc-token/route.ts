import { NextResponse } from "next/server";
import { apiError, requireContext } from "@/lib/http";
import { createWebRtcToken } from "@/lib/telephony/webrtc";

export async function POST() {
  const result = await requireContext();
  if ("response" in result) return result.response;
  try {
    const data = await createWebRtcToken(result.context.user.id, result.context.profile.team_id);
    return NextResponse.json({ data });
  } catch (error) {
    console.error("Could not issue Telnyx WebRTC token", error);
    // Setup details are for administrators only; sellers never see provider names.
    const detail = error instanceof Error ? error.message : "";
    return apiError(result.context.profile.role === "admin" && detail
      ? `Telefonien er ikke sat korrekt op: ${detail}`
      : "Opkald er ikke klar lige nu. Kontakt din administrator.", 503);
  }
}
