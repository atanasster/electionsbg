// Nearest scrollable ancestor of `el` (the element that actually scrolls). Used
// to auto-scroll the conversation: we scroll the scrollport itself to its foot
// rather than scrollIntoView the end-marker, because the marker sits above the
// sticky composer in the DOM — aligning it to the scrollport bottom would leave
// the composer overlaying the tail of the answer + the follow-up chips. Matched
// by overflow style alone (not current overflow) so it resolves before the
// content has grown tall enough to scroll.
export const scrollParent = (el: HTMLElement | null): HTMLElement | null => {
  let node = el?.parentElement ?? null;
  while (node) {
    const { overflowY } = getComputedStyle(node);
    if (overflowY === "auto" || overflowY === "scroll") return node;
    node = node.parentElement;
  }
  return null;
};

// A cleared pin must survive the first upward frames of smooth navigation,
// even while those frames remain inside the bottom slack.
export const shouldFollowChat = (
  pinned: boolean,
  previousTop: number,
  scrollTop: number,
  distanceFromBottom: number,
) => distanceFromBottom <= 80 && (pinned || scrollTop > previousTop);
