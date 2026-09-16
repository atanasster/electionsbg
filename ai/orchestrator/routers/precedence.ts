import type { Domain } from "../../tools/types";
import { TOOLS } from "../../tools/registry";

// THE PRECEDENCE CONTRACT for the routing cascade (plan C9).
//
// `ai/orchestrator/router.ts` is one order-dependent function: 4,011 lines of
// conditionals whose comments say "MUST precede", "Before the compare block", "so the
// specific intent isn't pre-empted by ... below". That ordering is load-bearing, and
// nothing tested it — the regression suite pins what each question routes TO, never
// WHY it wins over the branch that would otherwise have taken it.
//
// So this file records the decisions that are easy to invert, in one place, with a
// probe for each. It deliberately does NOT restate the cascade: a copy of the
// conditions would drift from the code it describes. Each entry names a WINNER, the
// tool it must beat for the same question, and why — and the test asserts the winner
// wins, so a reordered cascade fails HERE with the reason attached.
//
// WHERE THIS STANDS ON C9's MODULARIZATION: the contract and its conflict test exist;
// the 4,011-line function has NOT been carved into the four domain modules the plan
// names. A contiguous carve would preserve behaviour but relocate the shadowing rather
// than remove it — the plan's own criticism — so it is deliberately left open work
// until these probes cover the overlap surface.

export type PrecedenceRule = {
  // The tool that must answer.
  winner: string;
  // The tool the cascade would otherwise reach for the same question. Named so a
  // failure says WHICH ordering inverted, not merely that an expectation changed.
  over: string;
  // Why the winner must win, in the cascade's own terms.
  because: string;
  probes: string[];
};

export const PRECEDENCE_RULES: PrecedenceRule[] = [
  {
    winner: "machineVoteByParty",
    over: "machineVoteSeries",
    because:
      "a per-party machine-vote request is a breakdown, not a rolling series; the series branch is party-blind",
    probes: ["Машинно гласуване по партия", "machine voting by party"],
  },
  {
    winner: "machineVoteSeries",
    over: "machineVoteByParty",
    because:
      "without a party cue the same words mean the adoption series over time",
    probes: [
      "Делът на машинното гласуване в последните 5 избора",
      "machine voting share in the last 5 elections",
    ],
  },
  {
    winner: "basketVsInflation",
    over: "compareElections",
    because:
      '"спрямо" is a compare trigger, but the pair of cues (basket AND inflation) is more specific than a two-election comparison',
    probes: [
      "Кошницата спрямо инфлацията",
      "the basket compared with inflation",
    ],
  },
  {
    winner: "budgetFunction",
    over: "defenseProgram",
    because:
      "a budget question about a ministry is a COFOG function question; the defence-programme tools answer weapons purchases",
    probes: ["Какъв е бюджетът за отбрана?", "What is the budget for defence?"],
  },
  {
    winner: "turnout",
    over: "turnoutSeries",
    because:
      "a named calendar year is a ballot, not a rolling window; the series tool only takes a count",
    probes: ["Каква беше активността през 2023?", "What was turnout in 2023?"],
  },
  {
    winner: "turnoutSeries",
    over: "turnout",
    because: "a count of elections with no year is a series",
    probes: [
      "Активността на последните 5 избора",
      "turnout in the last 5 elections",
    ],
  },
  {
    winner: "presidentialResults",
    over: "nationalResults",
    because:
      "presidential ballots are a different corpus; a presidential question must not fall into the parliamentary national result",
    probes: [
      "Кой е президентът през 2021?",
      "Who won the 2021 presidential election?",
    ],
  },
  {
    winner: "budgetOverview",
    over: "budgetByFunction",
    because:
      "a question about the budget as a whole is not a question about one function of it",
    probes: ["Какъв е държавният бюджет?", "What is the state budget?"],
  },
  {
    winner: "nzokDrugs",
    over: "nzokBudget",
    because:
      "a drug-spending question names the drug programme; the NZOK budget tool answers the fund's totals",
    // The EN wording is a KNOWN GAP below, not a probe: the BG question routes
    // correctly and the EN one does not, and a probe that cannot pass would hide
    // that behind a failing test instead of recording it.
    probes: ["Колко похарчи НЗОК за лекарства?"],
  },
  {
    winner: "riverbedCleaning",
    over: "procurementQuery",
    because:
      "riverbed cleaning is specific enough not to be hijacked by generic water or procurement words",
    probes: ["Прочистване на речни корита", "riverbed cleaning"],
  },
  {
    winner: "regionWinners",
    over: "regionBreakdown",
    because:
      '"which party led in each district" asks for the WINNER per area, not one party\'s breakdown across areas',
    probes: ["Покажи резултатите по МИР"],
  },
];

/**
 * Overlaps that are DOCUMENTED AS BROKEN here rather than quietly absent. Each is a
 * real question phrasing whose intended tool the cascade does not reach, so a future
 * fix turns this list red and forces the entry to be removed deliberately.
 */
export const KNOWN_PRECEDENCE_GAPS: {
  question: string;
  lang: "bg" | "en";
  intended: string;
  observed: string | null;
  note: string;
}[] = [
  {
    question: "Коя партия води във всеки МИР?",
    lang: "bg",
    intended: "regionWinners",
    observed: null,
    note: "the BG phrasing is not covered; 'Покажи резултатите по МИР' is",
  },
  {
    question: "Which party led in each electoral district?",
    lang: "en",
    intended: "regionWinners",
    observed: null,
    note: "the EN phrasing is not covered — the coverage gap the 2026-09-09 AI chat audit recorded as P1",
  },
  {
    question: "How much did NZOK spend on medicines?",
    lang: "en",
    intended: "nzokDrugs",
    observed: null,
    note: "the BG drug-spending question routes correctly; the EN wording is not covered",
  },
];

/** Every domain the registry declares, so a probe can be attributed to a group. */
export const DOMAIN_OF_TOOL: Record<string, Domain> = Object.fromEntries(
  TOOLS.map((t) => [t.name, t.domain]),
);

/** The rules, grouped by the winning tool's domain — the shape a split would follow. */
export const RULES_BY_DOMAIN = (): Partial<
  Record<Domain, PrecedenceRule[]>
> => {
  const out: Partial<Record<Domain, PrecedenceRule[]>> = {};
  for (const rule of PRECEDENCE_RULES) {
    const domain = DOMAIN_OF_TOOL[rule.winner];
    if (!domain) continue;
    out[domain] = [...(out[domain] ?? []), rule];
  }
  return out;
};
