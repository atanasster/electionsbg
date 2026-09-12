import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import type { Envelope } from "../tools/types";
import { AnswerView } from "../render/AnswerView";

describe("AnswerView table entity links", () => {
  it("links company names inside scalar person facts", () => {
    const env: Envelope = {
      tool: "personProfile",
      domain: "people",
      kind: "scalar",
      title: "ВЕРОНИКА ЯВОРОВА СТЕФАНОВА — 1 фирма",
      facts: {
        име: "ВЕРОНИКА ЯВОРОВА СТЕФАНОВА",
        "фирми — по съвпадение на име": "БУЛГЕД",
      },
      factLinks: [
        {
          fact: "фирми — по съвпадение на име",
          text: "БУЛГЕД",
          href: "/company/123456789",
        },
      ],
      viz: "none",
      provenance: [],
    };

    render(
      <MemoryRouter>
        <AnswerView env={env} />
      </MemoryRouter>,
    );

    expect(screen.getByRole("link", { name: "БУЛГЕД" })).toHaveAttribute(
      "href",
      "/company/123456789",
    );
  });

  it("links a company-profile EIK to the company page", () => {
    const env: Envelope = {
      tool: "companyProfile",
      domain: "people",
      kind: "table",
      title: "Провиотик",
      columns: [
        { key: "metric", label: "Показател" },
        { key: "value", label: "Стойност" },
      ],
      rows: [{ metric: "ЕИК", value: "202930997" }],
      cellLinks: [
        {
          row: 0,
          column: "value",
          text: "202930997",
          href: "/company/202930997",
        },
      ],
      viz: "none",
      facts: { eik_id: "202930997" },
      provenance: [],
    };

    render(
      <MemoryRouter>
        <AnswerView
          env={env}
          narration="Компанията Провиотик е с ЕИК 202930997."
        />
      </MemoryRouter>,
    );

    const eikLinks = screen.getAllByRole("link", { name: "202930997" });
    expect(eikLinks).toHaveLength(2);
    for (const link of eikLinks)
      expect(link).toHaveAttribute("href", "/company/202930997");
  });

  it("renders person and company names as internal links", () => {
    const env: Envelope = {
      tool: "companyConnections",
      domain: "people",
      kind: "table",
      title: "Връзки",
      columns: [
        { key: "person", label: "Лице" },
        { key: "link", label: "Връзка" },
      ],
      rows: [
        {
          person: "Мирослава Петрова Петрова",
          link: "чрез Мартин Петров Драгулев → Да запазим Корал",
        },
      ],
      cellLinks: [
        {
          row: 0,
          column: "person",
          text: "Мирослава Петрова Петрова",
          href: "/person/miroslava-petrova",
        },
        {
          row: 0,
          column: "link",
          text: "Мартин Петров Драгулев",
          href: "/person/%D0%9C%D0%B0%D1%80%D1%82%D0%B8%D0%BD",
        },
        {
          row: 0,
          column: "link",
          text: "Да запазим Корал",
          href: "/company/123456789",
        },
      ],
      viz: "none",
      facts: { eik_id: "202930997" },
      provenance: [],
    };

    render(
      <MemoryRouter>
        <AnswerView env={env} />
      </MemoryRouter>,
    );

    expect(
      screen.getByRole("link", { name: "Мирослава Петрова Петрова" }),
    ).toHaveAttribute("href", "/person/miroslava-petrova");
    expect(
      screen.getByRole("link", { name: "Мартин Петров Драгулев" }),
    ).toHaveAttribute("href", "/person/%D0%9C%D0%B0%D1%80%D1%82%D0%B8%D0%BD");
    expect(
      screen.getByRole("link", { name: "Да запазим Корал" }),
    ).toHaveAttribute("href", "/company/123456789");
  });
});
