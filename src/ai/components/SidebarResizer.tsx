import React from "react";
import { cn } from "@/lib/utils";

interface SidebarResizerProps {
  onMouseDown: (event: React.MouseEvent<HTMLDivElement>) => void;
  isResizing: boolean;
}

const SidebarResizer: React.FC<SidebarResizerProps> = ({
  onMouseDown,
  isResizing,
}) => {
  return (
    <div
      className={cn(
        "h-full w-2 flex-shrink-0 cursor-col-resize flex items-center justify-center bg-transparent group",
        isResizing ? "bg-primary/20" : "hover:bg-border",
      )}
      onMouseDown={onMouseDown}
      aria-hidden="true"
    >
      <div
        className={cn(
          "h-8 w-1 rounded-full bg-border transition-colors",
          isResizing ? "bg-primary" : "group-hover:bg-muted-foreground",
        )}
      />
    </div>
  );
};

export default SidebarResizer;
