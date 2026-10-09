import { NextResponse } from "next/server";
import { apiError, readJson } from "@/lib/http";
import { gameResult, isUuid, loadAssetCatalog, requirePlayer } from "@/lib/game";

async function requireMarketPlayer() {
  const result = await requirePlayer();
  if ("response" in result) return result;
  const { data, error } = await result.admin.from("game_profiles").select("market_unlocked_at").eq("user_id", result.userId).single();
  if (error) {
    console.error("Market access lookup failed", error.message);
    return { response: apiError("Magnora Market kunne ikke indlæses.", 500) } as const;
  }
  if (!data.market_unlocked_at) return { response: gameResult("market_locked") } as const;
  return result;
}

// Listings, own listings, trade history and other qualified players in the team.
export async function GET() {
  const result = await requireMarketPlayer();
  if ("response" in result) return result.response;
  const { admin, userId, teamId } = result;
  try {
    const [assets, listings, history, players] = await Promise.all([
      loadAssetCatalog(admin),
      admin.from("game_market_listings").select("id, seller_id, inventory_id, asset_key, price, status, created_at")
        .eq("team_id", teamId).eq("status", "active").order("created_at", { ascending: false }).limit(300),
      admin.from("game_market_listings").select("id, seller_id, buyer_id, asset_key, price, status, created_at, closed_at")
        .eq("team_id", teamId).neq("status", "active").or(`seller_id.eq.${userId},buyer_id.eq.${userId}`)
        .order("closed_at", { ascending: false }).limit(100),
      admin.from("game_profiles").select("user_id, company_name, level, xp, public_profile")
        .eq("team_id", teamId).not("market_unlocked_at", "is", null),
    ]);
    const failed = [listings, history, players].find((query) => query.error);
    if (failed?.error) throw new Error(failed.error.message);
    const assetByKey = new Map(assets.map((asset) => [asset.key, asset]));
    // Only company name and level are shown for counterparties; nothing from the CRM.
    const names = new Map((players.data ?? []).map((player) => [player.user_id, { company_name: player.company_name, level: player.level }]));
    const describe = (key: string) => {
      const asset = assetByKey.get(key);
      return asset ? { name: asset.name, description: asset.description, category: asset.category, value: asset.value, min_level: asset.min_level, art: asset.art }
        : { name: key, description: "", category: "special", value: 0, min_level: 1, art: "box" };
    };
    return NextResponse.json({
      listings: (listings.data ?? []).map((listing) => ({
        ...listing, asset: describe(listing.asset_key), seller: names.get(listing.seller_id) ?? null, own: listing.seller_id === userId,
      })),
      history: (history.data ?? []).map((trade) => ({
        ...trade, asset: describe(trade.asset_key), role: trade.seller_id === userId ? "seller" : "buyer",
        counterparty: names.get(trade.seller_id === userId ? trade.buyer_id ?? "" : trade.seller_id)?.company_name ?? null,
      })),
      players: (players.data ?? []).filter((player) => player.public_profile && player.user_id !== userId)
        .map(({ user_id, company_name, level, xp }) => ({ user_id, company_name, level, xp })),
    });
  } catch (error) {
    console.error("Market query failed", error);
    return apiError("Magnora Market kunne ikke indlæses.", 500);
  }
}

// Puts an owned asset up for sale.
export async function POST(request: Request) {
  const result = await requireMarketPlayer();
  if ("response" in result) return result.response;
  const body = await readJson(request);
  const price = Number(body?.price);
  if (!isUuid(body?.inventory_id) || !Number.isInteger(price)) return apiError("Vælg et aktiv og en pris i hele kroner.");
  const { data, error } = await result.admin.rpc("game_market_list", { p_user: result.userId, p_inventory_id: body.inventory_id, p_price: price });
  if (error) {
    console.error("Market listing failed", error.message);
    return apiError("Annoncen kunne ikke oprettes.", 500);
  }
  return gameResult(String(data));
}

export async function DELETE(request: Request) {
  const result = await requirePlayer();
  if ("response" in result) return result.response;
  const id = new URL(request.url).searchParams.get("id");
  if (!isUuid(id)) return apiError("Vælg en annonce.");
  const { data, error } = await result.admin.rpc("game_market_cancel", { p_user: result.userId, p_listing_id: id });
  if (error) {
    console.error("Market cancel failed", error.message);
    return apiError("Annoncen kunne ikke trækkes tilbage.", 500);
  }
  return gameResult(String(data));
}
