// Aligning Sofia's OCR'd agenda to the decisions it produced.
//
// The case that matters is a MID-SESSION gap. Protokol 65 has 63 markers and 57
// decisions, and the five agenda items that produced no decision are not at the
// end: decisions 582/583/584 are Точки 60/61/62, not 55/56/57. Every positional
// scheme gets that tail wrong — truncation, and a single global offset alike —
// and a wrong merge publishes a named councillor's vote against a decision they
// did not cast it on.

import { describe, it, expect } from "vitest";
import { alignAgenda, foldTitle, titleOverlap, agendaSubject } from "./agenda_align";

describe("foldTitle", () => {
  it("folds case, punctuation and diacritics so two renderings meet", () => {
    // One side is OCR'd from a scan, the other extracted from a text PDF.
    expect(foldTitle('Приемане на „Бюджет“ — 2026 г.')).toBe(
      "приемане на бюджет 2026 г",
    );
  });
});

describe("titleOverlap", () => {
  it("scores a truncated title against its fuller form highly", () => {
    // A decision title is often a prefix of the protokol's fuller „относно"
    // clause, which is why this divides by the SMALLER set rather than the
    // union — Jaccard would score a true match low.
    const short = foldTitle("одобрение на Годишен отчет за 2025 г.");
    const long = foldTitle(
      "одобрение на Годишен отчет за 2025 г. за изпълнението на Комплексна програма за качеството на въздуха",
    );
    expect(titleOverlap(short, long)).toBe(1);
  });

  it("is 0 when either side is empty", () => {
    // An agenda item whose subject the OCR did not recover must never anchor.
    expect(titleOverlap("", foldTitle("каквото и да е"))).toBe(0);
  });
});

describe("agendaSubject", () => {
  it("reads the subject FORWARD of the marker", () => {
    // findResolutionMarkers()' own `title` looks BACKWARD for „ОТНОСНО:",
    // which is right for V. Tarnovo and empty for every Точка marker here.
    const block = [
      "Точка 3 (трета)",
      "СОА26-ВК66-5784/01.07.2026 г.",
      "Доклад вх.№ СОА26-ВК66-5784/01.07.2026 г.",
      "относно Меморандум за сътрудничество между Столична община и Дирекция Природен парк Витоша.",
    ].join("\n");
    expect(agendaSubject(block)).toContain("меморандум за сътрудничество");
  });

  it("returns empty rather than guessing when there is no relevance clause", () => {
    expect(agendaSubject("Точка 0 (нулева)\nОбсъждане на дневен ред")).toBe("");
  });
});

describe("alignAgenda", () => {
  const D = (...xs: string[]) => xs.map(foldTitle);

  it("aligns 1:1 when the lists correspond", () => {
    const decisions = D("приемане на бюджет", "продажба на имот", "избор на комисия");
    const markers = decisions;
    const r = alignAgenda(decisions, markers);
    expect(r.map.size).toBe(3);
    expect([...r.map.entries()]).toEqual([
      [0, 0],
      [1, 1],
      [2, 2],
    ]);
  });

  it("skips a LEADING marker that produced no decision", () => {
    // „Точка 0" — the vote adopting the agenda. It carries no subject, so it
    // cannot anchor, and the whole map shifts by one without any positional
    // rule saying so.
    const decisions = D("приемане на бюджет", "продажба на имот");
    const markers = ["", ...decisions];
    const r = alignAgenda(decisions, markers);
    expect(r.map.get(0)).toBe(1);
    expect(r.map.get(1)).toBe(2);
  });

  it("handles a MID-SESSION gap — the protokol-65 shape", () => {
    // Three decisions, then five agenda items that produced none, then three
    // more. A positional merge maps the last three onto the withdrawn items.
    const tail = D("наредба за рекламата", "план за квартал", "отчет на кмета");
    const head = D("приемане на бюджет", "продажба на имот", "избор на комисия");
    const decisions = [...head, ...tail];
    const markers = [...head, "", "", "", "", "", ...tail];
    const r = alignAgenda(decisions, markers);
    expect(r.map.size).toBe(6);
    // The tail jumps the gap rather than sliding into it.
    expect(r.map.get(3)).toBe(8);
    expect(r.map.get(4)).toBe(9);
    expect(r.map.get(5)).toBe(10);
  });

  it("interpolates a subject-less run BETWEEN two anchors", () => {
    // Equal spans on both sides, so the mapping is forced rather than assumed —
    // this is what recovers the agenda items whose „относно" the OCR dropped.
    const decisions = D("първо решение", "второ решение", "трето решение");
    const markers = [foldTitle("първо решение"), "", foldTitle("трето решение")];
    const r = alignAgenda(decisions, markers);
    expect(r.anchors).toBe(2);
    expect(r.interpolated).toBe(1);
    expect(r.map.get(1)).toBe(1);
  });

  it("does NOT interpolate across an unequal span", () => {
    // Two decisions between the anchors but three markers: something was
    // dropped in there and we cannot place it, so those decisions stay
    // unmerged rather than being attributed to a neighbour's vote.
    const decisions = D("първо", "средно едно", "средно две", "последно");
    const markers = [foldTitle("първо"), "", "", "", foldTitle("последно")];
    const r = alignAgenda(decisions, markers);
    expect(r.map.has(0)).toBe(true);
    expect(r.map.has(3)).toBe(true);
    expect(r.map.has(1)).toBe(false);
    expect(r.map.has(2)).toBe(false);
  });

  it("refuses everything when nothing anchors", () => {
    // No shared vocabulary at all — the caller turns an empty map into a
    // refusal rather than falling back to position.
    const r = alignAgenda(D("приемане на бюджет"), [foldTitle("нещо съвсем друго")]);
    expect(r.map.size).toBe(0);
  });

  it("never maps two decisions onto one marker", () => {
    // Monotonic by construction. A duplicated title must not let one agenda
    // item's named vote be attributed to two different decisions.
    const decisions = D("продажба на имот", "продажба на имот", "друго решение");
    const markers = D("продажба на имот", "друго решение");
    const r = alignAgenda(decisions, markers);
    expect(new Set([...r.map.values()]).size).toBe(r.map.size);
  });

  it("is empty on empty input rather than throwing", () => {
    expect(alignAgenda([], []).map.size).toBe(0);
    expect(alignAgenda(D("x"), []).map.size).toBe(0);
  });
});
