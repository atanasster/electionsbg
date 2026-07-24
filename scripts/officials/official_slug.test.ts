// What may and may not change an official's profile slug.
//
// The register re-spells declarants between folder years, and the slug is the
// profile's identity — so every spelling that means the same person must hash to
// the same slug, and every spelling that means a DIFFERENT person must not. Both
// directions are destructive when wrong: the first splits one official's wealth
// across several profiles, the second publishes one person's property under
// another's name.
//
// Every fixture below is a real (name, institution) pair from
// data/officials/declarations. Pure functions — `node` Vitest project, no
// network, no filesystem.

import { describe, expect, it } from "vitest";
import { canonicalDeclarantName, officialSlug, slugify } from "./shared";

const body = (slug: string): string => slug.replace(/-[0-9a-f]{6}$/, "");

describe("canonicalDeclarantName", () => {
  it("levels the ALL-CAPS → Title Case switch between the 2023 and 2024 folders", () => {
    expect(canonicalDeclarantName("Алдин Хитов Карагьозов")).toBe(
      canonicalDeclarantName("АЛДИН ХИТОВ КАРАГЬОЗОВ"),
    );
  });

  it("levels hyphen spacing in a double surname", () => {
    expect(canonicalDeclarantName("Весела Николова Караиванова - Начева")).toBe(
      canonicalDeclarantName("Весела Николова Караиванова-Начева"),
    );
  });

  it("drops the academic title in every casing the register uses", () => {
    const bare = canonicalDeclarantName("Ася Русева Генева");
    for (const withTitle of [
      "д-р Ася Русева Генева",
      "Д-р Ася Русева Генева",
      "Д-Р Ася Русева Генева",
    ]) {
      expect(canonicalDeclarantName(withTitle)).toBe(bare);
    }
  });

  it("keeps a trailing digit — it is the register's own disambiguator", () => {
    expect(canonicalDeclarantName("Стоян Георгиев Стоянов1")).not.toBe(
      canonicalDeclarantName("Стоян Георгиев Стоянов"),
    );
  });

  it("does not eat a given name that merely starts with the title's letters", () => {
    // "ДРАГОМИР" opens with the same two letters as the title. The prefix rule
    // demands the hyphen AND a following space, so the given name survives.
    expect(canonicalDeclarantName("Драгомир Събев Йосифов")).toBe(
      "ДРАГОМИР СЪБЕВ ЙОСИФОВ",
    );
  });
});

describe("officialSlug", () => {
  // Весела Николова Караиванова-Начева, подуправител на НОИ — one register
  // person id (943A7E38…) that the hyphen re-spelling forked into two profiles,
  // 2018-2023 apart from 2024-2025.
  const NOI = "Национален осигурителен институт";

  it("puts both spellings of one declarant on one slug", () => {
    expect(officialSlug("Весела Николова Караиванова - Начева", NOI)).toBe(
      officialSlug("Весела Николова Караиванова-Начева", NOI),
    );
  });

  it("puts the case-drifted spellings of one declarant on one slug", () => {
    const inst = 'МБАЛ "Св. Екатерина" ЕООД, гр. Димитровград';
    expect(officialSlug("АЛДИН ХИТОВ КАРАГЬОЗОВ", inst)).toBe(
      officialSlug("Алдин Хитов Карагьозов", inst),
    );
  });

  it("folds the titled and untitled filings of one declarant", () => {
    const inst = "РЗИ";
    expect(officialSlug("д-р Ася Русева Генева", inst)).toBe(
      officialSlug("Ася Русева Генева", inst),
    );
    expect(officialSlug("Д-Р Ася Русева Генева", inst)).toBe(
      officialSlug("Ася Русева Генева", inst),
    );
  });

  it("keeps two same-named people in one group label apart", () => {
    // AF888636… and A571FD82… are different people; the register disambiguates
    // them with the trailing 1. Merging them is the destructive direction.
    const inst = "Училища";
    expect(officialSlug("Стоян Георгиев Стоянов1", inst)).not.toBe(
      officialSlug("Стоян Георгиев Стоянов", inst),
    );
  });

  it("keeps one declarant's two institutions apart", () => {
    const name = "Айсел Исмаил Руфад";
    expect(officialSlug(name, "Финсово управление на средства от ЕС")).not.toBe(
      officialSlug(name, 'ПП "Движение за права и свободи"'),
    );
  });

  it("moves only the hash suffix for a case/hyphen re-spelling", () => {
    const inst = 'МБАЛ "Д-р Маджуров" ООД, гр. Бургас';
    const raw = "Александър Георгиев Маджуров";
    expect(body(officialSlug(raw, inst))).toBe(body(slugify(raw, inst)));
    expect(body(officialSlug(raw, inst))).toBe("aleksandr-georgiev-madzhurov");
  });

  it("shortens the BODY too when a title is dropped — a rename cannot key on the body", () => {
    // The exception to the rule above, and the one that matters for the
    // migration: 13 profiles move body, and they are precisely the ones the
    // title rule exists to merge. Matching old→new shards by a shared body
    // would skip them.
    const inst = "РЗИ";
    expect(body(slugify("д-р Ася Русева Генева", inst))).toBe(
      "d-r-asya-ruseva-geneva",
    );
    expect(body(officialSlug("д-р Ася Русева Генева", inst))).toBe(
      "asya-ruseva-geneva",
    );
  });

  it("pins the published slug — changing normalize() renames every profile", () => {
    // The only assertion here on a literal slug. Every other test is relational
    // (A === B) and would stay green if `normalize` changed under it, silently
    // re-slugging all 21,161 profiles.
    expect(officialSlug("Весела Николова Караиванова-Начева", NOI)).toBe(
      "vesela-nikolova-karaivanova-nacheva-d6a8a2",
    );
  });

  it("leaves the glued and truncated title forms alone", () => {
    // Both are real, and both are DECLARATION-XML names — a population this
    // function is never fed (the slug is minted from the register list name).
    // Pinned so that loosening TITLE_PREFIX to catch them is a deliberate act:
    // a regex wide enough for these is wide enough to eat a given name.
    expect(canonicalDeclarantName("д-рНягол Минчев Няголов")).toBe(
      "Д-РНЯГОЛ МИНЧЕВ НЯГОЛОВ",
    );
    // `normalize` collapses the space after the hyphen, so the truncated title
    // fuses onto the given name rather than surviving as its own token.
    expect(canonicalDeclarantName("д- Васил Николаев Попов")).toBe(
      "Д-ВАСИЛ НИКОЛАЕВ ПОПОВ",
    );
  });

  it("leaves slugify() itself raw, so already-published slugs stay reproducible", () => {
    // ./remerge_collision_slugs.ts reconstructs historical slugs with slugify().
    // If canonicalisation leaked into it, that script would stop finding them.
    const inst = "Област - Добрич";
    expect(slugify("АБИЛ ИСМЕТ АБИЛ", inst)).not.toBe(
      slugify("Абил Исмет Абил", inst),
    );
  });
});
