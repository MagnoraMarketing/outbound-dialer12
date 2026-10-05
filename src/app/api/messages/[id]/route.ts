import { NextResponse } from "next/server";
import { apiError, requireContext } from "@/lib/http";

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(_request: Request, route: RouteContext) {
  const result = await requireContext();
  if ("response" in result) return result.response;
  const { id } = await route.params;
  const { data, error } = await result.context.supabase.from("team_messages")
    .update({ read_at: new Date().toISOString() })
    .eq("id", id)
    .eq("team_id", result.context.profile.team_id)
    .eq("recipient_user_id", result.context.user.id)
    .select("id")
    .maybeSingle();
  if (error || !data) {
    if (error) console.error("Message read update failed", error.message);
    return apiError("Beskeden kunne ikke markeres som læst.", error ? 500 : 404);
  }
  return NextResponse.json({ success: true });
}
