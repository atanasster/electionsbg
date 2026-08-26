// The obshtina code → name resolver.
//
// WHAT THIS PINS. It backs the /persons chip that names an active `?obshtina` filter, and that
// chip is the ONLY surface where the filter exists — it has no picker. So the two ways this can
// fail are both "a filter is applied and the page cannot say which":
//
//   · Sofia. `municipalities.json` is EKATTE-derived and structurally cannot contain
//     `SFO_CITY`, which is a synthetic bundle — and it is the LARGEST municipality in the
//     corpus (1,315 of 23,469 placed people). A resolver that only reads that file returns
//     nothing for exactly the biggest case.
//   · An unknown code. Returning "" leaves a chip with no text and no way to know what to
//     remove; the code itself is ugly and honest.

import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useObshtinaLabel } from "./useObshtinaLabel";

// The hook is language-aware and there is no i18n instance in unit tests, so the language is
// stubbed rather than inferred. Mutable because `renderProbe` sets it per case.
let language = "bg";
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ i18n: { language } }),
}));

const MUNICIPALITIES = [
  { obshtina: "BGS04", name: "Бургас", name_en: "Burgas", ekatte: "07079" },
  // An EMPTY name_en — the one degenerate value `RegionInfo` permits, since the field is typed
  // as required. It is why the EN branch uses `||` and not `??`: `??` passes "" through and
  // drops the reader to the raw CODE when the Bulgarian name was right there.
  { obshtina: "KRZ16", name: "Кърджали", name_en: "", ekatte: "40909" },
];

const Probe = ({
  code,
  enabled = true,
}: {
  code?: string | null;
  enabled?: boolean;
}) => {
  const label = useObshtinaLabel(enabled);
  return <span data-testid="out">{label(code)}</span>;
};

const renderProbe = (
  code?: string | null,
  { enabled = true, lang = "bg" }: { enabled?: boolean; lang?: string } = {},
) => {
  language = lang;
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(
    <QueryClientProvider client={client}>
      <Probe code={code} enabled={enabled} />
    </QueryClientProvider>,
  );
};

const out = () => screen.getByTestId("out").textContent;

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, json: async () => MUNICIPALITIES })),
  );
});
afterEach(() => vi.unstubAllGlobals());

describe("useObshtinaLabel", () => {
  it("names Sofia, which municipalities.json cannot", async () => {
    // The synthetic bundle. It is not an EKATTE municipality, so the JSON has no row for it —
    // and it carries more people than any real one.
    renderProbe("SFO_CITY");
    await vi.waitFor(() => expect(out()).toBe("Столична община"));
  });

  it("folds SOF00 — the code the governance dashboards route on — onto Sofia", async () => {
    // A reader can arrive on `?obshtina=SOF00` from a hand-built link. It matches 0 rows in the
    // corpus (which says SFO_CITY), so echoing it would name a filter that selected nothing.
    renderProbe("SOF00");
    await vi.waitFor(() => expect(out()).toBe("Столична община"));
  });

  it("folds the shard code SOF too", async () => {
    renderProbe("SOF");
    await vi.waitFor(() => expect(out()).toBe("Столична община"));
  });

  it("names an ordinary EKATTE municipality", async () => {
    renderProbe("BGS04");
    await vi.waitFor(() => expect(out()).toBe("Бургас"));
  });

  it("falls back to the CODE for an unknown one, never to nothing", async () => {
    // An empty chip is a filter applied and named nowhere — the state the chip exists to end.
    renderProbe("ZZZ99");
    await vi.waitFor(() => expect(out()).toBe("ZZZ99"));
  });

  it("shows the code while municipalities.json is still in flight", () => {
    // Not "", so the chip is legible from its first paint.
    renderProbe("BGS04");
    expect(out()).toBe("BGS04");
  });

  it("names an ordinary municipality in ENGLISH", async () => {
    renderProbe("BGS04", { lang: "en" });
    await vi.waitFor(() => expect(out()).toBe("Burgas"));
  });

  it("falls back to the BULGARIAN name when name_en is empty, not to the code", async () => {
    // `RegionInfo.name_en` is typed as required, so "" is the only degenerate value that can
    // reach the fallback — and `??` would pass it straight through to the code.
    renderProbe("KRZ16", { lang: "en" });
    await vi.waitFor(() => expect(out()).toBe("Кърджали"));
  });

  it("names Sofia in English too", async () => {
    renderProbe("SFO_CITY", { lang: "en" });
    await vi.waitFor(() => expect(out()).toBe("Sofia (capital municipality)"));
  });

  it("fetches nothing while disabled, and resolves once enabled flips", async () => {
    // The deferral's `false → true` transition is the one thing it could get wrong: a caller
    // may mount with no filter and gain one later. React Query's `enabled` is reactive, so the
    // label must sharpen from the code to the name rather than sticking.
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });
    language = "bg";
    const { rerender } = render(
      <QueryClientProvider client={client}>
        <Probe code="BGS04" enabled={false} />
      </QueryClientProvider>,
    );
    expect(out()).toBe("BGS04");
    expect(fetch).not.toHaveBeenCalled();

    rerender(
      <QueryClientProvider client={client}>
        <Probe code="BGS04" enabled />
      </QueryClientProvider>,
    );
    await vi.waitFor(() => expect(out()).toBe("Бургас"));
  });

  it("returns an empty string for no code at all", () => {
    // Distinct from the fallback above: there is nothing to name, so there is no chip either.
    renderProbe(null);
    expect(out()).toBe("");
  });
});
