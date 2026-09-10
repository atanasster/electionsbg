import { afterEach, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.resetModules();
});
const response = (body: object, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

// ⚠️ THE ENDPOINT IS SPELLED OUT ON PURPOSE. `session.ts` reads it from
// VITE_LLM_PROXY_URL with a hard-coded default, and an expectation derived from
// that same default would assert nothing — it would pass whatever the module
// happened to point at, which is precisely the case that matters. This literal
// is what proves the chat calls the endpoint we actually deployed.
//
// It named ai.electionsbg.com until the LLM function, its secrets and the usage
// ledger moved to the elections-bg project (see
// docs/plans/chat-launch-rebrand-handoff.md). Update it deliberately, alongside
// the move — never to make a red test green.
it("requires verification again after expiry and uses the retained AI endpoint", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-10T10:00:00Z"));
  const fetcher = vi
    .fn()
    .mockResolvedValue(
      response({ token: "verified", expiresAt: Date.now() + 3600000 }),
    );
  vi.stubGlobal("fetch", fetcher);
  const session = await import("./session");
  await session.verifyAiSession("challenge");
  expect(fetcher.mock.calls[0][0]).toBe("https://elections-bg.web.app/api/llm");
  expect(session.hasAiSession()).toBe(true);
  vi.advanceTimersByTime(3600000);
  await expect(session.questionAccess.start()).rejects.toThrow(
    "verification_required",
  );
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it("invalid sessions clear credentials; network errors replace stale allowance notices", async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(
      response({ token: "verified", expiresAt: Date.now() + 3600000 }),
    )
    .mockResolvedValueOnce(response({ error: "verification_required" }, 401))
    .mockRejectedValueOnce(new TypeError("network unavailable"));
  vi.stubGlobal("fetch", fetcher);
  const session = await import("./session");
  await session.verifyAiSession("challenge");
  await expect(session.questionAccess.start()).rejects.toThrow(
    "verification_required",
  );
  expect(session.hasAiSession()).toBe(false);
  session.setAiNotice("question_limit");
  await expect(session.sessionRequest({ action: "session" })).rejects.toThrow();
  expect(session.aiSessionNotice()).toBe("ai_unavailable");
});
