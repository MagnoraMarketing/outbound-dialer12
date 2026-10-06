"use client";

import { Workspace } from "@/components/workspace";

export default function AdminPage() {
  const configured = Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
  return <Workspace configured={configured} adminEntry />;
}
