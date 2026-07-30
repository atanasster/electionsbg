// "само свързани с депутати" toggle for the /procurement/contractors toolbar.
// Drives the ?mp URL filter → is_mp_tied = true. Mirrors SingleBidderToggle.

import { FC } from "react";
import { useTranslation } from "react-i18next";

export const MpTiedToggle: FC<{
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
      {t("contractors_mp_tied_only") || "само свързани с депутати"}
    </label>
  );
};
