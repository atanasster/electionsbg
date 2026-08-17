// Aligning an OCR'd agenda to the decisions it produced.
//
// Sofia's full-session protokol is scanned, so the OCR recovers „Точка N"
// agenda markers rather than „Решение № NNN" headers. The per-resolution PDFs
// give us the decisions. Joining the two is the last step before a named vote
// can be attributed, and it is the step where a wrong answer is worst: a
// misaligned merge publishes a named councillor's vote against a decision they
// did not cast it on.
//
// POSITION ALONE IS NOT ENOUGH, and the measurement that proves it is the whole
// reason this file exists. Protokol 65 has 63 markers and 57 decisions. The
// obvious reading — drop „Точка 0" (the vote adopting the agenda, which
// produces no решение) and take the first 57 — is right for 54 of them and
// WRONG for the last three: decisions 582/583/584 are Точки 60/61/62, not
// 55/56/57. Measured by title overlap, 582 scores 1.00 against Точка 60 and
// 0.12 against Точка 55. The five agenda items that produced no decision sit
// mid-session, not at the end, so `Math.min(recs, markers)` truncation silently
// misattributes the tail.
//
// So the alignment is DERIVED and VERIFIED instead. Both lists are in document
// order, which makes this a monotonic sequence alignment:
//
//   1. Each marker's subject is the „относно …" clause that follows it. Each
//      decision has its own title from its own PDF. Score every pair by word
//      overlap.
//   2. Needleman-Wunsch over the two ordered lists, gaps free. This finds the
//      best monotonic set of ANCHORS and discovers gaps on either side wherever
//      they fall — no offset is assumed anywhere.
//   3. Fill between consecutive anchors ONLY when the two spans are equal. That
//      is an interpolation constrained on both sides by verified matches, not a
//      guess: if 3 decisions sit between two anchors and so do 3 markers, the
//      mapping between them is forced.
//
// On protokol 65 that is 45 anchors + 12 interpolated = 57 of 57, with the tail
// correctly jumping 54 → 60.
//
// A single global offset was also tried and rejected: offset 527 scores 0.835
// mean against 0.27 for its neighbours — decisive, and still wrong for the last
// three decisions, because one offset cannot express a mid-session gap.

/** Word-overlap similarity, 0..1, over the smaller of the two token sets.
 *
 *  Deliberately not Jaccard: a decision title is often a truncated prefix of
 *  the protokol's fuller „относно" clause, so the union is much larger than the
 *  intersection and Jaccard would score a true match low. Dividing by the
 *  SMALLER set asks "is the shorter text contained in the longer one", which is
 *  the actual relationship. */
export const titleOverlap = (a: string, b: string): number => {
  const A = new Set(a.split(" ").filter(Boolean));
  const B = new Set(b.split(" ").filter(Boolean));
  if (A.size === 0 || B.size === 0) return 0;
  let hit = 0;
  for (const w of A) if (B.has(w)) hit++;
  return hit / Math.min(A.size, B.size);
};

/** Diacritic-stripped, punctuation-free, lowercase. The two sides come from
 *  different renderings of the same sentence — one OCR'd from a scan, one
 *  extracted from a text PDF — so they differ in case, quoting and spacing. */
export const foldTitle = (s: string): string =>
  s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

/** A confident match. Chosen from the protokol-65 distribution: real matches
 *  cluster at 0.7-1.00 and boilerplate collisions sit below 0.5. */
const ANCHOR_MIN = 0.5;

export type AlignResult = {
  /** decision index -> marker index. */
  map: Map<number, number>;
  anchors: number;
  interpolated: number;
};

/**
 * Align `decisions` (ordered by decision number) to `markers` (document order).
 *
 * Both arrays carry ALREADY-FOLDED subject text; an empty string means "no
 * subject recovered", which scores 0 everywhere and can only ever be
 * interpolated between anchors, never anchored itself.
 */
export const alignAgenda = (
  decisions: string[],
  markers: string[],
): AlignResult => {
  const n = decisions.length;
  const m = markers.length;
  const map = new Map<number, number>();
  if (n === 0 || m === 0) return { map, anchors: 0, interpolated: 0 };

  const sc = (i: number, j: number): number =>
    titleOverlap(decisions[i], markers[j]);

  // Needleman-Wunsch. Gaps are free (a decision with no marker, or a marker
  // that produced no decision, are both normal); a below-threshold pairing
  // carries a tiny penalty so the traceback prefers a gap over a bad match.
  const dp: number[][] = Array.from({ length: n + 1 }, () =>
    new Array<number>(m + 1).fill(0),
  );
  const bt: number[][] = Array.from({ length: n + 1 }, () =>
    new Array<number>(m + 1).fill(0),
  );
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const s = sc(i - 1, j - 1);
      const diag = dp[i - 1][j - 1] + (s >= ANCHOR_MIN ? s : -0.01);
      const up = dp[i - 1][j];
      const left = dp[i][j - 1];
      const best = Math.max(diag, up, left);
      dp[i][j] = best;
      bt[i][j] = best === diag ? 0 : best === up ? 1 : 2;
    }
  }

  const anchors: [number, number][] = [];
  let i = n;
  let j = m;
  while (i > 0 && j > 0) {
    if (bt[i][j] === 0) {
      if (sc(i - 1, j - 1) >= ANCHOR_MIN) anchors.push([i - 1, j - 1]);
      i--;
      j--;
    } else if (bt[i][j] === 1) i--;
    else j--;
  }
  anchors.reverse();
  for (const [ri, mj] of anchors) map.set(ri, mj);

  // Interpolate ONLY between anchors whose spans are equal — then the mapping
  // between them is forced rather than assumed. An unequal span means a gap
  // somewhere inside it that we cannot place, so those decisions stay unmerged.
  let interpolated = 0;
  for (let k = 0; k + 1 < anchors.length; k++) {
    const [ri, mj] = anchors[k];
    const [rk, ml] = anchors[k + 1];
    if (rk - ri === ml - mj && rk - ri > 1) {
      for (let d = 1; d < rk - ri; d++) {
        if (!map.has(ri + d)) {
          map.set(ri + d, mj + d);
          interpolated++;
        }
      }
    }
  }
  // Extend past the first and last anchor at that anchor's own offset. Bounded
  // by both list ends, so it cannot invent a marker.
  if (anchors.length > 0) {
    const [r0, m0] = anchors[0];
    for (let d = 1; d <= Math.min(r0, m0); d++) {
      if (!map.has(r0 - d)) {
        map.set(r0 - d, m0 - d);
        interpolated++;
      }
    }
    const [rz, mz] = anchors[anchors.length - 1];
    for (let d = 1; d <= Math.min(n - 1 - rz, m - 1 - mz); d++) {
      if (!map.has(rz + d)) {
        map.set(rz + d, mz + d);
        interpolated++;
      }
    }
  }
  return { map, anchors: anchors.length, interpolated };
};

/**
 * The subject of one agenda item — the „относно …" clause that follows the
 * „Точка N" marker.
 *
 * Sofia's protokol lays each item out as
 *
 *     Точка 3 (трета)
 *     СОА26-ВК66-5784/01.07.2026 г.
 *     Доклад вх.№ СОА26-ВК66-5784/01.07.2026 г.
 *     относно Меморандум за сътрудничество между Столична община …
 *
 * so the subject is FORWARD of the marker. findResolutionMarkers()' own `title`
 * looks BACKWARD for an „ОТНОСНО:" clause, which is right for V. Tarnovo and
 * returns empty for every Точка marker here — which is why this exists rather
 * than reusing it.
 */
export const agendaSubject = (block: string): string => {
  const m = /относно\s+([\s\S]{20,400}?)(?:\n|$)/u.exec(block);
  return m ? foldTitle(m[1]) : "";
};
