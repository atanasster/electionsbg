import type { WatchSource, Fingerprint, WatchState } from "../types";
import { fetchJson, sha256Short } from "../fingerprint";

interface RawMp {
  A_ns_MP_id: number;
}
interface CollListNs {
  A_ns_CL_value: string;
  A_ns_C_active_count: number;
  colListMP: RawMp[];
}

export const parliamentMps: WatchSource = {
  id: "parliament_mps",
  label: "Parliament MPs (active roster)",
  url: "https://www.parliament.bg/api/v1/coll-list-ns/bg",
  cadence: "daily",

  async fingerprint(): Promise<Fingerprint> {
    const data = await fetchJson<CollListNs>(this.url);
    if (!data) throw new Error("empty response from coll-list-ns");
    const ids = data.colListMP.map((m) => m.A_ns_MP_id).sort((a, b) => a - b);
    const value = sha256Short(`${data.A_ns_CL_value}|${ids.join(",")}`);
    return {
      value,
      detail: `${data.A_ns_CL_value} — ${data.A_ns_C_active_count} MPs`,
      meta: { ns: data.A_ns_CL_value, count: data.A_ns_C_active_count, ids },
    };
  },

  describe(prev: WatchState | null, curr: Fingerprint): string {
    if (!prev) return curr.detail;
    const prevIds = new Set((prev.meta?.ids as number[] | undefined) ?? []);
    const currIds = new Set((curr.meta?.ids as number[] | undefined) ?? []);
    const added = [...currIds].filter((id) => !prevIds.has(id));
    const removed = [...prevIds].filter((id) => !currIds.has(id));
    const parts: string[] = [];
    if (added.length)
      parts.push(`+${added.length} new MP id(s): ${added.join(", ")}`);
    if (removed.length)
      parts.push(`-${removed.length} removed: ${removed.join(", ")}`);
    if (parts.length === 0)
      parts.push("roster unchanged but fingerprint differs (NS label?)");
    return `${curr.detail} · ${parts.join("; ")}`;
  },
};
