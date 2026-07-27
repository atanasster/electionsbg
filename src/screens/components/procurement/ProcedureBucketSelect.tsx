// Bucketed procedure dropdown for the contracts toolbars — mirrors the mix bar's
// vocabulary and drives the same ?proc bucket filter. Shared by the global and
// per-entity contracts browsers. Renders nothing until the facet
// has buckets, so the caller can drop it unconditionally.

import { FC } from "react";
import { useTranslation } from "react-i18next";
import {
  procedureLabel,
  type MethodBucketFacet,
  type ProcedureBucket,
} from "@/lib/cpvSectors";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const ALL = "__all__";

export const ProcedureBucketSelect: FC<{
  groupedMethods: MethodBucketFacet[];
  value: ProcedureBucket | null;
  onChange: (b: ProcedureBucket | null) => void;
}> = ({ groupedMethods, value, onChange }) => {
  const { t, i18n } = useTranslation();
  if (groupedMethods.length === 0) return null;
  return (
    <Select
      value={value ?? ALL}
      onValueChange={(v) => onChange(v === ALL ? null : (v as ProcedureBucket))}
    >
      <SelectTrigger className="w-auto h-9 max-w-[220px]">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>
          {t("company_contracts_all_procedures") || "Всички процедури"}
        </SelectItem>
        {groupedMethods.map((g) => (
          <SelectItem key={g.bucket} value={g.bucket}>
            {procedureLabel(g.bucket, i18n.language)} ({g.count})
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
};
