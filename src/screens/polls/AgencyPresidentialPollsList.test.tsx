import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { bgCorpus, enCorpus } from "@/locales/allKeys";
import type {
  Poll,
  PresidentialPollDetail,
  Runoff,
} from "@/data/polls/pollsTypes";
import { AgencyPresidentialPollsList } from "./AgencyPresidentialPollsList";

await i18n.use(initReactI18next).init({
  lng: "bg",
  fallbackLng: "bg",
  resources: { bg: { translation: bgCorpus }, en: { translation: enCorpus } },
  interpolation: { escapeValue: false },
  react: { useSuspense: false },
});

const POLL = (over: Partial<Poll> = {}): Poll => ({
  id: "gm-2026-07-11",
  agencyId: "GM",
  fieldwork: "through Jul 11 2026",
  electionDate: "2026-11-08",
  respondents: 1503,
  methodology: { bg: "Метод", en: "Method" },
  source: "https://globalmetrics.eu/example",
  race: "presidential",
  cycle: null,
  ...over,
});

const renderList = (
  polls: Poll[],
  details: PresidentialPollDetail[],
  runoffs: Runoff[] = [],
) =>
  render(
    <MemoryRouter>
      <AgencyPresidentialPollsList
        polls={polls}
        details={details}
        runoffs={runoffs}
      />
    </MemoryRouter>,
  );

describe("AgencyPresidentialPollsList", () => {
  it("shows a placeholder row (no nominee yet) as plain text, never a link", () => {
    const poll = POLL();
    const details: PresidentialPollDetail[] = [
      {
        pollId: poll.id,
        agencyId: "GM",
        candidateKey: "placeholder:прб",
        candidateName_bg: "Прогресивна България",
        candidateName_en: "Progressive Bulgaria",
        nominator: null,
        placeholderFor: "ПрБ",
        support: 39.7,
      },
    ];
    renderList([poll], details);
    const cell = screen.getByText("Прогресивна България");
    expect(cell.closest("a")).toBeNull();
  });

  it("shows a 'none' (Не подкрепям никого) row as plain text, never a link", () => {
    const poll = POLL();
    const details: PresidentialPollDetail[] = [
      {
        pollId: poll.id,
        agencyId: "GM",
        candidateKey: "none",
        candidateName_bg: "Не подкрепям никого",
        candidateName_en: "None of the above",
        nominator: null,
        placeholderFor: null,
        support: 2.1,
      },
    ];
    renderList([poll], details);
    const cell = screen.getByText("Не подкрепям никого");
    expect(cell.closest("a")).toBeNull();
  });

  it("renders the fieldwork, source link and methodology for a poll", () => {
    const poll = POLL();
    renderList([poll], []);
    expect(screen.getByText("до Jul 11 2026")).toBeInTheDocument();
    expect(screen.getByText("Метод")).toBeInTheDocument();
    const source = screen.getByRole("link", { name: /Източник/ });
    expect(source).toHaveAttribute("href", poll.source);
  });

  it("orders multiple polls newest fieldwork first", () => {
    const older = POLL({ id: "gm-2025-01-01", fieldwork: "Jan 01 2025" });
    const newer = POLL({ id: "gm-2026-07-11", fieldwork: "Jul 11 2026" });
    renderList([older, newer], []);
    const fieldworkCells = screen.getAllByText(/2025|2026/);
    expect(fieldworkCells[0]).toHaveTextContent("Jul 11 2026");
    expect(fieldworkCells[1]).toHaveTextContent("Jan 01 2025");
  });

  it("resolves a runoff pairing's CandidateKeys back to display names via this poll's own rows", () => {
    const poll = POLL();
    const details: PresidentialPollDetail[] = [
      {
        pollId: poll.id,
        agencyId: "GM",
        candidateKey: "provisional:илияна-йотова",
        candidateName_bg: "Илияна Йотова",
        candidateName_en: "Iliana Yotova",
        nominator: null,
        placeholderFor: null,
        support: 30,
      },
      {
        pollId: poll.id,
        agencyId: "GM",
        candidateKey: "provisional:андрей-гюров",
        candidateName_bg: "Андрей Гюров",
        candidateName_en: "Andrey Gyurov",
        nominator: null,
        placeholderFor: null,
        support: 9.6,
      },
    ];
    const runoffs: Runoff[] = [
      {
        pollId: poll.id,
        agencyId: "GM",
        a: "provisional:илияна-йотова",
        b: "provisional:андрей-гюров",
        supportA: 55,
        supportB: 45,
        residual: null,
      },
    ];
    renderList([poll], details, runoffs);
    // The runoff row shows the resolved NAMES, never the raw CandidateKey.
    expect(screen.queryByText(/provisional:/)).not.toBeInTheDocument();
    expect(screen.getAllByText("Илияна Йотова").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Андрей Гюров").length).toBeGreaterThan(0);
  });
});
