import { useState, ReactNode, useRef, useLayoutEffect } from "react";

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
      x: left < x ? x - width - gap : left,
      y: top,
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
    tooltip:
      tooltip.visible && tooltip.content ? (
        <div
          ref={containerRef}
          className="absolute overflow-hidden rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 z-10"
          style={{ left: `${tooltip.x + gap}px`, top: `${tooltip.y + gap}px` }}
        >
          {tooltip.content}
        </div>
      ) : null,
  };
};
