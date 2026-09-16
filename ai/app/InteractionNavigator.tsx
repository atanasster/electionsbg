import { scrollParent } from "./chatScroll";
import { useEffect, useMemo, useState, type RefObject } from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { ChatMsg } from "./export";
import type { Lang } from "../tools/types";

type Message = ChatMsg & { id: number };

// The document can scroll independently of the chat. Its sticky toolbar may
// cover the top of the chat scrollport, so use the visible edge, not its box.
const visibleChatTop = (scroller: HTMLElement) =>
  Math.max(
    0,
    scroller.getBoundingClientRect().top,
    scroller.ownerDocument
      .querySelector("[data-chat-toolbar]")
      ?.getBoundingClientRect().bottom ?? 0,
  );

export const InteractionNavigator = ({
  messages,
  contentRef,
  lang,
  onNavigate,
}: {
  messages: Message[];
  contentRef: RefObject<HTMLDivElement | null>;
  lang: Lang;
  onNavigate: () => void;
}) => {
  const interactions = useMemo(
    () =>
      messages.flatMap((message, index) => {
        if (message.role !== "user") return [];
        const responses: string[] = [];
        for (
          let i = index + 1;
          i < messages.length && messages[i].role !== "user";
          i++
        ) {
          const answer = messages[i];
          responses.push(answer.text || answer.env?.title || "");
        }
        return [
          {
            id: message.id,
            prompt: message.text,
            response: responses.filter(Boolean).join(" "),
          },
        ];
      }),
    [messages],
  );
  const promptIds = interactions.map(({ id }) => id).join(",");
  const [active, setActive] = useState<number | null>(null);
  useEffect(() => {
    const content = contentRef.current;
    if (!content) return;
    const scroller = scrollParent(content);
    if (!scroller) return;
    const update = () => {
      const top = visibleChatTop(scroller) + 32;
      const prompts = Array.from(
        content.querySelectorAll<HTMLElement>("[data-interaction]"),
      );
      const current =
        [...prompts]
          .reverse()
          .find((prompt) => prompt.getBoundingClientRect().top <= top) ??
        prompts[0];
      setActive(current ? Number(current.dataset.interaction) : null);
    };
    update();
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    const observer = new ResizeObserver(update);
    observer.observe(content);
    return () => {
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
      observer.disconnect();
    };
  }, [contentRef, promptIds]);

  if (interactions.length < 2) return null;
  return (
    <div
      className="pointer-events-none sticky top-24 z-[8] h-0"
      data-export-omit=""
    >
      <nav
        aria-label={
          lang === "bg" ? "Навигация в разговора" : "Conversation navigation"
        }
        className="pointer-events-auto absolute left-0 top-0 max-h-[40vh] overflow-y-auto overscroll-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        <TooltipProvider delayDuration={150}>
          {interactions.map((interaction, index) => (
            <Tooltip key={interaction.id}>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  aria-label={`${index + 1}. ${interaction.prompt}`}
                  aria-current={active === interaction.id ? "step" : undefined}
                  className="group flex h-6 w-7 items-center rounded-sm px-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  onClick={() => {
                    const target =
                      contentRef.current?.querySelector<HTMLElement>(
                        `[data-interaction="${interaction.id}"]`,
                      );
                    if (!target) return;
                    onNavigate();
                    const scroller = scrollParent(target);
                    if (scroller)
                      scroller.scrollTo({
                        top:
                          scroller.scrollTop +
                          target.getBoundingClientRect().top -
                          visibleChatTop(scroller) -
                          16,
                        behavior: window.matchMedia(
                          "(prefers-reduced-motion: reduce)",
                        ).matches
                          ? "instant"
                          : "smooth",
                      });
                    target.focus({ preventScroll: true });
                  }}
                >
                  <span
                    className={cn(
                      "h-0.5 rounded-full transition-all motion-reduce:transition-none group-hover:w-5 group-hover:bg-foreground group-focus-visible:w-5 group-focus-visible:bg-foreground",
                      active === interaction.id
                        ? "w-5 bg-foreground"
                        : "w-3 bg-muted-foreground/50",
                    )}
                  />
                </button>
              </TooltipTrigger>
              <TooltipContent
                side="right"
                sideOffset={10}
                className="max-w-[min(20rem,calc(100vw-4rem))] space-y-2 p-3"
              >
                <p className="line-clamp-2 break-words text-sm font-medium">
                  {interaction.prompt}
                </p>
                <p className="line-clamp-3 break-words text-xs text-muted-foreground">
                  {interaction.response ||
                    (lang === "bg"
                      ? "Все още няма отговор…"
                      : "No response yet…")}
                </p>
              </TooltipContent>
            </Tooltip>
          ))}
        </TooltipProvider>
      </nav>
    </div>
  );
};
