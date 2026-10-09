import { apiError, createSupabaseAdminClient, requireContext } from "@/lib/http";

// Admin-only route context with a service-role client for team-scoped writes.
export async function requireAdmin(message = "Kun administratorer har adgang.") {
  const result = await requireContext();
  if ("response" in result) return { response: result.response } as const;
  if (result.context.profile.role !== "admin") return { response: apiError(message, 403) } as const;
  try {
    return { context: result.context, admin: createSupabaseAdminClient() } as const;
  } catch (error) {
    console.error("Admin service client setup failed", error);
    return { response: apiError("Administrationen er ikke konfigureret. Kontrollér serverens miljøvariabler.", 503) } as const;
  }
}
