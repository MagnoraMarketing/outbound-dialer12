import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { requireContext } from "@/lib/http";
import { calcomRedirectUri } from "@/lib/integrations/calcom";

export async function GET(request: Request) {
  const result = await requireContext();
  if ("response" in result) return result.response;
  const clientId = process.env.CAL_OAUTH_CLIENT_ID;
  if (!clientId || !process.env.CAL_OAUTH_CLIENT_SECRET || !process.env.CAL_OAUTH_TOKEN_ENCRYPTION_KEY) {
    return NextResponse.json({
      error: "Cal.com-forbindelsen er ikke konfigureret. Tilføj OAuth-klientens servernøgler i Vercel.",
    }, { status: 503 });
  }
  const state = randomBytes(32).toString("base64url");
  const callbackUrl = calcomRedirectUri(request.url);
  const authorizeUrl = new URL("https://app.cal.com/auth/oauth2/authorize");
  authorizeUrl.searchParams.set("client_id", clientId);
  authorizeUrl.searchParams.set("redirect_uri", callbackUrl);
  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set("state", state);
  const response = NextResponse.redirect(authorizeUrl);
  response.cookies.set("nordcall_calcom_oauth_state", state, {
    httpOnly: true,
    secure: new URL(request.url).protocol === "https:",
    sameSite: "lax",
    path: "/api/integrations/calcom/callback",
    maxAge: 600,
  });
  return response;
}
