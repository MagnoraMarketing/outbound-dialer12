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
    return apiError(error instanceof Error ? error.message : "Telnyx-forbindelsen kunne ikke klargøres.", 503);
  }
}
