export type SecurityEvent =
  | "attempt_limited"
  | "clock_unavailable"
  | "configuration_unavailable"
  | "challenge_valid"
  | "challenge_invalid_provider"
  | "challenge_invalid_hostname"
  | "challenge_invalid_action"
  | "challenge_invalid_timestamp"
  | "challenge_expired"
  | "challenge_unavailable_network"
  | "challenge_unavailable_timeout"
  | "challenge_unavailable_http"
  | "challenge_unavailable_configuration"
  | "challenge_unavailable_internal"
  | "challenge_unavailable_response"
  | "abuse_context_unavailable"
  | "submission_unavailable";

export interface SecurityMetrics {
  record(event: SecurityEvent, latencyMilliseconds?: number): void;
}

export const noOpSecurityMetrics: SecurityMetrics = Object.freeze({
  record: () => undefined,
});

export function boundedLatency(value: number): number | undefined {
  if (!Number.isFinite(value) || value < 0) return undefined;
  return Math.min(60_000, Math.round(value));
}
