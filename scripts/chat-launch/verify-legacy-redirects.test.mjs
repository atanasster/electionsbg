import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { verifyLegacyRedirects } from "./verify-legacy-redirects.mjs";
const rules = JSON.parse(
  fs.readFileSync(new URL("./legacy-redirects.json", import.meta.url)),
);
const fetcher = async (input, broken = false) => {
  const url = new URL(input);
  const rule = rules.find((r) => r.source === url.pathname);
  if (!rule) return new Response("Recovery", { status: 200 });
  const target = new URL(rule.destination);
  target.search = url.search;
  if (broken && target.searchParams.has("q"))
    target.searchParams.set(
      "q",
      target.searchParams.get("q").replaceAll("?", "%3F"),
    );
  return new Response(null, {
    status: rule.type,
    headers: { location: target.href },
  });
};
test("exact page rules preserve question/tools queries; never match API or recovery", async () => {
  assert.deepEqual(
    rules.map((r) => r.source),
    ["/", "/tools", "/tools/", "/evals", "/evals/"],
  );
  assert.deepEqual(
    await verifyLegacyRedirects("https://old.example", (input) => fetcher(input)),
    { redirects: 5, recoveryStatus: 200 },
  );
});
test("probe rejects the emulator's double-encoding failure", async () => {
  await assert.rejects(
    verifyLegacyRedirects("https://old.example", (input) =>
      fetcher(input, true),
    ),
  );
});
