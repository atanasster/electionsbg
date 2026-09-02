import {
  forwardRef,
  type ComponentPropsWithoutRef,
  type ReactNode,
} from "react";
import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";
import { pillClass, type PillSize } from "./pillClass";

/**
 * The site's pill — a rounded chip that is either a filter toggle, a section
 * link, or a mode switch. Single-sourced because its SELECTED state was
 * hand-rolled as `border-accent bg-accent text-accent-foreground` in several
 * screens, and that pair renders 4.77:1 at 14px/500 in light mode: past WCAG AA
 * (4.5) by 0.27 and nowhere near AAA. It reads muddy because coral and the
 * near-black label are close in luminance and the hue difference is doing work
 * the contrast is not.
 *
 * Selected uses `--accent-strong` — the INTERACTIVE coral, white on 41%
 * lightness, 5.45:1 — while the decorative `--accent` (node dots, borders, the
 * freshness pulse) keeps the brand hue at full chroma. Dark mode needs no
 * correction (mint on near-black is 11.81:1) so the two tokens are equal there.
 *
 * Not to be confused with `PillToggle` in this directory: that is a SEGMENTED
 * CONTROL (one group, one value, a tinted selected state) for the sector tiles.
 * This is the chip family — many independent toggles, a solid selected state.
 */

type PillProps = {
  selected?: boolean;
  size?: PillSize;
  children: ReactNode;
  className?: string;
} & Omit<ComponentPropsWithoutRef<"button">, "children" | "className">;

/**
 * A toggle pill. `selected` drives `aria-pressed`, because a filter chip is a
 * toggle button rather than a link — a screen reader otherwise announces no
 * state at all, which is the half of this that a colour fix cannot reach.
 */
export const Pill = forwardRef<HTMLButtonElement, PillProps>(
  ({ selected = false, size = "md", children, className, ...rest }, ref) => (
    <button
      ref={ref}
      type="button"
      aria-pressed={selected}
      className={cn(pillClass(selected, size), className)}
      {...rest}
    >
      {children}
    </button>
  ),
);
Pill.displayName = "Pill";

type PillLinkProps = {
  selected?: boolean;
  size?: PillSize;
  children: ReactNode;
  className?: string;
} & Omit<ComponentPropsWithoutRef<typeof Link>, "children" | "className">;

/** The same chip as navigation. `aria-current="page"` rather than
 *  `aria-pressed`: it moves you somewhere, it does not toggle a state. */
export const PillLink = ({
  selected = false,
  size = "md",
  children,
  className,
  ...rest
}: PillLinkProps) => (
  <Link
    aria-current={selected ? "page" : undefined}
    className={cn(pillClass(selected, size), className)}
    {...rest}
  >
    {children}
  </Link>
);

type PillGroupProps = {
  label: string;
  children: ReactNode;
  className?: string;
  /**
   * Render a `<nav>` landmark. Only for a group of PillLinks — a row of
   * `aria-pressed` toggles is a toolbar, and announcing it as navigation puts
   * a filter in the screen reader's list of places to jump to. Same split
   * PillToggle already makes with `role="group"`.
   */
  nav?: boolean;
  /**
   * One line that scrolls sideways rather than wrapping — for a row whose
   * length varies, where wrapping would silently cost a second line of head.
   *
   * It does NOT bleed: a caller that wants the row to run to the page edge
   * applies SHELL_BLEED itself, once, at whichever level actually sits on the
   * padding. Bleeding here as well nested two of them, and they cancelled only
   * because Layout's `p-2` and the toolbar's `px-2` happen to be equal.
   */
  scroll?: boolean;
};

export const PillGroup = ({
  label,
  children,
  className,
  scroll = false,
  nav = false,
}: PillGroupProps) => {
  const Tag = nav ? "nav" : "div";
  return (
    <Tag
      {...(nav ? {} : { role: "group" })}
      aria-label={label}
      className={cn(
        "flex items-center gap-2",
        scroll ? "overflow-x-auto py-1 [&>*]:shrink-0" : "flex-wrap",
        className,
      )}
    >
      {children}
    </Tag>
  );
};
