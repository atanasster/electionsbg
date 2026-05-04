import { FC, CSSProperties } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { initials, cn } from "@/lib/utils";
import { useMps } from "@/data/parliament/useMps";
import { useParliamentGroups } from "@/data/parliament/useParliamentGroups";

type Props = {
  name?: string | null;
  mpId?: number | null;
  className?: string;
  /** When true (default), draws a thin party-coloured ring around the avatar
   * derived from the MP's parliament group. Set to false for places where the
   * surrounding UI already conveys party. */
  showPartyRing?: boolean;
};

export const MpAvatar: FC<Props> = ({
  name,
  mpId,
  className,
  showPartyRing = true,
}) => {
  const { findMpByName, findMpById } = useMps();
  const { lookup } = useParliamentGroups();
  const mp = findMpById(mpId) ?? findMpByName(name);
  const photoUrl = mp?.photoUrl;
  const displayName = mp?.name ?? name ?? "";
  const group = showPartyRing ? lookup(mp?.currentPartyGroupShort) : undefined;
  const ringStyle: CSSProperties | undefined = group
    ? { ["--tw-ring-color" as string]: group.color }
    : undefined;
  return (
    <Avatar
      className={cn("h-5 w-5 shrink-0", group && "ring-2", className)}
      style={ringStyle}
    >
      {photoUrl && (
        <AvatarImage
          src={photoUrl}
          alt={displayName}
          className="object-cover"
        />
      )}
      <AvatarFallback className="text-[8px] font-semibold bg-muted text-muted-foreground">
        {initials(displayName)}
      </AvatarFallback>
    </Avatar>
  );
};
