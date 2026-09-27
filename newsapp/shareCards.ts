// Share cards (og:image) for the person pages, /persons and the outlet grid
// (news-person-sentiment-v1 §6.3).
//
// ⚠️ THE NEWS APP HAD NO CHART CARD PIPELINE: an article page borrows its own
// photo, and the main site's cards drive a browser. These are drawn at build
// time instead — an SVG template rendered to PNG with `sharp` — so there is no
// browser and a card changes only when its numbers do.
//
// ⚠️ A CARD MAY SAY NO MORE THAN ITS PAGE. It carries the name, the office,
// the full five-bucket distribution with its neutral majority, N and the
// outlet count — never a mean, a score or a rank, and it says what it
// describes: the coverage, not the person.

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { NEWS_SITE } from "./app/site";
import { isNewsPersonId } from "./app/newsPersonId";

export const CARD_W = 1200;
export const CARD_H = 630;
export const CARD_DIR = "og";

const BUCKETS = [
  "strongly_unfavorable",
  "unfavorable",
  "neutral",
  "favorable",
  "strongly_favorable",
] as const;
type Bucket = (typeof BUCKETS)[number];

const LABEL: Record<Bucket, string> = {
  strongly_unfavorable: "силно неблагоприятно",
  unfavorable: "неблагоприятно",
  neutral: "неутрално",
  favorable: "благоприятно",
  strongly_favorable: "силно благоприятно",
};
const LABEL_EN: Record<Bucket, string> = {
  strongly_unfavorable: "strongly unfavourable",
  unfavorable: "unfavourable",
  neutral: "neutral",
  favorable: "favourable",
  strongly_favorable: "strongly favourable",
};
type Lang = "bg" | "en";
const FILL: Record<Bucket, string> = {
  strongly_unfavorable: "#c2410c",
  unfavorable: "#e8956f",
  neutral: "#8b95a8",
  favorable: "#7cc3a3",
  strongly_favorable: "#15803d",
};
const INK = {
  bg: "#0b1224",
  text: "#f2f5f8",
  muted: "#9aa7bd",
  accent: "#df6b43",
};
const FONT = "Inter, 'Helvetica Neue', Arial, 'DejaVu Sans', sans-serif";

const esc = (s: string): string =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/** Cut on a word boundary so a long name never runs off the card. */
const fit = (s: string, max: number): string =>
  s.length <= max ? s : s.slice(0, max).replace(/\s+\S*$/, "") + "…";

const frame = (body: string, lang: Lang = "bg"): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${CARD_W}" height="${CARD_H}" viewBox="0 0 ${CARD_W} ${CARD_H}">` +
  `<rect width="100%" height="100%" fill="${INK.bg}"/>` +
  `<g font-family="${FONT}">` +
  `<text x="64" y="84" font-size="26" font-weight="700" fill="${INK.accent}">${lang === "en" ? "Naiasno News" : "Наясно Новини"}</text>` +
  body +
  `<text x="64" y="${CARD_H - 48}" font-size="22" fill="${INK.muted}">${esc(
    lang === "en"
      ? "Describes the coverage, not the person · not a ranking"
      : "Описва отразяването, не човека · не е класация",
  )}</text>` +
  `</g></svg>`;

type Row = Record<string, unknown>;

export interface PersonCardSpec {
  name: string;
  role?: string | null;
  /** Story-basis units: one outlet's coverage of one story counts once. */
  n: number;
  outlets: number;
  counts: Partial<Record<Bucket, number>>;
  first?: string | null;
  last?: string | null;
}

/** dd.mm.yyyy from an ISO date, or null — the card states dates, never ages. */
const dmy = (iso: string | null | undefined): string | null => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? "");
  return m ? `${m[3]}.${m[2]}.${m[1]}` : null;
};

/** A stacked five-bucket bar at (x, y), widths proportional to the counts. */
const stackedBar = (
  counts: Partial<Record<Bucket, number>>,
  x0: number,
  y: number,
  w: number,
  h: number,
): string => {
  const total = BUCKETS.reduce((s, b) => s + (counts[b] ?? 0), 0);
  if (!total) return "";
  let x = x0;
  return BUCKETS.map((b) => {
    const c = counts[b] ?? 0;
    if (!c) return "";
    const width = (w * c) / total;
    const rect = `<rect x="${x.toFixed(2)}" y="${y}" width="${width.toFixed(2)}" height="${h}" fill="${FILL[b]}"/>`;
    x += width;
    return rect;
  }).join("");
};

const legend = (
  y: number,
  counts?: Partial<Record<Bucket, number>>,
  lang: Lang = "bg",
): string =>
  BUCKETS.map((b, i) => {
    const lx = 64 + i * 218;
    return (
      `<rect x="${lx}" y="${y - 16}" width="18" height="18" rx="3" fill="${FILL[b]}"/>` +
      `<text x="${lx + 28}" y="${y}" font-size="20" fill="${INK.muted}">${esc(
        counts
          ? `${(lang === "en" ? LABEL_EN : LABEL)[b]} ${counts[b] ?? 0}`
          : (lang === "en" ? LABEL_EN : LABEL)[b],
      )}</text>`
    );
  }).join("");

export const personCardSvg = (
  spec: PersonCardSpec,
  lang: Lang = "bg",
): string => {
  const first = dmy(spec.first);
  const last = dmy(spec.last);
  const span = first && last ? ` · ${first}–${last}` : "";
  return frame(
    `<text x="64" y="176" font-size="60" font-weight="800" fill="${INK.text}">${esc(
      fit(spec.name, 34),
    )}</text>` +
      (spec.role
        ? `<text x="64" y="226" font-size="28" fill="${INK.muted}">${esc(
            fit(spec.role, 60),
          )}</text>`
        : "") +
      // ⚠️ n counts (outlet, story) units, not articles — the card must not
      // print a figure the page does not.
      `<text x="64" y="300" font-size="26" fill="${INK.text}">${esc(
        lang === "en"
          ? `${spec.n} scores (outlet × story) from ${spec.outlets} outlets${span}`
          : `${spec.n} оценки (издание × история) от ${spec.outlets} издания${span}`,
      )}</text>` +
      stackedBar(spec.counts, 64, 330, CARD_W - 128, 56) +
      legend(432, spec.counts, lang),
    lang,
  );
};

export const hubCardSvg = (title: string, subtitle: string): string =>
  frame(
    `<text x="64" y="220" font-size="64" font-weight="800" fill="${INK.text}">${esc(
      fit(title, 32),
    )}</text>` +
      `<text x="64" y="290" font-size="30" fill="${INK.muted}">${esc(
        fit(subtitle, 70),
      )}</text>`,
  );

/** `/persons`: the most-covered people and their distributions — ordered by
 *  coverage, exactly as the index is, never by tone. */
export const personsCardSvg = (rows: Row[]): string => {
  const top = rows.slice(0, 6);
  const body = top
    .map((r, i) => {
      const y = 150 + i * 58;
      return (
        `<text x="64" y="${y + 28}" font-size="26" fill="${INK.text}">${esc(
          fit(String(r.name_bg ?? r.id ?? ""), 26),
        )}</text>` +
        stackedBar(
          (r.counts as PersonCardSpec["counts"]) ?? {},
          520,
          y + 6,
          520,
          30,
        ) +
        `<text x="1060" y="${y + 30}" font-size="22" fill="${INK.muted}">${Number(
          r.n ?? 0,
        )}</text>`
      );
    })
    .join("");
  return frame(
    `<text x="64" y="128" font-size="40" font-weight="800" fill="${INK.text}">${esc(
      `Хора в новините — ${rows.length} души, по обем на отразяването`,
    )}</text>` +
      body +
      legend(CARD_H - 96),
  );
};

type MatrixDoc = {
  rules?: { cell_min_n?: number };
  periods?: Record<
    string,
    {
      offered?: boolean;
      rows?: { id: string }[];
      cols?: { domain: string }[];
      cells?: Record<
        string,
        Record<string, { n?: number; mean_bucket?: Bucket | null }>
      >;
    }
  >;
};

/** `/persons/media`: the grid itself, in position mode — a blank cell under
 *  the per-cell minimum, exactly as on the page. */
export const matrixCardSvg = (m: MatrixDoc): string => {
  const period = (["90", "all", "30"] as const)
    .map((k) => m.periods?.[k])
    .find((p) => p?.offered);
  if (!period)
    return hubCardSvg(
      "Медиите и хората",
      "Как изданията представят едни и същи хора",
    );
  const rows = period.rows ?? [];
  const cols = period.cols ?? [];
  const min = m.rules?.cell_min_n ?? 5;
  // Rows run from y=130 to above the legend (CARD_H - 96 - 16), each cell
  // plus its 2px gap; columns across 1072px the same way.
  const size = Math.max(
    4,
    Math.min(
      26,
      Math.floor((CARD_H - 112 - 130) / Math.max(rows.length, 1)) - 2,
      Math.floor((CARD_W - 128) / Math.max(cols.length, 1)) - 2,
    ),
  );
  const cells = rows
    .flatMap((r, i) =>
      cols.map((c, j) => {
        const cell = period.cells?.[r.id]?.[c.domain];
        const x = 64 + j * (size + 2);
        const y = 130 + i * (size + 2);
        return cell && (cell.n ?? 0) >= min && cell.mean_bucket
          ? `<rect x="${x}" y="${y}" width="${size}" height="${size}" rx="2" fill="${FILL[cell.mean_bucket]}"/>`
          : `<rect x="${x}" y="${y}" width="${size}" height="${size}" rx="2" fill="none" stroke="${INK.muted}" stroke-opacity="0.35"/>`;
      }),
    )
    .join("");
  return frame(
    `<text x="64" y="104" font-size="40" font-weight="800" fill="${INK.text}">${esc(
      `Медиите и хората — ${rows.length} души × ${cols.length} издания`,
    )}</text>` +
      cells +
      legend(CARD_H - 96),
  );
};

export interface ShareCard {
  /** Path under the output directory, e.g. `og/persons/mp-1.png`. */
  file: string;
  svg: string;
}

/** The card URL a route's og:image names — the one place the path is minted.
 *  The version is a digest of the card's content, so a crawler or a browser
 *  holding the 30-day `**\/*.png` cache fetches a new image the day the
 *  numbers change, and the same one otherwise. */
export const cardUrl = (card: ShareCard): string =>
  `${NEWS_SITE}/${card.file}?v=${createHash("sha256").update(card.svg).digest("hex").slice(0, 10)}`;
export const personCardFile = (id: string, lang: Lang = "bg"): string =>
  `${CARD_DIR}/${lang === "en" ? "en/" : ""}persons/${id}.png`;
export const PERSONS_CARD = `${CARD_DIR}/persons.png`;
export const MATRIX_CARD = `${CARD_DIR}/persons-media.png`;

const readJson = (dir: string, name: string): Row | null => {
  const file = path.join(dir, name);
  return fs.existsSync(file)
    ? (JSON.parse(fs.readFileSync(file, "utf-8")) as Row)
    : null;
};

/** Every card the published person data calls for — none when it is held. */
export const buildShareCards = (dataDir: string): ShareCard[] => {
  const persons = readJson(dataDir, "persons.json");
  if (!persons) return [];
  const rows = (persons.persons as Row[] | undefined) ?? [];
  const cards: ShareCard[] = [
    {
      file: PERSONS_CARD,
      // §8.2 — during an election freeze with no snapshot nothing is
      // published; the card must not read as „0 people".
      svg: persons.withheld
        ? hubCardSvg(
            "Хора в новините",
            "Данните са задържани до края на изборния ден",
          )
        : personsCardSvg(rows),
    },
  ];
  const matrix = readJson(dataDir, "person_outlet_matrix.json");
  if (matrix) {
    cards.push({ file: MATRIX_CARD, svg: matrixCardSvg(matrix as MatrixDoc) });
  }
  for (const r of rows) {
    const id = String(r.id ?? "");
    if (!isNewsPersonId(id)) continue;
    const labels = (r.role_label as { bg?: string; en?: string } | null) ?? {};
    const spec = {
      n: Number(r.n ?? 0),
      outlets: Number(r.outlet_count ?? 0),
      counts: (r.counts as PersonCardSpec["counts"]) ?? {},
      first: (r.first_published as string | null) ?? null,
      last: (r.last_published as string | null) ?? null,
    };
    cards.push({
      file: personCardFile(id),
      svg: personCardSvg({
        ...spec,
        name: String(r.name_bg ?? id),
        role: labels.bg ?? null,
      }),
    });
    // The /en mirror's card: English name, office and labels.
    cards.push({
      file: personCardFile(id, "en"),
      svg: personCardSvg(
        {
          ...spec,
          name: String(r.name_en ?? r.name_bg ?? id),
          role: labels.en ?? null,
        },
        "en",
      ),
    });
  }
  return cards;
};

/** file → versioned og:image URL, for the routes. */
export const cardUrls = (dataDir: string): Map<string, string> =>
  new Map(buildShareCards(dataDir).map((c) => [c.file, cardUrl(c)]));

/** Render every card to PNG under `outDir`. */
export const writeShareCards = async (
  outDir: string,
  cards: ShareCard[],
): Promise<number> => {
  const { default: sharp } = await import("sharp");
  for (const card of cards) {
    const dest = path.join(outDir, card.file);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    await sharp(Buffer.from(card.svg)).png().toFile(dest);
  }
  return cards.length;
};
