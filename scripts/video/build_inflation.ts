/**
 * Precomputes the inflation explainer's series and every derived figure it
 * claims, with assertions — so a data refresh that moves the story fails the
 * BUILD rather than silently changing what the narration asserts.
 *
 *   npm run video:data-inflation
 *
 * Source: `data/macro_peers.json` → `indicators.inflation`, Eurostat
 * `prc_hicp_minr` (annual rate, quarterly cadence), 86 quarters 2005-Q1..2026-Q2.
 *
 * ── WHY EVERY CLAIM IS ASSERTED HERE ──────────────────────────────────────────
 * This video makes a causally-loaded observation — Bulgarian inflation more than
 * doubled in the quarter after euro adoption — and the whole editorial defence is
 * the surrounding context: the EU average rose too, ours rose about four times as
 * much, the first euro quarter was actually our LOWEST reading in a year, and
 * Croatia's post-adoption inflation FELL during a global disinflation so it is not
 * a clean comparison. If a refresh moves any of those, the script stops being
 * honest. Better to break the build than to keep narrating the old shape.
 */
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const OUT = resolve("video/src/generated/inflation.json");

/** Euro adoption dates. BG: 2026-01-01. HR: 2023-01-01. */
const BG_EURO_PERIOD = "2026-Q1";
const HR_EURO_PERIOD = "2023-Q1";

type Point = { year: number; quarter: number; period: string; value: number };

const main = () => {
  const peers = JSON.parse(
    readFileSync(resolve("data/macro_peers.json"), "utf8"),
  ) as {
    indicators: {
      inflation: {
        series: Record<string, Point[]>;
        latestDistribution: {
          period: string;
          bgValue: number;
          euAverage: number;
          rank: number;
          total: number;
        } | null;
      };
    };
  };
  const inf = peers.indicators.inflation;
  const S = inf.series;
  const dist = inf.latestDistribution;
  if (!dist) throw new Error("no latestDistribution — cannot state the rank");

  const at = (geo: string, period: string) =>
    S[geo]?.find((p) => p.period === period)?.value ?? null;

  const bgLast = S.BG!.at(-1)!;
  const bgPrev = S.BG!.at(-2)!;
  const euLast = at("EU27_2020", bgLast.period)!;
  const euPrev = at("EU27_2020", bgPrev.period)!;

  const bgJump = +(bgLast.value - bgPrev.value).toFixed(2);
  const euJump = +(euLast - euPrev).toFixed(2);

  // How often BG sat above the EU average across the whole series.
  const euBy = new Map(S.EU27_2020!.map((p) => [p.period, p.value]));
  let above = 0;
  let both = 0;
  let peak: Point = S.BG![0]!;
  for (const p of S.BG!) {
    const e = euBy.get(p.period);
    if (e == null) continue;
    both++;
    if (p.value > e) above++;
    if (p.value > peak.value) peak = p;
  }

  // Croatia across its own euro adoption — the only other recent adopter here.
  const hrBefore = at("HR", "2022-Q4")!;
  const hrAfterY1 = at("HR", "2023-Q4")!;
  const euAtHrBefore = euBy.get("2022-Q4")!;
  const euAtHrAfter = euBy.get("2023-Q4")!;

  const facts = {
    latest: {
      period: bgLast.period,
      bg: bgLast.value,
      eu: euLast,
      rank: dist.rank,
      total: dist.total,
      /** rank 1 = LOWEST (direction "lower"), so this is the position from the top. */
      rankFromTop: dist.total - dist.rank + 1,
    },
    jump: {
      fromPeriod: bgPrev.period,
      toPeriod: bgLast.period,
      bgFrom: bgPrev.value,
      bgTo: bgLast.value,
      bgDelta: bgJump,
      euFrom: euPrev,
      euTo: euLast,
      euDelta: euJump,
      ratio: +(bgJump / euJump).toFixed(1),
    },
    euro: {
      bgAdoptionPeriod: BG_EURO_PERIOD,
      /** The first quarter carrying the euro — and it was LOW, which is the point. */
      bgFirstEuroQuarter: at("BG", BG_EURO_PERIOD)!,
      hrAdoptionPeriod: HR_EURO_PERIOD,
      hrBefore,
      hrAfterY1,
      euAtHrBefore,
      euAtHrAfter,
    },
    history: {
      quarters: both,
      aboveEu: above,
      abovePct: Math.round((above / both) * 100),
      peakPeriod: peak.period,
      peakValue: peak.value,
      firstPeriod: S.BG![0]!.period,
    },
  };

  // ── Assertions: every one of these is spoken in the script ─────────────────
  const fail = (m: string) => {
    console.error(`Refusing to write — the story moved: ${m}`);
    process.exit(1);
  };
  if (facts.latest.rankFromTop !== 2)
    fail(
      `BG is now #${facts.latest.rankFromTop} from the top, script says 2nd`,
    );
  if (!(facts.jump.bgTo > facts.jump.bgFrom * 2))
    fail(
      `BG did not MORE THAN DOUBLE (${facts.jump.bgFrom} → ${facts.jump.bgTo})`,
    );
  if (!(facts.jump.euDelta > 0))
    fail(`the EU average did not also rise (${facts.jump.euDelta})`);
  if (!(facts.jump.ratio >= 3))
    fail(
      `BG rose only ${facts.jump.ratio}x the EU rise, script says about four times`,
    );
  if (!(facts.euro.bgFirstEuroQuarter < facts.jump.bgTo))
    fail(`the first euro quarter was not lower than the jump quarter`);
  if (!(facts.euro.hrAfterY1 < facts.euro.hrBefore))
    fail(`Croatia's inflation did not fall after adoption`);
  if (!(facts.euro.euAtHrAfter < facts.euro.euAtHrBefore))
    fail(
      `the EU was not also disinflating in Croatia's year — the confound is the point`,
    );
  if (facts.history.abovePct < 60 || facts.history.abovePct > 85)
    fail(
      `BG above the EU line ${facts.history.abovePct}% of quarters, script says about 70%`,
    );

  const series = (geo: string) =>
    (S[geo] ?? []).map((p) => ({ p: p.period, v: p.value }));

  mkdirSync(resolve("video/src/generated"), { recursive: true });
  writeFileSync(
    OUT,
    JSON.stringify({
      facts,
      series: {
        BG: series("BG"),
        EU: series("EU27_2020"),
        RO: series("RO"),
        HR: series("HR"),
      },
      peersLatest: (["RO", "BG", "HR", "GR", "EU27_2020", "HU"] as const).map(
        (g) => ({ geo: g, value: at(g, bgLast.period) }),
      ),
    }),
    "utf8",
  );

  console.log(
    `  latest      ${facts.latest.period}: BG ${facts.latest.bg}% · EU ${facts.latest.eu}% · #${facts.latest.rankFromTop} of ${facts.latest.total}`,
  );
  console.log(
    `  jump        ${facts.jump.bgFrom}% → ${facts.jump.bgTo}% (EU ${facts.jump.euFrom}% → ${facts.jump.euTo}%, ${facts.jump.ratio}x)`,
  );
  console.log(
    `  first euro Q ${facts.euro.bgAdoptionPeriod}: ${facts.euro.bgFirstEuroQuarter}%`,
  );
  console.log(
    `  croatia     ${facts.euro.hrBefore}% → ${facts.euro.hrAfterY1}% (EU ${facts.euro.euAtHrBefore}% → ${facts.euro.euAtHrAfter}%)`,
  );
  console.log(
    `  history     above EU in ${facts.history.aboveEu}/${facts.history.quarters} quarters (${facts.history.abovePct}%), peak ${facts.history.peakValue}% ${facts.history.peakPeriod}`,
  );
  console.log(`  → ${OUT}`);
};

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
