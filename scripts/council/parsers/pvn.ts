// Плевен (PVN01) — full-protocol DOCX parser.
//
// Source surface:
//   - Index: /bg/protokoli-i-resheniya/ (custom CMS)
//   - File pattern: uploads/posts/protokol<N>{1?}.docx
//     where the optional "1" suffix is the council's quirk (some files
//     have it, e.g. protokol-411.docx, protokol401.docx, others don't,
//     e.g. protokol-42.docx). It's not a separator — it's part of the
//     filename — so we extract the protocol number by stripping the
//     "protokol[-_]?" prefix and the trailing "1" if and only if the
//     digit run exceeds 2 chars.
//   - Date is in the protocol body header ("Плевен, 28.04.2026 г.").
//
// Pleven's DOCX has a distinctive format:
//   - Decision headers use letter-spacing: "Р  Е  Ш  Е  Н  И  Е      № 1103"
//   - Tally summary is a 3-line label-first block with em-dash + suffix:
//       За – 33 общински съветници;
//       Против – няма;
//       Въздържали се – няма.
//   - No ОТНОСНО: per resolution — titles are implicit from the agenda's
//     "ПО ПЪРВА ТОЧКА" / "ПО ВТОРА ТОЧКА" / ... numbering.
//
// We extract via lib/docx.ts then use the (extended) lib/tally.ts
// findResolutionMarkers (handles spaced РЕШЕНИЕ) and SUMMARY_RE_VERBOSE
// (handles the 3-line "общински съветници" suffix form).

import * as cheerio from "cheerio";
import { fetchHtml, resolveUrl, fetchToFile } from "../lib/fetch";
import { extractDocxText } from "../lib/docx";
import {
  classifyResult,
  findAllTallies,
  findResolutionMarkers,
} from "../lib/tally";
import type {
  CouncilResolution,
  MuniRecipe,
  MuniScrapeResult,
} from "../lib/types";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const OBSHTINA = "PVN01";
const BASE = "https://obs.pleven.bg/";
const INDEX_URL = `${BASE}bg/protokoli-i-resheniya/`;

type ProtocolRef = {
  url: string;
  filename: string;
  session: string;
};

// Match the loose uploads/posts/protokolNN[1].{docx,pdf} family. Capture
// the numeric run; we'll trim a trailing single digit later if it looks
// like the council's "1" suffix tic.
const PROTOCOL_HREF_RE =
  /uploads\/posts\/protokol[-_]?(\d{1,4})\.(docx?|pdf)/iu;

const discoverProtocols = async (): Promise<ProtocolRef[]> => {
  const html = await fetchHtml(INDEX_URL);
  const $ = cheerio.load(html);
  const out: ProtocolRef[] = [];
  const seen = new Set<string>();
  $("a[href]").each((_: number, a) => {
    const href = $(a).attr("href") ?? "";
    const m = href.match(PROTOCOL_HREF_RE);
    if (!m) return;
    // hrefs are site-root-relative ("uploads/posts/protokol-42.docx").
    // Resolve against BASE, not the index URL, to avoid prefixing the
    // /bg/protokoli-i-resheniya/ path.
    const url = resolveUrl(href.replace(/^\/+/, ""), BASE);
    if (seen.has(url)) return;
    seen.add(url);
    // Skip PDF files for the DOCX-only parser — surface as soft errors.
    if (m[2].toLowerCase() === "pdf") return;
    let digits = m[1];
    // Heuristic: if 3+ digits and ends with "1", strip the trailing "1"
    // (protokol-411.docx → protocol 41; protokol321.docx → protocol 32).
    // 2-digit protocols (protokol-42.docx) stay as-is.
    if (digits.length >= 3 && digits.endsWith("1")) {
      digits = digits.slice(0, -1);
    }
    out.push({
      url,
      filename: m[0],
      session: digits,
    });
  });
  // Newest-first sort by session number desc.
  out.sort((a, b) => parseInt(b.session, 10) - parseInt(a.session, 10));
  return out;
};

const extractSittingDate = (text: string): string | null => {
  // "Плевен, 28.04.2026 г."
  const m = text.match(/Плевен,\s*(\d{1,2})\.(\d{1,2})\.(\d{4})/iu);
  if (!m) return null;
  return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
};

const parseProtocolText = (
  text: string,
  meta: { url: string; session: string; date: string },
): CouncilResolution[] => {
  const tallies = findAllTallies(text);
  const markers = findResolutionMarkers(text);
  const out: CouncilResolution[] = [];
  const yyyy = meta.date.slice(0, 4);
  for (const marker of markers) {
    let best: (typeof tallies)[number] | undefined;
    for (const t of tallies) {
      if (t.offset < marker.offset) best = t;
      else break;
    }
    const tally = best?.tally;
    const result = best ? classifyResult(text, best.offset) : "unknown";
    out.push({
      id: `${OBSHTINA}-${yyyy}-prot${meta.session}-r${marker.number}`,
      date: meta.date,
      session: meta.session,
      number: marker.number,
      title: marker.title || "(no title parsed)",
      tally,
      result,
      sourceUrl: meta.url,
    });
  }
  return out;
};

export const scrapePVN = async (
  _recipe: MuniRecipe,
  opts: {
    sinceYear?: number;
    sinceDate?: string;
    maxProtocols?: number;
  },
): Promise<MuniScrapeResult> => {
  const errors: MuniScrapeResult["errors"] = [];
  const resolutions: CouncilResolution[] = [];
  let protocolsTouched = 0;

  let refs: ProtocolRef[];
  try {
    refs = await discoverProtocols();
  } catch (err) {
    return {
      obshtinaCode: OBSHTINA,
      resolutions: [],
      protocolsTouched: 0,
      errors: [
        {
          url: INDEX_URL,
          message: err instanceof Error ? err.message : String(err),
        },
      ],
    };
  }

  if (opts.maxProtocols) refs = refs.slice(0, opts.maxProtocols);

  if (refs.length === 0) {
    console.log(`  [${OBSHTINA}] no new protocols`);
    return { obshtinaCode: OBSHTINA, resolutions, protocolsTouched, errors };
  }

  console.log(`  [${OBSHTINA}] fetching ${refs.length} protocol(s)`);
  const dir = await mkdtemp(join(tmpdir(), "council-pvn-"));
  try {
    for (const ref of refs) {
      const localPath = join(dir, `prot_${ref.session}.docx`);
      try {
        await fetchToFile(ref.url, localPath);
        const buf = await readFile(localPath);
        const text = await extractDocxText(buf);
        const sittingDate = extractSittingDate(text);
        if (!sittingDate) {
          errors.push({
            url: ref.url,
            message: "could not parse sitting date from header",
          });
          continue;
        }
        if (
          opts.sinceYear &&
          parseInt(sittingDate.slice(0, 4), 10) < opts.sinceYear
        )
          continue;
        if (opts.sinceDate && sittingDate <= opts.sinceDate) continue;
        const recs = parseProtocolText(text, {
          url: ref.url,
          session: ref.session,
          date: sittingDate,
        });
        resolutions.push(...recs);
        protocolsTouched++;
        console.log(
          `    + prot ${ref.session} (${sittingDate}): ${recs.length} resolution(s)`,
        );
      } catch (err) {
        errors.push({
          url: ref.url,
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }

  return { obshtinaCode: OBSHTINA, resolutions, protocolsTouched, errors };
};
