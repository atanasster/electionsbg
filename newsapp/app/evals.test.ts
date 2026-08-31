import { describe, expect, it } from "vitest";
import {
  DEFAULT_EVAL_FILTERS,
  canonicalEvalSha256,
  filterEvalTasks,
  orderEvalTasks,
  parseEvalQueue,
  pickRandomEvalTask,
  type EvalTask,
} from "./evals";

const task = (over: Partial<EvalTask> = {}): EvalTask => ({
  article_key: "ex.bg/a1",
  domain: "ex.bg",
  article_id: "a1",
  url: "https://ex.bg/a1",
  title: "Статия",
  published: "2026-08-30T10:00:00.000Z",
  story_id: null,
  primary_topic: "government",
  outlet: "Пример",
  content_sha256: `sha256:${"1".repeat(64)}`,
  analysis_sha256: `sha256:${"2".repeat(64)}`,
  model_labels: {
    leaning: "neutral",
    russia_stance: "neutral",
    party_tones: [],
  },
  review_fields: [],
  dataset_ids: ["pilot-v1"],
  task_revision: 123,
  ...over,
});

const queue = async (tasks: EvalTask[]) => ({
  schema_version: 1,
  generated_at: "2026-08-31T10:00:00.000Z",
  public_data_revision: "2026-08-31T10:00:00.000Z",
  rubric_version: "news-article-evaluation-v1",
  task_count: tasks.length,
  tasks_sha256: await canonicalEvalSha256(tasks),
  tasks,
});

describe("public eval queue contract", () => {
  it("accepts a complete public task and preserves no private article text", async () => {
    const parsed = await parseEvalQueue(await queue([task()]));
    expect(parsed.tasks).toHaveLength(1);
    expect(parsed.tasks[0].article_key).toBe("ex.bg/a1");
    expect(JSON.stringify(parsed)).not.toMatch(/content"|evidence|public_note/);
  });

  it("accepts an empty deactivation queue but rejects malformed inventories", async () => {
    await expect(parseEvalQueue(await queue([]))).resolves.toMatchObject({
      task_count: 0,
      tasks: [],
    });
    await expect(parseEvalQueue(await queue([task(), task()]))).rejects.toThrow(
      /Повторена задача/,
    );
    await expect(
      parseEvalQueue(await queue([task({ article_key: "wrong/a1" })])),
    ).rejects.toThrow(/Невалидна задача/);
    await expect(
      parseEvalQueue(
        await queue([
          task({
            model_labels: {
              leaning: "neutral",
              russia_stance: "neutral",
              party_tones: [{ party: "Партия", party_id: "", tone: "neutral" }],
            },
          }),
        ]),
      ),
    ).rejects.toThrow(/Невалидна партия/);
    await expect(
      parseEvalQueue({ ...(await queue([task()])), schema_version: 2 }),
    ).rejects.toThrow(/Невалиден договор/);
  });

  it("fails closed on integrity, revision, field and bounded-value mutations", async () => {
    const valid = await queue([task()]);
    await expect(
      parseEvalQueue({ ...valid, tasks_sha256: `sha256:${"0".repeat(64)}` }),
    ).rejects.toThrow(/Хешът/);
    await expect(
      parseEvalQueue({
        ...valid,
        public_data_revision: "2026-08-31T10:00:01.000Z",
      }),
    ).rejects.toThrow(/Невалиден договор/);
    await expect(
      parseEvalQueue({ ...valid, private_article_text: "не трябва да излиза" }),
    ).rejects.toThrow(/Невалиден договор/);
    await expect(
      parseEvalQueue(
        await queue([{ ...task(), evidence: "частен текст" } as EvalTask]),
      ),
    ).rejects.toThrow(/Невалидна задача/);
    await expect(
      parseEvalQueue(await queue([task({ url: "https://" })])),
    ).rejects.toThrow(/Невалидна задача/);
    await expect(
      parseEvalQueue(await queue([task({ title: "x".repeat(501) })])),
    ).rejects.toThrow(/Невалидна задача/);
    await expect(
      parseEvalQueue(
        await queue([
          task({
            review_fields: Array.from(
              { length: 11 },
              (_, index) => `f${index}`,
            ),
          }),
        ]),
      ),
    ).rejects.toThrow(/Невалидна задача/);
  });

  it("rejects duplicate canonical and surface party identities", async () => {
    const labels = (partyTones: EvalTask["model_labels"]["party_tones"]) => ({
      leaning: "neutral" as const,
      russia_stance: "neutral" as const,
      party_tones: partyTones,
    });
    await expect(
      parseEvalQueue(
        await queue([
          task({
            model_labels: labels([
              { party: "Партия", party_id: "p", tone: "neutral" },
              { party: "Друго име", party_id: "p", tone: "mixed" },
            ]),
          }),
        ]),
      ),
    ).rejects.toThrow(/Повторена партия/);
    await expect(
      parseEvalQueue(
        await queue([
          task({
            model_labels: labels([
              { party: "Партия", party_id: null, tone: "neutral" },
              { party: "партия", party_id: null, tone: "mixed" },
            ]),
          }),
        ]),
      ),
    ).rejects.toThrow(/Повторена партия/);
  });
});

describe("queue selection", () => {
  const party = task({
    article_key: "party.bg/a2",
    domain: "party.bg",
    article_id: "a2",
    outlet: "Партиен източник",
    primary_topic: "politics",
    model_labels: {
      leaning: "strong_conservative",
      russia_stance: "pro_russia",
      party_tones: [{ party: "Партия", party_id: "p", tone: "mixed" }],
    },
    review_fields: ["party_tones"],
    dataset_ids: ["pilot-v2"],
  });

  it("combines axis, party, outlet, topic, batch, review and date filters", () => {
    const filtered = filterEvalTasks(
      [task(), party],
      {
        ...DEFAULT_EVAL_FILTERS,
        leaning: "strong_conservative",
        russia: "pro_russia",
        party: "with_party",
        outlet: "Партиен източник",
        topic: "politics",
        dataset: "pilot-v2",
        reviewField: "party_tones",
        date: "7",
      },
      Date.parse("2026-08-31T10:00:00.000Z"),
    );
    expect(filtered.map((item) => item.article_key)).toEqual(["party.bg/a2"]);
  });

  it("orders review/strong/party tasks first with a stable identity fallback", () => {
    const ordered = orderEvalTasks([
      task({ article_key: "z.bg/a1", domain: "z.bg" }),
      party,
      task({ article_key: "a.bg/a1", domain: "a.bg" }),
    ]);
    expect(ordered[0]).toBe(party);
    expect(ordered.slice(1).map((item) => item.article_key)).toEqual([
      "a.bg/a1",
      "z.bg/a1",
    ]);
  });

  it("orders equivalent priorities by the actual instant, not timestamp text", () => {
    const earlier = task({
      article_key: "early.bg/a1",
      domain: "early.bg",
      published: "2026-08-30T22:30:00-02:00",
    });
    const later = task({
      article_key: "late.bg/a1",
      domain: "late.bg",
      published: "2026-08-31T00:45:00Z",
    });
    expect(
      orderEvalTasks([earlier, later]).map((item) => item.article_key),
    ).toEqual(["late.bg/a1", "early.bg/a1"]);
  });

  it("selects within bounds and returns null for an empty result", () => {
    const items = [task(), party];
    expect(pickRandomEvalTask(items, 0)).toBe(items[0]);
    expect(pickRandomEvalTask(items, 1)).toBe(items[1]);
    expect(pickRandomEvalTask([], 0.5)).toBeNull();
  });
});
