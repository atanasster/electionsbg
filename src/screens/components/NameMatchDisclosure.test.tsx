// The shared footer caveat — the tri-state its two consumers only exercise in aggregate.
//
// Both consumer suites (PersonCompanies, PersonNgoSeats) pass through this component, so a
// broken guard fails there too. What they do NOT pin is the distinction this file exists for:
// `null` and `1` produce the same rendered output — silence — for completely different
// reasons, and a future change that collapsed "unmeasured" into "1 person" would keep both
// suites green while turning missing evidence into a clean bill of health.
//
//   npm run test:unit

import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { NameMatchDisclosure } from "./NameMatchDisclosure";

const COUNT_SENTENCE = /различни лица с това име/;
const NAMESAKE = /Лицата в Търговския регистър се идентифицират/;

describe("NameMatchDisclosure", () => {
  it("always states the name-match caveat — that is the whole reason it renders", () => {
    // The component is only mounted when a block already decided at least one row rests on a
    // name, so there is no state in which it renders and says nothing.
    render(<NameMatchDisclosure />);
    expect(screen.getByText(NAMESAKE)).toBeTruthy();
  });

  it("states the registry's count only when the fold is MEASURED and SHARED", () => {
    render(<NameMatchDisclosure foldPeopleN={2} />);
    expect(screen.getByText(COUNT_SENTENCE)).toBeTruthy();
  });

  it("stays silent at 1 — a fold the registry says is one person needs no sentence", () => {
    render(<NameMatchDisclosure foldPeopleN={1} />);
    expect(screen.queryByText(COUNT_SENTENCE)).toBeNull();
  });

  it("stays silent when UNMEASURED, which is NOT the same claim as 1", () => {
    // null/undefined mean the fold was never observed in the TR feed's window. Rendering it
    // as "1 person" would assert uniqueness on evidence we do not have; rendering it as a
    // count would invent one. Silence is the only honest option, and it is why this case
    // cannot be distinguished from the one above by output alone — hence this test.
    render(<NameMatchDisclosure foldPeopleN={null} />);
    expect(screen.queryByText(COUNT_SENTENCE)).toBeNull();
    render(<NameMatchDisclosure />);
    expect(screen.queryByText(COUNT_SENTENCE)).toBeNull();
  });

  it("interpolates with `n`, never i18next's `count`", () => {
    // Passing `count` switches i18next to the plural key family (…_one / …_other), which do
    // not exist — so the lookup misses, the defaultValue is bypassed, and the reader gets the
    // bare key `pp_fold_people_n` on the line qualifying a claim about a named person. The
    // component's own comment says so; nothing enforced it until now.
    //
    // i18next is not initialised in jsdom, so `t` returns the defaultValue with {{n}}
    // unsubstituted — which is exactly what makes this assertion possible: the placeholder
    // surviving proves the `n` key was used and no plural lookup was attempted.
    render(<NameMatchDisclosure foldPeopleN={7} />);
    expect(screen.getByText(/\{\{n\}\} различни лица/)).toBeTruthy();
    expect(screen.queryByText(/pp_fold_people_n/)).toBeNull();
  });
});
