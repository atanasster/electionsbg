import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, within, fireEvent } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { bgCorpus, enCorpus } from "@/locales/allKeys";
import { PresidentialHistory } from "./PresidentialHistory";
import { PollsAgencyPresidentialScreen } from "../PollsAgencyPresidentialScreen";
import polls from "../../../data/polls/presidential/polls.json";
import details from "../../../data/polls/presidential/polls_details.json";
import runoffs from "../../../data/polls/presidential/runoffs.json";
import accuracy from "../../../data/polls/presidential/accuracy.json";
import agencies from "../../../data/polls/agencies.json";
import coverage from "../../../data/polls/presidential/coverage.json";
vi.mock("recharts", async () => {
  const actual = await vi.importActual<typeof import("recharts")>("recharts");
  return { ...actual, ResponsiveContainer: () => null };
});
await i18n.use(initReactI18next).init({
  lng: "en",
  fallbackLng: "en",
  resources: { bg: { translation: bgCorpus }, en: { translation: enCorpus } },
  interpolation: { escapeValue: false },
  react: { useSuspense: false },
});
const response = (value: unknown) =>
  new Response(JSON.stringify(value), { status: 200 });
const fetchCorpus = async (input: RequestInfo | URL) => {
  const url = String(input);
  if (url.includes("coverage.json")) return response(coverage);
  if (url.includes("polls_details.json")) return response(details);
  if (url.includes("runoffs.json")) return response(runoffs);
  if (url.includes("accuracy.json")) return response(accuracy);
  if (url.includes("agencies.json")) return response(agencies);
  return response(polls);
};
function show(
  component = <PresidentialHistory cycle="2021_11_14_pvr" />,
  path = "/",
) {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <MemoryRouter initialEntries={[path]}>{component}</MemoryRouter>
    </QueryClientProvider>,
  );
}
beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(globalThis, "fetch").mockImplementation(fetchCorpus);
});
describe("presidential history", () => {
  it("shows every selected observation and withholds an incomplete overall grade", async () => {
    show();
    const table = await screen.findByRole("table", {
      name: "All displayed observations",
    });
    expect(within(table).getAllByRole("row").length).toBeGreaterThan(30);
    expect(screen.getByText(/MAE: Incomplete comparison/)).toBeInTheDocument();
    expect(
      screen.getByText(/Incomplete candidate coverage/),
    ).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Candidate"), {
      target: {
        value: details.find((d) => d.pollId === "sh-2021-11-02-presidential")!
          .candidateKey,
      },
    });
    expect(within(table).getAllByRole("row").length).toBeLessThan(15);
  });
  it("loads a presidential-only agency directly and separates GM questions and answer tiers", async () => {
    show(
      <Routes>
        <Route
          path="/polls/:agencyId/presidential"
          element={<PollsAgencyPresidentialScreen />}
        />
      </Routes>,
      "/polls/GM/presidential",
    );
    const p = polls.find((p) => p.agencyId === "GM")!;
    const party = await screen.findByRole("region", {
      name: p.questions![0].wording.en,
    });
    const potential = screen.getByRole("region", {
      name: p.questions![1].wording.en,
    });
    expect(within(party).queryByText("Илияна Йотова")).not.toBeInTheDocument();
    expect(within(potential).getAllByText("Илияна Йотова")).toHaveLength(3);
    expect(
      screen.getByRole("link", { name: "Agency overview" }),
    ).toHaveAttribute("href", "/polls/GM");
  });
  it("keeps question sample sizes unknown and filters every question by round", async () => {
    show(<PresidentialHistory agencyId="SH" />);
    const p = polls.find((p) => p.id === "sh-2021-11-02-presidential")!;
    const main = p.questions!.find((q) => q.round === 1)!;
    const regions = await screen.findAllByRole("region", {
      name: main.wording.en,
    });
    const region = regions.find((r) => r.closest("article")?.id === p.id)!;
    expect(region).toHaveTextContent("n=Not disclosed");
    expect(region).not.toHaveTextContent("n=1000");
    fireEvent.change(screen.getByLabelText("Round"), {
      target: { value: "2" },
    });
    expect(
      screen.queryByRole("region", { name: main.wording.en }),
    ).not.toBeInTheDocument();
    expect(screen.getAllByText(/67.0%/).length).toBeGreaterThan(0);
  });

  it("distinguishes a failed fetch and retries into available data", async () => {
    vi.mocked(fetch).mockRejectedValue(new Error("offline"));
    vi.spyOn(console, "warn").mockImplementation(() => {});
    show();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Poll data could not be loaded",
    );
    vi.mocked(fetch).mockImplementation(fetchCorpus);
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(
      await screen.findByRole("table", { name: "All displayed observations" }),
    ).toBeInTheDocument();
  });
  it("restores URL filters and updates the permalink when the round changes", async () => {
    show(
      <PresidentialHistory agencyId="SH" />,
      "/?pollCycle=2021_11_14_pvr&pollRound=2",
    );
    await screen.findByText("Runoff matchup matrix", { selector: "h3" });
    expect(screen.getByLabelText("Round")).toHaveValue("2");
    expect(screen.getByLabelText("Election")).toHaveValue("2021_11_14_pvr");
    expect(
      screen.getByRole("link", { name: "Link to this view" }),
    ).toHaveAttribute("href", "?pollCycle=2021_11_14_pvr&pollRound=2");
    fireEvent.change(screen.getByLabelText("Round"), {
      target: { value: "1" },
    });
    expect(
      screen.getByRole("link", { name: "Link to this view" }),
    ).toHaveAttribute("href", "?pollCycle=2021_11_14_pvr&pollRound=1");
    expect(
      screen.getByText("No published matchups match these filters."),
    ).toBeInTheDocument();
  });
  it("shows unavailable-source coverage even with no accepted agency polls", async () => {
    show(<PresidentialHistory agencyId="GIB" />);
    expect(
      await screen.findByText("Source unavailable at last check"),
    ).toBeInTheDocument();
    expect(screen.getByText("2026-09-25")).toBeInTheDocument();
  });
  it("keeps the 2001 historical gap visible with no accepted surveys", async () => {
    show(<PresidentialHistory cycle="2001_11_11_pvr" />);
    expect(
      await screen.findByText(/No primary-source survey is accepted for 2001/),
    ).toBeInTheDocument();
    expect(
      screen.getByText("No accepted presidential polls for this page."),
    ).toBeInTheDocument();
  });
  it("counts an accepted unassigned survey under the unassigned election filter", async () => {
    show(<PresidentialHistory agencyId="GM" />, "/?pollCycle=unassigned");
    const cell = await screen.findByText("2026-07-11 – 2026-07-11");
    expect(
      within(cell.closest("tr")!).getAllByRole("cell")[2],
    ).toHaveTextContent(/^1$/);
  });
  it("shows accepted-coverage absence separately", async () => {
    show(<PresidentialHistory agencyId="NO_DATA" />);
    expect(
      await screen.findByText("No accepted presidential polls for this page."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
