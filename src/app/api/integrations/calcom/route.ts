import { NextResponse } from "next/server";
import { apiError, createSupabaseAdminClient, requireContext } from "@/lib/http";

export async function GET() {
  const result = await requireContext();
  if ("response" in result) return result.response;
  try {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin.from("calcom_connections")
      .select("connected_at, expires_at")
      .eq("user_id", result.context.user.id)
      .eq("team_id", result.context.profile.team_id)
      .maybeSingle();
    if (error) {
      console.error("Cal.com connection status query failed", error.message);
      return apiError("Cal.com-forbindelsens status kunne ikke hentes.", 500);
    }
    return NextResponse.json({ connected: Boolean(data), connected_at: data?.connected_at ?? null });
  } catch (error) {
    console.error("Cal.com connection status is unavailable", error);
    return apiError("Cal.com-forbindelsen kræver SUPABASE_SERVICE_ROLE_KEY på serveren.", 503);
  }
}

export async function DELETE() {
  const result = await requireContext();
  if ("response" in result) return result.response;
  try {
    const admin = createSupabaseAdminClient();
    const { error } = await admin.from("calcom_connections")
      .delete().eq("user_id", result.context.user.id).eq("team_id", result.context.profile.team_id);
    if (error) {
      console.error("Cal.com connection disconnect failed", error.message);
      return apiError("Cal.com-kontoen kunne ikke afkobles.", 500);
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Cal.com disconnect is unavailable", error);
    return apiError("Cal.com-forbindelsen kunne ikke afkobles.", 503);
  }
}
