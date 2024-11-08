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
        className="tooltip absolute bg-white border border-black p-2"
        style={{ left: `${tooltip.x + 5}px`, top: `${tooltip.y + 50}px` }}
      >
        {tooltip.content}
      </div>
    ) : null,
  };
};
