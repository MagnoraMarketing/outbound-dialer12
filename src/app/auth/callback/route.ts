import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const nextPath = request.nextUrl.searchParams.get("next");
  const returnPath = nextPath?.startsWith("/") && !nextPath.startsWith("//") ? nextPath : "/";
  const isRecovery = request.nextUrl.searchParams.get("recovery") === "1";
  if (!code) {
    const redirectUrl = new URL(returnPath, request.url);
    redirectUrl.searchParams.set("authError", "confirmation");
    return NextResponse.redirect(redirectUrl);
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    console.error("Email confirmation callback failed", error.message);
    return NextResponse.redirect(new URL("/?authError=confirmation", request.url));
  }

  const redirectUrl = new URL(returnPath, request.url);
  if (isRecovery) redirectUrl.searchParams.set("recovery", "1");
  return NextResponse.redirect(redirectUrl);
}
