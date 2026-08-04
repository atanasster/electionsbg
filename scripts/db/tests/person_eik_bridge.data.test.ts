// Tier 3 (Postgres-native) — integrity of the curated np- → БУЛСТАТ identity bridge.
//
// The bridge exists because one procurement feed publishes a natural person's ЕГН (encoded
// `np-<hash of their name>` so the ЕГН is never stored — supplier_identity.ts) while the other
// publishes their real БУЛСТАТ. Same person, keys that can never match, so their contracts
// double-count. `data/procurement/person_eik_bridge.json` maps one to the other and
// `scripts/procurement/reconcile_cross_source.ts` applies it to the shards.
//
// WHY A GATE. A wrong bridge merges two different people's public money — it would show one
// person's contracts, net worth context and connections under another's identity. That is worse
// than the double-count it fixes, so the map is curated (18 entries, reviewed) rather than
// derived from a name-similarity threshold, and its post-conditions are asserted here against
// the loaded corpus rather than assumed from the file.
//
//   npm run test:data
//
// Requires the Postgres store; auto-skips when Postgres is unreachable or the contracts table is
// absent, like invariants_pg.data.test.ts.

import fs from "fs";
import path from "path";
import { test, afterAll } from "vitest";
import assert from "node:assert/strict";
import { allRows, end } from "../lib/pg";
import { personSupplierKey } from "../../procurement/supplier_identity";

const BRIDGE_FILE = path.resolve(
  import.meta.dirname,
  "../../../data/procurement/person_eik_bridge.json",
);

interface BridgeEntry {
  eik: string;
  name: string;
  why: string;
}

const bridges: Record<string, BridgeEntry> = (
  JSON.parse(fs.readFileSync(BRIDGE_FILE, "utf8")) as {
    bridges: Record<string, BridgeEntry>;
  }
).bridges;

const reachable = async (): Promise<boolean> => {
  try {
    await allRows("SELECT 1");
    const [t] = await allRows<{ ok: boolean }>(
      "SELECT to_regclass('public.contracts') IS NOT NULL AS ok",
    );
    return !!t?.ok;
  } catch {
    return false;
  }
};

const haveDb = await reachable();
const skip = haveDb ? false : "Postgres unreachable / contracts table absent";

afterAll(async () => {
  await end();
});

test("each np- key recomputes from its own stated name", () => {
  // The only check that catches a CONSISTENT-but-wrong triple: a key, a name and an EIK that all
  // look plausible while the key does not actually belong to that name. Nothing else can catch
  // it, and after the pass runs the np- key is gone from the corpus, so no database assertion
  // could recover the evidence. `personSupplierKey` is the same function that minted the key.
  for (const [k, v] of Object.entries(bridges)) {
    assert.equal(
      personSupplierKey(v.name),
      k,
      `bridge key ${k} does not derive from its stated name "${v.name}" ` +
        `(that name hashes to ${personSupplierKey(v.name)}) — the entry names the wrong person`,
    );
  }
});

test("the map is well-formed and injective", () => {
  // No database needed. Two np- keys sharing one БУЛСТАТ is the merge-two-people failure.
  const seen = new Map<string, string>();
  for (const [k, v] of Object.entries(bridges)) {
    assert.match(k, /^np-[0-9a-f]{12}$/, `'${k}' is not an np- key`);
    assert.match(v.eik, /^\d{9}$/, `${k} → '${v.eik}' is not a 9-digit EIK`);
    assert.doesNotMatch(
      v.eik,
      /^0{6,}\d{1,3}$/,
      `${k} → '${v.eik}' is a placeholder EIK (000000001 alone carries 9 unrelated names)`,
    );
    assert.ok(v.name?.trim(), `${k} has no name`);
    assert.ok(v.why?.trim(), `${k} has no stated reason`);
    const prev = seen.get(v.eik);
    assert.equal(
      prev,
      undefined,
      `EIK ${v.eik} is the target of BOTH ${prev} and ${k} — that would merge two people`,
    );
    seen.set(v.eik, k);
  }
});

test.skipIf(skip)(
  "no np- key survives that the bridge should have rewritten",
  async () => {
    // Post-condition of the pass. A bridged key still present means reconcile_cross_source.ts has
    // not run since the map last changed, so the corpus still double-counts those people.
    const keys = Object.keys(bridges);
    if (!keys.length) return;
    const rows = await allRows<{ contractor_eik: string; n: number }>(
      `SELECT contractor_eik, count(*)::int AS n
       FROM contracts WHERE contractor_eik = ANY($1::text[])
      GROUP BY 1 ORDER BY 2 DESC`,
      [keys],
    );
    assert.deepEqual(
      rows.map((r) => `${r.contractor_eik} (${r.n} rows)`),
      [],
      `bridged np- key(s) still in the corpus. Run: ` +
        `npx tsx scripts/procurement/reconcile_cross_source.ts --apply, then rebuild and reload.`,
    );
  },
);

test.skipIf(skip)(
  "each bridge target names only the bridged person",
  async () => {
    // The other direction of the same risk: if a target EIK carries a name belonging to a
    // DIFFERENT party, the bridge has attached one person's rows to another entity.
    //
    // Containment, not equality. A target legitimately carries casing variants and trade
    // descriptors of the one person — 179842434 appears as "Иван Славейков Тодоров",
    // "ИВАН СЛАВЕЙКОВ ТОДОРОВ" and "Иван Славейков Тодоров - Земеделски производител", all the
    // same farmer. Requiring exact equality flagged that as a merge, which it is not. Requiring
    // every name to CONTAIN the bridged person's name still fails on a genuinely different party,
    // which is the case that matters.
    const rows = await allRows<{ eik: string; names: string[] }>(
      `SELECT contractor_eik AS eik, array_agg(DISTINCT contractor_name) AS names
       FROM contracts WHERE contractor_eik = ANY($1::text[])
      GROUP BY 1`,
      [Object.values(bridges).map((b) => b.eik)],
    );
    const fold = (s: string): string =>
      s
        .toLocaleLowerCase("bg")
        .replace(/[„“"'`.-]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    const expected = new Map(
      Object.values(bridges).map((b) => [b.eik, fold(b.name)]),
    );
    const bad: string[] = [];
    for (const r of rows) {
      const want = expected.get(r.eik);
      if (!want) continue;
      const strays = r.names.filter((n) => !fold(n).includes(want));
      if (strays.length)
        bad.push(
          `${r.eik} (bridged as "${want}") also carries: ${strays.join(" | ")}`,
        );
    }
    assert.deepEqual(
      bad,
      [],
      `bridge target(s) carry a name that is not the bridged person, so the bridge may have ` +
        `merged two entities:\n  ${bad.join("\n  ")}`,
    );
  },
);
