import React, { useState, useMemo, useEffect } from "react";
import ChatWindow from "@/ai/components/ChatWindow";
import { translations, Language } from "@/ai/constants";
import { PanelLeft, X } from "lucide-react";
import { useChat } from "@/ai/hooks/useChat";
import Sidebar from "@/ai/components/Sidebar";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useTranslation } from "react-i18next";

export const AIChatWindow: React.FC = () => {
  const { i18n } = useTranslation();
  const language = i18n.language as Language;
  const { messages, isLoading, sendUserMessage } = useChat(language);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  const currentTranslations = useMemo(() => translations[language], [language]);

  // Set initial sidebar state based on screen width
  useEffect(() => {
    const mediaQuery = window.matchMedia("(min-width: 768px)");
    setIsSidebarOpen(mediaQuery.matches);
    const handler = (e: MediaQueryListEvent) => setIsSidebarOpen(e.matches);
    mediaQuery.addEventListener("change", handler);
    return () => mediaQuery.removeEventListener("change", handler);
  }, []);

  return (
    <div className="flex flex-col h-screen antialiased w-full text-foreground ">
      <div className="flex flex-1 overflow-hidden">
        <aside
          className={cn(
            "absolute md:relative z-5 h-full w-[350px] flex-shrink-0 border-r transition-all duration-300 ease-in-out",
            isSidebarOpen
              ? "translate-x-0"
              : "-translate-x-full md:translate-x-0 md:-ml-[350px]",
          )}
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
              sendUserMessage={sendUserMessage}
              translations={currentTranslations}
              language={language}
            />
          </main>
        </div>
      </div>
    </div>
  );
};
