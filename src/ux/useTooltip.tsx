import { useState, ReactNode } from "react";
export const useTooltip = () => {
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
  const onMouseEnter = (
    e: React.MouseEvent<SVGPathElement, MouseEvent>,
    content: ReactNode,
  ) => {
    setTooltip({
      visible: true,
      x: e.clientX,
      y: e.clientY,
      content,
    });
  };
  const onMouseMove = (e: React.MouseEvent<SVGPathElement, MouseEvent>) => {
    setTooltip((prev) => ({
      ...prev,
      //visible: true,
      x: e.clientX,
      y: e.clientY,
    }));
  };
  const onMouseLeave = () => {
    setTooltip({ visible: false, x: 0, y: 0, content: "" });
  };
  return {
    onMouseEnter,
    onMouseMove,
    onMouseLeave,
    tooltip: tooltip.visible ? (
      <div
        className="absolute overflow-hidden rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2"
        style={{ left: `${tooltip.x + 5}px`, top: `${tooltip.y + 50}px` }}
      >
        {tooltip.content}
      </div>
    ) : null,
  };
};
