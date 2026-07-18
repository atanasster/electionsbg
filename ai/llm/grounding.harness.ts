// Unit test for the grounded-number gate (ai/llm/grounding.ts) — the pure,
// ReDoS-safe post-check both model providers use to reject narration prose that
// surfaces a fabricated or ROUNDED figure. Run via npm run ai:test:all.

import { digitRuns, foldDigits, numbersGrounded } from "./grounding";

let failures = 0;
const assert = (cond: boolean, msg: string) => {
  if (!cond) {
    failures += 1;
    console.error(`  ✗ ${msg}`);
  } else console.log(`  ✓ ${msg}`);
};

const run = () => {
  console.log("=== [grounding] numbersGrounded ===");

  // --- helpers reused by both providers -------------------------------------
  assert(foldDigits("٦١٨٢٠٦") === "618206", "foldDigits: Arabic-Indic → ASCII");
  assert(foldDigits("６１８") === "618", "foldDigits: fullwidth → ASCII");
  assert(
    JSON.stringify(digitRuns("618 206 и 25,3%")) ===
      JSON.stringify(["618206", "253"]),
    "digitRuns: grouping space + decimal comma reduce to bare digit runs",
  );
  assert(
    JSON.stringify(digitRuns("през 2023 45 пъти")) ===
      JSON.stringify(["2023", "45"]),
    "digitRuns: a non-3-digit gap is NOT fused (2023 45 stays two tokens)",
  );

  // --- the gate --------------------------------------------------------------
  const facts = { votes: 618206, pct: "25.3%" };

  // fabricated big number not in facts → reject
  assert(
    numbersGrounded("Партията получи 512 900 гласа.", facts) === false,
    "fabricated big number (not in facts) → false",
  );

  // grounded number (matches a facts value) → accept
  assert(
    numbersGrounded("Партията получи 618206 гласа.", facts) === true,
    "grounded number (matches a facts value) → true",
  );

  // localized separators, both forms → accept
  assert(
    numbersGrounded("Партията получи 618 206 гласа.", facts) === true,
    "localized separator: space grouping (618 206) → true",
  );
  assert(
    numbersGrounded("Партията получи 618,206 гласа.", facts) === true,
    "localized separator: comma grouping (618,206) → true",
  );

  // Cyrillic/other-script digits in prose → folded and matched
  assert(
    numbersGrounded("Партията получи ٦١٨٢٠٦ гласа.", facts) === true,
    "other-script (Arabic-Indic) digits are folded and matched → true",
  );

  // percent restated from facts, either separator → accept
  assert(
    numbersGrounded("Това е 25,3% от вота.", facts) === true,
    "percent restated with comma (25,3%) → true",
  );
  assert(
    numbersGrounded("Това е 25.3% от вота.", facts) === true,
    "percent restated with dot (25.3%) → true",
  );

  // model ROUNDING must fall back (rounded value isn't a substring of any fact)
  assert(
    numbersGrounded("Партията получи около 618 000 гласа.", facts) === false,
    "rounded figure (facts 618206, prose 618 000) → false",
  );

  // relational language with no ungrounded number → accept
  assert(
    numbersGrounded("Приблизително половината, повече от преди.", facts) ===
      true,
    "relational language, no ungrounded number → true",
  );
  assert(
    numbersGrounded("Резултатът е по-висок от този на опонента.", facts) ===
      true,
    "comparison with no numbers → true",
  );

  // bare small integers / a year present in a facts date label → not rejected
  const dated = {
    election: "2023_10_27",
    winner: "ГЕРБ",
    parties_over_threshold: 6,
  };
  assert(
    numbersGrounded("На изборите през 2023 г. участваха 6 партии.", dated) ===
      true,
    "year grounded in a date label + a bare small count → true",
  );
  assert(
    numbersGrounded("Класира се на 3-то място сред 5 партии.", facts) === true,
    "bare 1-2 digit ordinals/counts pass unconditionally → true",
  );

  // a small number carrying a currency/magnitude marker is NOT trivial: an
  // ungrounded marked figure must be rejected even though it's one digit. (7 is
  // a substring of neither "618206" nor "253", so it can't ground by substring.)
  assert(
    numbersGrounded("Договорът е за 7 млрд евро.", facts) === false,
    "marked small number (7 млрд) with no facts backing → false",
  );

  // English narration is gated the same way (the number logic is script-agnostic;
  // EN magnitude/currency markers mirror the BG ones).
  assert(
    numbersGrounded("The party got $618,206.", facts) === true,
    "EN: grounded currency amount → true",
  );
  assert(
    numbersGrounded("The party got $512 million.", facts) === false,
    "EN: fabricated $512 million → false",
  );
  assert(
    numbersGrounded("It rose 7 pts higher than before.", facts) === false,
    "EN: marked point-difference (7 pts) absent from facts → false",
  );

  // the grounding material includes `extra` (title/provenance the model saw)
  assert(
    numbersGrounded("Данните са за 2026 г.", {}, "Резултати за 2026_04_19") ===
      true,
    "a number present only in the title (extra) is grounded → true",
  );

  console.log(
    `\n${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`} — grounding gate`,
  );
  process.exit(failures === 0 ? 0 : 1);
};

run();
