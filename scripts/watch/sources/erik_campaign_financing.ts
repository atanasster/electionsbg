// ЕРИК campaign-finance register (erik.bulnao.government.bg — Единен регистър по
// Изборния кодекс, Court of Audit). ЕРИК publishes per-participant donors,
// candidate donations, and post-election financial reports for each election.
// This watcher tells the orchestrator when new campaign-finance data has landed
// for the current election so the update-financing skill re-runs the scraper
// (scripts/smetna_palata/scrape_erik.ts).
//
// Fingerprint = the latest election's participant count + election-wide donor
// count + total donation sum. It flips when a new participant registers, a new
// donation is filed, or amounts are corrected — the ongoing signals as the
// reporting window fills. Cadence weekly: donations trickle in but the ingest
// (25 filing PDFs + CSV pulls) is heavier than a single page fetch.
//
// The endpoints are plain-HTTP JSON but ЕРИК hands out its session cookie on a
// GET and rejects cold POSTs (403), so we reuse the scraper's cookie-aware
// client. No geo-gating, no auth.

import type { WatchSource, Fingerprint, WatchState } from "../types";
import { sha256Short } from "../fingerprint";
import { createErikClient } from "../../smetna_palata/erik_client";
import { ERIK_ELECTIONS } from "../../smetna_palata/erik_config";

type DataTable = {
  recordsTotal: number;
  additionalParameters?: { TotalDonationPrice?: number };
};

export const erikCampaignFinancing: WatchSource = {
  id: "erik_campaign_financing",
  label: "ЕРИК campaign financing (Сметна палата, изборни дарения/отчети)",
  url: `https://erik.bulnao.government.bg/Reports?electionId=${ERIK_ELECTIONS[0].electionId}`,
  cadence: "weekly",

  async fingerprint(): Promise<Fingerprint> {
    const el = ERIK_ELECTIONS[0];
    const client = createErikClient();
    // Warm the session cookie (cold POSTs 403).
    await client.get(`/Reports?electionId=${el.electionId}`);

    let participants = 0;
    for (const commissionType of [1, 2, 3]) {
      const r = await client.postJson<DataTable>(
        "/Reports/GetParticipantsByElectionId",
        {
          electionId: el.electionId,
          electionCommissionType: commissionType,
          draw: 1,
          start: 0,
          length: 1000,
        },
      );
      participants += r.recordsTotal ?? 0;
    }

    const donors = await client.postJson<DataTable>(
      "/Reports/GetDonorsByElectionId",
      {
        electionId: el.electionId,
        isOldSystemElection: el.isOldSystem,
        draw: 1,
        start: 0,
        length: 1,
      },
    );
    const donorCount = donors.recordsTotal ?? 0;
    const total = Math.round(
      donors.additionalParameters?.TotalDonationPrice ?? 0,
    );

    if (participants === 0 && donorCount === 0) {
      throw new Error(
        "ЕРИК returned no participants/donors (markup or session?)",
      );
    }

    const value = sha256Short(`${participants}|${donorCount}|${total}`);
    return {
      value,
      detail: `${el.election}: ${participants} participants, ${donorCount} donors, €${total.toLocaleString("en-US")} donated (hash ${value})`,
      meta: { election: el.election, participants, donorCount, total },
    };
  },

  describe(prev: WatchState | null, curr: Fingerprint): string {
    if (!prev) return curr.detail;
    const pd = (prev.meta?.donorCount as number | undefined) ?? null;
    const cd = (curr.meta?.donorCount as number | undefined) ?? null;
    const pt = (prev.meta?.total as number | undefined) ?? null;
    const ct = (curr.meta?.total as number | undefined) ?? null;
    const bits: string[] = [];
    if (pd != null && cd != null && cd !== pd) {
      bits.push(`${cd - pd > 0 ? "+" : ""}${cd - pd} donors (${pd} → ${cd})`);
    }
    if (pt != null && ct != null && ct !== pt) {
      bits.push(`€${(ct - pt).toLocaleString("en-US")} donated`);
    }
    return bits.length
      ? `ЕРИК ${curr.meta?.election}: ${bits.join(", ")}`
      : `ЕРИК campaign financing changed (${curr.meta?.election})`;
  },
};
