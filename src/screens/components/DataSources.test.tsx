// Manifest-driven, so the fixture below is a small hand-built DataMapManifest
// rather than real data — the real content is covered by model.test.ts's own
// SOURCE_GROUPS assertions (issue shape, url well-formedness). This file
// exercises the WIRING: does DataSources render one tile per source node,
// grouped by its primary tag, and do the three filter controls actually
// filter — plus the FINDING-002 regression (an origin-less node must not
// assert a specific country).
//
// react-i18next is mocked onto the real EN corpus (same pattern as
// BudgetMinistryScreen.test.tsx, English side) — real i18next needs its
// async init to resolve before `t()` returns anything but the bare key, and
// nothing here waits on that. Every literal asserted below is the EN string.

import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { enCorpus } from "@/locales/allKeys";
import type { DataMapNode } from "@/data/dataMap/useDataMap";
import { DataSources } from "./DataSources";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    i18n: { language: "en" },
    t: (k: string) => (enCorpus as Record<string, string>)[k] ?? k,
  }),
}));

const MANIFEST = {
  version: 3,
  generatedAt: "2026-09-02T00:00:00.000Z",
  views: [
    {
      id: "elections",
      label: { bg: "Избори", en: "Elections" },
      tag: "elections",
    },
    {
      id: "fiscal",
      label: { bg: "Публични пари", en: "Public money" },
      tag: "fiscal",
    },
  ],
  tiers: [],
  tours: [],
  links: [],
  edges: [],
  nodes: [
    {
      id: "src:a",
      kind: "source",
      label: { bg: "Тест А", en: "Test A" },
      detail: { bg: "", en: "" },
      desc: { bg: "Описание А", en: "Description A" },
      tags: ["elections"],
      origin: "state",
      url: "https://a.example.bg/",
      skills: [],
      freshness: "2026-01-01T00:00:00.000Z",
      x: 0,
      y: 0,
      w: 0,
      h: 0,
    },
    {
      id: "src:b",
      kind: "source",
      label: { bg: "Тест Б", en: "Test B" },
      detail: { bg: "", en: "" },
      desc: { bg: "Описание Б", en: "Description B" },
      tags: ["fiscal"],
      origin: "eu",
      url: "https://b.example.eu/",
      skills: [],
      issue: {
        label: { bg: "Проблем", en: "Known issue" },
        note: { bg: "Бележка за проблема", en: "A note about the issue" },
      },
      x: 0,
      y: 0,
      w: 0,
      h: 0,
    },
    {
      id: "src:c",
      kind: "source",
      label: { bg: "Тест В", en: "Test C" },
      detail: { bg: "", en: "" },
      desc: { bg: "Описание В", en: "Description C" },
      tags: ["fiscal"],
      // No `origin` at all — the FINDING-002 regression case.
      url: "https://c.example.org/",
      skills: [],
      x: 0,
      y: 0,
      w: 0,
      h: 0,
    },
    {
      id: "ds:not-a-source",
      kind: "dataset",
      label: { bg: "Не е източник", en: "Not a source" },
      detail: { bg: "", en: "" },
      desc: { bg: "", en: "" },
      tags: ["fiscal"],
      x: 0,
      y: 0,
      w: 0,
      h: 0,
    },
  ],
};

/** `manifest: null` leaves the data_map.json fetch permanently pending, for
 *  the loading-state test — never resolving is the only reliable way to
 *  observe the isLoading branch rather than racing a real resolution. */
const mount = (manifest: unknown = MANIFEST) => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes("data_map.json")) {
        if (manifest === null) return new Promise(() => {});
        return { ok: true, status: 200, json: async () => manifest };
      }
      if (u.includes("data-changes.json")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            updatedAt: "2026-09-02T00:00:00.000Z",
            entries: [],
          }),
        };
      }
      return { ok: false, status: 404, json: async () => null };
    }),
  );
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
  return render(<DataSources />, { wrapper: Wrapper });
};

/** A minimal one-node manifest, for tests that want a fixture unentangled
 *  from MANIFEST's section/filter-count assertions above. */
const soloManifest = (node: DataMapNode) => ({
  version: 3,
  generatedAt: "2026-09-02T00:00:00.000Z",
  views: [
    {
      id: "fiscal",
      label: { bg: "Публични пари", en: "Public money" },
      tag: "fiscal",
    },
  ],
  tiers: [],
  tours: [],
  links: [],
  edges: [],
  nodes: [node],
});

/** `mount()` + waiting for the fixture's first tile to appear, repeated at
 *  the top of nearly every test below — collapsed to one call. */
const mountAndSettle = async (
  settleText = "Test A",
  manifest: unknown = MANIFEST,
) => {
  const result = mount(manifest);
  await waitFor(() => expect(screen.getByText(settleText)).toBeInTheDocument());
  return result;
};

afterEach(() => vi.unstubAllGlobals());

describe("DataSources", () => {
  it("renders one tile per source node, grouped by section — never a dataset node", async () => {
    await mountAndSettle();

    expect(screen.getByText("Elections")).toBeInTheDocument();
    expect(screen.getByText("Public money")).toBeInTheDocument();
    expect(screen.getByText("Test A")).toBeInTheDocument();
    expect(screen.getByText("Test B")).toBeInTheDocument();
    expect(screen.getByText("Test C")).toBeInTheDocument();
    expect(screen.queryByText("Not a source")).not.toBeInTheDocument();
  });

  it("narrows the list when typing in the search box", async () => {
    await mountAndSettle();

    await userEvent.type(screen.getByLabelText("Search sources"), "Test A");

    expect(screen.getByText("Test A")).toBeInTheDocument();
    expect(screen.queryByText("Test B")).not.toBeInTheDocument();
    expect(screen.queryByText("Test C")).not.toBeInTheDocument();
  });

  it("filters by origin pill", async () => {
    await mountAndSettle();

    await userEvent.click(screen.getByRole("button", { name: "EU" }));

    expect(screen.queryByText("Test A")).not.toBeInTheDocument();
    expect(screen.getByText("Test B")).toBeInTheDocument();
    expect(screen.queryByText("Test C")).not.toBeInTheDocument();
  });

  it("filters to issue-bearing nodes with the issues-only pill, and renders the issue text", async () => {
    await mountAndSettle();

    await userEvent.click(
      screen.getByRole("button", { name: "Known caveats only" }),
    );

    expect(screen.queryByText("Test A")).not.toBeInTheDocument();
    expect(screen.getByText("Test B")).toBeInTheDocument();
    expect(screen.queryByText("Test C")).not.toBeInTheDocument();
    expect(screen.getByText("Known issue")).toBeInTheDocument();
    expect(screen.getByText("A note about the issue")).toBeInTheDocument();
  });

  it("labels an origin-less node as unknown rather than asserting a specific country", async () => {
    await mountAndSettle("Test C");

    // Test C has no `origin` field — must read "Unknown origin", never one of
    // the four real origin labels (the FINDING-002 regression).
    expect(screen.getByText("Unknown origin")).toBeInTheDocument();
  });

  it("labels a node with no freshness signal as manually maintained", async () => {
    await mountAndSettle("Test C");

    // Test C carries neither a baked `freshness` nor any `skills` a
    // data-changes.json entry could match — dataMapFreshnessTier must read
    // that as "static", not silently fall through to some other bucket.
    // Test B is ALSO static (issue-bearing but no freshness/skills either),
    // plus the legend strip's own dot — three occurrences total.
    expect(screen.getAllByText("manually maintained")).toHaveLength(3);
  });

  it("shows a loading skeleton before the manifest resolves", () => {
    mount(null);

    // Six placeholder blocks, no tile content and no section heading yet —
    // the isLoading branch, not a flash of the empty state.
    expect(document.querySelectorAll(".animate-pulse")).toHaveLength(6);
    expect(screen.queryByText("Elections")).not.toBeInTheDocument();
  });

  it("shows the empty-state message and announces zero results when nothing matches", async () => {
    await mountAndSettle();

    await userEvent.type(
      screen.getByLabelText("Search sources"),
      "no such source",
    );

    expect(
      screen.getByText(
        "Nothing matches — try a different word, or widen the filters above.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("shown now: 0");
  });

  it("combines the search term and the origin filter (AND, not OR)", async () => {
    await mountAndSettle();

    // "Test" matches all three; the EU pill alone narrows to Test B. Typing
    // a term that matches ONLY Test A while EU stays selected must therefore
    // hide Test A too, not fall back to widening on the text match alone.
    await userEvent.click(screen.getByRole("button", { name: "EU" }));
    await userEvent.type(screen.getByLabelText("Search sources"), "Test A");

    expect(screen.queryByText("Test A")).not.toBeInTheDocument();
    expect(screen.queryByText("Test B")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("shown now: 0");
  });

  it("hides a section entirely once none of its tiles match the filter", async () => {
    await mountAndSettle();

    // Elections' only member is Test A (origin "state") — filtering to EU
    // must drop the WHOLE section, not just leave an empty heading behind.
    await userEvent.click(screen.getByRole("button", { name: "EU" }));

    expect(screen.queryByText("Elections")).not.toBeInTheDocument();
    expect(screen.getByText("Public money")).toBeInTheDocument();
  });

  it("falls back to the raw string when a node's url is not a well-formed absolute URL", async () => {
    mount(
      soloManifest({
        id: "src:bad-url",
        kind: "source",
        label: { bg: "Лош адрес", en: "Bad URL" },
        detail: { bg: "", en: "" },
        desc: { bg: "", en: "" },
        tags: ["fiscal"],
        origin: "state",
        // Deliberately not a well-formed absolute URL — `new URL()` throws on
        // this. Must not blank the page (FINDING-003).
        url: "not-a-valid-url",
        skills: [],
        x: 0,
        y: 0,
        w: 0,
        h: 0,
      }),
    );

    await waitFor(() =>
      expect(screen.getByText("Bad URL")).toBeInTheDocument(),
    );
    expect(screen.getByText("not-a-valid-url")).toBeInTheDocument();
  });
});
