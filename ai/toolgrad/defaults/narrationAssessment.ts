import { hash } from "../corpus";
// Fixed local judgments apply only to these retained experiment reports.
const ASSESSED_REPORTS: Record<string, string> = {
  baseline: "2f105cc034d943515581c2d5ef7af156ca8cdb43a7031545ca83cc37325b2344",
  candidate: "7bdfd6246f079e735c9ebdaed37f755a2fa45e1019e6b20c8308791fbe2dc6ab",
};
export function requireAssessedNarration(
  variant: string,
  report: unknown,
): void {
  if (
    !Object.prototype.hasOwnProperty.call(ASSESSED_REPORTS, variant) ||
    hash(report) !== ASSESSED_REPORTS[variant]
  )
    throw new Error(
      "Unassessed narration report: perform a new local rubric review before attaching judgments",
    );
}
