// The /funds/calls ↔ server-registry contract.
//
// WHY THIS EXISTS. `DbDataTable` forwards `sort: [{ id }]` to /api/db/table verbatim, and
// `buildOrder` (functions/db_table.js) does `if (!def || !def.sort) continue`. So a column id
// that is not in `REGISTRY.open_calls` is DROPPED IN SILENCE — and because a non-empty `sort`
// array also suppresses the registry's own `defaultSort`, the table falls back to `ORDER BY id`
// and serves an ARBITRARY order at a 200.
//
// That is not hypothetical: the first version of the screen used the camelCase RESPONSE field
// names (`closesAt`, `budgetEur`) as column ids, which are not registry ids. Nothing failed —
// no type error, no 400, no console warning. The page rendered with a 2029 deadline first and a
// 36-day one fourth, under a „Краен срок" header the reader has every reason to trust.
//
// The ids are read out of the SOURCE FILE rather than from an exported list, so the gate cannot
// be satisfied by a list that has drifted from the column definitions it claims to describe.

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { REGISTRY } = require("../../../functions/db_table.js");

const SRC = readFileSync(path.join(__dirname, "OpenCallsScreen.tsx"), "utf-8");

/** Every `id: "..."` inside the `columns` memo — i.e. every id this page can sort by. */
const columnIds = (): string[] => {
  const start = SRC.indexOf("const columns = useMemo");
  expect(start).toBeGreaterThan(-1);
  const end = SRC.indexOf("[t, i18n.language]", start);
  expect(end).toBeGreaterThan(start);
  const block = SRC.slice(start, end);
  // `id: "x",` on its own line — inside the columns block that is only ever a column id (the
  // MODES list and the filter objects are outside the slice).
  return [...block.matchAll(/^\s+id: "([a-z_]+)",$/gmu)].map((m) => m[1]);
};

describe("OpenCallsScreen ↔ REGISTRY.open_calls", () => {
  const reg = REGISTRY.open_calls;

  it("the registry entry exists and is backed by the view", () => {
    expect(reg).toBeTruthy();
    // The VIEW, not open_calls_list(): the engine composes its own WHERE/ORDER BY/LIMIT and runs
    // counts and facets over the same relation, so the base must be the full relation.
    expect(reg.base).toBe("open_calls_table");
  });

  it("finds every column id the page declares", () => {
    // Five columns today. A wrong anchor in the regex above would silently find none and make
    // the whole gate vacuous, which is the failure mode of source-parsing tests.
    expect(columnIds().length).toBe(5);
  });

  it("every column id is a REGISTRY column, and sortable", () => {
    for (const id of columnIds()) {
      expect(reg.columns[id], `${id} is not a registry column`).toBeTruthy();
      expect(
        reg.columns[id].sort,
        `${id} is in the registry but not sortable, so buildOrder drops it`,
      ).toBe(true);
    }
  });

  it("no column id is a camelCase response field", () => {
    // The exact mistake this file exists for. `closesAt` etc. would pass a naive
    // `id in reg.columns`-free review and fail nothing at runtime.
    for (const id of columnIds())
      expect(id, `${id} looks like a response field, not a column id`).toBe(
        id.toLowerCase(),
      );
  });

  it("the default sort is a registry column too", () => {
    const m = SRC.match(/const DEFAULT_SORT = \[\{ id: "([a-z_]+)"/u);
    expect(m).toBeTruthy();
    const id = m![1];
    expect(reg.columns[id]?.sort).toBe(true);
  });

  it("the search placeholder's promise is backed by a searchable column", () => {
    // The placeholder says „заглавие или код": measured on the live corpus, all 45 open rows
    // carry a code and NONE has it in the title, so a title-only search returned nothing for
    // every code query — at a 200, with the row present.
    expect(reg.columns.title.search).toBe(true);
    expect(reg.columns.code.search).toBe(true);
  });

  it("the status/kind pairing the picker sends is filterable", () => {
    // `status` alone would leave the registry's kind='call' default in place, so the
    // „проекти на насоки" mode would return zero rows: a consultation is kind='consultation'
    // by construction (142's status CASE).
    expect(reg.columns.status.filter).toBe("in");
    expect(reg.columns.kind.filter).toBe("in");
    const modes = [
      ...SRC.matchAll(/\{ id: "(\w+)", status: "(\w+)", kind: "(\w+)" \}/gu),
    ];
    expect(modes.length).toBe(5);
    const consult = modes.find((m) => m[1] === "consultation");
    expect(consult?.[3]).toBe("consultation");
  });

  it("the floor the page documents is the floor the server applies", () => {
    // The file header tells the reader the page opens on kind='call' + status='open'. If the
    // registry's defaults moved, that prose would become wrong and the page would open on the
    // oldest expired rows (`closes_at ASC` over an archive the loader never deletes from).
    const pairs = (reg.defaultFilters ?? []).map(
      (d: { col: string; val: string }) => `${d.col}=${d.val}`,
    );
    expect(pairs.sort()).toEqual(["kind=call", "status=open"]);
  });
});
