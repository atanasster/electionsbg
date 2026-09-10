import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { bgCorpus, enCorpus } from "@/locales/allKeys";
import { TooltipProvider } from "@/components/ui/tooltip";
import type {
  Agency,
  Poll,
  PresidentialPollDetail,
} from "@/data/polls/pollsTypes";
import { PresidentialPollsSection } from "./PresidentialPollsSection";

await i18n.use(initReactI18next).init({
  lng: "bg",
  fallbackLng: "bg",
  resources: { bg: { translation: bgCorpus }, en: { translation: enCorpus } },
  interpolation: { escapeValue: false },
  react: { useSuspense: false },
});

const AGENCY: Agency = {
  id: "GM",
  website: "https://globalmetrics.eu/",
  name_bg: "Глобал Метрикс",
  name_en: "Global Metrics",
  abbr_bg: "ГМ",
  abbr_en: "GM",
  eik: "203020572",
};

const jsonResponse = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });

const renderSection = (agencies: Agency[] = [AGENCY]) => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <TooltipProvider>
          <PresidentialPollsSection agencies={agencies} />
        </TooltipProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
};

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("PresidentialPollsSection", () => {
  it("renders nothing at all — not even a heading — when the corpus is empty", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) =>
      String(url).includes("polls.json") ? jsonResponse([]) : jsonResponse([]),
    );
    const { container } = renderSection();
    // waitFor via findBy on something that would only appear once settled —
    // there is nothing to find, so assert the settled DOM has no content.
    await new Promise((r) => setTimeout(r, 0));
    expect(container).toBeEmptyDOMElement();
    expect(
      screen.queryByText(bgCorpus.polls_section_presidential),
    ).not.toBeInTheDocument();
  });

  it("renders one card per agency (its latest poll), linking to /polls/:agencyId", async () => {
    const poll: Poll = {
      id: "gm-2026-07-11",
      agencyId: "GM",
      fieldwork: "through Jul 11 2026",
      electionDate: "2026-11-08",
      respondents: 1503,
      methodology: { bg: "Метод", en: "Method" },
      source: "https://globalmetrics.eu/example",
      race: "presidential",
      cycle: null,
    };
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
    ];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      const u = String(url);
      if (u.includes("polls_details.json")) return jsonResponse(details);
      if (u.includes("polls.json")) return jsonResponse([poll]);
      return jsonResponse([]);
    });
    renderSection();

    expect(
      await screen.findByText(bgCorpus.polls_section_presidential),
    ).toBeInTheDocument();
    const link = screen.getByRole("link", { name: "Глобал Метрикс" });
    expect(link).toHaveAttribute("href", "/polls/GM");
    expect(screen.getByText("Илияна Йотова")).toBeInTheDocument();
    expect(screen.getByText("30.0%")).toBeInTheDocument();
  });

  it("shows only the LATEST poll per agency, never one card per poll", async () => {
    const older: Poll = {
      id: "gm-2025-01-01",
      agencyId: "GM",
      fieldwork: "Jan 01 2025",
      electionDate: null,
      respondents: null,
      methodology: { bg: "N/A", en: "N/A" },
      source: "",
      race: "presidential",
      cycle: null,
    };
    const newer: Poll = {
      ...older,
      id: "gm-2026-07-11",
      fieldwork: "Jul 11 2026",
    };
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      const u = String(url);
      if (u.includes("polls.json")) return jsonResponse([older, newer]);
      return jsonResponse([]);
    });
    renderSection();

    await screen.findByText(bgCorpus.polls_section_presidential);
    expect(
      screen.getAllByRole("link", { name: "Глобал Метрикс" }),
    ).toHaveLength(1);
    expect(screen.getByText("Jul 11 2026")).toBeInTheDocument();
    expect(screen.queryByText("Jan 01 2025")).not.toBeInTheDocument();
  });
});
