import { apiError } from "@/lib/http";
import { gameResult, requirePlayer } from "@/lib/game";

// Opens Magnora Market for a player who has reached the verified-earnings
// threshold. The check and the change happen atomically in the database.
export async function POST() {
  const result = await requirePlayer();
  if ("response" in result) return result.response;
  const { data, error } = await result.admin.rpc("game_market_unlock", { p_user: result.userId });
  if (error) {
    console.error("Market unlock failed", error.message);
    return apiError("Markedet kunne ikke låses op.", 500);
  }
  return gameResult(String(data));
}
