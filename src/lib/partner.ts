import { apiError, createSupabaseAdminClient } from "@/lib/http";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type PartnerUser = { user_id: string; team_id: string; partner_id: string; full_name: string; email: string };

// Resolves the signed-in partner user and the campaigns of their partner. Partner
// users have no team profile, so every query uses the service role and is scoped here.
export async function requirePartnerUser() {
  try {
    const supabase = await createSupabaseServerClient();
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) return { response: apiError("Log ind for at fortsætte.", 401) } as const;
    const admin = createSupabaseAdminClient();
    const { data: account, error } = await admin.from("partner_users")
      .select("user_id, team_id, partner_id, full_name, email").eq("user_id", user.id).maybeSingle();
    if (error) {
      console.error("Partner user lookup failed", error.message);
      return { response: apiError("Kontoen kunne ikke indlæses.", 500) } as const;
    }
    if (!account) return { response: apiError("Din bruger har ikke adgang til partnerportalen.", 403) } as const;
    const [partner, campaigns] = await Promise.all([
      admin.from("partners").select("id, name").eq("id", account.partner_id).eq("team_id", account.team_id).maybeSingle(),
      admin.from("campaigns").select("id, name").eq("team_id", account.team_id).eq("partner_id", account.partner_id),
    ]);
    if (partner.error || campaigns.error || !partner.data) {
      console.error("Partner lookup failed", partner.error?.message ?? campaigns.error?.message ?? "Partner missing");
      return { response: apiError("Kontoen kunne ikke indlæses.", 500) } as const;
    }
    return {
      context: {
        admin,
        account: account as PartnerUser,
        partnerName: partner.data.name as string,
        campaigns: (campaigns.data ?? []) as { id: string; name: string }[],
      },
    } as const;
  } catch (error) {
    console.error("Unable to initialize partner request", error);
    return { response: apiError("Partnerportalen er ikke konfigureret. Kontrollér serverens miljøvariabler.", 503) } as const;
  }
}
