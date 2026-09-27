import { expect, it } from "vitest";
import { homePreviewParagraph } from "./routes";
import { SITE_ORIGIN } from "@/lib/siteOrigin";

it.each(["bg", "en"] as const)(
  "renders the localized chat artwork and links (%s)",
  (lang) => {
    const html = homePreviewParagraph(lang);
    const prefix = lang === "en" ? "/en" : "";
    expect(html).toContain(`${SITE_ORIGIN}${prefix}/chat`);
    expect(html).toContain(
      `${SITE_ORIGIN}${prefix}/articles/2026-09-10-popitai-naiasno`,
    );
    expect(html).toContain("/images/chat/invitation.webp");
    expect(html).not.toContain("/flyover/");
  },
);
