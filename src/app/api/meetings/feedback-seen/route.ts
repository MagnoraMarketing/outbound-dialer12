import { NextResponse } from "next/server";
import { apiError, createSupabaseAdminClient, requireContext } from "@/lib/http";

// Marks customer feedback on the signed-in seller's own meetings as seen.
export async function POST() {
  const result = await requireContext();
  if ("response" in result) return result.response;
  const { context } = result;
  try {
    const admin = createSupabaseAdminClient();
    const { data: meetings, error } = await admin.from("meetings").select("id")
      .eq("team_id", context.profile.team_id).eq("user_id", context.user.id);
    if (error) throw new Error(error.message);
    const ids = (meetings ?? []).map((meeting) => meeting.id as string);
    for (let offset = 0; offset < ids.length; offset += 200) {
      const { error: updateError } = await admin.from("meeting_feedback").update({ seller_seen_at: new Date().toISOString() })
        .eq("team_id", context.profile.team_id).is("seller_seen_at", null).in("meeting_id", ids.slice(offset, offset + 200));
      if (updateError) throw new Error(updateError.message);
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Marking meeting feedback as seen failed", error);
    return apiError("Feedback kunne ikke markeres som set.", 500);
  }
}
