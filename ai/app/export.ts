// Conversation export — Markdown (always available, tiny) and PDF (lazy-loaded
// jsPDF + jspdf-autotable, reusing the site's Cyrillic OpenSans font so the heavy
// deps + ~300 KB font never touch the main bundle).

import type { ResponseMeta } from "../llm/provider";
import type { Envelope, Lang, ToolArgs } from "../tools/types";

export type ChatMsg = {
  role: "user" | "assistant";
  text: string;
  env?: Envelope | null;
  meta?: ResponseMeta;
  // the tool + resolved args behind this answer, kept so the next turn can
  // resolve a follow-on ("а ДПС?") against it (conversational memory)
  tool?: string;
  args?: ToolArgs;
  // the language this answer was generated in — so context built from it stays
  // language-consistent if the user switches EN/BG mid-thread
  lang?: Lang;
};

const cell = (v: unknown): string => (v == null ? "—" : String(v));

// An envelope as a {head?, body} grid — shared by the Markdown + PDF serializers.
const envToGrid = (env: Envelope): { head?: string[]; body: string[][] } => {
  if (env.kind === "table" && env.columns) {
    const cols = env.columns;
    return {
      head: cols.map((c) => c.label),
      body: (env.rows ?? []).map((r) => cols.map((c) => cell(r[c.key]))),
    };
  }
  if (env.kind === "series" && env.series) {
    const cats = env.categories ?? [];
    const series = env.series;
    return {
      head: ["", ...series.map((s) => s.label)],
      body: cats.map((x, i) => [
        cell(x),
        ...series.map((s) => cell(s.points[i]?.y)),
      ]),
    };
  }
  // scalar
  return { body: Object.entries(env.facts).map(([k, v]) => [k, cell(v)]) };
};

const envToMarkdown = (env: Envelope, lang: Lang): string => {
  const lines: string[] = [`**${env.title}**`, ""];
  const { head, body } = envToGrid(env);
  if (head) {
    lines.push(`| ${head.join(" | ")} |`);
    lines.push(`| ${head.map(() => "---").join(" | ")} |`);
    for (const row of body) lines.push(`| ${row.join(" | ")} |`);
  } else {
    for (const [k, v] of body) lines.push(`- **${k}:** ${v}`);
  }
  const sourceLabel = lang === "bg" ? "Източник" : "Source";
  if (env.provenance.length)
    lines.push("", `_${sourceLabel}: ${env.provenance.join(", ")}_`);
  return lines.join("\n");
};

export const conversationToMarkdown = (msgs: ChatMsg[], lang: Lang): string => {
  const out: string[] = [
    lang === "bg" ? "# Наясно AI — разговор" : "# Наясно AI — conversation",
    "",
  ];
  for (const m of msgs) {
    if (m.role === "user") {
      out.push(`**${lang === "bg" ? "Въпрос" : "Question"}:** ${m.text}`, "");
    } else {
      if (m.text) out.push(m.text, "");
      if (m.env) out.push(envToMarkdown(m.env, lang), "");
      out.push("---", "");
    }
  }
  out.push(
    lang === "bg"
      ? "_Данни: electionsbg.com · числата са изчислени, не генерирани._"
      : "_Data: electionsbg.com · figures are computed, not generated._",
  );
  return out.join("\n");
};

const triggerDownload = (blob: Blob, filename: string) => {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
};

const stamp = (): string => new Date().toISOString().slice(0, 10);

export const downloadMarkdown = (msgs: ChatMsg[], lang: Lang) => {
  const blob = new Blob([conversationToMarkdown(msgs, lang)], {
    type: "text/markdown;charset=utf-8",
  });
  triggerDownload(blob, `naiasno-${stamp()}.md`);
};

// --- Single-answer export -------------------------------------------------
// Per-response Markdown/PDF reuse the conversation serializers on a 2-element
// [question, answer] slice, so there's one source of truth for the layout.

export const downloadAnswerMarkdown = (
  answer: ChatMsg,
  question: string,
  lang: Lang,
) => downloadMarkdown([{ role: "user", text: question }, answer], lang);

export const downloadAnswerPdf = (
  answer: ChatMsg,
  question: string,
  lang: Lang,
) => downloadPdf([{ role: "user", text: question }, answer], lang);

// CSV for tabular answers. Uses ";" (BG locale treats "," as the decimal
// separator) and a UTF-8 BOM so Excel renders Cyrillic correctly.
const csvEscape = (v: string): string =>
  /[";\n\r"]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;

export const envToCsv = (env: Envelope): string => {
  const { head, body } = envToGrid(env);
  const rows = head ? [head, ...body] : body;
  return "\uFEFF" + rows.map((r) => r.map(csvEscape).join(";")).join("\r\n");
};

export const downloadCsv = (env: Envelope) => {
  const blob = new Blob([envToCsv(env)], {
    type: "text/csv;charset=utf-8",
  });
  triggerDownload(blob, `naiasno-${stamp()}.csv`);
};

// Naясно logo (mirrors src/layout/header/Logo.tsx) as raw SVG for the off-screen
// share card — a React component can't be dropped into a plain DOM node.
const LOGO_SVG = `<svg viewBox="0 0 64 64" width="30" height="30" fill="none" aria-hidden="true">
  <rect x="4" y="4" width="56" height="56" rx="14" fill="hsl(var(--logo-card))"/>
  <g><rect x="4" y="52" width="56" height="2.7" fill="#FFFFFF"/>
  <rect x="4" y="54.7" width="56" height="2.7" fill="#00966E"/>
  <rect x="4" y="57.4" width="56" height="2.7" fill="#D62612"/></g>
  <path d="M16 30 L27 41 L48 17" stroke="hsl(var(--logo-check))" stroke-width="7" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
</svg>`;

// Render one answer card as a branded PNG (for sharing on social). Clones the
// already-rendered answer node (keeps the chart SVG + theme styles) into an
// off-screen branded frame and rasterizes it with html2canvas (lazy-loaded).
export const downloadAnswerImage = async (
  answerEl: HTMLElement,
  question: string,
  lang: Lang,
) => {
  const html2canvas = (await import("html2canvas")).default;

  const frame = document.createElement("div");
  frame.className = "bg-card text-foreground";
  frame.style.cssText =
    "position:fixed;left:-99999px;top:0;width:760px;padding:28px;box-sizing:border-box;";

  const header = document.createElement("div");
  header.style.cssText =
    "display:flex;align-items:center;gap:10px;margin-bottom:14px;";
  header.innerHTML = `${LOGO_SVG}<span style="font-size:22px;font-weight:600;">Наясно <span style="color:hsl(var(--primary));">AI</span></span>`;

  const q = document.createElement("div");
  q.style.cssText = "font-size:17px;font-weight:600;margin-bottom:14px;";
  q.textContent = question;

  const clone = answerEl.cloneNode(true) as HTMLElement;
  // drop the interactive controls from the shared card (export menu, plus the
  // speaker / detail-toggle row) while keeping the meta line + source links
  clone
    .querySelectorAll("[data-export-actions],[data-export-omit]")
    .forEach((n) => n.remove());

  const footer = document.createElement("div");
  footer.className = "text-muted-foreground";
  footer.style.cssText = "margin-top:16px;font-size:12px;";
  footer.textContent =
    lang === "bg"
      ? "electionsbg.com · изчислено от официални данни, не генерирано"
      : "electionsbg.com · computed from official data, not generated";

  frame.append(header, q, clone, footer);
  document.body.appendChild(frame);
  try {
    const canvas = await html2canvas(frame, {
      scale: 2,
      backgroundColor:
        getComputedStyle(document.body).backgroundColor || "#fff",
      useCORS: true,
      logging: false,
    });
    await new Promise<void>((resolve) =>
      canvas.toBlob((blob) => {
        if (blob) triggerDownload(blob, `naiasno-${stamp()}.png`);
        resolve();
      }, "image/png"),
    );
  } finally {
    document.body.removeChild(frame);
  }
};

export const downloadPdf = async (msgs: ChatMsg[], lang: Lang) => {
  const [{ jsPDF }, autoTableMod, fontMod] = await Promise.all([
    import("jspdf"),
    import("jspdf-autotable"),
    import("@/ux/data_table/OpenSans-Medium-normal"),
  ]);
  const autoTable = autoTableMod.default;
  const FONT = "OpenSans-Medium";
  const doc = new jsPDF();
  doc.addFileToVFS("OpenSans-Medium-normal.ttf", fontMod.font);
  doc.addFont("OpenSans-Medium-normal.ttf", FONT, "normal");
  doc.setFont(FONT);

  const margin = 14;
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  let y = 18;
  const ensure = (h: number) => {
    if (y + h > pageH - margin) {
      doc.addPage();
      doc.setFont(FONT);
      y = margin;
    }
  };
  const write = (text: string, size = 10) => {
    doc.setFontSize(size);
    for (const ln of doc.splitTextToSize(text, pageW - margin * 2)) {
      ensure(size * 0.55);
      doc.text(ln, margin, y);
      y += size * 0.55;
    }
  };

  write(
    lang === "bg" ? "Наясно AI — разговор" : "Наясно AI — conversation",
    15,
  );
  y += 3;

  for (const m of msgs) {
    if (m.role === "user") {
      y += 3;
      write(`${lang === "bg" ? "Въпрос" : "Q"}: ${m.text}`, 11);
    } else {
      if (m.text) write(m.text, 10);
      if (m.env) {
        y += 1;
        write(m.env.title, 10);
        const { head, body } = envToGrid(m.env);
        if (body.length) {
          autoTable(doc, {
            startY: y + 1,
            head: head ? [head] : undefined,
            body,
            margin: { left: margin, right: margin },
            styles: { font: FONT, fontStyle: "normal", fontSize: 9 },
            headStyles: { font: FONT, fontStyle: "normal" },
          });
          const after = (
            doc as unknown as { lastAutoTable?: { finalY: number } }
          ).lastAutoTable;
          if (after) y = after.finalY + 4;
        }
        if (m.env.provenance.length)
          write(
            `${lang === "bg" ? "Източник" : "Source"}: ${m.env.provenance.join(", ")}`,
            8,
          );
      }
      y += 3;
    }
  }
  doc.save(`naiasno-${stamp()}.pdf`);
};
