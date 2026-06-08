// Community CTA tile — invites the user into the Наясно Facebook group for
// discussion and alerts about their area. The funnel's last tile: once the
// dashboard has shown what's happening, this is the "talk about it" hook.

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { Users } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Anchor } from "@/ux/Anchor";
import { GROUP_URL } from "@/lib/community";

type Props = {
  area: string;
};

export const MyAreaCommunityTile: FC<Props> = ({ area }) => {
  const { t } = useTranslation();
  return (
    <Card className="p-4">
      <div className="flex items-center gap-2 mb-2">
        <Users className="size-4 text-primary" />
        <h2 className="text-sm font-semibold flex-1">
          {t("community_alerts_title")}
        </h2>
      </div>
      <p className="text-sm text-muted-foreground mb-3">
        {t("community_alerts_desc", { area })}
      </p>
      <Anchor
        href={GROUP_URL}
        className="inline-flex items-center gap-1.5 rounded-full border border-input px-3 py-1.5 text-sm font-medium text-foreground hover:bg-muted no-underline"
      >
        <Users className="size-4" />
        {t("community_join")}
      </Anchor>
    </Card>
  );
};
