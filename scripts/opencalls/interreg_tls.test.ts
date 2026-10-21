// The Interreg TLS completion: scoped to four hosts, and adding INTERMEDIATES — never a new
// trust anchor, never verification off. Offline: every PEM is checked against Node's own root
// store with `X509Certificate.verify`, so the gate holds without touching the network.

import { X509Certificate } from "node:crypto";
import { rootCertificates } from "node:tls";
import { describe, expect, it } from "vitest";
import {
  INTERMEDIATE_PEMS,
  INTERREG_TLS_HOSTS,
  interregDispatcherFor,
} from "./interreg_tls";
import { PROGRAMMES } from "./interreg_parse";

const roots = rootCertificates.map((p) => new X509Certificate(p));

describe("scope", () => {
  it("covers exactly the hosts of the programmes that need it", () => {
    const needing = PROGRAMMES.filter(
      (p) => p.kind === "mrrb" || p.kind === "robg",
    ).map((p) => new URL(p.indexUrl).hostname);
    expect([...INTERREG_TLS_HOSTS].sort()).toEqual(
      [...new Set(needing)].sort(),
    );
  });

  it.each([
    "https://ipa-bgrs.mrrb.bg/en/term/37",
    "https://interregviarobg.eu/en/calls-for-proposals-1",
  ])("gives %s the completing dispatcher", (u) => {
    expect(interregDispatcherFor(u)).toBeDefined();
  });

  it.each([
    "https://www.greece-bulgaria.eu/calls/",
    "https://data.egov.bg/",
    // Look-alikes: the scope is an exact hostname match, never a suffix or prefix.
    "https://ipa-bgrs.mrrb.bg.attacker.example/",
    "https://evil-interregviarobg.eu/",
    "https://mrrb.bg/",
    "not a url",
  ])("leaves %s on Node's default dispatcher", (u) => {
    expect(interregDispatcherFor(u)).toBeUndefined();
  });
});

describe("the bundled PEMs are intermediates chaining to a root Node ALREADY trusts", () => {
  it.each(INTERMEDIATE_PEMS.map((p) => [new X509Certificate(p).subject, p]))(
    "%s",
    (_subject, pem) => {
      const cert = new X509Certificate(pem);
      expect(cert.ca).toBe(true);
      // Not self-signed: a self-signed cert here would be a NEW trust anchor.
      expect(cert.issuer).not.toBe(cert.subject);
      const issuer = roots.find((r) => cert.checkIssued(r));
      expect(
        issuer,
        `issuer of ${cert.subject} is not in Node's store`,
      ).toBeDefined();
      expect(cert.verify(issuer!.publicKey)).toBe(true);
    },
  );
});
