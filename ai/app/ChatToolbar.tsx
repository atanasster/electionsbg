import { Plus, Target, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useChatNavigation } from "./navigation";
import { chatToolbarPath } from "./navigationPaths";

export const ChatToolbar = ({ onNewChat }: { onNewChat: () => void }) => {
  const navigation = useChatNavigation();
  const en = navigation.lang === "en";
  return (
    <nav
      aria-label={en ? "Chat actions" : "Действия за чата"}
      data-chat-toolbar
      className="sticky top-[var(--header-height,70px)] z-20 flex h-12 shrink-0 items-center gap-1 border-b bg-background px-2 sm:px-4"
    >
      <Button
        variant="ghost"
        className="min-h-11 px-2 sm:px-3"
        onClick={onNewChat}
      >
        <Plus className="hidden size-4 sm:block" />
        {en ? "New chat" : "Нов чат"}
      </Button>
      <Button
        variant="ghost"
        className="min-h-11 px-2 sm:px-3"
        aria-current={
          navigation.pathname.endsWith("/tools") ? "page" : undefined
        }
        onClick={() =>
          navigation.navigate(
            chatToolbarPath("tools", navigation.pathname, navigation.search),
          )
        }
      >
        <Wrench className="hidden size-4 sm:block" />
        {en ? "Tools" : "Инструменти"}
      </Button>
      <Button
        variant="ghost"
        className="min-h-11 px-2 sm:px-3"
        aria-current={
          navigation.pathname.endsWith("/evals") ? "page" : undefined
        }
        onClick={() =>
          navigation.navigate(
            chatToolbarPath("evals", navigation.pathname, navigation.search),
          )
        }
      >
        <Target className="hidden size-4 sm:block" />
        {en ? "Accuracy" : "Точност"}
      </Button>
    </nav>
  );
};
