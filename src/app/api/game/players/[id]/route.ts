import { NextResponse } from "next/server";
import { apiError } from "@/lib/http";
import { companyValue, gameResult, isUuid, requirePlayer } from "@/lib/game";

// Public game profile of another qualified player. Never includes DKK earnings
// or CRM data.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const result = await requirePlayer();
  if ("response" in result) return result.response;
  const { admin, userId, teamId } = result;
  const { id } = await params;
  if (!isUuid(id)) return apiError("Spilleren findes ikke.", 404);
  const { data: viewer } = await admin.from("game_profiles").select("market_unlocked_at").eq("user_id", userId).single();
  if (!viewer?.market_unlocked_at) return gameResult("market_locked");
  const { data: player, error } = await admin.from("game_profiles")
    .select("user_id, company_name, level, xp, public_profile, market_unlocked_at")
    .eq("user_id", id).eq("team_id", teamId).maybeSingle();
  if (error) return apiError("Profilen kunne ikke hentes.", 500);
  if (!player || !player.public_profile || !player.market_unlocked_at) return apiError("Profilen er privat eller findes ikke.", 404);
  try {
    const [inventory, achievements, value] = await Promise.all([
      admin.from("game_inventory").select("asset_key").eq("owner_id", id),
      admin.from("game_user_achievements").select("achievement_key, completed_at").eq("user_id", id),
      companyValue(admin, id),
    ]);
    return NextResponse.json({
      data: {
        company_name: player.company_name, level: player.level, xp: player.xp, company_value: value,
        assets: (inventory.data ?? []).map((item) => item.asset_key),
        achievements: achievements.data ?? [],
      },
    });
  } catch (loadError) {
    console.error("Public game profile failed", loadError);
    return apiError("Profilen kunne ikke hentes.", 500);
  }
}
