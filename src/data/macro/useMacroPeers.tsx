import { useQuery } from "@tanstack/react-query";
import { dataUrl } from "@/data/dataUrl";

export type PeerGeo = "BG" | "EU27_2020" | "RO" | "HU" | "PL";
export type PeerMetric = "TR" | "TE" | "B9";

export type PeerPoint = { year: number; value: number };

// Peer-band per naItem built from the full 27-member EU distribution. Pinned
// to the latest year where BG and ≥20 peers report. Lives alongside the
// 5-country `series` — they answer different questions.
export type PeerBand = {
  year: number;
  bgPctGdp: number;
  euAvgPctGdp: number | null;
  rank: number;
  total: number;
};

export type MacroPeersPayload = {
  fetchedAt: string;
  source: {
    name: string;
    dataset: string;
    url: string;
    unit: string;
    sector: string;
    filters: Record<string, string>;
  };
  geos: PeerGeo[];
  naItems: PeerMetric[];
  latestYear: number;
  series: Record<PeerGeo, Record<PeerMetric, PeerPoint[]>>;
  distribution?: Partial<Record<PeerMetric, PeerBand>>;
};

export const useMacroPeers = () =>
  useQuery({
    queryKey: ["macro_peers"],
    queryFn: async (): Promise<MacroPeersPayload | undefined> => {
      const res = await fetch(dataUrl("/macro_peers.json"));
      if (!res.ok) return undefined;
      return (await res.json()) as MacroPeersPayload;
    },
  });
