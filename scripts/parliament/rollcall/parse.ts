// Parser for parliament.bg's "Поименно гласуване" CSVs.
//
// CSV columns (with UTF-8 BOM on the first):
//   NAME       — MP name in uppercase Cyrillic (e.g. "АЙЛИН НУРИДИН ПЕХЛИВАНОВА")
//   textbox7   — MP id (matches data/parliament/index.json `id`)
//   textbox8   — Party group short label (e.g. "ПП - ДБ")
//   textbox800 — NS folder number (e.g. "51")
//   ITEM       — Vote item number within the session (1, 2, 3, …)
//   textbox2   — Vote code (single Cyrillic/ASCII char):
//                  +   ЗА (yes)
//                  -   ПРОТИВ (no)
//                  =   ВЪЗДЪРЖАЛ СЕ (abstain)
//                  0   present-but-didn't-vote
//                  О   ОТСЪСТВАЛ (absent)
//                  П   правен отпуск / parental leave (treated as absent)
//                  Р   regional duty / other excused absence (treated as absent)
//
// For v1 we collapse to four canonical labels: yes | no | abstain | absent.
// Future versions can split present-not-voting from physically absent if the
// frontend needs it for loyalty calculations.

export type Vote = "yes" | "no" | "abstain" | "absent";

export interface RawCsvRow {
  mpName: string;
  mpId: number;
  partyShort: string;
  nsFolder: string;
  item: number;
  voteCode: string;
}

export interface VoteRecord {
  mpId: number;
  vote: Vote;
}

export interface SessionItem {
  item: number;
  tallies: { yes: number; no: number; abstain: number; absent: number };
  votes: VoteRecord[];
}

const VOTE_MAP: Record<string, Vote> = {
  "+": "yes",
  "-": "no",
  "=": "abstain",
  "0": "absent",
  О: "absent",
  П: "absent",
  Р: "absent",
  // Empty cells appear in some sessions for MPs who were never registered
  // that day. Parliament.bg treats them as absent in the published tallies.
  "": "absent",
};

const stripBom = (s: string): string =>
  s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;

const splitCsvLine = (line: string): string[] => {
  // The roll-call CSVs are simple — no embedded quotes or commas in fields.
  // (BG names use only Cyrillic + spaces; party shorts use ASCII letters and
  // dashes.) If the upstream format ever changes we'll see a parse-time failure
  // here, which is the right outcome — fail loud, do not write garbage.
  return line.split(",").map((s) => s.trim());
};

export const parseCsv = (raw: string): RawCsvRow[] => {
  const text = stripBom(raw).replace(/\r\n?/g, "\n");
  const lines = text.split("\n").filter((l) => l.trim() !== "");
  if (lines.length < 2) return [];
  const header = splitCsvLine(lines[0]);
  const idx = {
    name: header.indexOf("NAME"),
    mpId: header.indexOf("textbox7"),
    party: header.indexOf("textbox8"),
    ns: header.indexOf("textbox800"),
    item: header.indexOf("ITEM"),
    vote: header.indexOf("textbox2"),
  };
  for (const [k, v] of Object.entries(idx)) {
    if (v < 0)
      throw new Error(
        `CSV missing column for ${k} (header: ${header.join("|")})`,
      );
  }
  const rows: RawCsvRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = splitCsvLine(lines[i]);
    if (cols.length < header.length) continue;
    const mpId = parseInt(cols[idx.mpId], 10);
    const item = parseInt(cols[idx.item], 10);
    if (!Number.isFinite(mpId) || !Number.isFinite(item)) continue;
    rows.push({
      mpName: cols[idx.name],
      mpId,
      partyShort: cols[idx.party],
      nsFolder: cols[idx.ns],
      item,
      voteCode: cols[idx.vote],
    });
  }
  return rows;
};

const codeToVote = (code: string): Vote => {
  const v = VOTE_MAP[code];
  if (!v) throw new Error(`unknown vote code: "${code}"`);
  return v;
};

export const groupByItem = (rows: RawCsvRow[]): SessionItem[] => {
  const byItem = new Map<number, VoteRecord[]>();
  for (const r of rows) {
    const v = codeToVote(r.voteCode);
    const arr = byItem.get(r.item) ?? [];
    arr.push({ mpId: r.mpId, vote: v });
    byItem.set(r.item, arr);
  }
  const out: SessionItem[] = [];
  for (const [item, votes] of [...byItem.entries()].sort(
    (a, b) => a[0] - b[0],
  )) {
    const tallies = { yes: 0, no: 0, abstain: 0, absent: 0 };
    for (const v of votes) tallies[v.vote]++;
    votes.sort((a, b) => a.mpId - b.mpId);
    out.push({ item, tallies, votes });
  }
  return out;
};
