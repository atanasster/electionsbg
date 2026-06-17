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

type ViewProps = {
  /** Absolute (already dataUrl-resolved) photo URL, or empty/null for initials. */
  photoUrl?: string | null;
  /** Name to derive the fallback initials from and label the image. */
  displayName: string;
  /** Party-colour ring colour; omit/null for no ring. */
  ringColor?: string | null;
  className?: string;
};

/** Presentational avatar — no data hooks. Use this when the caller already
 * holds the photo URL + party colour (e.g. from a resolved-candidate shard),
 * so the page doesn't download parliament/index.json just to render a face. */
export const MpAvatarView: FC<ViewProps> = ({
  photoUrl,
  displayName,
  ringColor,
  className,
}) => {
  const ringStyle: CSSProperties | undefined = ringColor
    ? { ["--tw-ring-color" as string]: ringColor }
    : undefined;
  return (
    <Avatar
      className={cn("h-5 w-5 shrink-0", ringColor && "ring-2", className)}
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

/** Connected avatar — resolves the MP by id/name through the parliament index.
 * Prefer `MpAvatarView` on hot paths where the photo is already known. */
export const MpAvatar: FC<Props> = ({
  name,
  mpId,
  className,
  showPartyRing = true,
}) => {
  const { findMpByName, findMpById } = useMps();
  const { lookup } = useParliamentGroups();
  const mp = findMpById(mpId) ?? findMpByName(name);
  const group = showPartyRing ? lookup(mp?.currentPartyGroupShort) : undefined;
  return (
    <MpAvatarView
      photoUrl={mp?.photoUrl}
      displayName={mp?.name ?? name ?? ""}
      ringColor={group?.color}
      className={className}
    />
  );
};
