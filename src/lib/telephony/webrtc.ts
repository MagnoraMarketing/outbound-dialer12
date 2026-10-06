import { createSupabaseAdminClient } from "@/lib/http";

type TelnyxPayload = {
  data?: {
    id?: string;
    token?: string;
    jwt?: string;
  } | string;
  id?: string;
  token?: string;
  jwt?: string;
};

function getTelnyxConfig() {
  const apiKey = process.env.TELNYX_API_KEY;
  const connectionId = process.env.TELNYX_WEBRTC_CONNECTION_ID;
  const callerNumber = process.env.TELNYX_PHONE_NUMBER;
  if (!apiKey || !connectionId || !callerNumber) {
    throw new Error("Telnyx WebRTC mangler serveropsætning. Kontakt administratoren.");
  }
  const normalizedCallerNumber = callerNumber.trim().replace(/[\s().-]/g, "");
  if (!/^\+[1-9]\d{7,14}$/.test(normalizedCallerNumber)) {
    throw new Error("TELNYX_PHONE_NUMBER skal være et gyldigt nummer i internationalt format.");
  }
  return { apiKey, connectionId, callerNumber: normalizedCallerNumber };
}

async function telnyxRequest(path: string, apiKey: string, body?: Record<string, string>) {
  const response = await fetch(`https://api.telnyx.com/v2${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(15_000),
  });
  const text = await response.text();
  let payload: TelnyxPayload | null = null;
  if (text) {
    try {
      payload = JSON.parse(text) as TelnyxPayload;
    } catch {
      throw new Error("Telnyx returnerede et ugyldigt svar.");
    }
  }
  if (!response.ok) {
    console.error("Telnyx WebRTC API request failed", response.status, payload);
    throw new Error(`Telnyx kunne ikke behandle WebRTC-anmodningen (HTTP ${response.status}).`);
  }
  return payload;
}

async function getOrCreateCredential(userId: string, teamId: string) {
  const { apiKey, connectionId } = getTelnyxConfig();
  const admin = createSupabaseAdminClient();
  const { data: existing, error: lookupError } = await admin
    .from("telnyx_webrtc_credentials")
    .select("credential_id")
    .eq("user_id", userId)
    .eq("team_id", teamId)
    .maybeSingle();
  if (lookupError) {
    console.error("Telnyx WebRTC credential lookup failed", lookupError.message);
    throw new Error("Brugerens Telnyx-forbindelse kunne ikke indlæses.");
  }
  if (existing?.credential_id) return existing.credential_id;

  const payload = await telnyxRequest("/telephony_credentials", apiKey, {
    connection_id: connectionId,
    name: `Nordcall ${userId}`,
  });
  const credentialId = typeof payload?.data === "object" ? payload.data?.id : payload?.id;
  if (!credentialId) {
    console.error("Telnyx credential response did not include a credential ID");
    throw new Error("Telnyx oprettede ikke en brugerforbindelse.");
  }

  const { error: insertError } = await admin.from("telnyx_webrtc_credentials").insert({
    user_id: userId,
    team_id: teamId,
    credential_id: credentialId,
  });
  if (insertError) {
    console.error("Telnyx WebRTC credential could not be saved", insertError.message);
    throw new Error("Brugerens Telnyx-forbindelse kunne ikke gemmes.");
  }
  return credentialId;
}

export async function createWebRtcToken(userId: string, teamId: string) {
  const { apiKey, callerNumber } = getTelnyxConfig();
  const credentialId = await getOrCreateCredential(userId, teamId);
  const payload = await telnyxRequest(
    `/telephony_credentials/${encodeURIComponent(credentialId)}/token`,
    apiKey,
  );
  const token = typeof payload?.data === "string"
    ? payload.data
    : typeof payload?.data === "object"
      ? payload.data?.token ?? payload.data?.jwt
      : payload?.token ?? payload?.jwt;
  if (!token) {
    console.error("Telnyx token response did not include a JWT");
    throw new Error("Telnyx returnerede ikke et gyldigt login-token.");
  }
  return { token, callerNumber };
}
