import { NextResponse } from "next/server";
import { apiError, readJson } from "@/lib/http";
import { requirePlayer } from "@/lib/game";

// Players may only change their company name and profile visibility.
export async function PATCH(request: Request) {
  const result = await requirePlayer();
  if ("response" in result) return result.response;
  const body = await readJson(request);
  const changes: Record<string, unknown> = {};
  if (body?.company_name !== undefined) {
    const name = typeof body.company_name === "string" ? body.company_name.trim() : "";
    if (name.length < 2 || name.length > 60) return apiError("Virksomhedsnavnet skal være 2–60 tegn.");
    changes.company_name = name;
  }
  if (body?.public_profile !== undefined) {
    if (typeof body.public_profile !== "boolean") return apiError("Vælg om profilen er offentlig.");
    changes.public_profile = body.public_profile;
  }
  if (!Object.keys(changes).length) return apiError("Der er ingen ændringer at gemme.");
  const { error } = await result.admin.from("game_profiles")
    .update({ ...changes, updated_at: new Date().toISOString() }).eq("user_id", result.userId);
  if (error) {
    console.error("Game profile update failed", error.message);
    return apiError("Profilen kunne ikke gemmes.", 500);
  }
  return NextResponse.json({ success: true });
}
