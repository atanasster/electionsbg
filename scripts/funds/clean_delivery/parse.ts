// ИСУН „clean delivery" — the two reports the state publishes about EU-funded
// contracts that finished WITHOUT a financial correction. Plan P9, re-scoped.
//
// ⚠️⚠️ READ THIS BEFORE USING THE DATA. These are ACHIEVEMENT lists, not the
// complement of „was corrected", and the difference is the whole reason P9 as
// originally specified is not implementable:
//
//   • „Проекти без наложени финансови корекции" (ExecutedContracts) — completed
//     projects with no imposed correction. Every row is status „Приключен".
//   • „Бенефициенти без ФК" (BeneficiaryWithoutFinancialCorrections) — its payload
//     column is „Брой договори, УСПЕШНО ПРИКЛЮЧЕНИ В СРОК", i.e. on time.
//
// So **ABSENCE FROM THESE LISTS DOES NOT MEAN A PROJECT WAS CORRECTED.** A project
// can be absent because it finished late, was terminated (3,656 in our corpus are
// `Прекратен`), or is still in final verification. Deriving „had EU money clawed
// back" by subtracting these from `fund_projects` would manufacture accusations
// against named beneficiaries out of ordinary lateness. Individual irregularity
// records go to OLAF's IMS, which is confidential; there is no public complement.
// Publish this as what it is — a clean-delivery record — and nothing else.
//
// ⚠️ THE EXPORTS ARE COMPLETE — DO NOT PARTITION THEM. This was measured, because
// the obvious inference is wrong: the contracts export returns 9,940 rows while the
// beneficiaries report accounts for 41,530 on-time clean contracts, which reads
// exactly like a ~10,000-row export cap (the shape BULSTAT's 999 ceiling and ЦПРС's
// cartesian product both have). It is not. Each listing prints its own pager, and
// they agree with the exports to within a part-page:
//
//     contracts     „Страница (1/398)"   → 398 × 25 = 9,950   vs 9,940 exported
//     beneficiaries „Страница (1/1359)"  → 1359 × 25 = 33,975 vs 33,954 exported
//
// So the 4× gap is REAL: the two reports count different populations (projects with
// no imposed correction vs on-time contracts of beneficiaries with no correction),
// and they must never be reconciled by subtracting one from the other. Each is its
// own statement. A per-programme partition would add ProgrammeId round-trips against
// a WAF that already fights automation, and buy nothing.

export interface CleanContract {
  /** ИСУН contract registration number, e.g. „BG05M9OP001-2.002-0001-C01". */
  regNo: string;
  /** ⚠️ The SAME id without the `-C##` contract-version suffix. That suffix is an
   *  annex version, and `fund_projects.contract_number` does not carry it: joining
   *  on the raw value matches 0 of 9,940 rows, and on the base 9,940 of 9,940. */
  contractNumber: string;
  programme: string;
  procedure: string;
  title: string;
  beneficiaryEik: string | null;
  beneficiaryName: string;
  orgType: string;
  orgKind: string;
  enterpriseCategory: string;
  durationMonths: number | null;
  signedOn: string | null;
  originalEndOn: string | null;
  closedOn: string | null;
  status: string;
}

export interface CleanBeneficiary {
  eik: string | null;
  name: string;
  orgType: string;
  orgKind: string;
  seat: string;
  /** „Брой договори, успешно приключени в срок" — ON TIME, not merely clean. */
  onTimeContracts: number;
}

/** A 10-digit id in this column is an ЕГН, not an EIK — 2 rows carry one. It is a
 *  personal identifier and is DROPPED at parse time rather than stored and filtered
 *  later, so no downstream consumer can ever reach it. 9-digit and 13-digit values
 *  are EIK/БУЛСТАТ and are kept (13 = a 9-digit parent plus a 4-digit branch).
 *
 *  ⚠️ A NULL here is not one thing. Besides those 2 ЕГН rows, 1,533 beneficiary rows
 *  are NATURAL PERSONS published with a first name only and no id at all („Христо",
 *  „Аделина", org type „Друга"). They identify nobody, join to nothing, and naming
 *  them buys no analysis — the ingest counts them in coverage and publishes neither. */
export const cleanEik = (raw: unknown): string | null => {
  const s = String(raw ?? "").trim();
  if (/^\d{9}$/.test(s) || /^\d{13}$/.test(s)) return s;
  return null;
};

/** Strip the `-C##` contract-version suffix. See CleanContract.contractNumber. */
export const baseContractNumber = (regNo: string): string =>
  regNo.trim().replace(/-C\d+$/i, "");

/** Excel serial → ISO. The exports store dates as serials, and a naive
 *  `new Date(serial)` yields 1970 — a silently wrong date on every row. */
export const excelDate = (v: unknown): string | null => {
  if (v === "" || v === null || v === undefined) return null;
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n) || n <= 0) {
    // Some exports carry an already-formatted date instead of a serial.
    const m = /^(\d{2})\.(\d{2})\.(\d{4})/.exec(String(v).trim());
    return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
  }
  // Excel's epoch is 1899-12-30 (its 1900 leap-year bug is why it is not 12-31).
  const ms = Math.round((n - 25569) * 86400_000);
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
};

const cell = (r: unknown[], i: number): string => String(r[i] ?? "").trim();

/** Find the header row by its OWN first column rather than by position: both
 *  reports carry a title and blank rows above it, and the count differs between
 *  them. Anchoring on a row index is what makes a one-row layout change silently
 *  ingest the title as data. */
const headerIndex = (rows: unknown[][], first: string): number => {
  const i = rows.findIndex((r) => cell(r, 0) === first);
  if (i < 0)
    throw new Error(
      `clean-delivery parse: no header row starting „${first}" — the export ` +
        `layout changed, and guessing a row index here would ingest the title`,
    );
  return i;
};

export const parseCleanContracts = (rows: unknown[][]): CleanContract[] => {
  const h = headerIndex(rows, "Програма");
  const out: CleanContract[] = [];
  for (const r of rows.slice(h + 1)) {
    const regNo = cell(r, 2);
    if (!regNo) continue;
    out.push({
      regNo,
      contractNumber: baseContractNumber(regNo),
      programme: cell(r, 0),
      procedure: cell(r, 1),
      title: cell(r, 3),
      beneficiaryEik: cleanEik(r[4]),
      beneficiaryName: cell(r, 5),
      orgType: cell(r, 6),
      orgKind: cell(r, 7),
      enterpriseCategory: cell(r, 8),
      durationMonths: Number(r[9]) || null,
      signedOn: excelDate(r[10]),
      originalEndOn: excelDate(r[11]),
      closedOn: excelDate(r[12]),
      status: cell(r, 13),
    });
  }
  return out;
};

export const parseCleanBeneficiaries = (
  rows: unknown[][],
): CleanBeneficiary[] => {
  const h = headerIndex(rows, "Бенефициент");
  const out: CleanBeneficiary[] = [];
  for (const r of rows.slice(h + 1)) {
    const eik = cleanEik(r[1]);
    const name = cell(r, 0);
    if (!name && !eik) continue;
    out.push({
      eik,
      // The name column is prefixed with the id („175157251   ЕНТЪРПРАЙЗ …"),
      // which would otherwise be stored inside the display name.
      name: name.replace(/^\d{9,13}\s+/, "").trim(),
      orgType: cell(r, 2),
      orgKind: cell(r, 3),
      seat: cell(r, 4),
      onTimeContracts: Number(r[5]) || 0,
    });
  }
  return out;
};
