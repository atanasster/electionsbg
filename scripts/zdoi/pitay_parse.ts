// Parse one pitay.government.bg application page (`/application/<id>/view`).
//
// pitay.government.bg is the government's ЗДОИ portal („Платформа за достъп до
// обществена информация"). Every request filed THROUGH it is a public page: the
// obliged body, the subject as the requester wrote it, the status, the body's
// decision text, decision attachments, the processing history and any
// forwarding „по компетентност" to another body. There is no API; pages are
// server-rendered and ids are sequential (docs/plans/insait-gap-v1.md §3).
//
// PRIVACY: the requester's IDENTITY is stored only as the type the platform
// prints („Физическо лице" / „Юридическо лице"). Early pages (2019) print the
// requester's NAME in that field instead, with their phone and e-mail beside it;
// `redactRequester` removes all three before a page is stored, and the parser
// then records the type as unknown (null) — never the value it found. The
// subject and the decision are stored as published except that e-mail addresses
// and phone numbers are scrubbed (`scrubContacts`); either can still contain a
// name — consumers show an excerpt and link out.

import { decodeEntities, stripTags } from "../lib/html";

export interface ZdoiEvent {
  /** ISO local timestamp, "YYYY-MM-DDTHH:MM". */
  at: string;
  process: string;
}

export interface ZdoiForward {
  /** The forwarded copy's own application id on the platform. */
  id: number | null;
  regNo: string;
  body: string;
  createdAt: string | null;
  status: string | null;
}

export interface ZdoiApplication {
  id: number;
  regNo: string;
  body: string;
  status: string;
  /** One of APPLICANT_TYPES, or null when the page named the requester instead
   *  of a type (the name is redacted, never stored). */
  applicantType: string | null;
  /** ISO dates "YYYY-MM-DD". */
  submittedOn: string | null;
  deadline: string | null;
  subject: string;
  decisionDate: string | null;
  decisionText: string | null;
  /** /download/<id> links attached to the decision, with their description. */
  attachments: { downloadId: number; description: string | null }[];
  events: ZdoiEvent[];
  forwards: ZdoiForward[];
  views: number | null;
}

/** The only values the requester field may take (see PRIVACY above). */
export const APPLICANT_TYPES: ReadonlySet<string> = new Set([
  "Физическо лице",
  "Юридическо лице",
]);

/** What a redacted requester reads as. */
export const REDACTED = "[заявител]";

/**
 * Remove the requester's identity from a page before it is stored anywhere: a
 * name printed in the requester field (everywhere it recurs on the page — the
 * title repeats it) and the contact paragraph with phone / e-mail / address.
 * A page whose requester field is already a type passes through unchanged.
 */
export const redactRequester = (html: string): string => {
  let out = html.replace(
    /<p class="p-fs">(?:(?!<\/p>)[\s\S])*?fa-(?:phone|envelope|map-marker|home|address)[\s\S]*?<\/p>/gi,
    '<p class="p-fs"></p>',
  );
  const anchor = /(fa-user[^>]*><\/i>)([\s\S]*?)(<\/a>)/i.exec(out);
  const name = anchor ? anchor[2].trim() : "";
  const visible = text(name);
  if (name && !APPLICANT_TYPES.has(visible)) {
    out = out.split(name).join(REDACTED);
    if (visible.length >= 3 && visible !== name)
      out = out.split(visible).join(REDACTED);
  }
  return out;
};

/** What a scrubbed contact reads as. */
export const SCRUBBED_CONTACT = "[контакт]";

/** E-mail addresses and Bulgarian phone numbers inside free text — bodies quote
 *  the requester's own address back in the decision („изпратено на … @abv.bg"). */
export const scrubContacts = (s: string): string =>
  s
    .replace(
      /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.[\p{L}]{2,}/gu,
      SCRUBBED_CONTACT,
    )
    .replace(
      // Anchored so a number cannot continue a document reference
      // („РД-02-14-577/20.06.2019", „№ 02-00-71/26.01.2018").
      /(?<![\p{L}\p{N}/.\-№])(?:\+359|00359|0)\s?(?:8[789]|2|[3-9]\d)(?:[\s-]?\d){6,7}(?![\p{N}/.])/gu,
      SCRUBBED_CONTACT,
    );

/** Visible text of a fragment, whitespace collapsed. */
const text = (html: string): string =>
  decodeEntities(stripTags(html)).replace(/\s+/g, " ").trim();

/** "13.12.2023" → "2023-12-13"; anything else → null. */
export const bgDate = (s: string | null | undefined): string | null => {
  const m = /(\d{2})\.(\d{2})\.(\d{4})/.exec(s ?? "");
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
};

/** "13.12.2023 17:08" → "2023-12-13T17:08". */
const bgDateTime = (s: string): string | null => {
  const m = /(\d{2})\.(\d{2})\.(\d{4})\s+(\d{2}):(\d{2})/.exec(s);
  return m ? `${m[3]}-${m[2]}-${m[1]}T${m[4]}:${m[5]}` : null;
};

/** The block of a tab pane, by its id — up to the next pane or the end of main. */
const pane = (html: string, id: string): string => {
  const start = html.indexOf(`id="${id}"`);
  if (start < 0) return "";
  const rest = html.slice(start);
  const next = rest.slice(1).search(/class="tab-pane[^"]*"\s+id="/);
  return next < 0 ? rest : rest.slice(0, next + 1);
};

/** Rows of every <tr> in a fragment, each as its cells' raw inner HTML. */
const rows = (html: string): string[][] =>
  [...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map((r) =>
    [...r[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((c) => c[1]),
  );

/**
 * Returns null for a page that is not an application (a 404 body, a removed
 * request, the platform's error page). Throws when a page IS an application but
 * its header cannot be read — a silent partial row would publish a request with
 * no body or status, which is worse than a loud parse failure.
 */
export const parseApplication = (
  html: string,
  id: number,
): ZdoiApplication | null => {
  const h3 = /<h3[^>]*>([\s\S]*?)<\/h3>/i.exec(html);
  if (!h3 || !/^Заявление от/.test(text(h3[1]))) return null;

  const app = pane(html, "application");
  const meta = /<strong>\s*Рег\. №:\s*<\/strong>([\s\S]*?)<\/p>/i.exec(app);
  if (!meta)
    throw new Error(`pitay #${id}: application header without „Рег. №"`);
  const metaText = text(meta[1]);
  // "1702480122-13.12.2023 | Министерство … | Одобрено | Дата на подаване: 13.12.2023 | Срок: 27.12.2023"
  const parts = metaText.split("|").map((p) => p.trim());
  const [regNo, body, status] = parts;
  if (!regNo || !body || !status)
    throw new Error(`pitay #${id}: cannot split header „${metaText}"`);
  const field = (label: string) =>
    parts.find((p) => p.startsWith(label))?.slice(label.length) ?? null;

  const applicant = /fa-user[^>]*><\/i>([\s\S]*?)<\/a>/i.exec(app);
  // The header paragraph block ends at the first `col-12 mb-3` div; the subject is
  // the next one, the decision (if any) the one carrying <h4>Решение</h4>.
  const blocks = app
    .split(/<div class="col-12 mb-3">/i)
    .slice(1)
    .map((b) => b.replace(/<\/div>\s*$/i, ""));
  const subjectBlock = blocks.find(
    (b, i) =>
      i > 0 &&
      !/<h4>\s*Решение/i.test(b) &&
      !/fa-eye/.test(b) &&
      !/Рег\. №/.test(b),
  );
  const decisionBlock = blocks.find((b) => /<h4>\s*Решение/i.test(b)) ?? null;

  let decisionDate: string | null = null;
  let decisionText: string | null = null;
  const attachments: ZdoiApplication["attachments"] = [];
  if (decisionBlock) {
    const d = /<strong>\s*Дата:\s*<\/strong>([^<]*)/i.exec(decisionBlock);
    decisionDate = bgDate(d?.[1]);
    const docsAt = decisionBlock.search(/<strong>\s*Документи:/i);
    const prose = (docsAt < 0 ? decisionBlock : decisionBlock.slice(0, docsAt))
      .replace(/<h4>[\s\S]*?<\/h4>/i, "")
      .replace(/<p[^>]*>\s*<strong>\s*Дата:[\s\S]*?<\/p>/i, "");
    decisionText = scrubContacts(text(prose)) || null;
    if (docsAt >= 0)
      for (const r of rows(decisionBlock.slice(docsAt))) {
        const m = /\/download\/(\d+)/.exec(r[0] ?? "");
        if (!m) continue;
        const desc = text(r[1] ?? "");
        attachments.push({
          downloadId: Number(m[1]),
          description: desc && desc !== "Няма описание" ? desc : null,
        });
      }
  }

  const applicantRaw = applicant ? text(applicant[1]) : "";
  const applicantType = APPLICANT_TYPES.has(applicantRaw) ? applicantRaw : null;

  const views = /fa-eye[^>]*><\/i>\s*(\d+)/.exec(app);

  const events: ZdoiEvent[] = rows(pane(html, "history"))
    .map((r) => ({
      at: bgDateTime(text(r[0] ?? "")),
      process: text(r[1] ?? ""),
    }))
    .filter((e): e is ZdoiEvent => !!e.at && !!e.process);

  const forwards: ZdoiForward[] = rows(pane(html, "sub-application"))
    .filter((r) => r.length >= 4)
    .map((r) => {
      const link = /\/application\/(\d+)\/view/.exec(r[0]);
      return {
        id: link ? Number(link[1]) : null,
        regNo: text(r[0]),
        body: text(r[1]),
        createdAt: bgDateTime(text(r[2])),
        status: text(r[3]) || null,
      };
    });

  return {
    id,
    regNo,
    body,
    status,
    applicantType,
    submittedOn: bgDate(field("Дата на подаване:")),
    deadline: bgDate(field("Срок:")),
    subject: subjectBlock ? scrubContacts(text(subjectBlock)) : "",
    decisionDate,
    decisionText,
    attachments,
    events,
    forwards,
    views: views ? Number(views[1]) : null,
  };
};

/** The platform's full status vocabulary (its listing filter, 2026-11-24). The
 *  final ones no longer move; the rest are re-fetched on a refresh run.
 *  „Непроизнесени в срок" is NOT final — a body can still answer late, and
 *  „Възобновено" re-opens a closed request. */
export const STATUSES = [
  "Прието на платформата",
  "Очаква регистрация при задължен субект",
  "Регистрирано/в процес на обработка",
  "Одобрено",
  "Частично одобрено",
  "Неодобрено",
  "Информацията не съществува",
  "Непроизнесени в срок",
  "Препратено по компетентност",
  "Възобновено",
  "Оставено без разглеждане",
] as const;

export const FINAL_STATUSES: ReadonlySet<string> = new Set([
  "Одобрено",
  "Частично одобрено",
  "Неодобрено",
  "Информацията не съществува",
  "Препратено по компетентност",
  "Оставено без разглеждане",
]);
