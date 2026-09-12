import {
  decodeRollcallQuery,
  encodeRollcallQuery,
  validateRollcallQuery,
  type RollcallQuery,
  type RollcallArgs,
} from "./rollcallQuery";
import {
  understandRollcall,
  rollcallCorpus,
} from "../../ai/orchestrator/rollcallUnderstanding";
export type RollcallFocus = { key: string; source_url?: string | null };
export type RollcallContinuation = {
  query?: RollcallQuery;
  question?: string;
  previous?: RollcallQuery;
  reason?: string;
  notice?: string;
};
const finish = (raw: RollcallArgs): RollcallContinuation => {
  const p = validateRollcallQuery(raw);
  return p.ok ? { query: p.query } : { reason: "scope" };
};
export function refreshRollcall(q: RollcallQuery): RollcallQuery {
  const copy = { ...q, offset: 0 };
  delete copy.expectedRevision;
  if (copy.parentQuery) {
    const parent = decodeRollcallQuery(copy.parentQuery);
    if (parent.ok)
      copy.parentQuery = encodeRollcallQuery(refreshRollcall(parent.query));
  }
  return copy;
}
function editParents(
  q: RollcallQuery,
  edit: (q: RollcallQuery) => void,
): RollcallQuery {
  const copy = { ...q };
  edit(copy);
  if (copy.parentQuery) {
    const p = decodeRollcallQuery(copy.parentQuery);
    if (p.ok)
      copy.parentQuery = encodeRollcallQuery(editParents(p.query, edit));
  }
  return copy;
}
export function rollcallContinuation(
  text: string,
  q: RollcallQuery,
  focus: RollcallFocus[] = [],
): RollcallContinuation | null {
  const t = text.trim(),
    base = { ...q, offset: 0 };
  if (/^(?:покажи )?следващите|show the next|next page/i.test(t))
    return finish({ ...q, offset: q.offset + q.limit });
  if (/махни.*тем|remove.*topic/i.test(t)) {
    return finish(
      editParents(base, (x) => {
        delete x.topicIds;
        delete x.keyword;
      }),
    );
  }
  if (/включи.*преглас|include re-votes|all attempts/i.test(t))
    return finish(
      editParents(base, (x) => {
        x.basis = "attempts";
      }),
    );
  if (/окончателните|standing votes/i.test(t))
    return finish(
      editParents(base, (x) => {
        x.basis = "standing";
      }),
    );
  if (/по месеци|by month/i.test(t))
    return finish({ ...base, operation: "trend", groupBy: "month" });
  if (/знаменател|denominator|липсва.*поимен|named roll missing/i.test(t))
    return finish({ ...base, operation: "summary" });
  if (/предходната година|previous year/i.test(t)) {
    if (!q.from || !q.toExclusive || q.latestN) return { reason: "dates" };
    const shift = (date: string) => `${+date.slice(0, 4) - 1}${date.slice(4)}`;
    return finish({
      ...base,
      operation: "compare",
      compareFrom: shift(q.from),
      compareToExclusive: shift(q.toExclusive),
    });
  }
  if (
    /по второто|second one|това заседание|that sitting|оригиналния документ|original document/i.test(
      t,
    )
  ) {
    const second = /второто|second/i.test(t);
    const row = second ? focus[1] : focus.length === 1 ? focus[0] : undefined;
    const key = row?.key || (!second ? q.key : undefined);
    if (!key) return { reason: "record" };
    if (/документ|document/i.test(t))
      return finish({ ...base, operation: "detail", key });
    const session = q.corpus.endsWith("Sessions");
    const parent = {
      ...base,
      key,
      operation: "detail" as const,
      latestN: undefined,
    };
    return finish({
      corpus: session
        ? q.corpus.startsWith("council")
          ? "councilResolutions"
          : "parliamentVotes"
        : q.corpus.startsWith("council")
          ? "councilCasts"
          : "parliamentCasts",
      parentQuery: encodeRollcallQuery(parent),
      relationship: session ? "sessionVotes" : "voteCasts",
      expectedRevision: q.expectedRevision,
    });
  }
  if (
    /само.*против|only.*against|колко от тях.*за|how many of those.*for/i.test(
      t,
    )
  ) {
    const forChoice = /колко|how many/i.test(t);
    const choice = forChoice ? "for" : "against";
    if (q.corpus.endsWith("Casts"))
      return finish({
        ...base,
        choice,
        operation: forChoice ? "share" : "list",
        metric: forChoice ? "choiceShare" : "records",
        groupBy: undefined,
      });
    if (q.corpus.endsWith("Sessions")) return { reason: "record" };
    return finish({
      corpus: q.corpus.startsWith("council")
        ? "councilCasts"
        : "parliamentCasts",
      parentQuery: encodeRollcallQuery(q),
      relationship: "voteCasts",
      choice,
      operation: forChoice ? "share" : "list",
      metric: forChoice ? "choiceShare" : "records",
      expectedRevision: q.expectedRevision,
    });
  }
  const explicit =
    rollcallCorpus(t) ||
    (/council|общински.*съвет/i.test(t) ? "councilResolutions" : null);
  if (
    explicit &&
    explicit.startsWith("council") !== q.corpus.startsWith("council")
  ) {
    const cleared = validateRollcallQuery({
      corpus: explicit,
      from: q.from,
      toExclusive: q.toExclusive,
      topicIds: q.topicIds,
      keyword: q.keyword,
    });
    return cleared.ok
      ? { question: t, previous: cleared.query, notice: "body_changed" }
      : { reason: "scope" };
  }
  if (
    /^(?:а |само |махни |покажи |and |only |remove |show )/i.test(t) ||
    explicit
  ) {
    if (
      /^(?:а за |and for )/i.test(t) &&
      !/(?:20\d{2}|здрав|health|бюджет|budget)/i.test(t)
    )
      return {
        question:
          (q.corpus.startsWith("council")
            ? "Как гласува съветникът "
            : "Как гласува ") + t.replace(/^(?:а за |and for )/i, ""),
        previous: {
          ...base,
          corpus: q.corpus.startsWith("council")
            ? "councilCasts"
            : "parliamentCasts",
        },
      };
    const result = understandRollcall(t, { previous: base });
    if (result.kind === "none") return null;
    if (result.needs || result.names.length)
      return { question: t, previous: base };
    const changedDates =
      result.draft.from !== q.from ||
      result.draft.toExclusive !== q.toExclusive;
    const changedTopics =
      JSON.stringify(result.draft.topicIds) !== JSON.stringify(q.topicIds) ||
      result.draft.keyword !== q.keyword;
    if (changedDates || changedTopics) {
      let cleared = false;
      const p = validateRollcallQuery(result.draft);
      if (!p.ok) return { reason: "scope" };
      const edited = editParents(p.query, (part) => {
        if (changedDates) {
          part.from = result.draft.from;
          part.toExclusive = result.draft.toExclusive;
          if (part.key || part.sessionKey) cleared = true;
          delete part.key;
          delete part.sessionKey;
          if (part.operation === "detail") part.operation = "list";
        }
        if (changedTopics) {
          part.topicIds = result.draft.topicIds;
          part.keyword = result.draft.keyword;
        }
      });
      return {
        ...finish(edited),
        notice: cleared ? "record_scope_cleared" : undefined,
      };
    }
    return finish(result.draft);
  }
  return null;
}
