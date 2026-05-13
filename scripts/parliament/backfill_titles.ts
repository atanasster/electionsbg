// One-off backfill: re-fetch each session's "Гласуване по парламентарни групи"
// CSV from parliament.bg and inject `itemTitles` + `pdfUrl` into the existing
// session JSON files under data/parliament/votes/sessions/. Idempotent — re-
// run anytime to refresh titles.
//
// Skips the index/diff-cap/canary machinery. Run once after the title parser
// lands; thereafter the normal scrape picks up titles for new sessions.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  fetchStenogram,
  findGroupsCsv,
  findRollcallPdf,
  fetchCsv,
  publicUrl,
} from "./rollcall/api";
import { extractItemTitles } from "./rollcall/titles";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const VOTES_DIR = path.resolve(__dirname, "../../data/parliament/votes");
const INDEX_FILE = path.join(VOTES_DIR, "index.json");

interface IndexEntry {
  date: string;
  stenogramId: number;
  file: string;
}

const main = async (): Promise<void> => {
  const idx = JSON.parse(fs.readFileSync(INDEX_FILE, "utf8")) as {
    sessions: IndexEntry[];
  };
  console.log(`→ backfilling titles for ${idx.sessions.length} session(s)`);
  let titleHits = 0;
  let pdfHits = 0;
  for (const entry of idx.sessions) {
    const sessionPath = path.join(VOTES_DIR, entry.file);
    if (!fs.existsSync(sessionPath)) {
      console.log(`  · ${entry.date}: file missing — skipped`);
      continue;
    }
    const sten = await fetchStenogram(entry.stenogramId);
    if (!sten) {
      console.log(
        `  · ${entry.date}: stenogram ${entry.stenogramId} not found`,
      );
      continue;
    }
    const groupsRef = findGroupsCsv(sten);
    let itemTitles: Record<string, string> = {};
    if (groupsRef) {
      try {
        const csv = await fetchCsv(groupsRef.Pl_StenDfile);
        itemTitles = extractItemTitles(csv);
      } catch (e) {
        console.log(
          `  · ${entry.date}: groups CSV fetch failed (${(e as Error).message})`,
        );
      }
    }
    const pdfRef = findRollcallPdf(sten);
    const pdfUrl = pdfRef ? publicUrl(pdfRef.Pl_StenDfile) : undefined;
    const session = JSON.parse(fs.readFileSync(sessionPath, "utf8")) as Record<
      string,
      unknown
    >;
    if (Object.keys(itemTitles).length > 0) {
      session.itemTitles = itemTitles;
      titleHits++;
    } else {
      delete session.itemTitles;
    }
    if (pdfUrl) {
      session.pdfUrl = pdfUrl;
      pdfHits++;
    } else {
      delete session.pdfUrl;
    }
    fs.writeFileSync(sessionPath, JSON.stringify(session, null, 2) + "\n");
    console.log(
      `  ~ ${entry.date}: ${Object.keys(itemTitles).length} title(s)${pdfUrl ? " + pdf" : ""}`,
    );
  }
  console.log(
    `✓ done — ${titleHits}/${idx.sessions.length} session(s) with titles, ${pdfHits} with PDFs`,
  );
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
