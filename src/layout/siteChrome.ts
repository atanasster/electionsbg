/**
 * Visual contract shared by every Naiasno product shell.
 *
 * Products keep their own navigation and routing, while these classes prevent
 * the brand surfaces, borders, active treatment and footer from drifting.
 */
const activeSurface = "border-primary/50 bg-primary/[0.07]";
const idleSurface = "border-border/70 hover:border-border";
const activeText = "text-primary hover:bg-primary/10";
const idleText =
  "text-secondary-foreground hover:bg-foreground/[0.05] hover:text-primary";

export const siteChrome = {
  headerSurface: "border-b-2 border-border bg-muted shadow-sm",
  footerSurface: "border-t border-border bg-muted",
  activeSurface,
  idleSurface,
  activeText,
  idleText,
  activeDivider: "bg-primary/30",
  idleDivider: "bg-border/70",
  activeTrigger: `${activeText} data-[state=open]:bg-primary/10`,
  idleTrigger: `${idleText} data-[state=open]:bg-foreground/[0.05]`,
  activeNav: `${activeSurface} ${activeText}`,
  idleNav: `${idleSurface} ${idleText}`,
} as const;
