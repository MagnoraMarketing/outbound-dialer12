import { createServerClient } from "@supabase/ssr";
import type { CookieOptions } from "@supabase/ssr/dist/module/types";
import { cookies } from "next/headers";

export function isSupabaseConfigured() {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}

export async function createSupabaseServerClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("Supabase is not configured. Add the project URL and anon key to the server environment.");
  const cookieStore = await cookies();

  return createServerClient(url, key, {
    db: { schema: "nordcall" },
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (updates: { name: string; value: string; options: CookieOptions }[]) => {
        try {
          updates.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Server components cannot mutate cookies; middleware refreshes sessions.
        }
      },
    },
  });
}

export async function getAuthenticatedContext() {
  const supabase = await createSupabaseServerClient();
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) return { error: "Log ind for at fortsætte.", status: 401 as const };
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id, team_id, full_name, role, recordings_enabled")
    .eq("id", user.id)
    .single();
  if (profileError || !profile) return { error: "Din brugerprofil mangler et team. Kontakt administratoren.", status: 403 as const };
  if (!profile.team_id) return { error: "Din bruger er endnu ikke tilknyttet et team.", status: 403 as const };
  return { supabase, user, profile };
}

export type AuthContext = Extract<Awaited<ReturnType<typeof getAuthenticatedContext>>, { supabase: unknown }>;
