import { parseHmacKeyring, type Clock, type HmacKeyring } from "./abuse.js";
import type {
  TurnstileVerification,
  TurnstileVerifier,
  VerifyTurnstileInput,
} from "./turnstile.js";

const FIXED_NOW = "2026-08-31T10:15:00.000Z";
const DEMO_PROJECT = /^demo-[a-z0-9-]+$/;

class EmulatorTurnstileVerifier implements TurnstileVerifier {
  async verify(input: VerifyTurnstileInput): Promise<TurnstileVerification> {
    if (input.remoteIp !== null)
      throw new Error("emulator Turnstile received an IP address");
    if (input.token.startsWith("emulator-valid-")) return { kind: "valid" };
    if (input.token === "emulator-unavailable")
      return { kind: "unavailable", reason: "network" };
    return { kind: "invalid", reason: "provider_rejected" };
  }
}

export type EmulatorAdapters = Readonly<{
  clock: Clock;
  turnstileVerifier: TurnstileVerifier;
  hmacKeyring: HmacKeyring;
}>;

export function emulatorAdapters(
  environment: NodeJS.ProcessEnv = process.env,
): EmulatorAdapters | null {
  if (environment.NEWS_EVAL_EMULATOR_ADAPTERS !== "true") return null;
  const project = environment.GCLOUD_PROJECT ?? environment.GCP_PROJECT ?? "";
  if (environment.FUNCTIONS_EMULATOR !== "true" || !DEMO_PROJECT.test(project))
    throw new Error(
      "NEWS_EVAL_EMULATOR_ADAPTERS requires the Functions emulator and a demo-* project",
    );
  return Object.freeze({
    clock: Object.freeze({ now: () => new Date(FIXED_NOW) }),
    turnstileVerifier: new EmulatorTurnstileVerifier(),
    hmacKeyring: parseHmacKeyring({
      active: "emulator-v1",
      keys: {
        "emulator-v1":
          "local emulator HMAC key; never valid outside a demo project",
      },
    }),
  });
}
