import { describe, expect, it } from "vitest";
import {
  compareDraftToReading,
  labelsMatch,
  validateReading,
  type AiReading,
} from "./ai_reading";
import { aiReviewStamp, reviewDraftHash } from "./ai_review";
import { myaraDraft, myaraReading } from "./ai_reading.fixtures";
import type { InboxDraft } from "./draft";

describe("labelsMatch", () => {
  it("folds case, quotes and the candidate prefix", () => {
    expect(labelsMatch("„Не подкрепям никого“", "не подкрепям никого")).toBe(
      true,
    );
    expect(labelsMatch("Кандидат на ГЕРБ-СДС", "ГЕРБ-СДС")).toBe(true);
  });
  it("matches a name inside a ticket, never a bare acronym inside a coalition", () => {
    expect(labelsMatch("Илияна Йотова", "Илияна Йотова и Кирил Вълчев")).toBe(
      true,
    );
    expect(labelsMatch("ГЕРБ", "ГЕРБ-СДС")).toBe(false);
    expect(labelsMatch("Илияна Йотова", "Андрей Гюров")).toBe(false);
  });
});

describe("compareDraftToReading", () => {
  it("agrees when every figure matches", () => {
    const cmp = compareDraftToReading(myaraDraft(), myaraReading());
    expect(cmp.diffs).toEqual([]);
    expect(cmp.agree).toBe(true);
  });

  it("disagrees on one share off by more than rounding", () => {
    const r = myaraReading();
    r.polls[0].questions[0].answers[1].value = 25.5;
    const cmp = compareDraftToReading(myaraDraft(), r);
    expect(cmp.agree).toBe(false);
    expect(cmp.diffs.join()).toMatch(/Андрей Гюров.*25.3.*25.5/);
  });

  it("disagrees when the reader finds an answer the extractor dropped", () => {
    const r = myaraReading();
    r.polls[0].questions[0].answers.push({
      label: "Ивелин Михайлов",
      kind: "choice",
      value: 4.2,
      quote: "x",
      image: null,
    });
    expect(compareDraftToReading(myaraDraft(), r).diffs.join()).toMatch(
      /Ивелин Михайлов/,
    );
  });

  it("disagrees when the extractor refused anything, even if values match", () => {
    const d = myaraDraft();
    d.refused = [{ field: "respondents", reason: "x", quote: "" }];
    expect(compareDraftToReading(d, myaraReading()).agree).toBe(false);
  });

  it("disagrees on fieldwork, sample, base, genre and capture version", () => {
    const r = myaraReading();
    r.captureSha256 = "b".repeat(64);
    r.polls[0].fieldworkEnd = "2026-10-05";
    r.polls[0].respondents = 1001;
    r.polls[0].genre = "forecast";
    r.polls[0].questions[0].baseKind = "decided_voters";
    const diffs = compareDraftToReading(myaraDraft(), r).diffs.join("\n");
    for (const m of [
      /capture version/,
      /fieldwork end/,
      /sample/,
      /genre/,
      /base/,
    ])
      expect(diffs).toMatch(m);
  });

  it("disagrees on a residual the extractor did not record", () => {
    const r = myaraReading();
    r.polls[0].questions[0].answers.push({
      label: "Не мога да преценя",
      kind: "undecided",
      value: 9,
      quote: "x",
      image: null,
    });
    expect(compareDraftToReading(myaraDraft(), r).diffs.join()).toMatch(
      /undecided extractor — vs reader 9/,
    );
  });

  it("refuses a reading with no poll of the draft's race", () => {
    const r = myaraReading();
    r.polls[0].race = "parliamentary";
    expect(compareDraftToReading(myaraDraft(), r).agree).toBe(false);
  });
});

describe("compareDraftToReading — open classifications", () => {
  it("ignores the by-design methodology refusal", () => {
    const d = myaraDraft();
    d.refused = [{ field: "methodology", reason: "by design", quote: "" }];
    expect(compareDraftToReading(d, myaraReading()).agree).toBe(true);
  });

  it("fills an unclear genre, a null round and an unknown base from the reader", () => {
    const d = myaraDraft();
    d.genre = "unclear";
    d.poll.questions![0].round = null;
    d.poll.questions![0].base = {
      kind: "unknown",
      label: { bg: "Неуточнена база", en: "Unresolved population base" },
      respondents: null,
      includesNone: null,
    };
    const cmp = compareDraftToReading(d, myaraReading());
    expect(cmp.agree).toBe(true);
    expect(cmp.fills).toEqual([
      { field: "genre", value: "raw_attitudes" },
      { field: "round", questionId: "vote", value: 1 },
      expect.objectContaining({ field: "base", kind: "likely_voters" }),
    ]);
  });

  it("never fills a value the reader also leaves open", () => {
    const r = myaraReading();
    r.polls[0].genre = "unclear";
    expect(compareDraftToReading(myaraDraft(), r).diffs.join()).toMatch(
      /genre unclear/,
    );
  });

  it("still rejects a resolved classification that disagrees", () => {
    const r = myaraReading();
    r.polls[0].genre = "forecast";
    expect(compareDraftToReading(myaraDraft(), r).diffs.join()).toMatch(
      /genre: extractor raw_attitudes vs reader forecast/,
    );
  });
});

describe("compareDraftToReading — parliamentary labels", () => {
  const parliamentary = () => {
    const d = myaraDraft() as unknown as InboxDraft;
    const draft = {
      ...d,
      race: "parliamentary",
      poll: { ...d.poll, questions: [] },
      details: [
        {
          pollId: "p",
          agencyId: "AR",
          support: 6,
          nickName_bg: "РБ",
          nickName_en: "",
        },
        {
          pollId: "p",
          agencyId: "AR",
          support: 6,
          nickName_bg: "КП ББЦ",
          nickName_en: "",
        },
      ],
    } as unknown as InboxDraft;
    const r = myaraReading();
    r.polls[0].race = "parliamentary";
    r.polls[0].questions[0].answers = [
      {
        label: "Реформаторски блок",
        kind: "choice",
        value: 6,
        quote: "Реформаторски блок 6",
        image: null,
      },
      {
        label: "България без цензура",
        kind: "choice",
        value: 6,
        quote: "България без цензура 6",
        image: null,
      },
      {
        label: "Други",
        kind: "other",
        value: 3.9,
        quote: "Други 3,9",
        image: null,
      },
    ];
    return { draft, r };
  };
  const aliases = new Map([
    ["рб", ["РЕФОРМАТОРСКИ БЛОК – БЗНС, ДБГ, ДСБ, НПСД, СДС"]],
    [
      "ббц",
      ["БЪЛГАРИЯ БЕЗ ЦЕНЗУРА, ВМРО-БНД, ЗЕМЕДЕЛСКИ НАРОДЕН СЪЮЗ И ГЕОРГИДЕН"],
    ],
  ]);

  it("matches a short name to the reader's full name through ЦИК's list, ignoring Други", () => {
    const { draft, r } = parliamentary();
    expect(compareDraftToReading(draft, r, aliases).diffs).toEqual([]);
  });

  it("does not match without the alias table", () => {
    const { draft, r } = parliamentary();
    expect(compareDraftToReading(draft, r).agree).toBe(false);
  });

  it("an alias never rescues a value disagreement", () => {
    const { draft, r } = parliamentary();
    r.polls[0].questions[0].answers[0].value = 6.5;
    expect(compareDraftToReading(draft, r, aliases).diffs.join()).toMatch(
      /РБ.*6.*6.5/,
    );
  });
});

describe("compareDraftToReading — every published figure is checked", () => {
  it("flags a residual only the extractor states", () => {
    const d = myaraDraft();
    d.poll.questions![0].residual = {
      undecided: 9,
      wontVote: null,
      wontSay: null,
      otherNamedMinor: null,
    };
    expect(compareDraftToReading(d, myaraReading()).diffs.join()).toMatch(
      /undecided extractor 9 vs reader —/,
    );
  });

  it("compares the reader's „Други\" with otherNamedMinor when the extractor recorded one", () => {
    const d = myaraDraft();
    d.details = d.details.filter((r) => r.candidateKey !== "placeholder:друг");
    d.poll.questions![0].residual = {
      undecided: null,
      wontVote: null,
      wontSay: null,
      otherNamedMinor: 7.6,
    };
    expect(compareDraftToReading(d, myaraReading()).agree).toBe(true);
    const r = myaraReading();
    r.polls[0].questions[0].answers = r.polls[0].questions[0].answers.filter(
      (a) => a.kind !== "other",
    );
    expect(compareDraftToReading(d, r).diffs.join()).toMatch(
      /other extractor 7.6 vs reader —/,
    );
  });

  it("fails closed on runoffs and participation figures it does not compare", () => {
    const d = myaraDraft();
    d.runoffs = [{} as (typeof d.runoffs)[number]];
    d.poll.questions!.push({
      ...d.poll.questions![0],
      id: "turnout",
      measure: "participation",
      observations: [{ answerCode: "will_vote", share: 35.4 }],
    });
    const diffs = compareDraftToReading(d, myaraReading()).diffs.join("\n");
    expect(diffs).toMatch(/runoff/);
    expect(diffs).toMatch(/participation question „turnout"/);
  });

  it("catches values swapped between a name and its longer form", () => {
    const d = myaraDraft();
    d.details[0].candidateName_bg = "Иван Петров";
    d.details[0].support = 10;
    d.details[1].candidateName_bg = "Иван Петров Иванов";
    d.details[1].support = 20;
    const r = myaraReading();
    const [a, b] = r.polls[0].questions[0].answers;
    Object.assign(a, { label: "Иван Петров Иванов", value: 10 });
    Object.assign(b, { label: "Иван Петров", value: 20 });
    expect(compareDraftToReading(d, r).agree).toBe(false);
  });
});

describe("validateReading", () => {
  it("accepts a well-formed reading", () => {
    expect(validateReading(myaraReading())).toEqual([]);
  });
  it("rejects an answer with neither a quote nor an image", () => {
    const r = myaraReading();
    r.polls[0].questions[0].answers[0].quote = null;
    expect(validateReading(r).join()).toMatch(/quote or an image/);
  });
  it("rejects a methodology that is not a {bg, en} pair", () => {
    const r = myaraReading();
    (r.polls[0] as unknown as Record<string, unknown>).methodology =
      "лично интервю";
    expect(validateReading(r).join()).toMatch(/methodology must be/);
  });
  it.each([
    ["a blank English side", { bg: "лично интервю", en: "  " }],
    ["a missing English side", { bg: "лично интервю" }],
    ["a non-string side", { bg: "лично интервю", en: 5 }],
  ])("rejects a methodology with %s", (_label, methodology) => {
    const r = myaraReading();
    (r.polls[0] as unknown as Record<string, unknown>).methodology =
      methodology;
    expect(validateReading(r).join()).toMatch(/methodology must be/);
  });
  it("accepts a null methodology", () => {
    const r = myaraReading();
    r.polls[0].methodology = null;
    expect(validateReading(r)).toEqual([]);
  });
  it("rejects a non-ISO date and a wrong schema tag", () => {
    const r = myaraReading() as unknown as Record<string, unknown>;
    r.schema = "v0";
    (r.polls as AiReading["polls"])[0].fieldworkEnd = "4 октомври";
    expect(validateReading(r).join()).toMatch(
      /schema.*fieldworkEnd|fieldworkEnd.*schema|schema/,
    );
  });
});

describe("aiReviewStamp", () => {
  const reviewed = () => {
    const d = myaraDraft();
    d.aiReview = {
      verdict: "agree",
      model: "m",
      reviewedAt: "t",
      draftHash: reviewDraftHash(d),
      diffs: [],
    };
    return d;
  };
  it("stamps an agreeing review that still matches the draft", () => {
    expect(aiReviewStamp(reviewed())?.kind).toBe("ai_agreement");
  });
  it("does not stamp after a hand edit", () => {
    const d = reviewed();
    d.details[0].support = 47;
    expect(aiReviewStamp(d)).toBeUndefined();
  });
  it("never stamps a needs_human review", () => {
    const d = reviewed();
    d.aiReview!.verdict = "needs_human";
    expect(aiReviewStamp(d)).toBeUndefined();
  });
});
