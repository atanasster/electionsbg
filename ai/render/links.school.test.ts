import { describe, expect, it } from "vitest";
import { siteLinks } from "./links";
import type { Envelope } from "../tools/types";

describe("school answer site link", () => {
  it("links a resolved school answer to its full school page", () => {
    const env: Envelope = {
      tool: "schoolMatura",
      domain: "indicators",
      kind: "scalar",
      title: "СУ Св. св. Кирил и Методий",
      viz: "none",
      facts: { school_id: "107090" },
      provenance: ["education-payload"],
    };

    expect(siteLinks(env)).toContainEqual({
      label: {
        bg: "Училище — пълен профил",
        en: "School — full profile",
      },
      href: "https://naiasno.bg/school/107090",
    });
  });

  it("does not invent a school link before disambiguation", () => {
    const env: Envelope = {
      tool: "schoolMatura",
      domain: "indicators",
      kind: "scalar",
      title: "Кое училище имате предвид?",
      viz: "none",
      facts: {},
      provenance: ["education-payload"],
    };

    expect(siteLinks(env).some((link) => link.href.includes("/school/"))).toBe(
      false,
    );
  });
});
