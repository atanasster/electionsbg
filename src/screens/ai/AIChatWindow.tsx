import React, {
  useState,
  useMemo,
  useEffect,
  useRef,
  useCallback,
} from "react";
import ChatWindow from "@/ai/components/ChatWindow";
import { translations, Language } from "@/ai/constants";
import { PanelLeft, X } from "lucide-react";
import { useChat } from "@/ai/hooks/useChat";
import Sidebar from "@/ai/components/Sidebar";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import SidebarResizer from "@/ai/components/SidebarResizer";
import { useTranslation } from "react-i18next";

const MIN_SIDEBAR_WIDTH = 280;
const MAX_SIDEBAR_WIDTH = 500;
const DEFAULT_SIDEBAR_WIDTH = 350;

const getInitialSidebarWidth = () => {
  if (typeof window === "undefined") return DEFAULT_SIDEBAR_WIDTH;
  const savedWidth = localStorage.getItem("sidebarWidth");
  if (savedWidth) {
    const parsedWidth = parseInt(savedWidth, 10);
    if (!isNaN(parsedWidth)) {
      return Math.max(
        MIN_SIDEBAR_WIDTH,
        Math.min(MAX_SIDEBAR_WIDTH, parsedWidth),
      );
    }
  }
  return DEFAULT_SIDEBAR_WIDTH;
};

const getInitialIsSidebarOpen = () => {
  if (typeof window === "undefined") return true;
  const savedCollapsed = localStorage.getItem("sidebarCollapsed");
  if (savedCollapsed) {
    return savedCollapsed !== "true";
  }
  return window.matchMedia("(min-width: 768px)").matches;
};

export const AIChatWindow: React.FC = () => {
  const { i18n } = useTranslation();
  const language = i18n.language as Language;
  const {
    messages,
    isLoading,
    isStopping,
    thinkingMessage,
    sendUserMessage,
    stopGeneration,
  } = useChat(language);
  const [isSidebarOpen, setIsSidebarOpen] = useState(getInitialIsSidebarOpen);
  const [sidebarWidth, setSidebarWidth] = useState(getInitialSidebarWidth);
  const [isResizing, setIsResizing] = useState(false);

  const resizeDataRef = useRef<{ startX: number; startWidth: number } | null>(
    null,
  );

  const currentTranslations = useMemo(() => translations[language], [language]);

  // Effect to add media query listener for first-time users
  useEffect(() => {
    const savedCollapsed = localStorage.getItem("sidebarCollapsed");
    // Only attach listener if state isn't already saved
    if (!savedCollapsed) {
      const mediaQuery = window.matchMedia("(min-width: 768px)");
      const handler = (e: MediaQueryListEvent) => setIsSidebarOpen(e.matches);
      mediaQuery.addEventListener("change", handler);
      return () => mediaQuery.removeEventListener("change", handler);
    }
  }, []);

  // Save width to localStorage on change
  useEffect(() => {
    if (!isResizing) {
      localStorage.setItem("sidebarWidth", String(sidebarWidth));
    }
  }, [sidebarWidth, isResizing]);

  // Save collapsed state to localStorage on change
  useEffect(() => {
    localStorage.setItem("sidebarCollapsed", String(!isSidebarOpen));
  }, [isSidebarOpen]);

  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    resizeDataRef.current = {
      startX: e.clientX,
      startWidth: sidebarWidth,
    };
    setIsResizing(true);
  };

  const handleMouseUp = useCallback(() => {
    setIsResizing(false);
    resizeDataRef.current = null;
  }, []);

  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (!isResizing || !resizeDataRef.current) {
        return;
      }
      const { startX, startWidth } = resizeDataRef.current;
      const dx = e.clientX - startX;
      const newWidth = startWidth + dx;
      const clampedWidth = Math.max(
        MIN_SIDEBAR_WIDTH,
        Math.min(MAX_SIDEBAR_WIDTH, newWidth),
      );
      setSidebarWidth(clampedWidth);
    },
    [isResizing],
  );

  // Effect to add/remove global mouse listeners for resizing
  useEffect(() => {
    if (isResizing) {
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp);
    }
    return () => {
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isResizing, handleMouseMove, handleMouseUp]);

  return (
    <div className="flex flex-col h-screen antialiased w-full text-foreground">
      <div className="flex flex-1 overflow-hidden">
        <aside
          className={cn(
            "absolute md:relative z-20 h-full flex-shrink-0 border-r bg-background",
            !isResizing &&
              "transition-[width,margin-left] duration-300 ease-in-out",
            isSidebarOpen
              ? "translate-x-0"
              : "-translate-x-full md:translate-x-0",
          )}
          style={{
            width: `${sidebarWidth}px`,
            marginLeft: !isSidebarOpen ? `-${sidebarWidth}px` : undefined,
          }}
          aria-hidden={!isSidebarOpen}
        >
          <div className="p-4 h-full overflow-y-auto">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-lg font-semibold">
                {currentTranslations.sidebarHeader}
              </h2>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setIsSidebarOpen(false)}
                className="md:hidden"
                aria-label="Close sidebar"
              >
                <X className="w-5 h-5" />
              </Button>
            </div>
            <Sidebar sendUserMessage={sendUserMessage} language={language} />
          </div>
        </aside>

        <div className={cn("hidden flex-shrink-0", isSidebarOpen && "md:flex")}>
          <SidebarResizer
            onMouseDown={handleMouseDown}
            isResizing={isResizing}
          />
        </div>

        {isSidebarOpen && (
          <div
            className="fixed inset-0 bg-black/60 z-10 md:hidden"
            onClick={() => setIsSidebarOpen(false)}
          ></div>
        )}

        <div className="flex flex-col flex-1 overflow-x-hidden">
          <div className="p-2 border-b flex items-center shrink-0">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setIsSidebarOpen(!isSidebarOpen)}
              aria-controls="sidebar"
              aria-expanded={isSidebarOpen}
              aria-label="Toggle sidebar"
            >
              <PanelLeft className="w-5 h-5" />
            </Button>
          </div>
          <main className="flex-1 overflow-y-auto p-2 sm:p-4 md:p-6 lg:p-8">
            <ChatWindow
              messages={messages}
              isLoading={isLoading}
              isStopping={isStopping}
              thinkingMessage={thinkingMessage}
              sendUserMessage={sendUserMessage}
              stopGeneration={stopGeneration}
              translations={currentTranslations}
              language={language}
            />
          </main>
        </div>
      </div>
    </div>
  );
};
