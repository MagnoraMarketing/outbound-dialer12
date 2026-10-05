import { createPublicKey, verify } from "node:crypto";

export function verifyTelnyxWebhook(rawBody: string, signature: string | null, timestamp: string | null) {
  const publicKey = process.env.TELNYX_PUBLIC_KEY;
  if (!publicKey || !signature || !timestamp) return false;
  const sentAt = Number(timestamp);
  if (!Number.isFinite(sentAt) || Math.abs(Date.now() / 1000 - sentAt) > 300) return false;
  try {
    const rawKey = Buffer.from(publicKey, "base64");
    if (rawKey.length !== 32) return false;
    const derPrefix = Buffer.from("302a300506032b6570032100", "hex");
    const key = createPublicKey({ key: Buffer.concat([derPrefix, rawKey]), format: "der", type: "spki" });
    return verify(
      null,
      Buffer.from(`${timestamp}|${rawBody}`),
      key,
      Buffer.from(signature, "base64"),
    );
  } catch {
    return false;
  }
}
