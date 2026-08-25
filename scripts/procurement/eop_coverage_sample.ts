// Choosing WHICH dossiers `eop_notice_coverage.data.test.ts` measures.
//
// It lives in its own module for one reason: the gate that uses it opens the 1.8 GB
// `eop_dossier.sqlite` capture at module scope, so anything exported FROM that file
// re-opens the store in whatever imports it. A rule this small has to be testable
// without paying for the corpus, which is the whole point of extracting it.

/**
 * Pick at most `sampleSize` ids spread evenly across `ids`, preserving order.
 *
 * ⚠️⚠️ IT MUST STRIDE, NEVER TAKE A PREFIX, AND THAT IS A CORRECTNESS PROPERTY
 * RATHER THAN A STYLE CHOICE. `eop_dossier.subject_id` tracks the register's own
 * chronology, and the eForms/legacy split is an ERA split — measured 2026-08-25 over
 * ids 56,505..600,641: the first 300 dossiers are **3.9%** eForms notices and the
 * last 300 are **98.5%**. So `ids.slice(0, n)` does not return a smaller sample of
 * the corpus, it returns the legacy era and reports it as the corpus, and the
 * coverage gate's two tier assertions would then pass or fail on which end of the
 * crawl they happened to land in.
 *
 * The obvious future edit is "just LIMIT it, it's simpler". `eop_coverage_sample.test.ts`
 * exists to make that edit fail, and carries a mutation check comparing this against
 * the prefix so the assertion cannot go vacuous.
 *
 * @throws when `sampleSize` is not a positive integer. Mirroring
 * `EopDossierStore.iterate()`'s guard deliberately: the size is read from
 * `EOP_COVERAGE_SAMPLE`, so a typo makes `Number(...)` NaN, and every comparison
 * against NaN is false — which would yield an EMPTY sample, i.e. a data gate that
 * silently measures nothing while still reporting success. That is the exact failure
 * class the gate was just repaired for, so it throws rather than returns `[]`.
 */
export const strideSample = (
  ids: readonly number[],
  sampleSize: number,
): number[] => {
  if (!Number.isInteger(sampleSize) || sampleSize < 1)
    throw new Error(
      `strideSample: sampleSize must be a positive integer, got ${sampleSize}`,
    );
  // Math.max guards the sampleSize >= ids.length case, where the ratio floors to 0
  // and `i % 0` is NaN — every id would be dropped instead of every id kept.
  const stride = Math.max(1, Math.floor(ids.length / sampleSize));
  return ids.filter((_, i) => i % stride === 0).slice(0, sampleSize);
};
