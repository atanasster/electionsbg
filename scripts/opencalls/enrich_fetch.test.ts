// Document selection and format sniffing. Every case here is a shape the live probe found on
// eumis2020.government.bg (2026-08-09) — see `enrich_fetch.ts`'s header for the measurements.
//
// The two things worth testing are the two the plan got wrong by assumption:
//   - „Условия за кандидатстване" is a single PDF/DOCX, NOT an archive;
//   - a third format exists (legacy OLE2 .doc), and feeding it to the docx reader fails as
//     „corrupt zip" rather than as „no reader for this format".

import { describe, expect, it } from "vitest";
import {
  DOC_PREFERENCE,
  filenameFrom,
  pickDoc,
  sniffKind,
} from "./enrich_fetch";

const buf = (hex: string, tail = ""): Buffer =>
  Buffer.concat([Buffer.from(hex, "hex"), Buffer.from(tail, "utf8")]);

describe("pickDoc", () => {
  it("prefers the short announcement over the long conditions", () => {
    // The plan's rule, and the reason the order exists at all: „Обява" is two pages, „Условия"
    // is fifty.
    const got = pickDoc([
      { label: "Условия за кандидатстване", url: "u" },
      { label: "Обява за откриване на процедурата", url: "o" },
    ]);
    expect(got?.url).toBe("o");
  });

  it("falls back to Условия — the plan's single-label rule would skip 4/5 of the corpus", () => {
    // Measured over the 55 live procedures: „Обява" on 7, „Условия за кандидатстване" on 26.
    expect(
      pickDoc([{ label: "Условия за кандидатстване", url: "u" }])?.url,
    ).toBe("u");
  });

  it("matches a label with an ИСУН qualifier appended", () => {
    // ИСУН publishes „Условия за кандидатстване - изменени 12.05.2026".
    expect(
      pickDoc([
        { label: "Условия за кандидатстване - изменени 12.05.2026", url: "u" },
      ])?.url,
    ).toBe("u");
  });

  it("returns null rather than guessing when nothing matches", () => {
    // A wrong document is worse than none: the gate would reject every quote and the run would
    // look like a model failure instead of a selection one.
    expect(
      pickDoc([{ label: "Приложение 5 - декларация", url: "x" }]),
    ).toBeNull();
    expect(pickDoc([])).toBeNull();
  });

  it("honours the declared order, not the input order", () => {
    const docs = DOC_PREFERENCE.map((label, i) => ({
      label,
      url: `u${i}`,
    })).reverse();
    expect(pickDoc(docs)?.label).toBe(DOC_PREFERENCE[0]);
  });
});

describe("sniffKind", () => {
  it("reads PDF and legacy .doc from the magic bytes", () => {
    expect(sniffKind(buf("25504446"), "anything.bin")).toBe("pdf");
    // OLE2. Measured: „Покана" arrives this way, and it is the format the plan did not expect.
    expect(sniffKind(buf("d0cf11e0"), "pokana.doc")).toBe("doc");
  });

  it("distinguishes .docx from a real archive — the same PK container", () => {
    expect(sniffKind(buf("504b0304"), "obyava.docx")).toBe("docx");
    expect(sniffKind(buf("504b0304"), "prilozheniya.zip")).toBe("archive");
  });

  it("falls back to [Content_Types].xml when the name cannot decide", () => {
    // Content-Disposition is sometimes absent, and then the name is empty. An OOXML package
    // always carries this member near the start; a zip of PDFs does not.
    expect(sniffKind(buf("504b0304", "....[Content_Types].xml...."), "")).toBe(
      "docx",
    );
    expect(sniffKind(buf("504b0304", "....doc1.pdf....doc2.pdf"), "")).toBe(
      "archive",
    );
  });

  it("recognises rar and 7z as archives", () => {
    expect(sniffKind(buf("52617221"), "x")).toBe("archive");
    expect(sniffKind(buf("377abcaf"), "x")).toBe("archive");
  });

  it("uses the extension only when the magic bytes say nothing", () => {
    expect(sniffKind(buf("00000000"), "x.pdf")).toBe("pdf");
    expect(sniffKind(buf("00000000"), "x.docx")).toBe("docx");
    expect(sniffKind(buf("00000000"), "x.bin")).toBe("unknown");
  });

  it("prefers the magic bytes OVER the extension when they disagree", () => {
    // The whole reason it sniffs: Content-Type is always octet-stream and ИСУН's filenames are
    // not reliable either. A PDF named .doc must be read as a PDF.
    expect(sniffKind(buf("25504446"), "usloviya.doc")).toBe("pdf");
  });

  it("does not crash on a body too short to have magic bytes", () => {
    expect(sniffKind(Buffer.from("ab", "utf8"), "")).toBe("unknown");
    expect(sniffKind(Buffer.alloc(0), "x.pdf")).toBe("pdf");
  });
});

describe("filenameFrom", () => {
  it("reads the RFC 5987 form ИСУН actually sends", () => {
    expect(
      filenameFrom(
        "attachment; filename*=UTF-8''%D0%9E%D0%B1%D1%8F%D0%B2%D0%B0.pdf",
      ),
    ).toBe("Обява.pdf");
  });

  it("reads the plain form", () => {
    expect(filenameFrom('attachment; filename="usloviya.docx"')).toBe(
      "usloviya.docx",
    );
  });

  it("prefers the encoded form when both are present", () => {
    // Servers send an ASCII-mangled `filename` alongside the real one; taking the wrong one
    // costs the .docx/.zip discrimination above.
    expect(
      filenameFrom(
        `attachment; filename="_____.pdf"; filename*=UTF-8''%D0%9E.pdf`,
      ),
    ).toBe("О.pdf");
  });

  it("survives a malformed escape instead of throwing", () => {
    // decodeURIComponent throws on a lone %; the name is only a hint, so it must not take the
    // whole fetch down.
    expect(filenameFrom("attachment; filename*=UTF-8''bad%zz.pdf")).toBe(
      "bad%zz.pdf",
    );
  });

  it("returns empty for an absent header", () => {
    expect(filenameFrom(null)).toBe("");
    expect(filenameFrom("attachment")).toBe("");
  });
});
