// The service finder on /sector/administration — 2,669 административни услуги.
//
// DELIBERATELY NOT a <SectorEntitySearch>. That component is for groups backed
// by a pre-folded client index, and the ИИСДА register is already a server-side
// DbDataTable resource with its own trigram search over `translit_bg_latin` —
// shipping a second copy of 2,669 rows to every reader of this page to
// re-implement a search that already exists would be the worst of both.
//
// So this FORWARDS: type, submit, land on the browse table with ?q= seeded.
// One control, no payload, and the destination's server-side fold is better at
// this than a client index would be.

import { FC, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Search, ArrowRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";

export const ADMIN_SERVICES_PATH = "/sector/administration/services";

export const AdminServicesSearchBox: FC = () => {
  const { i18n } = useTranslation();
  const bg = i18n.language === "bg";
  const navigate = useNavigate();
  const [q, setQ] = useState("");

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const term = q.trim();
    // An empty submit still goes to the register — "show me everything" is a
    // reasonable thing to ask of a finder, and the table is the right answer.
    navigate(
      term
        ? `${ADMIN_SERVICES_PATH}?q=${encodeURIComponent(term)}`
        : ADMIN_SERVICES_PATH,
    );
  };

  return (
    <Card className="my-4">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Search className="h-4 w-4 text-muted-foreground" />
          {bg
            ? "Намери административна услуга"
            : "Find an administrative service"}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3 pt-0 md:p-4 md:pt-0">
        <form onSubmit={submit} className="flex gap-2">
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={
              bg
                ? "напр. лиценз, разрешение, удостоверение…"
                : "e.g. licence, permit, certificate…"
            }
            aria-label={bg ? "Търсене на услуга" : "Search a service"}
            className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
          />
          <button
            type="submit"
            className="inline-flex shrink-0 items-center gap-1 rounded-md border px-3 py-2 text-sm hover:border-primary/50 hover:text-primary"
          >
            {bg ? "Търси" : "Search"}
            <ArrowRight className="h-3.5 w-3.5" />
          </button>
        </form>
        {/* NO shliokavitsa claim here, unlike the other sector boxes. This one
            forwards to a SERVER-side search (translit_bg_latin), which folds
            Cyrillic→Latin but has neither the shlyo rules nor the ч/х collapse
            the client folder applies — verified: "лиценз" returns rows,
            "licenz" returns none, because ц folds to "ts". Promising Latin
            input here would be a false claim, and the one thing worse than a
            search that misses is a search that says it will not. */}
        {/* No hardcoded row count. The destination renders the live total from
            admin_services, and a number frozen in copy here would drift away
            from it on the next ИИСДА ingest with nothing to catch it. */}
        <p className="mt-2 text-[11px] text-muted-foreground">
          {bg
            ? "Търсенето се изпълнява в пълния регистър ИИСДА, на кирилица."
            : "The search runs against the full ИИСДА register, in Cyrillic."}
        </p>
      </CardContent>
    </Card>
  );
};
