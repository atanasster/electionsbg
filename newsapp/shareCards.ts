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

const frame = (body: string): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${CARD_W}" height="${CARD_H}" viewBox="0 0 ${CARD_W} ${CARD_H}">` +
  `<rect width="100%" height="100%" fill="${INK.bg}"/>` +
  `<g font-family="${FONT}">` +
  `<text x="64" y="84" font-size="26" font-weight="700" fill="${INK.accent}">Наясно Новини</text>` +
  body +
  `<text x="64" y="${CARD_H - 48}" font-size="22" fill="${INK.muted}">${esc(
    "Описва отразяването, не човека · не е класация",
  )}</text>` +
  `</g></svg>`;

export interface PersonCardSpec {
  name: string;
  role?: string | null;
  n: number;
  outlets: number;
  counts: Partial<Record<Bucket, number>>;
}

export const personCardSvg = (spec: PersonCardSpec): string => {
  const total = BUCKETS.reduce((s, b) => s + (spec.counts[b] ?? 0), 0);
  const barX = 64;
  const barW = CARD_W - 128;
  let x = barX;
  const bar = BUCKETS.map((b) => {
    const c = spec.counts[b] ?? 0;
    if (!total || !c) return "";
    const w = (barW * c) / total;
    const rect = `<rect x="${x.toFixed(2)}" y="330" width="${w.toFixed(2)}" height="56" fill="${FILL[b]}"/>`;
    x += w;
    return rect;
  }).join("");
  const legend = BUCKETS.map((b, i) => {
    const lx = 64 + i * 218;
    return (
      `<rect x="${lx}" y="416" width="18" height="18" rx="3" fill="${FILL[b]}"/>` +
      `<text x="${lx + 28}" y="432" font-size="20" fill="${INK.muted}">${esc(
        `${LABEL[b]} ${spec.counts[b] ?? 0}`,
      )}</text>`
    );
  }).join("");
  return frame(
    `<text x="64" y="176" font-size="60" font-weight="800" fill="${INK.text}">${esc(
      fit(spec.name, 34),
    )}</text>` +
      (spec.role
        ? `<text x="64" y="226" font-size="28" fill="${INK.muted}">${esc(
            fit(spec.role, 60),
          )}</text>`
        : "") +
      `<text x="64" y="300" font-size="28" fill="${INK.text}">${esc(
        `${spec.n} материала от ${spec.outlets} издания`,
      )}</text>` +
      bar +
      legend,
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

export interface ShareCard {
  /** Path under the output directory, e.g. `og/persons/mp-1.png`. */
  file: string;
  svg: string;
}

/** The card URL a route's og:image names — the one place the path is minted. */
export const cardUrl = (file: string): string => `${NEWS_SITE}/${file}`;
export const personCardFile = (id: string): string =>
  `${CARD_DIR}/persons/${id}.png`;
export const PERSONS_CARD = `${CARD_DIR}/persons.png`;
export const MATRIX_CARD = `${CARD_DIR}/persons-media.png`;

type Row = Record<string, unknown>;
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
      svg: hubCardSvg(
        "Хора в новините",
        `Как медиите представят ${rows.length} души — по обем, не по тон`,
      ),
    },
  ];
  if (readJson(dataDir, "person_outlet_matrix.json")) {
    cards.push({
      file: MATRIX_CARD,
      svg: hubCardSvg(
        "Медиите и хората",
        "Как изданията представят едни и същи хора",
      ),
    });
  }
  for (const r of rows) {
    const id = String(r.id ?? "");
    if (!isNewsPersonId(id)) continue;
    const role = (r.role_label as { bg?: string } | null)?.bg ?? null;
    cards.push({
      file: personCardFile(id),
      svg: personCardSvg({
        name: String(r.name_bg ?? id),
        role,
        n: Number(r.n ?? 0),
        outlets: Number(r.outlet_count ?? 0),
        counts: (r.counts as PersonCardSpec["counts"]) ?? {},
      }),
    });
  }
  return cards;
};

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
