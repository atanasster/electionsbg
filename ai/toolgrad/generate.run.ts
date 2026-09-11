// node --env-file=.env.local --import tsx ai/toolgrad/generate.run.ts <corpus.json> <new-directory>
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { execFileSync } from "node:child_process";
import { PilotClient, PILOT_MODEL } from "./client";
import { hash, verifyCorpus, type Corpus } from "./corpus";
import { SEEDS } from "./seeds";
import {
  generationMessages,
  makeSamples,
  parseQuestions,
  restoreQuestions,
  verifySamples,
  type Sample,
} from "./questions";

async function main() {
  const [input, output, resume] = process.argv.slice(2);
  if (!input || !output)
    throw new Error("Provide corpus JSON and a new output directory");
  const corpus: Corpus = JSON.parse(await readFile(input, "utf8"));
  verifyCorpus(corpus, SEEDS);
  const client = new PilotClient(
    process.env.GEMINI_API_KEY ?? "",
    corpus.captures.length * 2,
  );
  await mkdir(dirname(output), { recursive: true });
  await mkdir(output); // refuse overwrite, including a partial run
  const samples: Sample[] = [];
  const traces: {
    workflow: string;
    lang: string;
    messages: ReturnType<typeof generationMessages>;
    text: string;
    error?: string;
  }[] = [];
  if (resume) {
    const prior = JSON.parse(
      await readFile(join(resume, "generation.json"), "utf8"),
    );
    if (prior.corpusHash !== hash(corpus) || prior.model !== PILOT_MODEL)
      throw new Error("Resume corpus/model mismatch");
    for (const trace of prior.traces) {
      const c = corpus.captures.find(
        (c) => c.seed.id === trace.workflow && c.context.lang === trace.lang,
      );
      if (!c || hash(trace.messages) !== hash(generationMessages(c)))
        throw new Error("Resume generation prompt mismatch");
      traces.push(trace);
      try {
        const restored = restoreQuestions(c, parseQuestions(trace.text));
        if (
          !samples.some(
            (s) => s.workflow === c.seed.id && s.lang === c.context.lang,
          )
        )
          samples.push(...makeSamples(c, restored));
      } catch {
        /* Retain invalid attempts, retry below. */
      }
    }
  }
  const meta = {
    version: 1,
    model: PILOT_MODEL,
    corpusHash: hash(corpus),
    startedAt: new Date().toISOString(),
    commit: execFileSync("git", ["rev-parse", "HEAD"], {
      encoding: "utf8",
    }).trim(),
    maxCalls: client.maxCalls,
    resumedFrom: resume ?? null,
    priorTraceCount: traces.length,
  };
  try {
    for (const c of corpus.captures) {
      if (
        samples.some(
          (s) => s.workflow === c.seed.id && s.lang === c.context.lang,
        )
      )
        continue;
      const messages = generationMessages(c);
      for (let attempt = 0; attempt < 2; attempt++) {
        const completion = await client.complete(messages, {
          json: true,
          temperature: 0.5,
        });
        const trace = {
          workflow: c.seed.id,
          lang: c.context.lang,
          messages,
          ...completion,
          error: undefined as string | undefined,
        };
        traces.push(trace);
        try {
          samples.push(
            ...makeSamples(
              c,
              restoreQuestions(c, parseQuestions(completion.text)),
            ),
          );
          break;
        } catch (e) {
          trace.error = String(e);
          if (attempt === 1)
            console.error(
              `${c.seed.id}:${c.context.lang} needs local repair: ${e}`,
            );
        }
      }
      console.log(`${c.seed.id}:${c.context.lang} generated`);
      await writeFile(
        join(output, "checkpoint.json"),
        JSON.stringify({ ...meta, traces, samples }, null, 2) + "\n",
      );
    }
    if (samples.length === corpus.captures.length * 3)
      verifySamples(samples, corpus);
    await writeFile(
      join(output, "questions.json"),
      JSON.stringify(
        {
          ...meta,
          status:
            samples.length === corpus.captures.length * 3
              ? "generated-unreviewed"
              : "incomplete-needs-repair",
          samples,
        },
        null,
        2,
      ) + "\n",
      { flag: "wx" },
    );
  } finally {
    await writeFile(
      join(output, "generation.json"),
      JSON.stringify(
        {
          ...meta,
          finishedAt: new Date().toISOString(),
          calls: client.calls,
          reservedCeilingUSD: client.reservedCeilingUSD,
          costNote:
            "Production reservation ceiling, not billed cost; usage retained per request.",
          traces,
        },
        null,
        2,
      ) + "\n",
    );
  }
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
