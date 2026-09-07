import { useState, ReactNode, useRef, useLayoutEffect } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import { tooltipSurfaceCompactClass } from "@/components/ui/tooltipSurface";

export type TooltipEvents = {
  onMouseEnter: (
    props: { pageX: number; pageY: number },
    content: ReactNode,
  ) => void;
  onMouseMove: (props: { pageX: number; pageY: number }) => void;
  onMouseLeave: () => void;
};
export const useTooltip = (
  props: { maxHeight: number; maxWidth: number } = {
    maxHeight: 350,
    maxWidth: 300,
  },
): { tooltip: ReactNode } & TooltipEvents => {
  const [tooltip, setTooltip] = useState<{
    visible: boolean;
    x: number;
    y: number;
    content: ReactNode;
  }>({
    visible: false,
    x: 0,
    y: 0,
    content: "",
  });
  const containerRef = useRef<HTMLDivElement>(null);
  const gap = 15;
  useLayoutEffect(() => {
    const listener = () => {
      if (tooltip.visible) {
        onMouseLeave();
      }
    };
    document.body.addEventListener("click", listener);
    return () => document.body.removeEventListener("click", listener);
  }, [tooltip.visible]);
  const calcCoordinates = (x: number, y: number) => {
    let width = props.maxWidth;
    let height = props.maxHeight;
    if (containerRef.current) {
      width = containerRef.current.clientWidth;
      height = containerRef.current.clientHeight;
    }
    const left = Math.min(window.scrollX + window.innerWidth - width - gap, x);
    const top = Math.min(window.scrollY + window.innerHeight - height - gap, y);
    return {
      x: Math.max(0, left < x ? x - width - gap : left),
      y: Math.max(0, top),
    };
  };
  const onMouseEnter: TooltipEvents["onMouseEnter"] = (
    { pageX, pageY },
    content: ReactNode,
  ) => {
    setTooltip({
      visible: true,
      content,
      ...calcCoordinates(pageX, pageY),
    });
  };
  const onMouseMove: TooltipEvents["onMouseMove"] = ({ pageX, pageY }) => {
    setTooltip((prev) => ({
      ...prev,
      ...calcCoordinates(pageX, pageY),
    }));
  };
  const onMouseLeave: TooltipEvents["onMouseLeave"] = () => {
    setTooltip({ visible: false, x: 0, y: 0, content: "" });
  };

  return {
    onMouseEnter,
    onMouseMove,
    onMouseLeave,
    // ⚠⚠ PORTALLED TO `document.body`, AND THAT IS A CORRECTNESS FIX RATHER THAN TIDYING.
    // `left`/`top` below are PAGE coordinates (`pageX`/`pageY` from the mouse event), but the
    // node is `position: absolute` — which resolves against the nearest POSITIONED ANCESTOR,
    // not the document. Rendered in place, any caller with a positioned ancestor gets the
    // tooltip offset by that ancestor's own distance from the top of the page.
    //
    // Measured on `/presidential/:cycle/region/:oblast`, which mounts two maps: each sits in a
    // `MeasuredMapBox`, which is `relative` on purpose (`SVGMapContainer` renders an absolute
    // `<svg>` and would otherwise paint over the page shell). Hovering the FIRST map put its
    // tooltip a full canvas-height too low — on top of the SECOND map, reading „1-и тур" while
    // the reader's cursor was on the round-2 map — and the second map's tooltip landed below
    // the fold and was never seen at all. Both are worse than no tooltip: the first one
    // attributes a round-1 figure to the round-2 canvas.
    //
    // ⚠ IT LOOKED FINE EVERYWHERE ELSE FOR A REASON, so this is not a regression in one screen.
    // The other ~55 callers render inside a `StatCard` whose box is NOT positioned, so the
    // offset parent was the body and the page coordinates happened to be right. The bug was
    // latent in every consumer and surfaced the first time one sat inside a positioned box.
    //
    // Portalling keeps the existing page-coordinate API — no call site changes — and makes the
    // offset parent the body for ALL of them, so the two can never disagree again.
    tooltip:
      tooltip.visible && tooltip.content
        ? createPortal(
            <div
              ref={containerRef}
              className={cn(
                // pointer-events-none: tooltip overlays the trigger and would
                // otherwise steal hover, causing the trigger's onMouseLeave to
                // fire as the cursor enters the tip — a classic flicker loop.
                "absolute overflow-hidden pointer-events-none animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 z-50",
                tooltipSurfaceCompactClass,
              )}
              style={{
                left: `${tooltip.x + gap}px`,
                top: `${tooltip.y + gap}px`,
              }}
            >
              {tooltip.content}
            </div>,
            document.body,
          )
        : null,
  };
};
