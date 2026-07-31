import { describe, it, expect } from "vitest";
import {
  sigmaContractId,
  sigmaContractUrl,
  sigmaAuthorityUrl,
  sigmaCompanyUrl,
} from "./sigma";

describe("sigmaContractId (cais_id derivation)", () => {
  it("uses the standard УНП as-is when present", () => {
    expect(sigmaContractId("00044-2024-0047", "eop-T78923")).toBe(
      "00044-2024-0047",
    );
  });

  it("recovers the ЦАИС T-id from an eop-T ocid", () => {
    expect(sigmaContractId(undefined, "eop-T78923")).toBe("T78923");
  });

  it("recovers the ЦАИС T-id from an ocds-e82gsb ocid", () => {
    expect(sigmaContractId(null, "ocds-e82gsb-566491")).toBe("T566491");
  });

  it("returns null for legacy АОП rows with no ЦАИС id", () => {
    expect(sigmaContractId(undefined, "aop-legacy-2023-412573")).toBeNull();
    expect(sigmaContractId(undefined, undefined)).toBeNull();
  });
});

describe("sigma entity URLs", () => {
  it("builds authority/company/contract URLs", () => {
    expect(sigmaAuthorityUrl("000695089")).toBe(
      "https://sigma.midt.bg/authorities/000695089",
    );
    expect(sigmaCompanyUrl("101611650")).toBe(
      "https://sigma.midt.bg/companies/101611650",
    );
  });

  // A contract link is a FILTERED LIST, never `/contracts/<id>` — that path 404s
  // for every contract, because SIGMA keys its contract pages by a composite slug
  // carrying its own row id (see the note on sigmaContractUrl).
  it("links a contract through the ?q= filter, not a path segment", () => {
    expect(sigmaContractUrl("T78923")).toBe(
      "https://sigma.midt.bg/contracts?q=T78923",
    );
  });

  it("carries a УНП through the query string, escaped", () => {
    expect(sigmaContractUrl("00042-2025-0016")).toBe(
      "https://sigma.midt.bg/contracts?q=00042-2025-0016",
    );
    // The id is escaped, so a value with a query/path separator can neither
    // truncate the parameter nor open a second one.
    expect(sigmaContractUrl("a&sort=b")).toBe(
      "https://sigma.midt.bg/contracts?q=a%26sort%3Db",
    );
  });
});
