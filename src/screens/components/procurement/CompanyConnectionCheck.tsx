// "Проверка на връзка с лице" for the DB company page — the company-anchored
// analog of the person page's connection check. Type any person name and see
// (a) whether they hold a role in THIS company directly, and (b) bridge
// companies where they co-appear with one of this company's officers. Fed by
// company_connection() (PG). Name-only match — a lead, not proof.

import { FC, useCallback, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Link2, Search } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { trRoleLabel } from "@/lib/trRole";
import { decodeEntities } from "@/lib/decodeEntities";

interface DirectRow {
  name: string;
  roles: string | null;
  active: boolean;
}
interface BridgeRow {
  eik: string;
  company: string | null;
  bridge: string | null;
}
interface PathResult {
  degree: number;
  companies: { eik: string; name: string | null }[];
  people: string[];
}
interface ConnResult {
  direct: DirectRow[];
  shared: BridgeRow[];
  path: PathResult | null;
}
// Bulgarian feminine ordinal for the degree ("2-ра степен", "3-та степен").
// Only degrees 2–3 ever reach the deep-path branch, but the map covers 1–5.
const BG_ORDINAL: Record<number, string> = {
  1: "1-ва",
  2: "2-ра",
  3: "3-та",
  4: "4-та",
  5: "5-та",
};
const bgOrdinal = (n: number): string => BG_ORDINAL[n] ?? `${n}-та`;

export const CompanyConnectionCheck: FC<{ eik: string }> = ({ eik }) => {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [result, setResult] = useState<ConnResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [queried, setQueried] = useState("");

  const rolesLabel = (roles: string | null): string =>
    (roles ?? "")
      .split(",")
      .map((r) => trRoleLabel(r.trim(), t))
      .filter(Boolean)
      .join(", ");

  const check = useCallback(() => {
    const person = name.trim();
    if (!person) return;
    setLoading(true);
    setResult(null);
    setQueried(person);
    fetch(
      `/api/db/company-connection?eik=${encodeURIComponent(eik)}&name=${encodeURIComponent(person)}`,
    )
      .then((r) => r.json())
      .then((j) =>
        setResult({
          direct: j.direct ?? [],
          shared: j.shared ?? [],
          path: j.path ?? null,
        }),
      )
      .catch(() => setResult({ direct: [], shared: [], path: null }))
      .finally(() => setLoading(false));
  }, [name, eik]);

  // Show the multi-hop chain only when there's no direct role and no 1-hop
  // bridge (degree ≥ 2); degrees 0/1 are already covered by direct/shared.
  const deepPath =
    result &&
    result.direct.length === 0 &&
    result.shared.length === 0 &&
    result.path &&
    result.path.degree >= 2
      ? result.path
      : null;
  const empty =
    result &&
    result.direct.length === 0 &&
    result.shared.length === 0 &&
    !deepPath;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Link2 className="h-4 w-4" />
          {t("company_conn_check_title") || "Проверка на връзка с лице"}
          <span className="text-xs text-muted-foreground font-normal ml-1">
            {t("company_conn_check_subtitle") ||
              "Има ли това лице роля във фирмата или обща фирма с неин представител"}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="mb-3 flex gap-2">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && check()}
            placeholder={t("company_conn_check_ph") || "име на лице…"}
            className="h-9 max-w-md"
          />
          <Button onClick={check} disabled={loading}>
            <Search className="mr-1 h-4 w-4" />{" "}
            {t("company_conn_check_go") || "Провери"}
          </Button>
        </div>

        {result && (
          <div className="space-y-3 text-sm">
            {result.direct.length > 0 && (
              <div>
                „
                <Link
                  to={`/person/${encodeURIComponent(result.direct[0].name)}`}
                  className="font-medium text-accent hover:underline"
                >
                  {decodeEntities(result.direct[0].name) || queried}
                </Link>
                “ {t("company_conn_check_direct") || "е"}{" "}
                <span className="text-foreground">
                  {rolesLabel(result.direct[0].roles)}
                </span>{" "}
                {t("company_conn_check_here") || "в тази фирма"}
                {result.direct[0].active ? "" : " (бивш)"}.
              </div>
            )}

            {result.shared.length > 0 && (
              <div>
                <div className="mb-1 text-muted-foreground">
                  {t("company_conn_check_bridges") ||
                    "Общи фирми с представител на компанията"}{" "}
                  ({result.shared.length}):
                </div>
                <ul className="space-y-1">
                  {result.shared.map((b, i) => (
                    <li key={`${b.eik}-${i}`}>
                      <Link
                        to={`/company/${b.eik}`}
                        className="text-accent hover:underline"
                      >
                        {decodeEntities(b.company) || b.eik}
                      </Link>
                      {b.bridge ? (
                        <span className="text-muted-foreground">
                          {" "}
                          — {t("company_conn_check_via") || "чрез"}{" "}
                          <Link
                            to={`/person/${encodeURIComponent(b.bridge)}`}
                            className="text-accent hover:underline"
                          >
                            {decodeEntities(b.bridge)}
                          </Link>
                        </span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {deepPath && (
              <div>
                <div className="mb-1 text-muted-foreground">
                  {t("company_conn_check_degree", {
                    degree: deepPath.degree,
                    ord: bgOrdinal(deepPath.degree),
                    defaultValue: "Свързан на {{ord}} степен на отдалеченост:",
                  })}
                </div>
                <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
                  {deepPath.companies.map((c, i) => (
                    <span
                      key={`${c.eik}-${i}`}
                      className="flex items-center gap-1.5"
                    >
                      {i > 0 && (
                        <span className="text-muted-foreground">
                          →{" "}
                          <Link
                            to={`/person/${encodeURIComponent(deepPath.people[i - 1] ?? "")}`}
                            className="text-accent hover:underline"
                          >
                            {decodeEntities(deepPath.people[i - 1])}
                          </Link>{" "}
                          →
                        </span>
                      )}
                      <Link
                        to={`/company/${c.eik}`}
                        className={
                          i === 0
                            ? "font-medium"
                            : "text-accent hover:underline"
                        }
                      >
                        {decodeEntities(c.name) || c.eik}
                      </Link>
                    </span>
                  ))}
                  <span className="text-muted-foreground">
                    →{" "}
                    <Link
                      to={`/person/${encodeURIComponent(queried)}`}
                      className="text-accent hover:underline"
                    >
                      {queried}
                    </Link>
                  </span>
                </div>
              </div>
            )}

            {empty && (
              <div className="text-muted-foreground">
                {t("company_conn_check_none") ||
                  "Няма открита връзка с това лице."}{" "}
                „{queried}“
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
};
