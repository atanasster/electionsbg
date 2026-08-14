/**
 * Where a Наясно post has actually been published.
 *
 * The registry (`brand/posts/index.json`) is a log of DRAFTS — `naiasno-post`
 * never publishes, an operator does, by hand. So until this field existed the
 * registry could say a card had been rendered and could not say whether anyone
 * had ever seen it. That gap has a cost: seeding the Instagram grid from the
 * back catalogue meant guessing which cards were already on the Facebook Page,
 * and guessing wrong means posting a duplicate to the audience that has been
 * there longest.
 *
 * Kept in its own module because `post_tool.ts` calls `main()` at import time,
 * so it cannot be imported from a test without running the CLI.
 */

/**
 * Publication targets a rendered card can reach.
 *
 * ⚠️ `fb-page` and `fb-group` are deliberately separate and there is no bare
 * `fb`. Наясно posts to both, they have different audiences, and the drafts
 * `post_tool` writes already instruct the operator differently for each
 * ("Група: ⋯ → Pin to Featured; Страница: ⋯ → Feature"). One `fb` value would
 * make "already posted?" unanswerable for the exact case this field exists to
 * answer.
 *
 * Video lives in `brand/videos/index.json` with its own `status`, so YouTube is
 * not a channel here.
 */
export const CHANNELS = [
  "fb-page",
  "fb-group",
  "ig",
  "li",
  "x",
  "pinterest",
  "tg",
] as const;

export type Channel = (typeof CHANNELS)[number];

export type Posted = {
  channel: Channel;
  /** YYYY-MM-DD the post went out. */
  at: string;
};

const CHANNEL_SET: ReadonlySet<string> = new Set(CHANNELS);

/** Human labels for CLI output. */
export const CHANNEL_LABEL: Record<Channel, string> = {
  "fb-page": "Facebook Page",
  "fb-group": "Facebook Group",
  ig: "Instagram",
  li: "LinkedIn",
  x: "X",
  pinterest: "Pinterest",
  tg: "Telegram",
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Parse a comma- and/or space-separated channel list. Throws on an unknown
 * value rather than silently dropping it — a typo'd channel that is quietly
 * ignored would record the post as unpublished for ever.
 */
export const parseChannels = (input: string[]): Channel[] => {
  const raw = input
    .flatMap((s) => s.split(","))
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (raw.length === 0) throw new Error("no channels given");
  const out: Channel[] = [];
  for (const r of raw) {
    if (!CHANNEL_SET.has(r)) {
      const hint =
        r === "fb" || r === "facebook"
          ? ` — use "fb-page" and/or "fb-group", not "${r}"`
          : "";
      throw new Error(
        `unknown channel "${r}"${hint}. Known: ${CHANNELS.join(", ")}`,
      );
    }
    if (!out.includes(r as Channel)) out.push(r as Channel);
  }
  return out;
};

/**
 * Fold new channel stamps into an existing list.
 *
 * Idempotent and, by default, NON-destructive: a channel already recorded keeps
 * its original date, because the question the field answers is "has this been
 * published here", and the first time it went out is the honest answer to it.
 * `overwrite` is for correcting a wrong date. Output is sorted by channel so the
 * JSON diff of a re-stamp is empty rather than a reordering.
 */
export const mergePosted = (
  existing: Posted[] | undefined,
  channels: Channel[],
  at: string,
  overwrite = false,
): { next: Posted[]; added: Channel[]; kept: Channel[] } => {
  if (!DATE_RE.test(at))
    throw new Error(`bad date "${at}" — expected YYYY-MM-DD`);
  const byChannel = new Map<Channel, Posted>();
  for (const p of existing ?? []) byChannel.set(p.channel, p);

  const added: Channel[] = [];
  const kept: Channel[] = [];
  for (const c of channels) {
    const prev = byChannel.get(c);
    if (prev && !overwrite) {
      kept.push(c);
      continue;
    }
    byChannel.set(c, { channel: c, at });
    added.push(c);
  }
  const next = [...byChannel.values()].sort((a, b) =>
    a.channel.localeCompare(b.channel),
  );
  return { next, added, kept };
};

/** Drop channel stamps. Returns the survivors and what was actually removed. */
export const removePosted = (
  existing: Posted[] | undefined,
  channels: Channel[],
): { next: Posted[]; removed: Channel[] } => {
  const drop = new Set<Channel>(channels);
  const next = (existing ?? []).filter((p) => !drop.has(p.channel));
  const removed = (existing ?? [])
    .filter((p) => drop.has(p.channel))
    .map((p) => p.channel);
  return { next, removed };
};

/** True when the post has been published on `channel`. */
export const isPostedTo = (
  existing: Posted[] | undefined,
  channel: Channel,
): boolean => (existing ?? []).some((p) => p.channel === channel);

/** Compact one-line rendering for CLI listings: `fb-page@2026-08-02, ig@2026-08-14`. */
export const formatPosted = (existing: Posted[] | undefined): string =>
  (existing ?? []).length === 0
    ? "—"
    : (existing ?? [])
        .map((p) => `${p.channel}@${p.at}`)
        .sort()
        .join(", ");
