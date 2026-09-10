// Import-free metadata projections for the main site's question selector.
// Run: node --import tsx scripts/ai/toolMetadata.ts [--write]
import { readFileSync, writeFileSync } from "node:fs";
import { TOOLS } from "../../ai/tools/registry";
import prompts from "../../ai/app/starterPrompts.json";

export const toolMetadata = () => ({
  "ai/app/toolParameters.json": Object.fromEntries(
    TOOLS.map((t) => [t.name, t.params]),
  ),
  "ai/app/toolTopics.json": Object.fromEntries(
    TOOLS.map((t) => {
      const prompt = prompts.find((p) => p.tool === t.name);
      if (!prompt) throw new Error(`Missing discovery question: ${t.name}`);
      return [t.name, [prompt.category, prompt.subcategory]];
    }),
  ),
});

if (process.argv[1]?.endsWith("toolMetadata.ts")) {
  for (const [path, data] of Object.entries(toolMetadata())) {
    const text = JSON.stringify(data, null, 2) + "\n";
    if (process.argv.includes("--write")) writeFileSync(path, text);
    else if (
      JSON.stringify(JSON.parse(readFileSync(path, "utf8"))) !==
      JSON.stringify(data)
    )
      throw new Error(`Stale ${path}; run toolMetadata.ts --write`);
  }
}
