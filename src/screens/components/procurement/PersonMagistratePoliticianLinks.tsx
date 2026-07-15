// "Възможна връзка с политик (през декларирано дружество)" on the /person/:name page.
// The richer bridge: if this person is a magistrate, walk from the companies they
// DECLARED (ИВСС чл. 175а ЗСВ) over the TR officer graph to any company tied to a
// politician, and show the chain. Renders nothing unless a link is found (rare).
//
// Framing: magistrates own shares but are not officers, so this is a multi-hop,
// name-matched LEAD — magistrate → declared company → shared officer → … →
// politician's company — never proof. Mirrors the connection-check path styling.

import { FC } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Landmark } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { decodeEntities } from "@/lib/decodeEntities";
import { useMagistratePoliticianLinks } from "@/data/judiciary/useMagistrateHoldings";

export const PersonMagistratePoliticianLinks: FC<{ name: string }> = ({
  name,
}) => {
  const { i18n } = useTranslation();
  const bg = i18n.language === "bg";
  const links = useMagistratePoliticianLinks(name);
  if (!links.length) return null;

  // Bulgarian feminine ordinals for "степен" (1-ва, 2-ра, 3-та).
  const BG_ORD: Record<number, string> = { 1: "1-ва", 2: "2-ра", 3: "3-та" };
  const degreeLabel = (d: number): string =>
    d === 0
      ? bg
        ? "общо дружество"
        : "shared company"
      : bg
        ? `връзка на ${BG_ORD[d] ?? `${d}-та`} степен`
        : `${d}-degree link`;

  // A bridge officer can be a CORPORATE entity (a holding company that sits on both
  // firms), not a person — those must not link to a /person page.
  const isCompanyLike = (s: string): boolean =>
    /(?:ЕООД|ЕАД|ООД|АД|КД|СД|ДЗЗД|ЕТ)\s*["“”»]?$/.test(s.trim());

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Landmark className="h-4 w-4" />
          {bg
            ? "Възможна връзка с политик (през декларирано дружество)"
            : "Possible link to a politician (via a declared company)"}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 p-3 md:p-4">
        {links.map((l, i) => (
          <div key={`${l.ref}-${i}`} className="text-sm">
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
              <Link
                to={l.ref}
                className="font-medium text-accent hover:underline"
              >
                {l.politician}
              </Link>
              <span className="text-xs text-muted-foreground">
                {l.kind === "mp"
                  ? bg
                    ? "депутат"
                    : "MP"
                  : bg
                    ? "длъжностно лице"
                    : "official"}
                {l.role ? ` · ${l.role}` : ""} · {degreeLabel(l.degree)}
              </span>
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-muted-foreground">
              {l.path.companies.map((c, j) => (
                <span
                  key={`${c.eik}-${j}`}
                  className="flex items-center gap-1.5"
                >
                  {j > 0 &&
                    (() => {
                      const bridge = l.path.people[j - 1] ?? "";
                      return (
                        <span>
                          →{" "}
                          {isCompanyLike(bridge) ? (
                            <span className="italic">
                              {decodeEntities(bridge)}
                            </span>
                          ) : (
                            <Link
                              to={`/person/${encodeURIComponent(bridge)}`}
                              className="text-accent hover:underline"
                            >
                              {decodeEntities(bridge)}
                            </Link>
                          )}{" "}
                          →
                        </span>
                      );
                    })()}
                  <Link
                    to={`/company/${c.eik}`}
                    className={
                      j === 0
                        ? "font-medium text-foreground hover:underline"
                        : "text-accent hover:underline"
                    }
                  >
                    {decodeEntities(c.name) || c.eik}
                  </Link>
                </span>
              ))}
            </div>
          </div>
        ))}
        <p className="mt-1 text-[11px] text-muted-foreground/80">
          {bg
            ? "Магистратът е декларирал дял/участие в първото дружество, което през общ управител или съдружник води до дружество, свързано с политик. Съвпадение по име в Търговския регистър — следа, не доказателство; магистратите не са изборни лица."
            : "The magistrate declared a stake in the first company, which — through a shared manager or partner — leads to a company tied to a politician. Name-matched in the Commerce Registry; a lead, not proof, and magistrates are not elected officials."}
        </p>
      </CardContent>
    </Card>
  );
};
