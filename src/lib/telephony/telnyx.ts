import type { OutboundCallInput, OutboundCallResult, TelephonyProvider } from "./types";

export class TelnyxProvider implements TelephonyProvider {
  private readonly apiKey = process.env.TELNYX_API_KEY;

  private get headers() {
    if (!this.apiKey) throw new Error("Telnyx API key is not configured.");
    return {
      Authorization: `Bearer ${this.apiKey}`,
      "Content-Type": "application/json",
    };
  }

  async startCall(input: OutboundCallInput): Promise<OutboundCallResult> {
    const response = await fetch("https://api.telnyx.com/v2/calls", {
      method: "POST",
      headers: this.headers,
      body: JSON.stringify({
        connection_id: input.connectionId,
        to: input.to,
        from: input.from,
        webhook_url: input.webhookUrl,
        webhook_url_method: "POST",
      }),
      signal: AbortSignal.timeout(15_000),
    });
    const result: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      console.error("Telnyx call request failed", response.status, result);
      throw new Error("Opkaldet kunne ikke startes hos teleoperatøren.");
    }
    const callControlId = (result as { data?: { call_control_id?: unknown } } | null)?.data?.call_control_id;
    if (typeof callControlId !== "string" || !callControlId) throw new Error("Teleoperatøren returnerede ikke et opkalds-ID.");
    return { callControlId };
  }

  async endCall(callControlId: string) {
    const response = await fetch(
      `https://api.telnyx.com/v2/calls/${encodeURIComponent(callControlId)}/actions/hangup`,
      { method: "POST", headers: this.headers, signal: AbortSignal.timeout(15_000) },
    );
    if (!response.ok) {
      const detail = await response.text();
      console.error("Telnyx hangup request failed", response.status, detail);
      throw new Error("Opkaldet kunne ikke afsluttes hos teleoperatøren.");
    }
  }
}

export const telephonyProvider: TelephonyProvider = new TelnyxProvider();
