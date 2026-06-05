// Template narrator: turns an Envelope's facts into a short bilingual sentence.
//
// This is the no-model narration path. In M3 the LLM narrates instead (handed
// the same facts), but the contract is identical: narration NEVER introduces a
// number that isn't already in `facts`.

import type { Envelope, Lang } from "../tools/types";

const f = (e: Envelope, key: string): string => String(e.facts[key] ?? "");

export const narrate = (env: Envelope, lang: Lang): string => {
  switch (env.tool) {
    case "machineVoteSeries": {
      const last = f(env, "latest");
      const ch = env.facts.change_pts;
      const locale = lang === "bg" ? "bg-BG" : "en-US";
      const mag =
        typeof ch === "number" ? Math.abs(ch).toLocaleString(locale) : "";
      const dir =
        typeof ch === "number"
          ? lang === "bg"
            ? ch >= 0
              ? `с ${mag} пр.п. нагоре`
              : `с ${mag} пр.п. надолу`
            : ch >= 0
              ? `up ${mag} pts`
              : `down ${mag} pts`
          : "";
      return lang === "bg"
        ? `Делът на машинното гласуване в последните ${f(env, "elections_count")} избора завършва на ${last} (${dir} спрямо началото).`
        : `Machine voting across the last ${f(env, "elections_count")} elections ends at ${last} (${dir} from the start).`;
    }
    case "turnoutSeries": {
      const last = f(env, "latest");
      return lang === "bg"
        ? `Избирателната активност в последните ${f(env, "elections_count")} избора завършва на ${last}.`
        : `Voter turnout across the last ${f(env, "elections_count")} elections ends at ${last}.`;
    }
    case "machineVoteShare":
      return lang === "bg"
        ? `Машинното гласуване е ${f(env, "machine_share")} (${f(env, "machine_votes")} машинни срещу ${f(env, "paper_votes")} хартиени действителни гласа).`
        : `Machine voting was ${f(env, "machine_share")} (${f(env, "machine_votes")} machine vs ${f(env, "paper_votes")} paper valid votes).`;
    case "turnout":
      return lang === "bg"
        ? `Избирателната активност е ${f(env, "turnout")} (${f(env, "voters")} от ${f(env, "registered")} избиратели).`
        : `Turnout was ${f(env, "turnout")} (${f(env, "voters")} of ${f(env, "registered")} registered).`;
    case "partyResult":
      if (!env.facts.party)
        return lang === "bg"
          ? "Не намерих такава партия."
          : "I couldn't find that party.";
      return lang === "bg"
        ? `${f(env, "party")} получава ${f(env, "votes")} гласа (${f(env, "pct")}) и ${f(env, "seats")} мандата.`
        : `${f(env, "party")} got ${f(env, "votes")} votes (${f(env, "pct")}) and ${f(env, "seats")} seats.`;
    case "partyTimeline":
      if (!env.facts.party)
        return lang === "bg"
          ? "Не намерих такава партия."
          : "I couldn't find that party.";
      return lang === "bg"
        ? `${f(env, "party")} се явява на ${f(env, "appearances")} избора; връх ${f(env, "peak_pct")}%, последно ${f(env, "latest_pct")}%.`
        : `${f(env, "party")} appears in ${f(env, "appearances")} elections; peak ${f(env, "peak_pct")}%, latest ${f(env, "latest_pct")}%.`;
    case "nationalResults":
      return lang === "bg"
        ? `Резултати за ${f(env, "election")}: ${env.facts.parties_over_threshold} партии над прага. Таблицата е подредена по гласове.`
        : `Results for ${f(env, "election")}: ${env.facts.parties_over_threshold} parties over threshold. Table sorted by votes.`;
    case "compareElections":
      return lang === "bg"
        ? `Активност: ${f(env, "turnout_a")} срещу ${f(env, "turnout_b")}. Машинно гласуване: ${f(env, "machine_a")} срещу ${f(env, "machine_b")}.`
        : `Turnout: ${f(env, "turnout_a")} vs ${f(env, "turnout_b")}. Machine voting: ${f(env, "machine_a")} vs ${f(env, "machine_b")}.`;
    default:
      return env.title;
  }
};
