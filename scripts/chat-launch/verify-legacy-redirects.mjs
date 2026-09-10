import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";

// Read-only probe: use the isolated Hosting proof first, then the legacy host
// only AFTER redirects are intentionally enabled. Never posts to the AI API.
export async function verifyLegacyRedirects(base, fetcher = fetch) {
  const cases = [
    [
      "/",
      "/chat",
      { q: "Какъв е бюджетът? & как се променя + 5%", lang: "en" },
    ],
    [
      "/tools",
      "/chat/tools",
      {
        v: "1",
        tool: "settlementPrices",
        args: JSON.stringify({ place: "Пловдив", note: "? & + %" }),
        lang: "bg",
        area: "PDV",
      },
    ],
    ["/tools/", "/chat/tools", { lang: "en" }],
    ["/evals", "/chat/evals", { lang: "bg" }],
    ["/evals/", "/chat/evals", { lang: "en" }],
  ];
  for (const [route, target, params] of cases) {
    const response = await fetcher(
      `${base}${route}?${new URLSearchParams(params)}`,
      { redirect: "manual" },
    );
    assert.equal(response.status, 301, route);
    const destination = new URL(response.headers.get("location"));
    assert.equal(destination.origin, "https://naiasno.bg");
    assert.equal(destination.pathname, target);
    assert.deepEqual(
      [...destination.searchParams].sort(),
      Object.entries(params).sort(),
    );
  }
  const recovery = await fetcher(`${base}/legacy-export`, {
    redirect: "manual",
  });
  assert.equal(recovery.status, 200, "legacy recovery remains available");
  return { redirects: cases.length, recoveryStatus: recovery.status };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  if (!process.argv[2])
    throw new Error("Supply the explicitly chosen legacy/proof origin");
  console.log(await verifyLegacyRedirects(new URL(process.argv[2]).origin));
}
