import { gzip } from "node:zlib";
import { promisify } from "node:util";
import { readFile, writeFile, readdir } from "node:fs/promises";
import { join } from "node:path";

const gzipAsync = promisify(gzip);
const DIST = join(process.cwd(), "dist");
const SKIP_DIRS = new Set(["locales"]);
const CONCURRENCY = 32;

async function collect(dir: string, out: string[]): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true });
  await Promise.all(
    entries.map(async (entry) => {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) return;
        await collect(path, out);
      } else if (entry.isFile() && entry.name.endsWith(".json")) {
        out.push(path);
      }
    }),
  );
}

async function main() {
  const files: string[] = [];
  await collect(DIST, files);

  let totalOriginal = 0;
  let totalCompressed = 0;
  let processed = 0;

  const queue = files.slice();
  const worker = async () => {
    while (queue.length > 0) {
      const file = queue.pop();
      if (!file) break;
      const raw = await readFile(file);
      const gz = await gzipAsync(raw, { level: 9 });
      await writeFile(file, gz);
      totalOriginal += raw.length;
      totalCompressed += gz.length;
      processed++;
      if (processed % 25000 === 0) {
        console.log(`  ...gzipped ${processed}/${files.length}`);
      }
    }
  };

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  const mb = (n: number) => (n / 1024 / 1024).toFixed(1);
  const ratio =
    totalOriginal === 0 ? 0 : (1 - totalCompressed / totalOriginal) * 100;
  console.log(
    `gzipped ${processed} JSON files: ${mb(totalOriginal)} MB → ${mb(totalCompressed)} MB (${ratio.toFixed(1)}% smaller)`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
