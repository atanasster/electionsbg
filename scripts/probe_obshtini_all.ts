// Wide-net probe: transliterate every distinct BG município name from
// the ekatte index and try its subdomain on the obshtini.bg platform.
// Reports the slugs that respond + their FEES/TAX naredba doc IDs.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EKATTE = path.resolve(__dirname, "../data/ekatte_index.json");

// BG Cyrillic → official-style ASCII transliteration. Diacritic handling
// and digraphs match the Bulgarian Council of Ministers' 2009 system.
const T: Record<string, string> = {
  а: "a",
  б: "b",
  в: "v",
  г: "g",
  д: "d",
  е: "e",
  ж: "zh",
  з: "z",
  и: "i",
  й: "y",
  к: "k",
  л: "l",
  м: "m",
  н: "n",
  о: "o",
  п: "p",
  р: "r",
  с: "s",
  т: "t",
  у: "u",
  ф: "f",
  х: "h",
  ц: "ts",
  ч: "ch",
  ш: "sh",
  щ: "sht",
  ъ: "a",
  ь: "y",
  ю: "yu",
  я: "ya",
};

const transliterate = (s: string): string => {
  return s
    .toLowerCase()
    .split("")
    .map((c) => T[c] ?? c)
    .join("")
    .replace(/[^a-z0-9_-]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
};

type EkRow = {
  ekatte: string;
  name: string;
  obshtina: string;
  obshtina_code: string;
  is_village: boolean;
};

const main = async (): Promise<void> => {
  const rows = JSON.parse(fs.readFileSync(EKATTE, "utf-8")) as EkRow[];

  // Map: obshtina name → obshtina_code. One per município.
  const obshtinas = new Map<string, string>();
  for (const r of rows) {
    if (!obshtinas.has(r.obshtina)) {
      obshtinas.set(r.obshtina, r.obshtina_code);
    }
  }
  console.log(`Probing ${obshtinas.size} distinct obshtinas…\n`);

  const hits: Array<{
    obshtina: string;
    nameBg: string;
    slug: string;
    naredbiFolder?: number;
    tax?: { id: number; caption: string };
    fees?: { id: number; caption: string };
  }> = [];
  const alreadyWired = new Set([
    "SOF00",
    "VAR06",
    "PDV22",
    "BGS04",
    "RAZ26",
    "SFO39",
    "SZR22",
    "DOB03",
  ]);

  for (const [nameBg, obshtinaCode] of obshtinas) {
    if (alreadyWired.has(obshtinaCode)) continue;
    const slug = transliterate(nameBg);
    if (!slug || slug.length < 3) continue;
    try {
      const r = await fetch(
        `https://web-api.apis.bg/api/obshtina-${slug}/Folders`,
        { signal: AbortSignal.timeout(5000) },
      );
      if (!r.ok) continue;
      const j = (await r.json()) as {
        folders: { id: number; value: string; children?: unknown }[];
      };
      const flat: { id: number; value: string }[] = [];
      const walk = (
        nodes: { id: number; value: string; children?: unknown }[],
      ): void => {
        for (const n of nodes) {
          flat.push({ id: n.id, value: n.value });
          const kids = n.children as
            | { id: number; value: string; children?: unknown }[]
            | undefined;
          if (kids) walk(kids);
        }
      };
      walk(j.folders);
      const naredbi = flat.find((f) => f.value === "Наредби" && f.id > 0);
      if (!naredbi) {
        hits.push({ obshtina: obshtinaCode, nameBg, slug });
        console.log(`✓ ${obshtinaCode} (${slug}) — but no Наредби folder`);
        continue;
      }
      // Pull naredbi list
      const dRes = await fetch(
        `https://web-api.apis.bg/api/obshtina-${slug}/DocList`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            pageNumber: 1,
            pageSize: 100,
            sortOrder: 1,
            sortType: 1,
            filters: [
              {
                type: 29,
                params: { leadFolderId: naredbi.id, linkedFolder: 0 },
              },
            ],
          }),
          signal: AbortSignal.timeout(8000),
        },
      );
      if (!dRes.ok) {
        hits.push({
          obshtina: obshtinaCode,
          nameBg,
          slug,
          naredbiFolder: naredbi.id,
        });
        continue;
      }
      const dJson = (await dRes.json()) as {
        data?: Array<{ uniqueId: number; caption: string }>;
      };
      const items = dJson.data ?? [];
      const tax = items.find((i) =>
        /размера на местните данъци/i.test(i.caption),
      );
      const fees = items.find((i) =>
        /местните такси и цени на услуги/i.test(i.caption),
      );
      const hit = {
        obshtina: obshtinaCode,
        nameBg,
        slug,
        naredbiFolder: naredbi.id,
        tax: tax ? { id: tax.uniqueId, caption: tax.caption } : undefined,
        fees: fees ? { id: fees.uniqueId, caption: fees.caption } : undefined,
      };
      hits.push(hit);
      const t = tax ? `TAX=${tax.uniqueId}` : "TAX=?";
      const f = fees ? `FEES=${fees.uniqueId}` : "FEES=?";
      console.log(`✓ ${obshtinaCode} (${slug}, ${nameBg}) — ${t} · ${f}`);
    } catch {
      // timeout / network blip — silently skip
    }
  }

  console.log(`\n${hits.length} obshtinas on the platform (excl. wired).`);
  fs.writeFileSync(
    path.resolve(__dirname, "../data-reports/obshtini_bg_survey.json"),
    JSON.stringify(hits, null, 2) + "\n",
  );
  console.log("Wrote data-reports/obshtini_bg_survey.json");
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
