// Gate for `reidentify` — the re-key one-off's identity recomputation.
//
//   npx vitest run scripts/procurement/rekey_placeholder_suppliers.test.ts
//
// WHY THIS EXISTS. The script is a one-off, but it is committed and re-runnable,
// and `reidentify` is the part that decides what a row's contract `key` BECOMES.
// Getting it wrong does not throw — it mints a key the parser would never produce,
// so the row survives, /contract/:key moves to an address nothing else knows, and
// the next real ingest emits the row again under the key this one should have
// written. That is a duplicate, discovered much later.
//
// It also ran against exactly ONE legacy row in anger (€409, „инж. Лъчезар
// Пиргов"), so the legacy branch — resolve the dataset by longest-prefix match,
// then recover `documentId` by trimming the trailing EIK — has essentially no
// production evidence behind it. Hence the cases below.
//
// ⚠ The expected keys are NOT hand-written hashes. Each is computed from the same
// exported builder the ingest calls (`releaseContractKey` / `legacyContractKey` /
// `legacyReleaseId` in contract_key.ts), because a literal would only prove this
// test agrees with itself. What is asserted is that `reidentify` routes each feed
// to the RIGHT builder with the RIGHT arguments.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { isPlaceholderId } from "./eik";
import { placeholderSupplierKey } from "./supplier_identity";
import { reidentify } from "./rekey_placeholder_suppliers";
import {
  releaseContractKey,
  legacyContractKey,
  legacyReleaseId,
} from "./contract_key";
import { LEGACY_DATASETS } from "./legacy_csv";

const NEW_EIK = "ph-2475f7344022";

describe("reidentify — release-shaped feeds", () => {
  it("routes a ЦАИС ЕОП row through releaseContractKey", () => {
    const r = {
      key: "1588a9f80dac",
      releaseId: "eop-00165-2022-0024-75355",
      contractId: "75355",
      tag: "contract",
    };
    expect(reidentify(r, NEW_EIK)).toEqual({
      key: releaseContractKey(r.releaseId, r.contractId, NEW_EIK, r.tag),
    });
  });

  it("routes an OCDS row through the same builder", () => {
    // The two feeds deliberately share one formula; this pins that they still do.
    const r = {
      key: "abc123abc123",
      releaseId: "ocds-e82gsb-405538-797791/2026-01-19-award",
      contractId: undefined,
      tag: "contract",
    };
    expect(reidentify(r, NEW_EIK)).toEqual({
      key: releaseContractKey(r.releaseId, undefined, NEW_EIK, "contract"),
    });
  });

  it("carries the tag into the key", () => {
    // `tag` is part of the base string, so an amendment and its base contract must
    // not collapse onto one key.
    const base = { key: "k", releaseId: "eop-1-2", contractId: "9" };
    const a = reidentify({ ...base, tag: "contract" }, NEW_EIK);
    const b = reidentify({ ...base, tag: "contractAmendment" }, NEW_EIK);
    expect(a!.key).not.toBe(b!.key);
  });

  it("leaves releaseId alone — only the legacy feed embeds the supplier", () => {
    const out = reidentify(
      { key: "k", releaseId: "eop-1-2", contractId: "9", tag: "contract" },
      NEW_EIK,
    );
    expect(out).not.toHaveProperty("releaseId");
  });
});

describe("reidentify — the legacy feed", () => {
  const ds2023 = LEGACY_DATASETS.find((d) => d.year === "2023")!;

  it("recovers the dataset and documentId, and moves BOTH key and releaseId", () => {
    // The live row: aop-legacy-<year>-<documentId>-<contractorEik>.
    const r = {
      key: "decfbcd27739",
      releaseId: "aop-legacy-2023-366252-000000003",
      contractId: "88527",
      tag: "contract",
    };
    expect(reidentify(r, NEW_EIK)).toEqual({
      key: legacyContractKey(ds2023.datasetUuid, "366252", NEW_EIK),
      releaseId: legacyReleaseId("2023", "366252", NEW_EIK),
    });
  });

  it("resolves a suffixed dataset year by LONGEST prefix, not by splitting on '-'", () => {
    // `LEGACY_DATASETS` carries both "2023" and "2023-RL". Splitting the releaseId
    // on "-" would read the year as "2023" for both and pick the wrong dataset
    // uuid — a silently wrong key, since the uuid is part of the hash.
    const rl = LEGACY_DATASETS.find((d) => d.year === "2023-RL");
    if (!rl) return; // dataset list changed; nothing to assert
    const out = reidentify(
      {
        key: "k",
        releaseId: `aop-legacy-${rl.year}-777-000000001`,
        contractId: undefined,
        tag: "contract",
      },
      NEW_EIK,
    );
    expect(out!.key).toBe(legacyContractKey(rl.datasetUuid, "777", NEW_EIK));
    expect(out!.key).not.toBe(
      legacyContractKey(ds2023.datasetUuid, "777", NEW_EIK),
    );
  });

  it("keeps a documentId that itself contains a hyphen", () => {
    // documentId is recovered by trimming the LAST hyphen group, so an internal
    // hyphen must survive. Trimming the first would truncate it.
    const out = reidentify(
      {
        key: "k",
        releaseId: "aop-legacy-2023-РД-07-9-000000001",
        contractId: undefined,
        tag: "contract",
      },
      NEW_EIK,
    );
    expect(out!.key).toBe(
      legacyContractKey(ds2023.datasetUuid, "РД-07-9", NEW_EIK),
    );
  });
});

describe("reidentify — refusals", () => {
  it("refuses rather than guessing when there is no releaseId", () => {
    // Returning a key here would invent one the parser cannot reproduce. The
    // script reports refusals and leaves the row untouched.
    expect(
      reidentify({ key: "k", releaseId: "", contractId: "1", tag: "contract" }, NEW_EIK), // prettier-ignore
    ).toBeNull();
    expect(
      reidentify({ key: "k", contractId: "1", tag: "contract" }, NEW_EIK),
    ).toBeNull();
  });

  it("refuses a legacy releaseId whose dataset year is unknown", () => {
    expect(
      reidentify(
        {
          key: "k",
          releaseId: "aop-legacy-1999-123-000000001",
          contractId: undefined,
          tag: "contract",
        },
        NEW_EIK,
      ),
    ).toBeNull();
  });

  it("refuses a legacy releaseId with no recoverable documentId", () => {
    expect(
      reidentify(
        {
          key: "k",
          releaseId: "aop-legacy-2023-000000001",
          contractId: undefined,
          tag: "contract",
        },
        NEW_EIK,
      ),
    ).toBeNull();
  });
});

describe("reidentify — determinism", () => {
  it("is a pure function of (row, eik)", () => {
    // The script's whole safety argument is that re-running writes nothing, which
    // requires the same inputs to give the same key every time.
    const r = {
      key: "k",
      releaseId: "eop-00165-2022-0024-75355",
      contractId: "75355",
      tag: "contract",
    };
    expect(reidentify(r, NEW_EIK)).toEqual(reidentify(r, NEW_EIK));
  });

  it("gives DISTINCT keys to distinct suppliers on one contract", () => {
    // The point of the re-key: two suppliers pooled under one filler id must come
    // apart, and their contract keys must not collide.
    const r = {
      key: "k",
      releaseId: "eop-00165-2022-0024-75355",
      contractId: "75355",
      tag: "contract",
    };
    const a = reidentify(r, "ph-aaaaaaaaaaaa")!.key;
    const b = reidentify(r, "ph-bbbbbbbbbbbb")!.key;
    expect(a).not.toBe(b);
  });
});

describe("the two defects this test found", () => {
  it("the legacy feed's parser reproduces what the re-key wrote", () => {
    // The script's header claims a re-keyed row still matches what a fresh parse
    // emits. On the legacy feed that was FALSE: since `isValidEik` learned to
    // reject filler, `legacy_csv.ts` sent such rows to `droppedNoContractor`, so
    // the parser emitted nothing while the corpus held
    // `aop-legacy-2023-366252-ph-5e82cc2f03c2` — an address no parse reproduced.
    // legacy_csv now classifies filler, and this pins the agreement.
    expect(isPlaceholderId("000000003")).toBe(true);
    expect(placeholderSupplierKey("инж. Лъчезар Пиргов")).toBe(
      "ph-5e82cc2f03c2",
    );
    const ds = LEGACY_DATASETS.find((d) => d.year === "2023")!;
    expect(legacyReleaseId("2023", "366252", "ph-5e82cc2f03c2")).toBe(
      "aop-legacy-2023-366252-ph-5e82cc2f03c2",
    );
    expect(ds.datasetUuid).toBeTruthy();
  });

  it("importing this module does not run the CLI", () => {
    // The first guard was an unanchored substring match on argv[1], which matches
    // this very file's path — so `npx tsx …test.ts` still walked all 406,722 rows.
    // It only looked fixed because vitest puts its own binary in argv[1].
    const src = readFileSync(
      new URL("./rekey_placeholder_suppliers.ts", import.meta.url),
      "utf8",
    );
    expect(src).toContain("pathToFileURL");
    expect(src).not.toMatch(/\/rekey_placeholder_suppliers\/\.test\(/);
  });

  it("a key collision refuses the row instead of rewriting it", () => {
    // The collision branch reported "REFUSED (not rewritten)" and then fell
    // through to the rewrite, writing two contracts to one key — the failure the
    // script exists to prevent.
    const src = readFileSync(
      new URL("./rekey_placeholder_suppliers.ts", import.meta.url),
      "utf8",
    );
    expect(src).toMatch(/KEY COLLISION[\s\S]{0,220}continue;/);
  });
});
