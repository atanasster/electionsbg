import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table";
import type { Envelope, EnvelopeKind, Lang } from "../../tools/types";
const KIND_LABELS: Record<EnvelopeKind, { bg: string; en: string }> = {
  scalar: { bg: "единична стойност", en: "single value" },
  table: { bg: "таблица", en: "table" },
  series: { bg: "времеви ред", en: "time series" },
};
// Renders the live shape of the Envelope a run produced — the actual contract
// the chat narrates from. Sourced from the result itself, so it can't drift.
export const ReturnShape = ({ env, lang }: { env: Envelope; lang: Lang }) => {
  const t = (bg: string, en: string) => (lang === "bg" ? bg : en);
  const factEntries = Object.entries(env.facts);
  return (
    <div className="space-y-4 rounded-xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {t("Какво връща (от резултата)", "Return shape (from this result)")}
        </h3>
        <Badge variant="outline">{KIND_LABELS[env.kind][lang]}</Badge>
        {env.viz !== "none" && <Badge variant="outline">{env.viz}</Badge>}
      </div>

      {env.columns && env.columns.length > 0 && (
        <div>
          <h4 className="mb-1 text-xs font-medium text-muted-foreground">
            {t("Колони", "Columns")}
          </h4>
          <div className="flex flex-wrap gap-2">
            {env.columns.map((c) => (
              <span
                key={c.key}
                className="rounded-md bg-muted px-2 py-0.5 text-xs"
              >
                <span className="font-mono">{c.key}</span>
                <span className="text-muted-foreground">
                  {" "}
                  — {c.label}
                  {c.format ? ` · ${c.format}` : ""}
                </span>
              </span>
            ))}
          </div>
        </div>
      )}

      {env.series && env.series.length > 0 && (
        <div>
          <h4 className="mb-1 text-xs font-medium text-muted-foreground">
            {t("Редове (серии)", "Series")}
          </h4>
          <div className="flex flex-wrap gap-2">
            {env.series.map((s) => (
              <span
                key={s.key}
                className="rounded-md bg-muted px-2 py-0.5 text-xs"
              >
                <span className="font-mono">{s.key}</span>
                <span className="text-muted-foreground"> — {s.label}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {factEntries.length > 0 && (
        <div>
          <h4 className="mb-1 text-xs font-medium text-muted-foreground">
            {t("Факти (за наративa)", "Facts (narrated)")}
          </h4>
          <Table>
            <TableBody>
              {factEntries.map(([k, v]) => (
                <TableRow key={k}>
                  <TableCell className="w-1/3 font-mono text-xs">{k}</TableCell>
                  <TableCell className="text-sm">{String(v)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {env.provenance.length > 0 && (
        <div>
          <h4 className="mb-1 text-xs font-medium text-muted-foreground">
            {t("Източници на данни", "Data sources")}
          </h4>
          <div className="flex flex-wrap gap-2">
            {env.provenance.map((p) => (
              <span
                key={p}
                className="rounded-md bg-muted px-2 py-0.5 font-mono text-xs text-muted-foreground"
              >
                {p}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
