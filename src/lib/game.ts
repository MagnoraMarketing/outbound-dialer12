import { NextResponse } from "next/server";
import { apiError, createSupabaseAdminClient, requireContext } from "@/lib/http";

type AdminClient = ReturnType<typeof createSupabaseAdminClient>;

// Messages for the result codes returned by the nordcall.game_* database functions.
const resultMessages: Record<string, [string, number]> = {
  insufficient_funds: ["Du har ikke nok virtuelle kroner.", 400],
  level_too_low: ["Du skal have et højere level for at købe dette aktiv.", 403],
  limit_reached: ["Du ejer allerede det maksimale antal af dette aktiv.", 400],
  unknown_asset: ["Aktivet findes ikke.", 404],
  market_locked: ["Magnora Market er låst. Det åbner ved 100.000 DKK i godkendt salgsindtjening.", 403],
  not_owner: ["Du kan kun sælge aktiver, du selv ejer.", 403],
  not_transferable: ["Dette aktiv kan ikke handles.", 400],
  already_listed: ["Aktivet er allerede sat til salg.", 409],
  invalid_price: ["Prisen skal være mellem 1 og 100.000.000 virtuelle kroner.", 400],
  not_available: ["Annoncen er ikke længere til salg.", 409],
  own_listing: ["Du kan ikke købe din egen annonce.", 400],
  not_found: ["Annoncen blev ikke fundet.", 404],
};

export function gameResult(code: string, success: Record<string, unknown> = {}) {
  if (code === "ok") return NextResponse.json({ success: true, ...success });
  if (code === "duplicate") return NextResponse.json({ success: true, duplicate: true, ...success });
  const [message, status] = resultMessages[code] ?? ["Handlingen kunne ikke gennemføres.", 400];
  return apiError(message, status);
}

// Signed-in team member with a synced game profile. Partner logins have no team
// profile and are rejected by requireContext.
export async function requirePlayer() {
  const result = await requireContext();
  if ("response" in result) return { response: result.response } as const;
  let admin: AdminClient;
  try {
    admin = createSupabaseAdminClient();
  } catch (error) {
    console.error("Game service client setup failed", error);
    return { response: apiError("Spillet er ikke klar endnu. Kontakt din administrator.", 503) } as const;
  }
  const { error } = await admin.rpc("game_sync", { p_user: result.context.user.id });
  if (error) {
    console.error("Game sync failed", error.message);
    const missing = error.message.includes("game_sync") || error.code === "PGRST202";
    return { response: apiError(missing ? "Spillet er ikke klar endnu. Kontakt din administrator." : "Spillet kunne ikke indlæses.", missing ? 503 : 500) } as const;
  }
  return { context: result.context, admin, userId: result.context.user.id, teamId: result.context.profile.team_id } as const;
}

export async function loadAssetCatalog(admin: AdminClient) {
  const { data, error } = await admin.from("game_assets")
    .select("key, name, description, category, price, value, min_level, max_per_user, transferable, art, sort")
    .eq("active", true).order("sort");
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function companyValue(admin: AdminClient, userId: string) {
  const { data, error } = await admin.from("game_inventory").select("asset_key, game_assets(value)").eq("owner_id", userId);
  if (error) throw new Error(error.message);
  return (data ?? []).reduce((sum, row) => {
    const asset = row.game_assets as unknown as { value: number } | { value: number }[] | null;
    return sum + Number(Array.isArray(asset) ? asset[0]?.value ?? 0 : asset?.value ?? 0);
  }, 0);
}

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}
