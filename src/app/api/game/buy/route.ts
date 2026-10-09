import { apiError, readJson } from "@/lib/http";
import { gameResult, isUuid, requirePlayer } from "@/lib/game";

// Buys a catalog asset. Price, level, limits and balance are checked in the
// database function; request_id makes retries of the same click harmless.
export async function POST(request: Request) {
  const result = await requirePlayer();
  if ("response" in result) return result.response;
  const body = await readJson(request);
  if (typeof body?.asset_key !== "string" || !isUuid(body.request_id)) return apiError("Vælg et aktiv at købe.");
  const { data, error } = await result.admin.rpc("game_buy_asset", {
    p_user: result.userId, p_asset_key: body.asset_key, p_request_id: body.request_id,
  });
  if (error) {
    console.error("Game purchase failed", error.message);
    return apiError("Købet kunne ikke gennemføres.", 500);
  }
  return gameResult(String(data));
}
