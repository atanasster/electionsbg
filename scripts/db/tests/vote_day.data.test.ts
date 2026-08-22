// vote_day (180) — the per-sitting facts vote_item has no column for, and the one of them
// a reader can see: `pdf_url`, which SessionScreen renders as the page's only link back to
// parliament.bg.
//
// Plan: docs/plans/json-retirement-v2.md Tier 1 (decision D2).
//
// The failure this file exists to catch is SILENT in both directions. A missing day row
// renders as no link at all — indistinguishable from a sitting that genuinely has no PDF —
// and a day row whose (ns, date) does not match its items renders SOMEBODY ELSE'S stenogram
// against this sitting, which is worse and looks identical.

import { afterAll, describe, expect, test } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { allRows, end, dbReachable } from "../lib/pg";

const REPO = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
);
const SESSIONS_DIR = path.join(REPO, "data/parliament/votes/sessions");

const haveDb = await dbReachable();
const built = haveDb
  ? (
      await allRows<{ n: string }>(
        `SELECT count(*)::text AS n FROM pg_class WHERE relname = 'vote_day'`,
      ).catch(() => [{ n: "0" }])
    )[0].n !== "0"
  : false;
const skip = !haveDb
  ? "Postgres unreachable"
  : !built
    ? "vote_day not applied — run db:load:rollcall:pg"
    : false;

afterAll(async () => {
  if (haveDb) await end();
});

describe("vote_day", () => {
  test.skipIf(skip)("covers every sitting that has items", async () => {
    const orphans = await allRows<{ ns: number; date: string }>(
      `SELECT ns, date::text AS date FROM (
         SELECT DISTINCT ns, date FROM vote_item
         EXCEPT SELECT ns, date FROM vote_day) x
       ORDER BY date LIMIT 10`,
    );
    expect(
      orphans,
      "sittings with items but no day row — /api/db/session serves them with no source link",
    ).toEqual([]);
  });

  // The converse. A day row for a sitting with no items is not harmful, but it means the
  // loader wrote from a file vote_item rejected, which is a disagreement worth surfacing.
  test.skipIf(skip)("has no day row without items", async () => {
    const [{ n }] = await allRows<{ n: string }>(
      `SELECT count(*)::text AS n FROM (
         SELECT ns, date FROM vote_day
         EXCEPT SELECT DISTINCT ns, date FROM vote_item) x`,
    );
    expect(Number(n)).toBe(0);
  });

  test.skipIf(skip)("is non-vacuous and carries the source link", async () => {
    const [row] = await allRows<{
      days: string;
      with_pdf: string;
      with_sten: string;
    }>(
      `SELECT count(*)::text AS days,
              count(pdf_url)::text AS with_pdf,
              count(stenogram_id)::text AS with_sten
         FROM vote_day`,
    );
    expect(Number(row.days), "vote_day is empty").toBeGreaterThan(400);
    // pdf_url is the only column a reader sees. A collapse here is the regression that
    // renders as "no link" on every session page, so it is asserted as a SHARE rather than
    // as "not zero" — a corpus where 3 sittings kept a URL would otherwise pass.
    expect(
      Number(row.with_pdf) / Number(row.days),
      `only ${row.with_pdf}/${row.days} sittings carry a roll-call PDF URL`,
    ).toBeGreaterThan(0.9);
    expect(Number(row.with_sten) / Number(row.days)).toBeGreaterThan(0.9);
  });

  // ATTRIBUTION. Every value is compared against the file it came from, because a row that
  // is merely PRESENT proves nothing — the harm is a stenogram or a PDF attached to the
  // wrong sitting, which every count above would report as healthy.
  test.skipIf(skip)(
    "matches the session files it was loaded from",
    async () => {
      if (!existsSync(SESSIONS_DIR)) {
        console.warn(
          "vote_day: no session files on disk — attribution arm skipped",
        );
        return;
      }
      const files = readdirSync(SESSIONS_DIR)
        .filter((f) => f.endsWith(".json"))
        .sort();
      // Spread across the corpus rather than the first N: the scraper's behaviour changed over
      // time, so a head-of-list sample tests one era.
      const step = Math.max(1, Math.floor(files.length / 40));
      const sample = files.filter((_, i) => i % step === 0);
      expect(sample.length, "no sittings sampled").toBeGreaterThan(20);

      const bad: string[] = [];
      for (const f of sample) {
        const j = JSON.parse(readFileSync(path.join(SESSIONS_DIR, f), "utf8"));
        const rows = await allRows<{
          stenogram_id: number | null;
          pdf_url: string | null;
        }>(
          `SELECT stenogram_id, pdf_url FROM vote_day WHERE ns = $1 AND date = $2`,
          [Number(j.ns), j.date],
        );
        if (!rows.length) {
          bad.push(`${f}: no row`);
          continue;
        }
        if (rows[0].stenogram_id !== (j.stenogramId ?? null))
          bad.push(
            `${f}: stenogram ${rows[0].stenogram_id} vs file ${j.stenogramId}`,
          );
        // The loader COALESCEs pdf_url, so the stored value may legitimately be a URL from an
        // EARLIER scrape when this file has none. It may never be a DIFFERENT non-null URL.
        if (j.pdfUrl && rows[0].pdf_url !== j.pdfUrl)
          bad.push(`${f}: pdf ${rows[0].pdf_url} vs file ${j.pdfUrl}`);
      }
      expect(bad, "vote_day disagrees with its source files").toEqual([]);
    },
  );

  // The refresh stamp is OURS, not the source's. Consumers render it as "computed at", so a
  // wiring that returned max(scraped_at) — parliament.bg's clock — would silently publish a
  // date that moves for a different reason.
  test.skipIf(skip)(
    "rollcall_refreshed_at() is our clock, not the source's",
    async () => {
      const [row] = await allRows<{
        refreshed: string | null;
        max_scraped: string | null;
      }>(
        `SELECT rollcall_refreshed_at()::text AS refreshed,
              max(scraped_at)::text        AS max_scraped
         FROM vote_day`,
      );
      expect(
        row.refreshed,
        "rollcall_refreshed_at() is NULL on a loaded corpus",
      ).not.toBeNull();
      // ⚠️ A FLOOR IS NOT A DISCRIMINATOR. The first version of this asserted only that the
      // value was after 2026-01-01 — which `max(scraped_at)` (2026-07-31 on this corpus)
      // also satisfies, so it passed for the exact mutation it exists to catch.
      //
      // The property that separates them: refreshed_at is stamped by the loader when it
      // WRITES, so it is strictly later than any scrape it wrote — the scrape necessarily
      // happened first. Returning the source's clock inverts that.
      expect(row.max_scraped, "no scraped_at recorded").not.toBeNull();
      expect(
        new Date(row.refreshed as string).getTime(),
        "rollcall_refreshed_at() is not later than max(scraped_at) — it is probably " +
          "returning the SOURCE's clock rather than ours",
      ).toBeGreaterThan(new Date(row.max_scraped as string).getTime());
    },
  );
});
