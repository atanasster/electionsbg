// "Connected officials" section on /company/:eik — the non-MP political class
// (mayors, deputy-mayors, councillors, ministers, governors, agency heads)
// tied to this contractor via a declared stake or a unique-name Commerce-
// Registry officer/owner match. Sibling of the MP-linkages card; only renders
// when the per-EIK officials shard has rows. High-confidence links only.

import { FC } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Landmark } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { usePepConnectedByEik } from "@/data/procurement/usePepConnectedByEik";

const roleLabel = (role: string, t: (k: string) => string): string => {
  const key = `official_role_${role}`;
  const translated = t(key);
  return translated === key ? role.replace(/_/g, " ") : translated;
};

export const CompanyOfficialsTile: FC<{ eik: string }> = ({ eik }) => {
  const { t } = useTranslation();
  const { entries, isLoading } = usePepConnectedByEik(eik);

  if (isLoading || entries.length === 0) return null;

  return (
    <Card className="my-4">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Landmark className="h-4 w-4 text-teal-600" />
          {t("company_officials_title") || "Connected officials"}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3 md:p-4">
        <ul className="text-sm space-y-1.5">
          {entries.map((e) => (
            <li key={e.slug} className="flex items-center gap-2 flex-wrap">
              <Link
                to={`/officials/${e.slug}`}
                className="font-medium hover:underline"
              >
                {e.name}
              </Link>
              <span className="text-xs text-muted-foreground">
                — {roleLabel(e.role, t)}
                {e.relations.length > 0
                  ? ` · ${e.relations.map((r) => roleLabel(r.role, t)).join(", ")}`
                  : ""}
              </span>
            </li>
          ))}
        </ul>
        <p className="text-[11px] text-muted-foreground/80 mt-3">
          {t("company_officials_hint") ||
            "Declared stake or Commerce-Registry officer/owner match. A link is a declared tie, not proof of wrongdoing."}
        </p>
      </CardContent>
    </Card>
  );
};
