// React Query hooks for the product-grain price surfaces (migration 048).
// These have no JSON predecessor — the old pipeline discarded the 95k product
// names and kept only the 101 КЗП group codes. See docs/plans/consumption-pg-v1.md.

import { useQuery } from "@tanstack/react-query";
import {
  fetchProduct,
  fetchProductHistory,
  fetchEuroVerdict,
} from "./fetchPricePayload";

/** One product: the cross-chain ladder, optionally narrowed to one settlement. */
export const useProduct = (slug?: string | null, ekatte?: string | null) =>
  useQuery({
    queryKey: ["prices", "product", slug, ekatte ?? ""],
    queryFn: () => fetchProduct(slug!, ekatte),
    enabled: !!slug,
    staleTime: Infinity,
  });

/** Per-product daily minimum since euro day. A missing day is a reporting gap. */
export const useProductHistory = (slug?: string | null) =>
  useQuery({
    queryKey: ["prices", "product-history", slug],
    queryFn: () => fetchProductHistory(slug!),
    enabled: !!slug,
    staleTime: Infinity,
  });

/** The five-bucket "did the euro raise prices?" classification. */
export const useEuroVerdict = () =>
  useQuery({
    queryKey: ["prices", "euro-verdict"],
    queryFn: () => fetchEuroVerdict(),
    staleTime: Infinity,
  });
