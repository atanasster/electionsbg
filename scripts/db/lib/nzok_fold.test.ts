// Unit tests for the ЕЕОФ financials fold-collision logic — the loader's most
// behaviour-changing part. The loader moved from "skip the whole block on any
// fold collision" (discarding ~120 good rows to lose 2 bad ones) to "drop only
// the colliding fold-groups, abort if the total exceeds COLLISION_BUDGET". This
// threshold logic silently rots when a new quarter's data shifts the drop count,
// so lock the contract here — no database needed.
//
//   npx tsx --test scripts/db/lib/nzok_fold.test.ts

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  fold,
  isJunk,
  partitionFoldCollisions,
  COLLISION_BUDGET,
} from "./nzok_fold";

test("fold: normalises legal forms, titles, saint prefix, repeated tokens", () => {
  // Legal form + geo prefix stripped, saint normalised.
  assert.equal(fold('УМБАЛ "Св. Екатерина" ЕАД'), "УМБАЛ СВ ЕКАТЕРИНА");
  // "Д-р" title dropped.
  assert.equal(fold('МБАЛ "Д-р Тота Венкова" АД'), "МБАЛ ТОТА ВЕНКОВА");
  // A trailing ", гр. Трявна" collapses the repeated town token.
  assert.equal(fold("МБАЛ Трявна ЕООД, гр. Трявна"), "МБАЛ ТРЯВНА");
  assert.equal(fold(""), "");
});

test("isJunk: rejects header/date/total lines, keeps real facilities", () => {
  assert.equal(isJunk("Данни към 30.09.2019 г."), true);
  assert.equal(isJunk("ОБЩО/СРЕДНО, в т.ч. за:"), true);
  assert.equal(isJunk(" ЕАД"), true); // folds to empty
  assert.equal(isJunk('УМБАЛ "Св. Екатерина" ЕАД'), false);
});

test("partitionFoldCollisions: keeps unique folds, drops only the colliding group", () => {
  // 3 distinct hospitals + 2 that fold to the same bare-oblast label.
  const rows = [
    { name: "МБАЛ Айтос ЕООД" },
    { name: "МБАЛ Разлог ЕООД" },
    { name: "УМБАЛ Бургас АД" },
    { name: "Бургас" }, // bare oblast → collides…
    { name: "гр. Бургас" }, // …with this one (both fold to "БУРГАС")
  ];
  const { kept, dropped } = partitionFoldCollisions(rows, (r) => r.name);
  assert.equal(dropped, 2, "only the 2 colliding rows are dropped");
  assert.equal(kept.length, 3, "the 3 unique-fold rows survive");
  assert.deepEqual(
    kept.map((r) => r.name),
    ["МБАЛ Айтос ЕООД", "МБАЛ Разлог ЕООД", "УМБАЛ Бургас АД"],
  );
});

test("partitionFoldCollisions: no collisions → nothing dropped", () => {
  const rows = [{ name: "УМБАЛ Пловдив АД" }, { name: "МБАЛ Кнежа ЕООД" }];
  const { kept, dropped } = partitionFoldCollisions(rows, (r) => r.name);
  assert.equal(dropped, 0);
  assert.equal(kept.length, 2);
});

test("partitionFoldCollisions: a >COLLISION_BUDGET synthetic block trips the budget", () => {
  // The loader aborts when the summed drops exceed COLLISION_BUDGET. Simulate the
  // failure mode: one block of N identical names all collide → N dropped.
  const N = COLLISION_BUDGET + 50;
  const rows = Array.from({ length: N }, () => ({ name: "Бургас" }));
  const { kept, dropped } = partitionFoldCollisions(rows, (r) => r.name);
  assert.equal(kept.length, 0, "all identical-fold rows drop");
  assert.equal(dropped, N);
  assert.ok(
    dropped > COLLISION_BUDGET,
    "this drop count would trip the loader's pre-transaction abort",
  );
});
