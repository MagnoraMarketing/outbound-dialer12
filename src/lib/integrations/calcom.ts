import { createCipheriv, createHash, randomBytes } from "node:crypto";

export function encryptCalcomToken(token: string) {
  const secret = process.env.CAL_OAUTH_TOKEN_ENCRYPTION_KEY;
  if (!secret) throw new Error("CAL_OAUTH_TOKEN_ENCRYPTION_KEY is not configured.");
  const key = createHash("sha256").update(secret).digest();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), encrypted].map((part) => part.toString("base64url")).join(".");
}

export function calcomRedirectUri(requestUrl: string) {
  const baseUrl = (process.env.NEXT_PUBLIC_APP_URL || new URL(requestUrl).origin).replace(/\/$/, "");
  return `${baseUrl}/api/integrations/calcom/callback`;
}
