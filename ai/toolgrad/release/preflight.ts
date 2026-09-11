import { readFileSync } from "node:fs";
import { hash } from "../corpus";
export function verifyFrozenSources(
  sourceHashes: Record<string, string>,
  read: (path: string) => string = (path) => readFileSync(path, "utf8"),
): void {
  for (const [path, expected] of Object.entries(sourceHashes))
    if (hash(read(path)) !== expected)
      throw new Error(`Frozen evaluation source changed: ${path}`);
}
