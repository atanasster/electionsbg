import { cn } from "@/lib/utils";
import { siteChrome } from "@/layout/siteChrome";
import { useChatNavigation } from "./navigation";
import { chatToolbarPath } from "./navigationPaths";

export const ChatToolbar = ({ onNewChat }: { onNewChat: () => void }) => {
  const navigation = useChatNavigation();
  const en = navigation.lang === "en";

  const isPrompts = navigation.pathname.endsWith("/prompts");
  const isTools = navigation.pathname.endsWith("/tools");
  const isEvals = navigation.pathname.endsWith("/evals");

  const itemClass = (active: boolean) =>
    cn(
      "inline-flex h-8 shrink-0 items-center justify-center whitespace-nowrap rounded-md border px-2.5 text-xs font-medium transition-colors sm:px-3 sm:text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
      active ? siteChrome.activeNav : siteChrome.idleNav,
    );

  return (
    <nav
      aria-label={en ? "Chat actions" : "Действия за чата"}
      data-chat-toolbar
      className="sticky top-[var(--header-height,70px)] z-20 flex h-11 shrink-0 items-center gap-1.5 overflow-x-auto border-b border-border bg-background/95 px-2 backdrop-blur supports-[backdrop-filter]:bg-background/80 [scrollbar-width:none] sm:h-12 sm:gap-2 sm:px-4 [&::-webkit-scrollbar]:hidden"
    >
      <button type="button" className={itemClass(false)} onClick={onNewChat}>
        {en ? "New chat" : "Нов чат"}
      </button>
      <span
        aria-hidden
        className="mx-0.5 h-4 w-px shrink-0 bg-border/70 sm:mx-1"
      />
      <button
        type="button"
        aria-current={isPrompts ? "page" : undefined}
        className={itemClass(isPrompts)}
        onClick={() =>
          navigation.navigate(
            chatToolbarPath("prompts", navigation.pathname, navigation.search),
          )
        }
      >
        {en ? "Prompts" : "Въпроси"}
      </button>
      <button
        type="button"
        aria-current={isTools ? "page" : undefined}
        className={itemClass(isTools)}
        onClick={() =>
          navigation.navigate(
            chatToolbarPath("tools", navigation.pathname, navigation.search),
          )
        }
      >
        {en ? "Tools" : "Инструменти"}
      </button>
      <button
        type="button"
        aria-current={isEvals ? "page" : undefined}
        className={itemClass(isEvals)}
        onClick={() =>
          navigation.navigate(
            chatToolbarPath("evals", navigation.pathname, navigation.search),
          )
        }
      >
        {en ? "Accuracy" : "Точност"}
      </button>
    </nav>
  );
};
