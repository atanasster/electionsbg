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
interface ConnResult {
  direct: DirectRow[];
  shared: BridgeRow[];
}

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
        setResult({ direct: j.direct ?? [], shared: j.shared ?? [] }),
      )
      .catch(() => setResult({ direct: [], shared: [] }))
      .finally(() => setLoading(false));
  }, [name, eik]);

  const empty =
    result && result.direct.length === 0 && result.shared.length === 0;

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
                <span className="font-medium">„{queried}“</span>{" "}
                {t("company_conn_check_direct") || "е"}{" "}
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
                        to={`/db/company/${b.eik}`}
                        className="text-accent hover:underline"
                      >
                        {decodeEntities(b.company) || b.eik}
                      </Link>
                      {b.bridge ? (
                        <span className="text-muted-foreground">
                          {" "}
                          — {t("company_conn_check_via") || "чрез"}{" "}
                          {decodeEntities(b.bridge)}
                        </span>
                      ) : null}
                    </li>
                  ))}
                </ul>
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
