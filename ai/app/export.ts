// Conversation export — Markdown (always available, tiny) and PDF (lazy-loaded
// jsPDF + jspdf-autotable, reusing the site's Cyrillic OpenSans font so the heavy
// deps + ~300 KB font never touch the main bundle).

import type { Envelope, Lang } from "../tools/types";

export type ChatMsg = {
  role: "user" | "assistant";
  text: string;
  env?: Envelope | null;
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

const envToMarkdown = (env: Envelope): string => {
  const lines: string[] = [`**${env.title}**`, ""];
  const { head, body } = envToGrid(env);
  if (head) {
    lines.push(`| ${head.join(" | ")} |`);
    lines.push(`| ${head.map(() => "---").join(" | ")} |`);
    for (const row of body) lines.push(`| ${row.join(" | ")} |`);
  } else {
    for (const [k, v] of body) lines.push(`- **${k}:** ${v}`);
  }
  if (env.provenance.length)
    lines.push("", `_Източник: ${env.provenance.join(", ")}_`);
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
      if (m.env) out.push(envToMarkdown(m.env), "");
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
          write(`Източник: ${m.env.provenance.join(", ")}`, 8);
      }
      y += 3;
    }
  }
  doc.save(`naiasno-${stamp()}.pdf`);
};
