import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

export const BUDGETS = {
  htmlGzip: 2_000,
  cssGzip: 30_000,
  jsGzip: 140_000,
  homeJsonGzip: 33 * 1024,
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
  return {
    htmlGzip: gzipBytes(files.html),
    cssGzip: files.css.reduce((sum, file) => sum + gzipBytes(file), 0),
    jsGzip: files.js.reduce((sum, file) => sum + gzipBytes(file), 0),
    homeJsonGzip: gzipBytes(files.homeJson),
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
