import { describe, expect, it } from "vitest";
import type { ArticleRecord, ImageRights } from "../data";
import { canDisplayHomeImage } from "./imageRights";

const rights = (status: ImageRights["status"], display_home: boolean) => ({
  status,
  display_home,
  creator: null,
  credit_text: "Credit",
  credit_url: "https://example.org/credit",
  licence_name: "Basis",
  licence_url: "https://example.org/basis",
  source_url: "https://example.org/source",
  checked_at: "2026-08-28",
});

describe("ArticleCard home image gate", () => {
  it.each([
    ["missing review", undefined, false],
    ["unknown even if flag is malformed", rights("unknown", true), false],
    ["blocked even if flag is malformed", rights("blocked", true), false],
    ["permitted but held", rights("cc", false), false],
    ["explicitly cleared", rights("cc", true), true],
    ["publisher permission", rights("publisher_permission", true), true],
    ["licensed", rights("licensed", true), true],
    ["public domain", rights("public_domain", true), true],
    ["official reuse policy", rights("official_reuse_policy", true), true],
    [
      "invented positive status",
      rights("pirated" as ImageRights["status"], true),
      false,
    ],
  ])("%s", (_label, image_rights, expected) => {
    const article = {
      image: "https://example.org/photo.jpg",
      image_rights,
    } as ArticleRecord;
    expect(canDisplayHomeImage(article)).toBe(expected);
  });

  it("requires an actual image even with a permitted decision", () => {
    expect(
      canDisplayHomeImage({
        image: null,
        image_rights: rights("cc", true),
      } as ArticleRecord),
    ).toBe(false);
  });
});
