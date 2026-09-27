// The election-freeze banner (news-person-sentiment-v1 §8.2). On every
// surface that serves a frozen or withheld person aggregate, with the dates
// STATED in Europe/Sofia time rather than relative („до утре" is wrong for a
// reader in another zone, and wrong again tomorrow).

import type { FreezeStamps } from "../data";
import { freezeText } from "../freeze";
import { useNewsLocale } from "../i18n";

export const FreezeBanner = ({
  stamps,
  className = "",
}: {
  stamps: FreezeStamps | null | undefined;
  className?: string;
}) => {
  const { isEnglish } = useNewsLocale();
  const text = freezeText(stamps, isEnglish);
  if (!text) return null;
  return (
    <p
      role="status"
      data-testid="freeze-banner"
      className={`rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm ${className}`}
    >
      {text}
    </p>
  );
};
