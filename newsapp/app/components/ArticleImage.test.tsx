// ArticleImage — the credit and the fallback ladder.
//
// ⚠️ The credit is the reason this component exists rather than an <img> tag.
// Credit is always required by our presentation policy, but is not itself a
// licence. Rights eligibility and CDN delivery are separate gates.

import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ArticleImage } from "./ArticleImage";
import { initialStage, monogramOf } from "./imageFallback";

const rights = (
  over: Partial<NonNullable<Parameters<typeof ArticleImage>[0]["rights"]>> = {},
) => ({
  status: "cc" as const,
  creator: "Иван Иванов",
  credit_text: "Снимка: Иван Иванов / CC BY 4.0",
  credit_url: "https://photos.example/ivan",
  licence_name: "CC BY 4.0",
  licence_url: "https://creativecommons.org/licenses/by/4.0/",
  source_url: "https://ex.bg/a/1",
  checked_at: "2026-08-28",
  display_home: true,
  ...over,
});

const outlet = (
  over: Partial<Parameters<typeof ArticleImage>[0]["outlet"]> = {},
) => ({
  domain: "ex.bg",
  outlet: "Примерен вестник",
  logo: "https://ex.bg/logo.png",
  hotlink_ok: null as boolean | null,
  ...over,
});

const renderImage = (props: Partial<Parameters<typeof ArticleImage>[0]> = {}) =>
  render(
    <ArticleImage
      image="https://cdn.ex.bg/photo.jpg"
      articleUrl="https://ex.bg/a/1"
      outlet={outlet()}
      rights={rights()}
      {...props}
    />,
  );

// Decorative images intentionally have no accessible `img` role. These tests
// inspect the DOM element because they verify delivery/fallback mechanics.
const imageElement = () =>
  document.querySelector("img") as HTMLImageElement | null;
const requiredImage = () => {
  const image = imageElement();
  expect(image).not.toBeNull();
  return image!;
};

// ⚠️ toBeVisible, never toBeInTheDocument. A review proved that adding
// `hidden` to the credit anchor left all 19 tests green — and an invisible
// credit is not a credit. Presence is not the presentation condition; visibility is.
describe("the credit", () => {
  it("renders on a photo", () => {
    renderImage();
    expect(screen.getByText("Снимка: Иван Иванов / CC BY 4.0")).toBeVisible();
  });

  it("renders when there is NO image at all", () => {
    // The monogram rung. A card with no photo still shows an outlet's work.
    renderImage({ image: null, outlet: outlet({ logo: null }) });
    expect(screen.getByText("Примерен вестник")).toBeVisible();
    expect(imageElement()).not.toBeInTheDocument();
  });

  it("renders on the logo rung", () => {
    renderImage({ image: null });
    expect(screen.getByText("Примерен вестник")).toBeVisible();
  });

  it("uses the recorded creator credit and link instead of inventing outlet copyright", () => {
    renderImage();
    const link = screen
      .getByText("Снимка: Иван Иванов / CC BY 4.0")
      .closest("a");
    expect(link).toHaveAttribute("href", "https://photos.example/ivan");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", expect.stringContaining("noopener"));
  });

  it("keeps the credit source and licence conditions as separate links", () => {
    renderImage();
    const credit = screen.getByRole("link", {
      name: /Кредит за изображението/,
    });
    expect(credit).toHaveAttribute("href", "https://photos.example/ivan");
    expect(credit).toHaveClass("focus-visible:ring-foreground");
    const licence = screen.getByRole("link", {
      name: /Условия на лиценза: CC BY 4.0/,
    });
    expect(licence).toHaveTextContent("CC BY 4.0");
    expect(licence).toHaveClass("focus-visible:ring-foreground");
    expect(licence).toHaveAttribute(
      "href",
      "https://creativecommons.org/licenses/by/4.0/",
    );
  });

  it("allows long unbroken card credits to wrap without clipping", () => {
    const { container } = renderImage({ creditVariant: "compact" });
    expect(
      screen.getByRole("link", { name: /Кредит за изображението/ }),
    ).toHaveClass(
      "min-w-0",
      "max-w-full",
      "break-words",
      "[overflow-wrap:anywhere]",
    );
    expect(container.querySelector("figcaption")).toHaveClass(
      "news-image-credit--compact",
      "text-[11px]",
    );
  });

  it("does not apply compact styling to full detail attribution", () => {
    const { container } = renderImage();
    expect(container.querySelector("figcaption")).not.toHaveClass(
      "news-image-credit--compact",
    );
    expect(container.querySelector("figcaption")).toHaveClass(
      "text-xs",
      "text-card-foreground",
    );
  });

  it("falls back to the outlet's site for a logo when the article URL is missing", () => {
    renderImage({ image: null, articleUrl: null });
    expect(
      screen.getByRole("link", { name: /към сайта на медията/ }),
    ).toHaveAttribute("href", "https://ex.bg/");
  });

  it("names the domain when the outlet has no display name", () => {
    renderImage({ image: null, outlet: outlet({ outlet: "" }) });
    expect(screen.getByText("ex.bg")).toBeVisible();
  });
});

describe("the fallback ladder", () => {
  it("starts on the photo when nothing says otherwise", () => {
    renderImage();
    expect(requiredImage()).toHaveAttribute(
      "src",
      "https://cdn.ex.bg/photo.jpg",
    );
  });

  it("drops to the logo when the photo fails to load", () => {
    // ⚠️ Measured: 3 of 13 outlets refuse a request carrying our referer, and
    // the failure is per-request — nothing at build time can predict it.
    renderImage();
    fireEvent.error(requiredImage());
    expect(requiredImage()).toHaveAttribute("src", "https://ex.bg/logo.png");
    expect(requiredImage()).toHaveAttribute("alt", "");
    expect(screen.getByText("Примерен вестник")).toBeVisible();
  });

  it("drops to the monogram when the logo fails too", () => {
    renderImage();
    fireEvent.error(requiredImage());
    fireEvent.error(requiredImage());
    expect(imageElement()).not.toBeInTheDocument();
    expect(screen.getByText("ПВ")).toBeInTheDocument();
  });

  it("goes straight to the monogram when a failing photo has no logo behind it", () => {
    renderImage({ outlet: outlet({ logo: null }) });
    fireEvent.error(requiredImage());
    expect(imageElement()).not.toBeInTheDocument();
  });
});

describe("the hotlink verdict", () => {
  it("skips the photo when the outlet has refused us", () => {
    // A 403 is a policy signal. Re-requesting on every card is pointless and
    // rude, and the logo says the same thing without asking again.
    renderImage({ outlet: outlet({ hotlink_ok: false }) });
    expect(requiredImage()).toHaveAttribute("src", "https://ex.bg/logo.png");
  });

  it("still tries when the outlet was never probed", () => {
    // ⚠️ null is NOT false. A wrong `false` permanently suppresses images an
    // outlet is happy to serve; a wrong `true` costs one request that onError
    // already handles.
    renderImage({ outlet: outlet({ hotlink_ok: null }) });
    expect(requiredImage()).toHaveAttribute(
      "src",
      "https://cdn.ex.bg/photo.jpg",
    );
  });

  it("tries when the outlet has accepted us", () => {
    renderImage({ outlet: outlet({ hotlink_ok: true }) });
    expect(requiredImage()).toHaveAttribute(
      "src",
      "https://cdn.ex.bg/photo.jpg",
    );
  });
});

describe("the request itself", () => {
  it("sends a referer rather than hiding who is asking", () => {
    // ⚠️ NOT "no-referrer". Stripping it would "fix" a 403 by concealing the
    // requester, which is the opposite of what an attributing link is for.
    renderImage();
    expect(requiredImage()).toHaveAttribute(
      "referrerpolicy",
      "no-referrer-when-downgrade",
    );
  });

  it("lazy-loads, so a 600-item feed does not fetch 600 photos", () => {
    renderImage();
    expect(requiredImage()).toHaveAttribute("loading", "lazy");
  });

  it("loads only an explicitly prioritized lead eagerly", () => {
    renderImage({ priority: true });
    expect(requiredImage()).toHaveAttribute("loading", "eager");
    expect(requiredImage()).toHaveAttribute("fetchpriority", "high");
  });

  it("uses a trimmed source description and otherwise avoids repeating the heading", () => {
    renderImage({ imageAlt: null });
    expect(requiredImage()).toHaveAttribute("alt", "");
    renderImage({ imageAlt: "  Надпис от изданието  " });
    expect(document.querySelectorAll("img")[1]).toHaveAttribute(
      "alt",
      "Надпис от изданието",
    );
    renderImage({ imageAlt: "   " });
    expect(document.querySelectorAll("img")[2]).toHaveAttribute("alt", "");
  });
});

describe("recycling", () => {
  it("re-tries the photo when the card is reused for another article", () => {
    // A list re-render can hand this component a new article; a stage left on
    // "monogram" from the previous one would suppress a perfectly good photo.
    const { rerender } = renderImage();
    fireEvent.error(requiredImage());
    fireEvent.error(requiredImage());
    expect(imageElement()).not.toBeInTheDocument();
    rerender(
      <ArticleImage
        image="https://cdn.ex.bg/other.jpg"
        articleUrl="https://ex.bg/a/2"
        outlet={outlet()}
        rights={rights({ source_url: "https://ex.bg/a/2" })}
      />,
    );
    expect(requiredImage()).toHaveAttribute(
      "src",
      "https://cdn.ex.bg/other.jpg",
    );
  });
});

describe("the pure helpers", () => {
  it("builds a two-letter monogram", () => {
    expect(monogramOf("Примерен вестник")).toBe("ПВ");
    expect(monogramOf("Дневник")).toBe("ДН");
    expect(monogramOf("  ")).toBe("??");
    expect(monogramOf("24 часа")).toBe("2Ч");
  });

  it("picks the starting rung", () => {
    expect(initialStage("img", null, "logo")).toBe("photo");
    expect(initialStage("img", true, "logo")).toBe("photo");
    expect(initialStage("img", false, "logo")).toBe("logo");
    expect(initialStage("img", false, null)).toBe("monogram");
    expect(initialStage(null, true, "logo")).toBe("logo");
    expect(initialStage(null, true, null)).toBe("monogram");
    expect(initialStage(undefined, undefined, undefined)).toBe("monogram");
  });
});
