import { NextResponse } from "next/server";
import { apiError, createSupabaseAdminClient, requireContext } from "@/lib/http";

const RECENT_DAYS = 14;

// Team members who recently reached the Magnora Market threshold. Shown to
// everyone on the team. Only names and dates are shared, never amounts.
export async function GET() {
  const result = await requireContext();
  if ("response" in result) return result.response;
  const teamId = result.context.profile.team_id;
  let admin: ReturnType<typeof createSupabaseAdminClient>;
  try {
    admin = createSupabaseAdminClient();
  } catch {
    return NextResponse.json({ data: [] });
  }
  const since = new Date(Date.now() - RECENT_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const [players, threshold] = await Promise.all([
    admin.from("game_profiles").select("user_id, company_name, market_ready_at, market_unlocked_at")
      .eq("team_id", teamId).gte("market_ready_at", since).order("market_ready_at", { ascending: false }).limit(20),
    admin.from("game_config").select("value").eq("key", "market_unlock_dkk").maybeSingle(),
  ]);
  if (players.error) {
    console.error("Milestone query failed", players.error.message);
    return apiError("Milepælene kunne ikke hentes.", 500);
  }
  const ids = (players.data ?? []).map((row) => row.user_id);
  const { data: profiles } = ids.length
    ? await admin.from("profiles").select("id, full_name").in("id", ids)
    : { data: [] as { id: string; full_name: string }[] };
  const names = new Map((profiles ?? []).map((profile) => [profile.id, profile.full_name]));
  return NextResponse.json({
    threshold_dkk: Number(threshold.data?.value ?? 50000),
    data: (players.data ?? []).map((row) => ({
      user_id: row.user_id,
      name: names.get(row.user_id) || row.company_name,
      company_name: row.company_name,
      ready_at: row.market_ready_at,
      unlocked: Boolean(row.market_unlocked_at),
      own: row.user_id === result.context.user.id,
    })),
  });
}
