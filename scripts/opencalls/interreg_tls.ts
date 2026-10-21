// Missing TLS intermediates for four Interreg programme sites — VERIFICATION STAYS ON.
//
// Measured 2026-10-21, Node 22.19:
//
//   ipa-bgrs.mrrb.bg  ipa-bgmk.mrrb.bg  ipa-bgtr.mrrb.bg   → UNABLE_TO_VERIFY_LEAF_SIGNATURE
//     The leaf (*.mrrb.bg) is issued by „Sectigo Public Server Authentication CA DV R36", but
//     the server sends a DIFFERENT intermediate („Sectigo RSA Domain Validation Secure Server
//     CA") and never R36. curl on macOS succeeds only because the system keychain fills the gap.
//   interregviarobg.eu                                    → UNABLE_TO_GET_ISSUER_CERT_LOCALLY
//     Let's Encrypt's new hierarchy: the server sends YR2 → „ISRG Root YR", a root Node's
//     bundled store does not carry yet.
//
// The fix is to supply the MISSING INTERMEDIATE, never to turn verification off (contrast
// scripts/lib/egov_tls.ts, which is a temporary bypass for an EXPIRED cert and says so). Both
// PEMs in ./certs/ were fetched from the issuers' own AIA „CA Issuers" URLs named in the
// certificates the sites serve, and both chain to a root ALREADY in Node's default store:
//
//   certs/sectigo_public_server_auth_ca_dv_r36.pem   R36 → Sectigo Public Server Authentication
//                                                    Root R46 (in tls.rootCertificates)
//   certs/isrg_root_yr_cross_x1.pem                  „Root YR" CROSS-SIGNED by ISRG Root X1
//                                                    (in tls.rootCertificates) — the AIA copy at
//                                                    http://yr.i.lencr.org/, not the self-signed one
//
// So the trust anchors are unchanged: the Agent's `ca` is Node's default roots PLUS these two
// intermediates. (`ca` REPLACES the default store rather than extending it, which is why the
// default roots are spread in explicitly — omitting them would break every other chain.)
//
// SCOPED TO THESE FOUR HOSTS, the same per-request shape egov_tls uses: importing this module
// wraps globalThis.fetch so that only requests to `INTERREG_TLS_HOSTS` carry the dispatcher.
// interreg_tls.test.ts asserts the scope and verifies each PEM against Node's store offline.
//
// REMOVE an entry when its site serves a complete chain (re-test with plain `node -e fetch`).

import { readFileSync } from "node:fs";
import path from "node:path";
import { rootCertificates } from "node:tls";
import { fileURLToPath } from "node:url";
import { Agent } from "undici";

const CERTS = path.join(path.dirname(fileURLToPath(import.meta.url)), "certs");

export const INTERMEDIATE_PEMS: readonly string[] = [
  "sectigo_public_server_auth_ca_dv_r36.pem",
  "isrg_root_yr_cross_x1.pem",
].map((f) => readFileSync(path.join(CERTS, f), "utf8"));

export const INTERREG_TLS_HOSTS: ReadonlySet<string> = new Set([
  "ipa-bgrs.mrrb.bg",
  "ipa-bgmk.mrrb.bg",
  "ipa-bgtr.mrrb.bg",
  "interregviarobg.eu",
]);

const INSTALLED = Symbol.for("electionsbg.interregTls");

const hostOf = (input: unknown): string | null => {
  try {
    if (typeof input === "string") return new URL(input).hostname;
    if (input instanceof URL) return input.hostname;
    if (input && typeof input === "object" && "url" in input)
      return new URL(String((input as { url: string }).url)).hostname;
  } catch {
    // Relative or malformed — not ours to touch.
  }
  return null;
};

let agent: Agent | null = null;

/** The dispatcher a request to `input` should use, or `undefined` for Node's default. */
export const interregDispatcherFor = (input: unknown): Agent | undefined => {
  const host = hostOf(input);
  if (!host || !INTERREG_TLS_HOSTS.has(host)) return undefined;
  agent ??= new Agent({
    // rejectUnauthorized stays at its default (true) — the whole point of this module.
    connect: { ca: [...rootCertificates, ...INTERMEDIATE_PEMS] },
  });
  return agent;
};

const install = (): void => {
  const g = globalThis as typeof globalThis & { [INSTALLED]?: boolean };
  if (g[INSTALLED]) return;
  g[INSTALLED] = true;
  const original = globalThis.fetch;
  globalThis.fetch = ((
    input: Parameters<typeof fetch>[0],
    init?: RequestInit,
  ) => {
    const dispatcher = interregDispatcherFor(input);
    if (!dispatcher) return original(input, init);
    // @ts-expect-error: dispatcher is undici-only, not in fetch's typings
    return original(input, { ...init, dispatcher });
  }) as typeof fetch;
};

install();
