// The prerendered / fast-path-materialized product head.
//
// Load-bearing coupling: export_slugs.ts prerenders the top-N products, and
// build_product_days.ts materializes their daily-minimum history for the
// price-history fast path. A prerendered product beyond the materialized head
// falls through to the LIVE history query — cheap only for the long tail. So
// the two MUST use the same N and the same ORDER BY. One constant, imported by
// both, is the single source of truth.
export const PRERENDER_HEAD = 3000;
