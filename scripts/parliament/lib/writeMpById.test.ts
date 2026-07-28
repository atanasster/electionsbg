import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { writeMpByIdShards } from "./writeMpById";

const dirs: string[] = [];
const tmp = (): string => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "mp-by-id-"));
  dirs.push(d);
  return d;
};

afterEach(() => {
  for (const d of dirs.splice(0))
    fs.rmSync(d, { recursive: true, force: true });
});

const shardNames = (out: string): string[] =>
  fs.readdirSync(path.join(out, "by-id")).sort();

describe("writeMpByIdShards", () => {
  it("writes one shard per roster entry", () => {
    const out = tmp();
    expect(writeMpByIdShards([{ id: 1 }, { id: 2 }], out)).toBe(2);
    expect(shardNames(out)).toEqual(["1.json", "2.json"]);
    expect(
      JSON.parse(fs.readFileSync(path.join(out, "by-id/1.json"), "utf8")),
    ).toEqual({ id: 1 });
  });

  it("sweeps a shard whose id has left the roster", () => {
    // The failure this prevents: the name-dedupe drops one of two records for the same
    // person, and the orphan shard lives on forever — served by useMpEntry, which
    // resolves an id straight from the URL and never consults the roster. It also
    // freezes at whatever schema it was written with, so a later field (seatedRegion)
    // is missing from exactly that one entry.
    const out = tmp();
    writeMpByIdShards([{ id: 1 }, { id: 4854 }], out);
    expect(shardNames(out)).toContain("4854.json");

    writeMpByIdShards([{ id: 1 }], out);
    expect(shardNames(out)).toEqual(["1.json"]);
  });

  it("leaves non-shard files alone", () => {
    const out = tmp();
    writeMpByIdShards([{ id: 1 }], out);
    const readme = path.join(out, "by-id", "README.md");
    fs.writeFileSync(readme, "keep me");
    writeMpByIdShards([{ id: 1 }], out);
    expect(fs.existsSync(readme)).toBe(true);
  });

  it("skips an entry with no id rather than writing null.json", () => {
    const out = tmp();
    const mps = [{ id: 1 }, { id: undefined }] as unknown as { id: number }[];
    expect(writeMpByIdShards(mps, out)).toBe(1);
    expect(shardNames(out)).toEqual(["1.json"]);
  });
});
