import { apiError, readJson } from "@/lib/http";
import { gameResult, isUuid, requirePlayer } from "@/lib/game";

// Buys a listing. Access, balance, ownership and listing state are all checked
// and changed atomically in nordcall.game_market_buy.
export async function POST(request: Request) {
  const result = await requirePlayer();
  if ("response" in result) return result.response;
  const body = await readJson(request);
  if (!isUuid(body?.listing_id)) return apiError("Vælg en annonce.");
  const { data, error } = await result.admin.rpc("game_market_buy", { p_user: result.userId, p_listing_id: body.listing_id });
  if (error) {
    console.error("Market purchase failed", error.message);
    return apiError("Handlen kunne ikke gennemføres.", 500);
  }
  return gameResult(String(data));
}
