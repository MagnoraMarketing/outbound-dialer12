import { NextResponse } from "next/server";
import { apiError } from "@/lib/http";
import { loadAssetCatalog, requirePlayer } from "@/lib/game";

// Full game state for the signed-in player. Syncs verified events first.
export async function GET() {
  const result = await requirePlayer();
  if ("response" in result) return result.response;
  const { admin, userId, teamId } = result;
  try {
    const [profile, assets, levels, inventory, achievements, unlocked, transactions, config, approvals, listings] = await Promise.all([
      admin.from("game_profiles")
        .select("company_name, level, xp, balance, lifetime_earned, verified_earnings_dkk, market_unlocked_at, public_profile, created_at")
        .eq("user_id", userId).single(),
      loadAssetCatalog(admin),
      admin.from("game_levels").select("level, title, min_company_value, required_asset, description").order("level"),
      admin.from("game_inventory").select("id, asset_key, acquired_at, acquired_price, acquired_via").eq("owner_id", userId).order("acquired_at"),
      admin.from("game_achievements").select("key, title, description, requirement_type, threshold, required_asset, reward").order("sort"),
      admin.from("game_user_achievements").select("achievement_key, completed_at").eq("user_id", userId),
      admin.from("game_transactions").select("id, kind, amount, balance_after, description, created_at")
        .eq("user_id", userId).order("created_at", { ascending: false }).limit(30),
      admin.from("game_config").select("key, value"),
      admin.from("earning_approvals").select("source_type").eq("user_id", userId).eq("team_id", teamId).eq("status", "approved"),
      admin.from("game_market_listings").select("inventory_id").eq("seller_id", userId).eq("status", "active"),
    ]);
    const failed = [profile, levels, inventory, achievements, unlocked, transactions, config, approvals, listings].find((query) => query.error);
    if (failed?.error) throw new Error(failed.error.message);
    if (!profile.data) throw new Error("Game profile missing after sync");
    const player = profile.data;

    const settings = Object.fromEntries((config.data ?? []).map((row) => [row.key, Number(row.value)]));
    const assetByKey = new Map(assets.map((asset) => [asset.key, asset]));
    const companyValue = (inventory.data ?? []).reduce((sum, item) => sum + Number(assetByKey.get(item.asset_key)?.value ?? 0), 0);
    const completed = new Map((unlocked.data ?? []).map((row) => [row.achievement_key, row.completed_at]));
    const listed = new Set((listings.data ?? []).map((row) => row.inventory_id));
    const threshold = settings.market_unlock_dkk ?? 100000;
    const earnings = Number(player.verified_earnings_dkk);

    return NextResponse.json({
      profile: {
        ...player,
        verified_earnings_dkk: earnings,
        company_value: companyValue,
        net_worth: Number(player.balance) + companyValue,
      },
      stats: {
        approved_meetings: (approvals.data ?? []).filter((row) => row.source_type === "meeting").length,
        approved_sales: (approvals.data ?? []).filter((row) => row.source_type === "sale").length,
        owned_assets: (inventory.data ?? []).length,
      },
      market: {
        threshold_dkk: threshold,
        unlocked: Boolean(player.market_unlocked_at),
        unlocked_at: player.market_unlocked_at,
        remaining_dkk: Math.max(0, threshold - earnings),
        percent: Math.min(100, Math.floor((earnings / threshold) * 1000) / 10),
      },
      rewards: {
        meeting_approved: settings.reward_meeting_approved ?? 500,
        meeting_held: settings.reward_meeting_held ?? 500,
        sale_approved: settings.reward_sale_approved ?? 1000,
      },
      levels: levels.data ?? [],
      assets,
      inventory: (inventory.data ?? []).map((item) => ({ ...item, listed: listed.has(item.id) })),
      achievements: (achievements.data ?? []).map((achievement) => ({ ...achievement, completed_at: completed.get(achievement.key) ?? null })),
      transactions: transactions.data ?? [],
    });
  } catch (error) {
    console.error("Game state query failed", error);
    return apiError("Spillet kunne ikke indlæses.", 500);
  }
}
