// End-to-end apply of the slug-normalisation migration on an ISOLATED copy of
// the real corpus, driven through the CLI with OFFICIALS_MIGRATE_DIR pointed at
// a tmp tree. Covers the one path the pure-function tests cannot: applyTree's
// delete-then-write, the index rewrite, and the shard/rankings projections.
//
// A *.data.test.ts because it needs data/officials present; skips cleanly when
// it is absent (fresh clone / CI without data).

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { ROOT } from "./shared";
import { personGuidFromSourceUrl } from "./slug_identity";

const SRC = path.join(ROOT, "data", "officials");
const present =
  fs.existsSync(path.join(SRC, "index.json")) &&
  fs.existsSync(path.join(SRC, "declarations"));

const sourceUrls = (dir: string): Set<string> => {
  const out = new Set<string>();
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".json")))
    for (const d of JSON.parse(fs.readFileSync(path.join(dir, f), "utf-8")) as {
      sourceUrl: string;
    }[])
      out.add(d.sourceUrl);
  return out;
};

// Two register-GUIDs that share a canonical name+institution but are different
// people, so must NOT end up on one shard (the corpus safety property, checked
// concretely on the applied tree rather than only in the abstract).
const distinctGuidsCollide = (declDir: string): string[] => {
  const bySlug = new Map<string, Set<string>>();
  const clashes: string[] = [];
  for (const f of fs.readdirSync(declDir).filter((x) => x.endsWith(".json"))) {
    const guids = new Set<string>();
    for (const d of JSON.parse(
      fs.readFileSync(path.join(declDir, f), "utf-8"),
    ) as { sourceUrl: string }[]) {
      const g = personGuidFromSourceUrl(d.sourceUrl);
      if (g) guids.add(g);
    }
    bySlug.set(f, guids);
  }
  // A shard carrying 2+ GUIDs is only legitimate for the register's re-issued
  // ids (the _slug_collisions pairs); this coarse check just records them for
  // the assertion to compare against the pre-migration count.
  for (const [f, guids] of bySlug) if (guids.size > 1) clashes.push(f);
  return clashes;
};

describe.skipIf(!present)(
  "slug-normalisation migration — apply on a copy",
  () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "officials-migrate-"));
    const dst = path.join(tmp, "officials");

    afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

    it("renames, folds, and rewrites the index without losing a filing", () => {
      // Copy both trees plus the index/aux files the script reads and writes.
      fs.cpSync(SRC, dst, { recursive: true });

      const beforeExec = sourceUrls(path.join(dst, "declarations"));
      const beforeMuni = sourceUrls(
        path.join(dst, "municipal", "declarations"),
      );
      const collideBefore = distinctGuidsCollide(
        path.join(dst, "declarations"),
      ).length;

      // Fingerprint the REAL serving artifacts the projections could leak into,
      // so the isolation contract is proven, not assumed.
      const realArtifacts = [
        path.join(SRC, "assets-rankings.json"),
        path.join(SRC, "assets-rankings-top.json"),
        path.join(SRC, "municipal", "search_index.json"),
      ].filter((p) => fs.existsSync(p));
      const fingerprint = (p: string): string =>
        `${fs.statSync(p).size}:${fs.readFileSync(p, "utf-8").length}`;
      const realBefore = realArtifacts.map(fingerprint);
      const realShardBefore = fs.existsSync(
        path.join(SRC, "municipal", "by_obshtina"),
      )
        ? fs.readdirSync(path.join(SRC, "municipal", "by_obshtina")).length
        : 0;

      execFileSync(
        "npx",
        ["tsx", "scripts/officials/migrate_slug_normalisation.ts", "--apply"],
        { cwd: ROOT, env: { ...process.env, OFFICIALS_MIGRATE_DIR: dst } },
      );

      for (const [label, declDir, indexFile] of [
        ["exec", path.join(dst, "declarations"), path.join(dst, "index.json")],
        [
          "muni",
          path.join(dst, "municipal", "declarations"),
          path.join(dst, "municipal", "index.json"),
        ],
      ] as const) {
        const shards = new Set(
          fs
            .readdirSync(declDir)
            .filter((f) => f.endsWith(".json"))
            .map((f) => f.replace(/\.json$/, "")),
        );
        const idx = JSON.parse(fs.readFileSync(indexFile, "utf-8")) as {
          entries: { slug: string }[];
        };
        const idxSlugs = new Set(idx.entries.map((e) => e.slug));

        // index.json and the shard directory describe the same set of profiles.
        expect([...idxSlugs].filter((s) => !shards.has(s))).toEqual([]);
        expect([...shards].filter((s) => !idxSlugs.has(s))).toEqual([]);
        expect(idx.entries.length).toBe(shards.size);

        // Every shard's embedded slug now matches its filename.
        for (const f of fs
          .readdirSync(declDir)
          .filter((x) => x.endsWith(".json"))) {
          const slug = f.replace(/\.json$/, "");
          for (const d of JSON.parse(
            fs.readFileSync(path.join(declDir, f), "utf-8"),
          ) as { slug: string }[])
            expect(d.slug).toBe(slug);
        }
        void label;
      }

      // No filing dropped by the union-merge (dedupe by sourceUrl only).
      expect(sourceUrls(path.join(dst, "declarations"))).toEqual(beforeExec);
      expect(sourceUrls(path.join(dst, "municipal", "declarations"))).toEqual(
        beforeMuni,
      );

      // Folding must not create a NEW multi-person shard — the count of shards
      // carrying 2+ register-GUIDs may only stay equal or fall.
      expect(
        distinctGuidsCollide(path.join(dst, "declarations")).length,
      ).toBeLessThanOrEqual(collideBefore);

      // The projections were rebuilt IN dst and reference the NEW slugs. Read
      // the executive rankings and require every ranked slug to be a real
      // post-migration profile (not a dropped old slug).
      const dstIdxSlugs = new Set(
        (
          JSON.parse(
            fs.readFileSync(path.join(dst, "index.json"), "utf-8"),
          ) as {
            entries: { slug: string }[];
          }
        ).entries.map((e) => e.slug),
      );
      const rankings = JSON.parse(
        fs.readFileSync(path.join(dst, "assets-rankings.json"), "utf-8"),
      ) as { topOfficials: { slug: string }[] };
      expect(rankings.topOfficials.length).toBeGreaterThan(0);
      expect(
        rankings.topOfficials.filter((r) => !dstIdxSlugs.has(r.slug)),
      ).toEqual([]);

      // A municipal by_obshtina shard in dst carries the renamed slugs too.
      const muniIdxSlugs = new Set(
        (
          JSON.parse(
            fs.readFileSync(path.join(dst, "municipal", "index.json"), "utf-8"),
          ) as { entries: { slug: string }[] }
        ).entries.map((e) => e.slug),
      );
      const someShard = fs
        .readdirSync(path.join(dst, "municipal", "by_obshtina"))
        .find((f) => f.endsWith(".json"))!;
      const shard = JSON.parse(
        fs.readFileSync(
          path.join(dst, "municipal", "by_obshtina", someShard),
          "utf-8",
        ),
      ) as { entries: { slug: string }[] };
      expect(shard.entries.every((e) => muniIdxSlugs.has(e.slug))).toBe(true);

      // ISOLATION: the real serving artifacts were not touched at all.
      expect(realArtifacts.map(fingerprint)).toEqual(realBefore);
      const realShardAfter = fs.existsSync(
        path.join(SRC, "municipal", "by_obshtina"),
      )
        ? fs.readdirSync(path.join(SRC, "municipal", "by_obshtina")).length
        : 0;
      expect(realShardAfter).toBe(realShardBefore);
    });

    it("is idempotent — a second run moves nothing", () => {
      const out = execFileSync(
        "npx",
        ["tsx", "scripts/officials/migrate_slug_normalisation.ts"],
        {
          cwd: ROOT,
          env: { ...process.env, OFFICIALS_MIGRATE_DIR: dst },
          encoding: "utf-8",
        },
      );
      expect(out).toMatch(/0 slug\(s\) would change/);
    });
  },
);
