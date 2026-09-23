import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

/**
 * Gzip byte ceilings — NOT layout shift. Nothing in the news suite measures
 * CLS; `newsVitals.ts` reports it from real sessions and `perf:cls` covers the
 * main site, not `dist-news`.
 *
 * Measured 2026-09-02 after the editorial-grid rewrite: html 1,220 · css
 * 26,722 (89.1%) · js 118,612 (84.7%) · home.json 30,727 (90.9%). The two
 * tight ones are css and home.json, and both are on the path of planned work —
 * a briefing-controls disclosure spends the first, added image provenance the
 * second. Re-measure after each; landing over budget is a decision to raise a
 * constant WITH its measurement, never a silent edit.
 */
export const BUDGETS = {
  htmlGzip: 2_000,
  cssGzip: 30_000,
  jsGzip: 140_000,
  homeJsonGzip: 33 * 1024,
  /**
   * The MAXIMUM over every emitted story index page, not the first one.
   *
   * ⚠️ PAGE 1 IS NOT THE WORST PAGE, and checking it alone is how a 200-row
   * size came to look safe. Measured 2026-09-21 once each row carried its
   * `prominence` block: `index-1` gzipped to 54,198 bytes while the worst
   * page reached 58,064 — a first-page check passes while most pages fail.
   * At `STORY_PAGE_SIZE = 150` the worst page is 43,982.
   *
   * ⚠️ IT COVERS BOTH ORDERINGS (`index-*` latest, `ranked-*` prominence),
   * because a second ordering doubles the pages a reader can land on and a
   * budget that saw only one of them would be measuring half the surface.
   */
  storyIndexPageGzip: 50 * 1024,
  /**
   * The global structured filter index — every story's window, topics,
   * outlets and rank, so the client can answer a facet over the WHOLE corpus
   * instead of over whatever it has downloaded.
   *
   * ⚠️⚠️ THAT MOMENT ARRIVED AND THE INDEX IS NOW PARTITIONED. At 4,899
   * stories the single whole-corpus file reached 66,122 bytes, the build
   * refused to write it, and `app-data` stopped being rebuilt at all. What
   * this now measures is what a reader on the DEFAULT window actually
   * downloads: the manifest plus the newest shard. Measured after the split —
   * manifest 1,001 bytes, largest shard 21,280.
   *
   * ⚠️ A WIDER WINDOW STILL COSTS MORE, AND IT HAS ITS OWN BUDGET BELOW.
   * This corpus is overwhelmingly recent (4,500 of 4,899 stories inside a
   * week), so a 7-day query still reads three shards — the partition fixed
   * the per-file cliff and restored the default view, it did not make a
   * whole-corpus question cheap. Publishing only the 24h figure would report
   * 22 KB while `/stories` at its DEFAULT window pays 64 KB and
   * `/outlet/:domain` — which passes no `days` at all — pays the whole index,
   * i.e. the same ~66 KB that aborted the build, passing unwatched. A
   * constant nobody reads is a budget nobody keeps.
   *
   * ⚠️ IT DELIBERATELY CARRIES NO TITLES. Adding them measured 288 KB, an
   * inverted index over them 348 KB, and the 24h window's titles alone 234 KB
   * — against a 13 KB home payload. Search is therefore not global here, and
   * must say so rather than be silently narrowed.
   */
  filterIndexGzip: 32 * 1024,
  /**
   * What the WHOLE index costs: the manifest plus every shard. This is what
   * `/outlet/:domain` downloads (`useGlobalStoryQuery({domain, now})` passes
   * no `days`, so `shardsForWindow` returns all of them) and roughly what the
   * default 7-day `/stories` browse pays. Measured after the split: 67,508.
   *
   * ⚠️ THIS IS THE ONE THAT GROWS WITH THE CORPUS. The partition moved the
   * cliff; it did not remove it. When this trips, the answer is a narrower
   * question on the outlet page — not a bigger number here.
   */
  filterIndexWholeGzip: 96 * 1024,
} as const;

export const gzipBytes = (file: string): number => {
  const result = spawnSync(
    "python3",
    [
      "-c",
      "import gzip,pathlib,sys; print(len(gzip.compress(pathlib.Path(sys.argv[1]).read_bytes(), compresslevel=6)))",
      file,
    ],
    { encoding: "utf8" },
  );
  if (result.status !== 0)
    throw new Error(
      `gzip measurement failed for ${file}: ${result.stderr.trim()}`,
    );
  const bytes = Number(result.stdout.trim());
  if (!Number.isFinite(bytes))
    throw new Error(`invalid gzip measurement for ${file}`);
  return bytes;
};

export const inspectNewsBuild = (root = path.resolve("dist-news")) => {
  const htmlFile = path.join(root, "index.html");
  if (!fs.existsSync(htmlFile))
    throw new Error(`missing production artifact: ${htmlFile}`);
  const html = fs.readFileSync(htmlFile, "utf8");
  const refsFor = (
    pattern: RegExp,
    kind: string,
    exactlyOne = false,
    allowEmpty = false,
  ) => {
    const refs = [...html.matchAll(pattern)].map((match) => match[1]);
    if ((!allowEmpty && refs.length === 0) || (exactlyOne && refs.length !== 1))
      throw new Error(
        `expected ${exactlyOne ? "one" : "at least one"} ${kind} entry reference, found ${refs.length}`,
      );
    return refs.map((ref) => {
      const resolved = path.resolve(root, ref.replace(/^\//, ""));
      if (!resolved.startsWith(path.resolve(root) + path.sep))
        throw new Error(`${kind} entry resolves outside build root`);
      return resolved;
    });
  };
  const files = {
    html: htmlFile,
    css: refsFor(
      /<link[^>]+rel="stylesheet"[^>]+href="([^"]+)"/g,
      "stylesheet",
    ),
    js: [
      refsFor(
        /<script[^>]+type="module"[^>]+src="([^"]+)"/g,
        "module script",
        true,
      )[0],
      ...refsFor(
        /<link[^>]+rel="modulepreload"[^>]+href="([^"]+)"/g,
        "modulepreload",
        false,
        true,
      ),
    ],
    homeJson: path.join(root, "news-data", "home.json"),
  };
  for (const file of [files.html, ...files.css, ...files.js, files.homeJson])
    if (!fs.existsSync(file))
      throw new Error(`missing production artifact: ${file}`);
  const storyDir = path.join(root, "news-data", "stories");
  const pages = fs.existsSync(storyDir)
    ? fs
        .readdirSync(storyDir)
        .filter((name) => /^(index|ranked)-\d+\.json$/.test(name))
        .map((name) => path.join(storyDir, name))
    : [];
  // ⚠️ AN ABSENT INDEX IS A FAILURE, not a pass. A build that emitted no
  // pages would otherwise satisfy a maximum-over-nothing of zero — the
  // vacuous-green shape this suite exists to avoid.
  if (pages.length === 0)
    throw new Error(`missing production artifact: ${storyDir}/index-1.json`);
  const filterIndex = path.join(storyDir, "filter-index.json");
  // ⚠️ ABSENT IS A FAILURE. Without it every facet silently falls back to
  // whatever the client downloaded — the defect the index exists to remove.
  if (!fs.existsSync(filterIndex))
    throw new Error(`missing production artifact: ${filterIndex}`);
  // ⚠️ AND SO IS A MANIFEST WITH NO SHARDS. Since the partition the rows live
  // beside the manifest, so a manifest alone is an index with no corpus in it
  // — which would measure small and answer nothing.
  const shardFiles = fs
    .readdirSync(storyDir)
    .filter((name) => /^filter-index-\d+\.json$/.test(name))
    .map((name) => path.join(storyDir, name));
  if (shardFiles.length === 0)
    throw new Error(
      `missing production artifact: ${storyDir}/filter-index-1.json`,
    );
  const shardGzip = shardFiles.map(gzipBytes);
  return {
    htmlGzip: gzipBytes(files.html),
    cssGzip: files.css.reduce((sum, file) => sum + gzipBytes(file), 0),
    jsGzip: files.js.reduce((sum, file) => sum + gzipBytes(file), 0),
    homeJsonGzip: gzipBytes(files.homeJson),
    storyIndexPageGzip: Math.max(...pages.map(gzipBytes)),
    // What a 24-HOUR reader costs: the manifest, plus one shard. The largest
    // shard stands in for "the newest" so the figure cannot improve by the
    // corpus happening to end mid-shard.
    filterIndexGzip: gzipBytes(filterIndex) + Math.max(...shardGzip),
    // What a WINDOWLESS reader costs: the manifest plus every shard.
    filterIndexWholeGzip:
      gzipBytes(filterIndex) + shardGzip.reduce((sum, n) => sum + n, 0),
  };
};

export const enforceNewsBudget = (sizes = inspectNewsBuild()) => {
  const failures = Object.entries(BUDGETS)
    .filter(([key, limit]) => sizes[key as keyof typeof sizes] > limit)
    .map(
      ([key, limit]) =>
        `${key}: ${sizes[key as keyof typeof sizes]} > ${limit}`,
    );
  if (failures.length)
    throw new Error(
      `news performance budget exceeded:\n${failures.join("\n")}`,
    );
  return sizes;
};

if (import.meta.url === `file://${process.argv[1]}`)
  console.log(JSON.stringify(enforceNewsBudget(), null, 2));
