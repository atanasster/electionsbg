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

const mount = () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes("data_map.json")) {
        return { ok: true, status: 200, json: async () => MANIFEST };
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

afterEach(() => vi.unstubAllGlobals());

describe("DataSources", () => {
  it("renders one tile per source node, grouped by section — never a dataset node", async () => {
    mount();
    await waitFor(() => expect(screen.getByText("Test A")).toBeInTheDocument());

    expect(screen.getByText("Elections")).toBeInTheDocument();
    expect(screen.getByText("Public money")).toBeInTheDocument();
    expect(screen.getByText("Test A")).toBeInTheDocument();
    expect(screen.getByText("Test B")).toBeInTheDocument();
    expect(screen.getByText("Test C")).toBeInTheDocument();
    expect(screen.queryByText("Not a source")).not.toBeInTheDocument();
  });

  it("narrows the list when typing in the search box", async () => {
    mount();
    await waitFor(() => expect(screen.getByText("Test A")).toBeInTheDocument());

    await userEvent.type(screen.getByLabelText("Search sources"), "Test A");

    expect(screen.getByText("Test A")).toBeInTheDocument();
    expect(screen.queryByText("Test B")).not.toBeInTheDocument();
    expect(screen.queryByText("Test C")).not.toBeInTheDocument();
  });

  it("filters by origin pill", async () => {
    mount();
    await waitFor(() => expect(screen.getByText("Test A")).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: "EU" }));

    expect(screen.queryByText("Test A")).not.toBeInTheDocument();
    expect(screen.getByText("Test B")).toBeInTheDocument();
    expect(screen.queryByText("Test C")).not.toBeInTheDocument();
  });

  it("filters to issue-bearing nodes with the issues-only pill, and renders the issue text", async () => {
    mount();
    await waitFor(() => expect(screen.getByText("Test A")).toBeInTheDocument());

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
    mount();
    await waitFor(() => expect(screen.getByText("Test C")).toBeInTheDocument());

    // Test C has no `origin` field — must read "Unknown origin", never one of
    // the four real origin labels (the FINDING-002 regression).
    expect(screen.getByText("Unknown origin")).toBeInTheDocument();
  });
});
