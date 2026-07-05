// Automatic scraper + loader for ЕРИК campaign-finance data
// (erik.bulnao.government.bg — Единен регистър по Изборния кодекс, Court of Audit).
//
// Previous campaign-finance data was downloaded by hand. This script reproduces
// the exact raw_data/<election>/smetna_palata/ layout the manual process built,
// so the existing parser (parseFinancing, run via `npm run data -- --financing`)
// consumes it unchanged:
//
//   raw_data/<election>/smetna_palata/
//     sp_parties.json                     ← ЕРИК-name → CIK-name reconciliation map
//     candidates_donations.csv            ← election-wide candidate/ИнК donations
//     parties/<CIK party name>/
//       filing.pdf                        ← post-election financial report (GDPR-safe copy)
//       from_donors.csv                   ← this party's donors
//       from_candidates.csv               ← this party's candidate donations (archival)
//
// All ЕРИК endpoints are plain-HTTP JSON (DataTables) — see erik_client.ts.
//
// CLI:  npx tsx scripts/smetna_palata/scrape_erik.ts [<election|electionId>]
//       (defaults to ERIK_ELECTIONS[0], the latest election)
// Or via the pipeline:  npm run data -- --erik [<election>]

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import type { PartyInfo } from "@/data/dataTypes";
import { createErikClient } from "./erik_client";
import {
  ERIK_ELECTIONS,
  findErikElection,
  type ErikElection,
} from "./erik_config";
import { reconcileErikToCik } from "./reconcile_parties";

type DataTable<T> = {
  recordsTotal: number;
  data: T[];
  additionalParameters?: {
    TotalDonationPrice?: number;
    TotalDonationValue?: number;
  };
};

type Participant = {
  id: number;
  registeredName: string;
  participantName: string; // "Партия" | "Коалиция" | "Инициативен комитет"
  registryNumber: string;
  commissionType: number; // 1=ЦИК, 2=РИК, 3=ОИК (== ikTypeId)
};

type DonationRow = {
  fullName?: string;
  donationDate?: string;
  donationType?: string;
  description?: string;
  donationPrice?: number;
  donationValue?: number;
};

type CandidateRow = {
  name?: string;
  fullName?: string;
  participant?: string;
  dateDonation?: string;
  donationDate?: string;
  candidateType?: string;
  moneyDonation?: number;
  donationPrice?: number;
  noMoneyDonation?: number;
  donationValue?: number;
};

type AgencyRow = {
  name?: string;
  eik?: string;
  typeOfAgency?: string;
  participant?: string; // "КП ГЕРБ-СДС - Коалиция"
  descr?: string;
};

const PAGE_LEN = 100000; // pull every row in one shot

// ── small helpers ────────────────────────────────────────────────────────────

const fmtDate = (iso: string | undefined): string => {
  if (!iso) return "";
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : iso;
};

const fmtMoney = (n: number | undefined): string =>
  (Number.isFinite(n) ? (n as number) : 0).toFixed(2);

const csvCell = (v: unknown): string =>
  `"${String(v ?? "").replace(/"/g, '""')}"`;
const csvRow = (cells: unknown[]): string => cells.map(csvCell).join(",");

const writeFile = (file: string, contents: string | Uint8Array): void => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, contents);
};

// ── ЕРИК fetchers ────────────────────────────────────────────────────────────

const client = createErikClient();

const fetchParticipants = async (el: ErikElection): Promise<Participant[]> => {
  const out: Participant[] = [];
  for (const commissionType of [1, 2, 3]) {
    const res = await client.postJson<DataTable<Participant>>(
      "/Reports/GetParticipantsByElectionId",
      {
        electionId: el.electionId,
        electionCommissionType: commissionType,
        draw: 1,
        start: 0,
        length: 1000,
      },
    );
    for (const r of res.data) out.push({ ...r, commissionType });
  }
  return out;
};

const fetchParticipantDonations = (el: ErikElection, p: Participant) =>
  client.postJson<DataTable<DonationRow>>(
    "/Participant/GetParticipantDonations",
    {
      participantId: p.id,
      electionId: el.electionId,
      electionCommissionType: p.commissionType,
      isOldSystemElection: el.isOldSystem,
      draw: 1,
      start: 0,
      length: PAGE_LEN,
    },
  );

const fetchParticipantCandidates = (el: ErikElection, p: Participant) =>
  client.postJson<DataTable<CandidateRow>>(
    "/Participant/GetParticipantCandidateDeclarations",
    {
      participantId: p.id,
      electionId: el.electionId,
      electionCommissionType: p.commissionType,
      isOldSystemElection: el.isOldSystem,
      draw: 1,
      start: 0,
      length: PAGE_LEN,
    },
  );

const fetchElectionCandidates = (el: ErikElection) =>
  client.postJson<DataTable<CandidateRow>>(
    "/Reports/GetCandidateDeclarations",
    {
      electionId: el.electionId,
      electionCommissionType: 1,
      isOldSystemElection: el.isOldSystem,
      draw: 1,
      start: 0,
      length: PAGE_LEN,
    },
  );

const fetchElectionAgencies = (el: ErikElection) =>
  client.postJson<DataTable<AgencyRow>>("/Reports/GetAgencies", {
    electionId: el.electionId,
    draw: 1,
    start: 0,
    length: PAGE_LEN,
  });

// Download the post-election financial report PDF (GDPR-safe copy). Returns the
// PDF bytes, or null if this participant hasn't filed a report yet.
const fetchFilingPdf = async (
  el: ErikElection,
  p: Participant,
): Promise<Uint8Array | null> => {
  const html = await client.get(
    `/Participant/AfterElectionSub?id=${p.id}&electionId=${el.electionId}&ikTypeId=${p.commissionType}`,
  );
  const form = html.match(
    /action='\/Reports\/DownloadPdfGDPRSafeCopy'[\s\S]*?<\/form>/,
  );
  if (!form) return null; // no report filed yet (genuine)
  // Below this point a filing DOES exist — a null return means we failed to
  // fetch it, which is data loss, so warn loudly (distinct from "no report")
  // rather than let the caller log the misleading "no filing yet".
  const pdfId = form[0].match(/name='pdfId' value=(\d+)/)?.[1];
  const token = form[0].match(
    /name="__RequestVerificationToken" type="hidden" value="([^"]+)"/,
  )?.[1];
  if (!pdfId || !token) {
    console.warn(
      `    ⚠ ${p.registeredName}: filing form present but pdfId/token not extractable — ЕРИК markup may have changed`,
    );
    return null;
  }
  const res = await client.postRaw("/Reports/DownloadPdfGDPRSafeCopy", {
    pdfId,
    __RequestVerificationToken: token,
  });
  if (!res.ok) {
    console.warn(
      `    ⚠ ${p.registeredName}: filing PDF download failed (HTTP ${res.status})`,
    );
    return null;
  }
  const ctype = res.headers.get("content-type") ?? "";
  if (!ctype.includes("pdf")) {
    console.warn(
      `    ⚠ ${p.registeredName}: filing download returned non-PDF (${ctype})`,
    );
    return null;
  }
  return new Uint8Array(await res.arrayBuffer());
};

// ── reconciliation ───────────────────────────────────────────────────────────

const loadCikParties = (dataFolder: string, election: string): PartyInfo[] => {
  const file = path.join(dataFolder, election, "cik_parties.json");
  if (!fs.existsSync(file)) {
    throw new Error(
      `Missing ${file}. Ingest the election results first (the reconciliation ` +
        `needs the CIK party list).`,
    );
  }
  return JSON.parse(fs.readFileSync(file, "utf-8")) as PartyInfo[];
};

// ── main ─────────────────────────────────────────────────────────────────────

export const scrapeErik = async ({
  electionKey,
  rawFolder,
  dataFolder,
  stringify,
}: {
  electionKey?: string | number;
  rawFolder: string; // raw_data/
  dataFolder: string; // data/ (holds cik_parties.json)
  stringify: (o: object) => string;
}): Promise<void> => {
  const el = findErikElection(electionKey);
  console.log(
    `ЕРИК scrape: ${el.label} (electionId=${el.electionId} → ${el.election})`,
  );

  const cikParties = loadCikParties(dataFolder, el.election);
  const outRoot = path.join(rawFolder, el.election, "smetna_palata");

  // Warm the session (GET the landing page → sets the cookie ЕРИК requires on
  // every subsequent JSON POST; cold POSTs are rejected with 403).
  await client.get(`/Reports?electionId=${el.electionId}`);

  // 1. Participants + reconciliation.
  const participants = await fetchParticipants(el);
  console.log(`  ${participants.length} participants registered on ЕРИК`);

  const spParties: Record<string, string> = {};
  const resolved: { p: Participant; cikName: string }[] = [];
  const unmatched: Participant[] = [];
  const claimed = new Map<string, string>(); // cikName → registeredName (collision guard)

  for (const p of participants) {
    // Инициативни комитети have no CIK "party" — attribute donations under their
    // own name (the parser skips ИнК rows in candidates_donations anyway).
    const isIk = p.participantName === "Инициативен комитет";
    const { cikName, method } = reconcileErikToCik(
      p.registeredName,
      cikParties,
    );
    if (!cikName && !isIk) {
      unmatched.push(p);
      continue;
    }
    const folderName = cikName ?? p.registeredName;
    if (cikName) {
      spParties[p.registeredName] = cikName;
      const prev = claimed.get(cikName);
      if (prev && prev !== p.registeredName) {
        throw new Error(
          `Two ЕРИК participants map to the same CIK party "${cikName}": ` +
            `"${prev}" and "${p.registeredName}". Fix PARTY_OVERRIDES.`,
        );
      }
      claimed.set(cikName, p.registeredName);
    }
    resolved.push({ p: { ...p }, cikName: folderName });
    if (method) {
      // one-line audit trail
      console.log(`    ✓ ${p.registeredName}  →  ${folderName}  [${method}]`);
    }
  }

  if (unmatched.length) {
    const lines = unmatched
      .map((p) => `    ✗ ${p.registeredName} (${p.participantName})`)
      .join("\n");
    throw new Error(
      `Could not reconcile ${unmatched.length} ЕРИК participant(s) to a CIK ` +
        `party — campaign financing would be unaccounted for:\n${lines}\n` +
        `Add each to PARTY_OVERRIDES in scripts/smetna_palata/erik_config.ts.`,
    );
  }

  writeFile(path.join(outRoot, "sp_parties.json"), stringify(spParties));

  // 2. Election-wide candidate/ИнК donations → candidates_donations.csv.
  //    Header/columns match the manual export the parser reads (it uses
  //    columns 0,1,2,4,5 = candidate, participant, date, amount, in-kind value).
  const elCand = await fetchElectionCandidates(el);
  const cdHeader = csvRow([
    "Име на кандидат/член на ИнК",
    "Предоставил средства на",
    "От дата",
    "Вид",
    "Размер",
    "Стойност",
    "Декл.",
  ]);
  const cdRows = elCand.data.map((r) =>
    csvRow([
      r.name ?? r.fullName ?? "",
      r.participant ?? "",
      fmtDate(r.dateDonation ?? r.donationDate),
      r.candidateType ?? "",
      fmtMoney(r.moneyDonation ?? r.donationPrice),
      fmtMoney(r.noMoneyDonation ?? r.donationValue),
      "",
    ]),
  );
  writeFile(
    path.join(outRoot, "candidates_donations.csv"),
    [cdHeader, ...cdRows].join("\n") + "\n",
  );
  console.log(`  candidates_donations.csv: ${elCand.data.length} rows`);

  // 2b. Election-wide contracted agencies/suppliers → agencies.csv.
  //     Columns match the parser (parse_agencies): name, eik, type, participant,
  //     description. `eik` joins to the Commerce Registry / connections graph.
  const elAgc = await fetchElectionAgencies(el);
  const agHeader = csvRow([
    "Наименование",
    "ЕИК",
    "Вид на агенцията",
    "Към участник",
    "Описание",
  ]);
  const agRows = elAgc.data.map((a) =>
    csvRow([
      a.name ?? "",
      a.eik ?? "",
      a.typeOfAgency ?? "",
      a.participant ?? "",
      a.descr ?? "",
    ]),
  );
  writeFile(
    path.join(outRoot, "agencies.csv"),
    [agHeader, ...agRows].join("\n") + "\n",
  );
  console.log(`  agencies.csv: ${elAgc.data.length} rows`);

  // 3. Per participant: donors, candidate donations, filing PDF.
  let filed = 0;
  const donorHeader = csvRow([
    "Име",
    "Дата на дарение",
    "Парични средства",
    "Непарични средства",
    "Цел",
  ]);
  for (const { p, cikName } of resolved) {
    const partyDir = path.join(outRoot, "parties", cikName);

    const donors = await fetchParticipantDonations(el, p);
    const dRows = donors.data.map((d) =>
      csvRow([
        d.fullName ?? "",
        fmtDate(d.donationDate),
        fmtMoney(d.donationPrice),
        fmtMoney(d.donationValue),
        d.description ?? "",
      ]),
    );
    writeFile(
      path.join(partyDir, "from_donors.csv"),
      [donorHeader, ...dRows].join("\n") + "\n",
    );

    const cands = await fetchParticipantCandidates(el, p);
    const cRows = cands.data.map((c) =>
      csvRow([
        c.name ?? c.fullName ?? "",
        fmtDate(c.dateDonation ?? c.donationDate),
        fmtMoney(c.moneyDonation ?? c.donationPrice),
        fmtMoney(c.noMoneyDonation ?? c.donationValue),
        "",
      ]),
    );
    writeFile(
      path.join(partyDir, "from_candidates.csv"),
      [donorHeader, ...cRows].join("\n") + "\n",
    );

    const pdf = await fetchFilingPdf(el, p);
    if (pdf) {
      writeFile(path.join(partyDir, "filing.pdf"), pdf);
      filed++;
    } else {
      console.log(
        `    …  ${cikName}: no filing report yet (skipped filing.pdf)`,
      );
    }
  }

  console.log(
    `ЕРИК scrape done: ${resolved.length} parties, ${filed} with filed reports → ${outRoot}`,
  );
};

// ── CLI ──────────────────────────────────────────────────────────────────────

const isMain = (() => {
  try {
    return process.argv[1] === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
})();

if (isMain) {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const rawFolder = path.resolve(__dirname, "../../raw_data");
  const dataFolder = path.resolve(__dirname, "../../data");
  const electionKey = process.argv[2] ?? ERIK_ELECTIONS[0].election;
  scrapeErik({
    electionKey,
    rawFolder,
    dataFolder,
    stringify: (o) => JSON.stringify(o, null, 2),
  }).catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
