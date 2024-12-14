import { useState, ReactNode } from "react";
export const useTooltip = (
  props: { maxHeight: number; maxWidth: number } = {
    maxHeight: 300,
    maxWidth: 300,
  },
) => {
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
  const calcCoordinates = (x: number, y: number) => ({
    x: Math.min(window.scrollX + window.innerWidth - props.maxWidth, x),
    y: Math.min(window.scrollY + window.innerHeight - props.maxHeight, y),
  });
  const onMouseEnter = (
    e: React.MouseEvent<SVGElement, MouseEvent>,
    content: ReactNode,
  ) => {
    setTooltip({
      visible: true,
      content,
      ...calcCoordinates(e.pageX, e.pageY),
    });
  };
  const onMouseMove = (e: React.MouseEvent<SVGElement, MouseEvent>) => {
    setTooltip((prev) => ({
      ...prev,
      ...calcCoordinates(e.pageX, e.pageY),
    }));
  };
  const onMouseLeave = () => {
    setTooltip({ visible: false, x: 0, y: 0, content: "" });
  };
  const onTouchStart = (e: React.TouchEvent<SVGPathElement>) => {
    console.log(onTouchStart, e);
  };

  const onTouchEnd = (e: React.TouchEvent<SVGPathElement>) => {
    console.log(onTouchEnd, e);
  };
  return {
    onMouseEnter,
    onMouseMove,
    onMouseLeave,
    onTouchStart,
    onTouchEnd,
    tooltip:
      tooltip.visible && tooltip.content ? (
        <div
          className="absolute overflow-hidden rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 z-10"
          style={{ left: `${tooltip.x + 5}px`, top: `${tooltip.y + 45}px` }}
        >
          {tooltip.content}
        </div>
      ) : null,
  };
};
