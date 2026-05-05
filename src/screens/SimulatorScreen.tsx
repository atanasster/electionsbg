import { FC, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Title } from "@/ux/Title";
import { useElectionContext } from "@/data/ElectionContext";
import { usePartyInfo } from "@/data/parties/usePartyInfo";
import { useCanonicalParties } from "@/data/parties/useCanonicalParties";
import { localDate, formatPct, formatThousands } from "@/data/utils";
import { Link } from "@/ux/Link";
import { cn } from "@/lib/utils";
import {
  allocateSeats,
  buildOfficialRows,
  MAJORITY_SEATS,
  SeatRow,
  TOTAL_SEATS,
} from "./utils/seatAllocation";
import { MinimalCoalitions } from "./components/coalitions/MinimalCoalitions";
import seatsData from "@/data/json/election_seats.json";
import { PartyInfo, PartySeats, StatsVote } from "@/data/dataTypes";

const allSeats = seatsData as Record<string, PartySeats[]>;

const ParliamentStrip: FC<{
  rows: SeatRow[];
  findParty: (n: number) => PartyInfo | undefined;
}> = ({ rows, findParty }) => {
  const { displayNameFor } = useCanonicalParties();
  const segments = rows.filter((r) => r.seats > 0);
  return (
    <div className="relative w-full">
      <div className="flex h-10 w-full overflow-hidden rounded border border-border">
        {segments.map((r) => {
          const party = findParty(r.partyNum);
          const nick = party?.nickName ?? r.nickName ?? "";
          const label = displayNameFor(nick) ?? nick;
          const widthPct = (r.seats / TOTAL_SEATS) * 100;
          return (
            <div
              key={r.partyNum}
              className="h-full"
              style={{
                width: `${widthPct}%`,
                backgroundColor: party?.color || "#888",
              }}
              title={`${label}: ${r.seats}`}
            />
          );
        })}
      </div>
      <div
        className="pointer-events-none absolute -top-1 -bottom-1 border-l-2 border-dashed border-foreground"
        style={{ left: `${(MAJORITY_SEATS / TOTAL_SEATS) * 100}%` }}
      >
        <span className="absolute -top-5 -translate-x-1/2 text-xs font-semibold whitespace-nowrap">
          {MAJORITY_SEATS}
        </span>
      </div>
    </div>
  );
};

const SeatTable: FC<{
  rows: SeatRow[];
  officialByPartyNum?: Map<number, number>;
  findParty: (n: number) => PartyInfo | undefined;
  showSimulatedColumn?: boolean;
}> = ({ rows, officialByPartyNum, findParty, showSimulatedColumn }) => {
  const { t } = useTranslation();
  const { displayNameFor } = useCanonicalParties();
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-muted-foreground border-b">
          <tr>
            <th className="text-left py-2 px-2">{t("party")}</th>
            <th className="text-right py-2 px-2">{t("votes")}</th>
            <th className="text-right py-2 px-2">%</th>
            {officialByPartyNum && (
              <th className="text-right py-2 px-2">{t("real_seats")}</th>
            )}
            {showSimulatedColumn && (
              <th className="text-right py-2 px-2">{t("simulated_seats")}</th>
            )}
            {!officialByPartyNum && !showSimulatedColumn && (
              <th className="text-right py-2 px-2">{t("seats")}</th>
            )}
            {officialByPartyNum && showSimulatedColumn && (
              <th className="text-right py-2 px-2">Δ</th>
            )}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const party = findParty(r.partyNum);
            const real = officialByPartyNum?.get(r.partyNum) ?? 0;
            const delta = r.seats - real;
            return (
              <tr
                key={r.partyNum}
                className={`border-b ${!r.passedThreshold ? "opacity-50" : ""}`}
              >
                <td className="py-2 px-2">
                  <span className="flex items-center gap-2">
                    <span
                      className="inline-block w-3 h-3 rounded-sm"
                      style={{ backgroundColor: party?.color || "#888" }}
                    />
                    <Link
                      to={`/party/${party?.nickName || r.nickName}`}
                      className="hover:underline"
                    >
                      {displayNameFor(party?.nickName ?? r.nickName ?? "") ??
                        party?.nickName ??
                        r.nickName}
                    </Link>
                  </span>
                </td>
                <td className="text-right py-2 px-2 tabular-nums">
                  {formatThousands(r.totalVotes)}
                </td>
                <td className="text-right py-2 px-2 tabular-nums">
                  {formatPct(r.pct)}
                </td>
                {officialByPartyNum && (
                  <td className="text-right py-2 px-2 tabular-nums font-semibold">
                    {real}
                  </td>
                )}
                {showSimulatedColumn && (
                  <td className="text-right py-2 px-2 tabular-nums font-semibold">
                    {r.passedThreshold ? r.seats : "—"}
                  </td>
                )}
                {!officialByPartyNum && !showSimulatedColumn && (
                  <td className="text-right py-2 px-2 tabular-nums font-semibold">
                    {r.seats}
                  </td>
                )}
                {officialByPartyNum && showSimulatedColumn && (
                  <td
                    className={`text-right py-2 px-2 tabular-nums ${
                      delta > 0
                        ? "text-positive"
                        : delta < 0
                          ? "text-negative"
                          : "text-muted-foreground"
                    }`}
                  >
                    {delta === 0 ? "0" : delta > 0 ? `+${delta}` : delta}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};

const ThresholdSlider: FC<{
  value: number;
  onChange: (v: number) => void;
}> = ({ value, onChange }) => {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between">
        <label className="text-sm font-medium">{t("threshold")}</label>
        <span className="tabular-nums font-semibold">{value.toFixed(1)}%</span>
      </div>
      <input
        type="range"
        min="0"
        max="10"
        step="0.1"
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-full accent-primary cursor-pointer"
        aria-label={t("threshold")}
      />
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>0%</span>
        <span>4% ({t("legal_threshold")})</span>
        <span>10%</span>
      </div>
    </div>
  );
};

export const SimulatorScreen: FC = () => {
  const { t } = useTranslation();
  const { selected, electionStats } = useElectionContext();
  const { findParty } = usePartyInfo();
  const [threshold, setThreshold] = useState(4);

  const officialSeats = allSeats[selected];
  const votes: StatsVote[] = useMemo(
    () => electionStats?.results?.votes ?? [],
    [electionStats],
  );

  const [tab, setTab] = useState<"actual" | "whatif">(
    officialSeats ? "actual" : "whatif",
  );

  const officialRows = useMemo(
    () => (officialSeats ? buildOfficialRows(officialSeats, votes) : []),
    [officialSeats, votes],
  );
  const officialByPartyNum = useMemo(
    () =>
      officialSeats
        ? new Map(officialSeats.map((s) => [s.partyNum, s.seats]))
        : undefined,
    [officialSeats],
  );

  const simulatedRows = useMemo(
    () => allocateSeats(votes, threshold),
    [votes, threshold],
  );

  const title = `${t("coalition_simulator")} — ${localDate(selected)}`;

  const tabBtn = (id: "actual" | "whatif", label: string, disabled = false) => (
    <button
      onClick={() => setTab(id)}
      disabled={disabled}
      className={cn(
        "px-4 py-2 text-sm font-medium rounded-md transition-colors",
        tab === id
          ? "bg-background text-foreground shadow"
          : "text-muted-foreground hover:text-foreground",
        disabled && "opacity-40 cursor-not-allowed",
      )}
    >
      {label}
    </button>
  );

  return (
    <>
      <Title description={t("coalition_simulator_description")}>{title}</Title>

      <div className="w-full max-w-5xl mx-auto px-4 pb-12">
        <div className="inline-flex items-center gap-1 rounded-lg bg-muted p-1">
          {tabBtn("actual", t("actual_seats"), !officialSeats)}
          {tabBtn("whatif", t("threshold_whatif"))}
        </div>

        {tab === "actual" && officialSeats && (
          <div className="space-y-6 mt-6">
            <p className="text-sm text-muted-foreground">
              {t("actual_seats_explainer")}
            </p>
            <div className="pt-6">
              <ParliamentStrip rows={officialRows} findParty={findParty} />
            </div>
            <SeatTable rows={officialRows} findParty={findParty} />
            <div>
              <h2 className="text-lg font-semibold mb-3">
                {t("possible_coalitions")}
              </h2>
              <MinimalCoalitions rows={officialRows} findParty={findParty} />
            </div>
          </div>
        )}

        {tab === "whatif" && (
          <div className="space-y-6 mt-6">
            <p className="text-sm text-muted-foreground">
              {t("whatif_explainer")}
            </p>
            <ThresholdSlider value={threshold} onChange={setThreshold} />
            <div className="pt-6">
              <ParliamentStrip rows={simulatedRows} findParty={findParty} />
            </div>
            <SeatTable
              rows={simulatedRows}
              officialByPartyNum={officialByPartyNum}
              showSimulatedColumn={true}
              findParty={findParty}
            />
            <div>
              <h2 className="text-lg font-semibold mb-3">
                {t("possible_coalitions")}
              </h2>
              <MinimalCoalitions rows={simulatedRows} findParty={findParty} />
            </div>
          </div>
        )}
      </div>
    </>
  );
};
