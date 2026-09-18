// The "how this was produced" band must never credit Jev for a turn Jev did not
// route. That is an honesty requirement, not a cosmetic one: routing through
// Jev is a hosted model call, and the No-LLM lane's whole promise is that the
// reader can tell what produced an answer.
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { AnswerView } from "../render/AnswerView";
import { JEV_FALLBACK_LABEL, JEV_LABEL } from "../llm/jev";
import type { ResponseMeta } from "../llm/provider";
import type { Envelope } from "../tools/types";

const env: Envelope = {
  tool: "turnout",
  domain: "elections",
  kind: "scalar",
  title: "Избирателна активност",
  facts: { активност: "38.9%" },
  viz: "none",
  provenance: [],
};

const show = (meta: ResponseMeta, lang: "bg" | "en" = "bg") =>
  render(
    <MemoryRouter>
      <AnswerView env={env} lang={lang} meta={meta} />
    </MemoryRouter>,
  );

const base: ResponseMeta = {
  model: JEV_LABEL,
  durationMs: 820,
  narratedBy: "rules",
};

describe("routing meta in the answer band", () => {
  it("names Jev and its confidence when Jev actually routed", () => {
    show({
      ...base,
      routedBy: "jev",
      routerConfidence: 0.93,
      routerLatencyMs: 410,
    });
    expect(screen.getByText(/избран от Jev 93%/)).toBeTruthy();
  });

  it("says Jev found nothing, rather than that it chose a tool, on a decline", () => {
    // A decline is Jev's decision — but no tool ran, so the tooltip must not
    // describe a choice that never happened.
    const { container } = show({
      ...base,
      routedBy: "jev",
      routerConfidence: 0.98,
      routerDeclined: true,
    });
    const title = container.querySelector("span[title]")?.getAttribute("title");
    expect(title).toMatch(/няма подходящ инструмент/);
    expect(title).not.toMatch(/Инструментът е избран от Jev/);
  });

  it("says Jev asked for details, not that it chose a tool, on a clarifying turn", () => {
    // No tool ran: the lane asked the user for a value it could not supply.
    const { container } = show({
      ...base,
      routedBy: "jev",
      routerConfidence: 0.95,
      routerAskedUser: true,
    });
    const title = container.querySelector("span[title]")?.getAttribute("title");
    expect(title).toMatch(/липсват подробности/);
    expect(title).not.toMatch(/Инструментът е избран от Jev/);
  });

  it("shows no Jev badge on a degraded turn, and names what answered instead", () => {
    const { container } = show({
      ...base,
      model: JEV_FALLBACK_LABEL,
      routedBy: "rules",
      routerDegraded: true,
    });
    // The badge must be absent — a turn Jev did not route may not carry its name.
    expect(container.textContent).not.toMatch(/избран от Jev/);
    const line = container.querySelector("span[title]");
    expect(line?.getAttribute("title")).toMatch(/Jev не отговори навреме/);
    // …and the lane label itself drops the Jev name on that turn.
    expect(line?.textContent).toContain("Без LLM");
    expect(line?.textContent).not.toContain("Jev");
  });

  it("shows no routing badge at all when Jev was never consulted", () => {
    const { container } = show({ ...base, model: JEV_FALLBACK_LABEL });
    expect(container.textContent).not.toMatch(/Jev/);
    expect(
      container.querySelector("span[title]")?.getAttribute("title"),
    ).not.toMatch(/Jev/);
  });

  it("leaves the existing cloud-model band untouched", () => {
    // A Gemini turn has no routedBy, so the band must read exactly as before.
    const { container } = show({
      model: { bg: "Gemini 3.5 Flash-Lite", en: "Gemini 3.5 Flash-Lite" },
      durationMs: 1400,
      narratedBy: "model",
      inputTokens: 900,
      outputTokens: 120,
    });
    const line = container.querySelector("span[title]");
    expect(line?.textContent).toMatch(/^Gemini 3\.5 Flash-Lite · /);
    expect(line?.getAttribute("title")).toMatch(
      /Токени: 900 вход \/ 120 изход/,
    );
    expect(line?.getAttribute("title")).not.toMatch(/Jev/);
  });

  it("keeps the trust line on every variant", () => {
    // The numbers are computed either way — a Jev-routed turn still narrates
    // from templates, so this assurance must not quietly disappear.
    for (const meta of [
      base,
      { ...base, routedBy: "jev" as const, routerConfidence: 0.9 },
      { ...base, routedBy: "rules" as const, routerDegraded: true },
    ]) {
      const { container, unmount } = show(meta);
      expect(
        container.querySelector("span[title]")?.getAttribute("title"),
      ).toMatch(/не са генерирани/);
      unmount();
    }
  });

  it("renders the English band in English", () => {
    const { container } = show(
      { ...base, model: JEV_LABEL, routedBy: "jev", routerConfidence: 0.88 },
      "en",
    );
    const line = container.querySelector("span[title]");
    expect(line?.textContent).toMatch(/routed by Jev 88%/);
    expect(line?.getAttribute("title")).toMatch(/Tool chosen by Jev/);
  });
});
