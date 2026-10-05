export type OutboundCallInput = {
  to: string;
  from: string;
  connectionId: string;
  webhookUrl: string;
};

export type OutboundCallResult = { callControlId: string };

export interface TelephonyProvider {
  startCall(input: OutboundCallInput): Promise<OutboundCallResult>;
  endCall(callControlId: string): Promise<void>;
}
