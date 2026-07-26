// Unit tests for preserveSectionCoords — the guard that keeps section GPS alive
// across a re-parse.
//
// WHY THIS EXISTS. Only the 2026+ CEC `sections.txt` carries GPS (see the year
// branches in ./sections.ts). For every older election the coordinates live
// solely in generated output that .gitignore excludes (`/data/2*/*`), so a
// re-parse rebuilds the section files from a GPS-less source and the loss is
// invisible to git. That is not hypothetical: runs on 2026-07-18 and
// 2026-07-25 took six elections (2021_07_11 … 2024_10_27) to 0 geocoded
// sections and the zeroed shards reached GCS before anyone noticed.
//
// preserveSectionCoords carries the previous run's coordinates onto the freshly
// parsed array before any writer touches disk. No DB, no network.
//
//   npm run test:unit -- scripts/parsers/backfill_section_coords

import { test, afterEach } from "vitest";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { SectionInfo } from "@/data/dataTypes";
import { sectionVotesFileName } from "scripts/consts";
import { preserveSectionCoords } from "./backfill_section_coords";

const dirs: string[] = [];
const withPrior = (prior: unknown): string => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "coords-"));
  dirs.push(d);
  if (prior !== undefined)
    fs.writeFileSync(
      path.join(d, sectionVotesFileName),
      typeof prior === "string" ? prior : JSON.stringify(prior),
    );
  return d;
};
afterEach(() => {
  for (const d of dirs.splice(0))
    fs.rmSync(d, { recursive: true, force: true });
});

const sec = (section: string, extra: Partial<SectionInfo> = {}): SectionInfo =>
  ({ section, ...extra }) as SectionInfo;

test("carries coordinates from the previous run onto a GPS-less re-parse", () => {
  const inFolder = withPrior([
    { section: "010100001", longitude: 23.48, latitude: 41.83 },
    { section: "010100002", longitude: 23.49, latitude: 41.84 },
  ]);
  const sections = [sec("010100001"), sec("010100002")];
  assert.equal(preserveSectionCoords({ inFolder, sections }), 2);
  assert.equal(sections[0].longitude, 23.48);
  assert.equal(sections[0].latitude, 41.83);
  assert.equal(sections[1].latitude, 41.84);
});

test("a fresh source coordinate wins — the 2026+ feed is authoritative", () => {
  const inFolder = withPrior([
    { section: "010100001", longitude: 1, latitude: 2 },
  ]);
  const sections = [sec("010100001", { longitude: 23.48, latitude: 41.83 })];
  assert.equal(preserveSectionCoords({ inFolder, sections }), 0);
  assert.equal(sections[0].longitude, 23.48);
  assert.equal(sections[0].latitude, 41.83);
});

test("sections absent from the previous run are left alone", () => {
  const inFolder = withPrior([
    { section: "010100001", longitude: 23.48, latitude: 41.83 },
  ]);
  const sections = [sec("010100001"), sec("999999999")];
  assert.equal(preserveSectionCoords({ inFolder, sections }), 1);
  assert.equal(sections[1].longitude, undefined);
  assert.equal(sections[1].latitude, undefined);
});

test("a half-populated prior entry is not carried over", () => {
  // Longitude without latitude is unusable; carrying it would make a section
  // look geocoded to every `latitude != null` check downstream.
  const inFolder = withPrior([{ section: "010100001", longitude: 23.48 }]);
  const sections = [sec("010100001")];
  assert.equal(preserveSectionCoords({ inFolder, sections }), 0);
  assert.equal(sections[0].longitude, undefined);
});

test("no prior file, empty, corrupt or wrong-shaped input is a safe no-op", () => {
  for (const prior of [undefined, "", "{not json", JSON.stringify({}), "[]"]) {
    const inFolder = withPrior(prior);
    const sections = [sec("010100001")];
    assert.equal(preserveSectionCoords({ inFolder, sections }), 0);
    assert.equal(sections[0].latitude, undefined);
  }
});

test("is idempotent — a second pass carries nothing new", () => {
  const inFolder = withPrior([
    { section: "010100001", longitude: 23.48, latitude: 41.83 },
  ]);
  const sections = [sec("010100001")];
  assert.equal(preserveSectionCoords({ inFolder, sections }), 1);
  assert.equal(preserveSectionCoords({ inFolder, sections }), 0);
  assert.equal(sections[0].latitude, 41.83);
});
