import { expect, it } from "vitest";
import { homePreviewParagraph } from "./routes";

it.each(["bg", "en"] as const)(
  "replaces the slideshow with localized chat artwork and links (%s)",
  (lang) => {
    const html = homePreviewParagraph(lang, true);
    const prefix = lang === "en" ? "/en" : "";
    expect(html).toContain(`https://electionsbg.com${prefix}/chat`);
    expect(html).toContain(
      `https://electionsbg.com${prefix}/articles/2026-09-10-popitai-naiasno`,
    );
    expect(html).toContain("/images/chat/invitation.webp");
    expect(html).not.toContain("/flyover/");
    expect(homePreviewParagraph(lang, false)).toContain(
      "/flyover/columns.webp",
    );
    expect(homePreviewParagraph(lang, false)).not.toContain("/chat");
  },
);
