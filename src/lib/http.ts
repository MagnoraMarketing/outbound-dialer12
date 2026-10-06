import { NextResponse } from "next/server";
import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import { getAuthenticatedContext } from "@/lib/supabase/server";

type AuthContext = {
  supabase: SupabaseClient;
  user: User;
  profile: { id: string; team_id: string; full_name: string; role: "admin" | "manager" | "salesperson"; recordings_enabled: boolean; call_recording_enabled: boolean };
};

export function apiError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export async function requireContext() {
  try {
    const context = await getAuthenticatedContext();
    if ("supabase" in context) return { context: context as AuthContext } as const;
    return { response: apiError(context.error, context.status) } as const;
  } catch (error) {
    console.error("Unable to initialize Supabase request", error);
    return { response: apiError("Databasen er ikke konfigureret. Kontrollér serverens miljøvariabler.", 503) } as const;
  }
}

export async function readJson(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const body: unknown = await request.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) return null;
    return body as Record<string, unknown>;
  } catch {
    return null;
  }
}

export async function writeAudit(
  context: AuthContext,
  action: string,
  entityType: string,
  entityId: string | null,
  metadata: Record<string, unknown> = {},
) {
  const { error } = await context.supabase.from("audit_logs").insert({
    team_id: context.profile.team_id,
    user_id: context.user.id,
    action,
    entity_type: entityType,
    entity_id: entityId,
    metadata,
  });
  if (error) console.error("Audit event could not be stored", error.message);
}

export function createSupabaseAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) throw new Error("Privileged Supabase access is not configured.");
  return createClient(url, serviceKey, {
    db: { schema: "nordcall" },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
