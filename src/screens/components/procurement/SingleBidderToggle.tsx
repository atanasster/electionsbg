// "само 1 оферта" competition-signal checkbox shared by the contracts toolbars
// Drives the ?single URL filter on both browsers.

import { FC } from "react";
import { useTranslation } from "react-i18next";

export const SingleBidderToggle: FC<{
  checked: boolean;
  onChange: (v: boolean) => void;
}> = ({ checked, onChange }) => {
  const { t } = useTranslation();
  return (
    <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer select-none">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      {t("company_contracts_single_bidder") || "само 1 оферта"}
    </label>
  );
};
