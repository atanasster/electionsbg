// Regulator rosters — the `regulator` "кой решава" facet on the person layer (plan §5 T1).
// The upstream is the curated register data/person/regulators.json: the current members of
// Bulgaria's independent / regulatory bodies (Конституционен съд, Сметна палата, КФН, БНБ
// УС, СЕМ, КЗК, Омбудсман…). There is NO unified feed — each body publishes its own roster
// on its own site — so this is a MANUALLY-CURATED register, like transparency_cpi and
// wiki_governments: an operator hand-verifies each seat against the official page.
//
// This watcher is a lightweight, best-effort REVIEW TRIGGER for the flagship body — it
// fingerprints the Constitutional Court composition page. When the court's composition page
// changes (a judge rotates out on the 3-year cadence), it flips and reminds the operator to
// re-check ALL bodies in data/person/regulators.json and re-run the resolver
// (`update-persons`). It cannot detect a change on the other bodies on its own — those are
// covered by the periodic manual review the header of the register documents.
//
// Downstream: a "changed" signal means review data/person/regulators.json (update-persons).

import type { WatchSource, Fingerprint, WatchState } from "../types";
import { fetchText, sha256Short } from "../fingerprint";

// The Constitutional Court composition page — the flagship independent body. Its roster
// rotates by a quarter every 3 years, so a change here is a reliable "go re-verify" nudge.
const PAGE = "https://www.constcourt.bg/bg/composition";

export const regulatorRosters: WatchSource = {
  id: "regulator_rosters",
  label: "Регулатори / независими органи — състави (regulator facet)",
  url: PAGE,
  cadence: "monthly",
  async fingerprint(): Promise<Fingerprint> {
    let html: string;
    try {
      html = (await fetchText(PAGE)) ?? "";
    } catch {
      html = "";
    }
    if (!html) {
      // Upstream transiently unreachable — the register is curated manually anyway, so a
      // stable sentinel avoids a false "changed" flip (mirrors comdos_ds).
      return {
        value: "manual",
        detail:
          "constcourt.bg unreachable — data/person/regulators.json curated manually",
      };
    }
    // Strip volatile chrome (scripts / inline styles) and hash the remaining markup — flips
    // when the composition block (the judges image + captions) is republished.
    const body = html
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/\s+/g, " ")
      .trim();
    return {
      value: sha256Short(body),
      detail:
        "Конституционен съд — състав (флагман; преглед на data/person/regulators.json)",
    };
  },
  describe(prev: WatchState | null, curr: Fingerprint): string {
    if (!prev || prev.fingerprint === curr.value)
      return `${curr.detail} — update-persons`;
    return `съставът на Конституционния съд се промени — прегледай data/person/regulators.json (update-persons)`;
  },
};
