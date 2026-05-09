// Centralised class strings for long-form content (analysis articles +
// documentation pages). Both the react-markdown renderer in ArticleScreen
// and hand-written JSX in pages like VoteFlowMethodologyScreen reach for
// these so the typography stays in sync. If you tune one knob, every
// long-form page picks it up.

export const proseClasses = {
  h2: "mt-10 mb-3 text-xl md:text-2xl font-bold tracking-tight text-foreground border-b border-border/40 pb-2",
  h3: "mt-6 mb-2 text-base md:text-lg font-semibold text-foreground",
  p: "my-4 text-[15px] md:text-base leading-7 text-foreground/90",
  ul: "my-4 space-y-2 list-disc pl-6 marker:text-muted-foreground",
  ol: "my-4 space-y-2 list-decimal pl-6 marker:text-muted-foreground",
  li: "text-[15px] md:text-base leading-7 text-foreground/90",
  strong: "font-semibold text-foreground",
  code: "rounded bg-secondary px-1.5 py-0.5 font-mono text-[0.85em] text-secondary-foreground",
  hr: "my-10 border-border/60",
  blockquote:
    "my-4 border-l-4 border-primary/40 pl-4 italic text-muted-foreground",
  a: "text-primary underline underline-offset-4 decoration-primary/40 hover:decoration-primary",
  // Tables
  tableWrap: "my-6 overflow-x-auto rounded-lg border border-border",
  table: "w-full border-collapse text-sm",
  thead: "bg-secondary/60",
  th: "border-b border-border px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground",
  td: "border-b border-border/40 px-3 py-2 align-top text-[14px] text-foreground/90",
  tr: "even:bg-muted/30",
  // Reserve aspect ratio so images don't reflow the article body as they
  // load. object-contain letterboxes non-16:9 images instead of cropping.
  img: "my-6 w-full rounded-lg border border-border/40 [aspect-ratio:16/9] object-contain bg-muted/30",
} as const;
