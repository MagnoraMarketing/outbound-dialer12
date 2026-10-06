import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient, requireContext } from "@/lib/http";
import { calcomRedirectUri, encryptCalcomToken } from "@/lib/integrations/calcom";

function settingsRedirect(request: NextRequest, status: "connected" | "error") {
  const redirect = new URL("/", request.url);
  redirect.searchParams.set("page", "settings");
  redirect.searchParams.set("calcom", status);
  return NextResponse.redirect(redirect);
}

export async function GET(request: NextRequest) {
  const stateCookie = request.cookies.get("nordcall_calcom_oauth_state")?.value;
  const suppliedState = request.nextUrl.searchParams.get("state");
  const code = request.nextUrl.searchParams.get("code");
  const response = settingsRedirect(request, "error");
  response.cookies.delete("nordcall_calcom_oauth_state");

  if (!stateCookie || !suppliedState || stateCookie !== suppliedState || !code) return response;
  const result = await requireContext();
  if ("response" in result) return response;

  const clientId = process.env.CAL_OAUTH_CLIENT_ID;
  const clientSecret = process.env.CAL_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret || !process.env.CAL_OAUTH_TOKEN_ENCRYPTION_KEY) return response;
  let tokenResponse: Response;
  try {
    tokenResponse = await fetch("https://api.cal.com/v2/auth/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: "authorization_code",
        code,
        redirect_uri: calcomRedirectUri(request.url),
      }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (error) {
    console.error("Cal.com OAuth token request failed", error);
    return response;
  }
  if (!tokenResponse.ok) {
    console.error("Cal.com OAuth token exchange rejected", tokenResponse.status);
    return response;
  }
  const tokenData: unknown = await tokenResponse.json().catch(() => null);
  if (!tokenData || typeof tokenData !== "object"
    || !("access_token" in tokenData) || typeof tokenData.access_token !== "string"
    || !tokenData.access_token) {
    console.error("Cal.com OAuth token response was invalid");
    return response;
  }
  const refreshToken = "refresh_token" in tokenData && typeof tokenData.refresh_token === "string"
    ? tokenData.refresh_token : null;
  const expiresIn = "expires_in" in tokenData && typeof tokenData.expires_in === "number"
    ? tokenData.expires_in : null;
  try {
    const admin = createSupabaseAdminClient();
    const { error } = await admin.from("calcom_connections").upsert({
      user_id: result.context.user.id,
      team_id: result.context.profile.team_id,
      encrypted_access_token: encryptCalcomToken(tokenData.access_token),
      encrypted_refresh_token: refreshToken ? encryptCalcomToken(refreshToken) : null,
      expires_at: expiresIn ? new Date(Date.now() + expiresIn * 1000).toISOString() : null,
      connected_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }, { onConflict: "user_id" });
    if (error) {
      console.error("Cal.com connection could not be saved", error.message);
      return response;
    }
  } catch (error) {
    console.error("Cal.com connection setup failed", error);
    return response;
  }
  const success = settingsRedirect(request, "connected");
  success.cookies.delete("nordcall_calcom_oauth_state");
  return success;
}
