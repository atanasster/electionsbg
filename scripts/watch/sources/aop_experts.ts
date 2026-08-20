// Watch the АОП external-experts register (чл. 232а, ал. 2 ЗОП). Maps to
// `update-procurement`.
//
// ⚠️ THE EXPECTED STATE OF THIS SOURCE IS „UNCHANGED, FOREVER". Measured
// 2026-08-20: 88 experts, none added since 2020-01-01, none still valid since
// 2023-01-01. So this watcher is not really looking for an update — it is looking
// for the register REOPENING, which would invalidate the historical framing that
// migration 174, its data test and the CLAUDE.md section all rest on.
//
// The fingerprint is over (УНЕ, validity) pairs rather than the HTML: the page is
// a PHP script that re-renders its own form on every request, so hashing the body
// would churn on nothing. Hashing the validity too — not just the id set — is what
// makes a RENEWAL of an existing expert visible; hashing ids alone would report
// „no change" on the one event that would matter most.

import { createHash } from "crypto";
import type { Fingerprint, WatchSource } from "../types";
import { fetchText } from "../fingerprint";
import { parseAreaPage } from "../../procurement/aop_experts/parse";
import {
  AOP_EXPERT_AREAS,
  AOP_EXPERTS_UA,
  AOP_EXPERTS_URL,
  areaUrl,
} from "../../procurement/aop_experts/sources";

export const aopExperts: WatchSource = {
  id: "aop_experts",
  label: "АОП — списък с външни експерти по чл. 232а, ал. 2 ЗОП (aop.bg)",
  url: AOP_EXPERTS_URL,
  // A closed register. Weekly is already generous; the point is to notice a
  // reopening within a reasonable window, not to track churn there is none of.
  cadence: "weekly",
  publishes: "irregular",

  async fingerprint(): Promise<Fingerprint> {
    // ALL 77 areas, not just the 32 that currently hold anyone. Probing only the
    // non-empty ones would be cheaper and would make the single event this watcher
    // exists to catch — a new expert appearing in a currently-empty area — the one
    // thing it could not see.
    const seen: string[] = [];
    for (const area of AOP_EXPERT_AREAS) {
      const html = await fetchText(areaUrl(area), {
        headers: { "User-Agent": AOP_EXPERTS_UA },
        encoding: "windows-1251",
      });
      // Unreachable is not „the register is empty". Throw so the watcher's own
      // source-down path reports a probe failure rather than a collapse to zero.
      if (html === null)
        throw new Error(
          `АОП experts area ${area} unreachable — a probe failure`,
        );
      for (const r of parseAreaPage(html, area).rows)
        seen.push(`${r.une}|${r.validFrom ?? ""}|${r.validUntil ?? ""}`);
    }
    const uniq = [...new Set(seen)].sort();
    if (!uniq.length)
      throw new Error(
        "АОП experts register parsed to zero experts across every area — the " +
          "page shape changed, or the register was emptied. Either needs a human.",
      );
    return {
      value: createHash("sha256").update(uniq.join("\n")).digest("hex"),
      detail: `${uniq.length} expert(s) — register closed since 2023-01-01`,
      meta: { count: uniq.length },
    };
  },
};
