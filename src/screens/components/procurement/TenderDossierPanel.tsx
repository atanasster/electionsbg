// "Документация" — the ЦАИС ЕОП dossier on the tender (procedure) detail page.
// The long description the notice header truncates, the published files, and the
// award-stage trail. See docs/plans/tender-dossier-ingest-v1.md §5 (A7).
//
// ⚠️ RENDERS NOTHING when there is no dossier. The capture is built up over a long
// crawl, so "not crawled yet" and "migration not applied" both arrive as null — and
// an empty state would read as "the register published no documents", a claim about
// the procurement that we would have no basis for.
//
// ⚠️ WE DO NOT HOST THESE FILES. Every link goes through /api/db/tender-document,
// which validates the id and redirects to the register's own signed URL (they
// expire in 30 minutes, so there is no stable href to embed).

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { FileText, ExternalLink, Gavel, Paperclip } from "lucide-react";
import {
  useTenderDossier,
  tenderDocumentHref,
  type TenderDossierDocument,
} from "@/data/procurement/useTenderDossier";
// Pinned to the classifier's own union, so a new kind cannot be added there and
// silently render label-less here.
import type { DocKind } from "@/../scripts/procurement/eop_doc_kind";

const KB = 1024;

const fileSize = (n: number | null): string => {
  if (!n || n <= 0) return "";
  if (n < KB) return `${n} B`;
  if (n < KB * KB) return `${Math.round(n / KB)} KB`;
  return `${(n / (KB * KB)).toFixed(1)} MB`;
};

/** Bulgarian label per derived kind. `null`/`unclassified` deliberately gets NO
 *  label rather than a guess — the classifier is filename-based (~70% hit). */
const KIND_BG: Partial<Record<DocKind, string>> = {
  spec: "техническа спецификация",
  documentation: "документация",
  methodology: "методика за оценка",
  contract_draft: "проект на договор",
  espd: "ЕЕДОП",
  boq: "количествена сметка",
  form: "образец",
  decision: "решение / обявление",
  project_docs: "проектна документация",
};

const KIND_EN: Partial<Record<DocKind, string>> = {
  spec: "technical specification",
  documentation: "documentation",
  methodology: "evaluation methodology",
  contract_draft: "draft contract",
  espd: "ESPD",
  boq: "bill of quantities",
  form: "form",
  decision: "decision / notice",
  project_docs: "project documentation",
};

const DocRow: FC<{ doc: TenderDossierDocument; bg: boolean }> = ({
  doc,
  bg,
}) => {
  const kind =
    doc.kind && doc.kind !== "unclassified" ? (doc.kind as DocKind) : null;
  const label = kind ? (bg ? KIND_BG[kind] : KIND_EN[kind]) : null;
  return (
    <li className="flex items-start gap-2 py-1">
      <FileText className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1">
        <a
          href={tenderDocumentHref(doc.document_id)}
          // The target is a third-party host we redirect to; never let it reach
          // back through window.opener.
          rel="noopener noreferrer nofollow"
          target="_blank"
          className="break-words underline underline-offset-2 hover:text-primary"
        >
          {doc.name}
        </a>
        {label ? (
          <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
            {label}
          </span>
        ) : null}
        {doc.size_bytes ? (
          <span className="ml-2 text-xs text-muted-foreground">
            {fileSize(doc.size_bytes)}
          </span>
        ) : null}
      </span>
    </li>
  );
};

export const TenderDossierPanel: FC<{ unp?: string | null }> = ({ unp }) => {
  const { i18n } = useTranslation();
  const bg = i18n.language === "bg";
  const { data } = useTenderDossier(unp);
  if (!data) return null;

  // ⚠️ PARTITION, never filter-and-drop. An earlier revision selected only
  // `attachment` and `announcement`, so a dossier whose files are all `export`
  // rendered as though the register had published none — the same claim-by-omission
  // this component's header exists to prevent, reached from the other side.
  const attachments = data.documents.filter((d) => d.source === "attachment");
  const awardDocs = data.documents.filter((d) => d.source === "announcement");
  const otherDocs = data.documents.filter(
    (d) => d.source !== "attachment" && d.source !== "announcement",
  );
  const hasAny =
    data.description_text ||
    data.documents.length ||
    data.announcements.length;
  if (!hasAny) return null;

  return (
    <section className="rounded-xl border bg-card p-4 shadow-sm space-y-4">
      <h2 className="flex items-center gap-2 text-base font-semibold">
        <Paperclip className="h-4 w-4" />
        {bg ? "Документация" : "Procurement documents"}
      </h2>

      {data.description_text ? (
        <div className="space-y-1">
          <div className="text-xs uppercase tracking-wide text-muted-foreground">
            {bg ? "Кратко описание" : "Description"}
          </div>
          <p className="whitespace-pre-line text-sm leading-relaxed">
            {data.description_text}
          </p>
        </div>
      ) : null}

      {attachments.length ? (
        <div className="space-y-1">
          <div className="text-xs uppercase tracking-wide text-muted-foreground">
            {bg ? "Прикачени файлове" : "Attached files"} ({attachments.length})
          </div>
          <ul className="text-sm">
            {attachments.map((d) => (
              <DocRow key={d.document_id} doc={d} bg={bg} />
            ))}
          </ul>
        </div>
      ) : null}

      {data.announcements.length || awardDocs.length ? (
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
            <Gavel className="h-3.5 w-3.5" />
            {bg ? "Протоколи и решения" : "Committee record"} (
            {data.announcements.length || awardDocs.length})
          </div>
          {data.announcements.length ? (
            <ul className="text-sm">
              {data.announcements.map((a) => (
                <li key={a.announcement_id} className="py-1">
                  <span className="text-muted-foreground">
                    {a.created_at ? a.created_at.slice(0, 10) : "—"}
                  </span>{" "}
                  {a.title ?? "—"}
                </li>
              ))}
            </ul>
          ) : null}
          {awardDocs.length ? (
            <ul className="text-sm">
              {awardDocs.map((d) => (
                <DocRow key={d.document_id} doc={d} bg={bg} />
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {otherDocs.length ? (
        <div className="space-y-1">
          <div className="text-xs uppercase tracking-wide text-muted-foreground">
            {bg ? "Други файлове" : "Other files"} ({otherDocs.length})
          </div>
          <ul className="text-sm">
            {otherDocs.map((d) => (
              <DocRow key={d.document_id} doc={d} bg={bg} />
            ))}
          </ul>
        </div>
      ) : null}

      {data.source_url ? (
        <a
          href={data.source_url}
          target="_blank"
          rel="noopener noreferrer nofollow"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground underline underline-offset-2 hover:text-primary"
        >
          <ExternalLink className="h-3 w-3" />
          {bg
            ? "Цялото досие в ЦАИС ЕОП"
            : "Full dossier at the register (ЦАИС ЕОП)"}
        </a>
      ) : null}
    </section>
  );
};
