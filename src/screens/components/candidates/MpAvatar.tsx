import { FC, CSSProperties } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { initials, cn } from "@/lib/utils";
import { useMps } from "@/data/parliament/useMps";
import { useMpAvatars } from "@/data/parliament/useMpAvatars";
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

/** Connected avatar — resolves the MP's photo + party ring by id (and name).
 *
 * Reads the slim ~36 KB parliament/avatars.json first; the full ~970 KB
 * parliament/index.json is fetched ONLY as a fallback (deferred via
 * `enabled`) — when the caller gave no id, or the id isn't in the slim
 * projection (e.g. a local-election candidate id, or a brand-new MP). This
 * keeps connection-only pages (/company, /awarder, /officials) from
 * downloading the whole roster just to draw a face.
 *
 * Prefer `MpAvatarView` on hot paths where the photo is already known. */
export const MpAvatar: FC<Props> = ({
  name,
  mpId,
  className,
  showPartyRing = true,
}) => {
  const { get, isSettled } = useMpAvatars();
  const slim = get(mpId);
  // The slim projection carries no names, so it can only fully answer when the
  // caller also supplied one (for initials + alt text). Otherwise fall back to
  // the full roster — which also covers name-only callers and slim misses.
  // Gate the fallback on the avatars query having SETTLED: on the first render
  // (avatars.json not yet loaded) slim is undefined for everyone, and an
  // ungated fallback would fire the ~970 KB index fetch before avatars.json
  // even arrives. Once settled, a still-missing id legitimately falls back.
  const slimUsable = !!slim && !!name;
  const needIndex = isSettled && !slimUsable && (mpId != null || !!name);
  const { findMpByName, findMpById } = useMps(needIndex);
  const { lookup } = useParliamentGroups();

  const mp = slimUsable ? undefined : (findMpById(mpId) ?? findMpByName(name));
  const photoUrl = slimUsable ? slim!.photoUrl : mp?.photoUrl;
  const partyShort = slimUsable
    ? slim!.partyGroupShort
    : mp?.currentPartyGroupShort;
  const displayName = (slimUsable ? name : (mp?.name ?? name)) ?? "";
  const group = showPartyRing ? lookup(partyShort) : undefined;

  return (
    <MpAvatarView
      photoUrl={photoUrl}
      displayName={displayName}
      ringColor={group?.color}
      className={className}
    />
  );
};
