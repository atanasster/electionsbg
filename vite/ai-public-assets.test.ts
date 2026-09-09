import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  assertAiOutput,
  AI_EXPECTED_OUTPUT_ENTRIES,
  AI_PUBLIC_ASSETS,
  AI_SEO_IMAGES,
  copyAiPublicAssets,
  copyAiSeoImages,
} from "./ai-public-assets";

const temporary: string[] = [];
afterEach(() => {
  for (const dir of temporary.splice(0))
    fs.rmSync(dir, { recursive: true, force: true });
});

const temp = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ai-public-assets-"));
  temporary.push(dir);
  return dir;
};

describe("AI production public assets", () => {
  it("copies only the declared files and font directory", () => {
    const source = temp();
    const output = temp();
    for (const relative of AI_PUBLIC_ASSETS) {
      const target = path.join(source, relative);
      if (relative === "fonts") {
        fs.mkdirSync(target, { recursive: true });
        fs.writeFileSync(path.join(target, "fonts.css"), "font");
      } else {
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, relative);
      }
    }
    fs.mkdirSync(path.join(source, "data"));
    fs.writeFileSync(path.join(source, "data", "large.json"), "do not copy");

    copyAiPublicAssets(source, output);

    expect(fs.existsSync(path.join(output, "fonts", "fonts.css"))).toBe(true);
    expect(fs.existsSync(path.join(output, "favicon.svg"))).toBe(true);
    expect(fs.existsSync(path.join(output, "data"))).toBe(false);
    expect(fs.readdirSync(output).sort()).toEqual([...AI_PUBLIC_ASSETS].sort());
  });

  it("fails packaging when a required asset disappears", () => {
    expect(() => copyAiPublicAssets(temp(), temp())).toThrow(
      "Required AI public asset is missing",
    );
  });

  it("requires every SEO image referenced by a generated page", () => {
    const source = temp();
    const output = temp();
    for (const image of AI_SEO_IMAGES)
      fs.writeFileSync(path.join(source, image), image);
    copyAiSeoImages(source, output);
    expect(fs.readdirSync(output).sort()).toEqual([...AI_SEO_IMAGES].sort());
    fs.rmSync(path.join(source, "tools-og.png"));
    expect(() => copyAiSeoImages(source, output)).toThrow(
      "Required AI SEO image is missing: tools-og.png",
    );
  });

  it("rejects missing or unexpected production output", () => {
    const output = temp();
    for (const entry of AI_EXPECTED_OUTPUT_ENTRIES) {
      const target = path.join(output, entry);
      if (entry === "assets" || entry === "fonts")
        fs.mkdirSync(target, { recursive: true });
      else fs.writeFileSync(target, entry);
    }
    expect(() => assertAiOutput(output)).not.toThrow();
    fs.writeFileSync(
      path.join(output, "evals.html"),
      '<meta property="og:image" content="https://ai.electionsbg.com/missing-social.png" />',
    );
    expect(() => assertAiOutput(output)).toThrow(
      "evals.html references a missing image: missing-social.png",
    );
    fs.writeFileSync(path.join(output, "evals.html"), "evals.html");
    fs.mkdirSync(path.join(output, "data"));
    expect(() => assertAiOutput(output)).toThrow("unexpected: data");
  });
});
