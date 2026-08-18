// The beneficiary finder on /subsidies — 16,702 ДФЗ recipients with an ЕИК.
//
// A THIN WRAPPER over the shared `HubSearch` adapter, which is what /parliament and
// /governance/declarations use. The 110-line hand-rolled version this replaces owned its own
// debounce, its own AbortController, its own loading flag and a `buildEntityIndex` pass. All of
// that now lives in one place, and the box gets the shared combobox ARIA, keyboard navigation,
// highlight + scroll-into-view, a stale-response guard the old code did not have, and the
// „searched in: …" empty state.
//
// That `buildEntityIndex` pass is worth a note, because its own comment described it backwards:
// it claimed to STOP the shell re-filtering the server's ranked answer, and it did the
// opposite — it fed those rows through a SECOND, independent matcher (`latinSkeleton` in JS
// against `translit_bg_latin` in SQL), so a row the server ranked could be dropped client-side
// by a fold that disagreed. `EntitySearchTile` does no matching at all and `HubSearch` calls
// `searchIndex()` only for `kind: "index"`, so server rows now pass through untouched.
//
// The source itself — and the rules that make it correct — is `./subsidies/subsidiesSearch`.
// Read that before changing anything here.

import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { HubSearch } from "@/ux/search/HubSearch";
import { subsidiesSearchSources } from "./subsidies/subsidiesSearch";

export const SubsidiesSearchBox: FC = () => {
  const { i18n } = useTranslation();
  const bg = i18n.language === "bg";
  // A factory call, not a constant: the see-all label needs the language, and re-minting the
  // array per render is what every sibling hub does (the sources are three object literals).
  const sources = useMemo(() => subsidiesSearchSources(bg), [bg]);

  return (
    <div className="mb-3">
      <HubSearch
        sources={sources}
        idPrefix="subsidies-search"
        className="max-w-2xl"
        title={{
          bg: "Намери земеделски стопанин",
          en: "Find a farm beneficiary",
        }}
        placeholder={{
          bg: "стопанин, фирма или ЕИК…",
          en: "beneficiary, company or EIK…",
        }}
        hint={{
          bg: "Търси по име, област или ЕИК — приема и изписване на латиница. Физическите лица нямат ЕИК и не се търсят.",
          en: "Search by name, province or EIK — Latin-typed queries work too. Natural persons have no EIK and are not searchable.",
        }}
      />
      {/* The unsearchable half, with somewhere to go. `hint` is a plain string in the shared
          component — widening it to a node would touch every hub — so the link that the plan's
          §7 asks for sits on its own line directly beneath it, which is the same position a
          reader reads it in.

          This is not a footnote: ~40% of the money is on rows with no ЕИК, so a reader whose
          neighbour is one of them gets „no results" from a box that is working correctly. The
          sentence exists so that answer is not mistaken for „received nothing". */}
      <p className="mt-1 max-w-2xl text-[11px] text-muted-foreground">
        {bg ? (
          <>
            Около 40% от парите отиват към редове без ЕИК, които не могат да
            бъдат приписани на получател —{" "}
            <Link
              to="/subsidies/untraceable"
              className="text-primary hover:underline"
            >
              защо
            </Link>
            .
          </>
        ) : (
          <>
            Around 40% of the money sits on rows with no EIK, which cannot be
            attributed to a recipient —{" "}
            <Link
              to="/subsidies/untraceable"
              className="text-primary hover:underline"
            >
              why
            </Link>
            .
          </>
        )}
      </p>
    </div>
  );
};
