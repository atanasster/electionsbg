// The collision report's employer line depends on one path equation holding:
// the register folder SEGMENT parsed from a filing's sourceUrl must equal the
// directory `fetchDeclaration` cached it under (`RAW_DIR/<year>/<file>`). If the
// two ever drift, every `работи:` line silently vanishes with no failing test —
// and that line is what the whole collision triage now leads with. So pin the
// round trip against a real fixture on disk rather than an injected reader.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { readCachedDeclarationXml } from "./shared";
import { workOf } from "./slug_identity";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cacbg-cache-"));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

const write = (folder: string, file: string, body: string): void => {
  fs.mkdirSync(path.join(tmp, folder), { recursive: true });
  fs.writeFileSync(path.join(tmp, folder, file), body, "utf-8");
};

describe("readCachedDeclarationXml", () => {
  const XML =
    "<Personal><Work>ВОЕННО ФОРМИРОВАНИЕ 26720 - ЧЕРНОМОРЕЦ</Work></Personal>";
  const url =
    "https://register.cacbg.bg/2025/D1245F3F-A206-40F9-BB6C-A9F0BE3D1D09216503.xml";

  it("reads back a filing cached under RAW_DIR/<folder>/<file>", () => {
    write("2025", "D1245F3F-A206-40F9-BB6C-A9F0BE3D1D09216503.xml", XML);
    const xml = readCachedDeclarationXml(url, tmp);
    expect(xml).not.toBeNull();
    // And the employer parses out — the round trip the report actually performs.
    expect(workOf(xml!)).toBe("ВОЕННО ФОРМИРОВАНИЕ 26720 - ЧЕРНОМОРЕЦ");
  });

  it("returns null on a cache miss rather than throwing", () => {
    expect(
      readCachedDeclarationXml(
        "https://register.cacbg.bg/2019/DEADBEEF-0000-0000-0000-000000000000000.xml",
        tmp,
      ),
    ).toBeNull();
  });

  it("returns null when the URL carries no folder segment", () => {
    expect(readCachedDeclarationXml("not-a-register-url.xml", tmp)).toBeNull();
  });
});
