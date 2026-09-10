import { Link } from "react-router-dom";
import { trackEvent } from "@/lib/analytics";
import {
  CHAT_LAUNCH_PUBLISHED,
  CHAT_LAUNCH_SLUG,
  CHAT_LAUNCH_STARTERS,
  chatQuestionPath,
} from "@/lib/chatLaunch";

export const ChatInvitation = ({ lang }: { lang: "bg" | "en" }) => (
  <section
    aria-label={lang === "bg" ? "Попитай Наясно" : "Ask Наясно"}
    data-chat-invitation=""
    className="mt-1 flex flex-wrap items-center gap-x-2 rounded-lg border border-border bg-card px-2 py-1 lg:flex-nowrap"
  >
    <img
      src="/images/chat/invitation.webp"
      alt=""
      width={78}
      height={52}
      decoding="async"
      className="h-[52px] w-[78px] shrink-0 rounded object-contain"
    />
    <Link
      to="/chat"
      onClick={() => trackEvent("chat_invitation", { entry: "primary" })}
      className="flex min-h-11 shrink-0 flex-col justify-center rounded px-1 text-foreground hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
    >
      <h2 className="text-base font-semibold leading-5">
        {lang === "bg" ? "Попитай Наясно" : "Ask Наясно"}
      </h2>
      <span className="text-xs leading-5 text-muted-foreground">
        {lang === "bg" ? "Задай въпрос →" : "Ask a question →"}
      </span>
    </Link>
    <nav
      aria-label={lang === "bg" ? "Готови въпроси" : "Starter questions"}
      className="flex flex-wrap items-center gap-1 lg:ml-auto lg:flex-nowrap"
    >
      {CHAT_LAUNCH_STARTERS.map((starter) => (
        <Link
          key={starter.id}
          to={chatQuestionPath(starter.prompt[lang])}
          title={starter.prompt[lang]}
          onClick={() =>
            trackEvent("chat_invitation", {
              entry: "starter",
              starter: starter.id,
            })
          }
          className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md bg-muted px-2 text-xs font-medium text-foreground hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
        >
          {starter.label[lang]}
        </Link>
      ))}
      {CHAT_LAUNCH_PUBLISHED && (
        <Link
          to={`/articles/${CHAT_LAUNCH_SLUG}`}
          onClick={() => trackEvent("chat_invitation", { entry: "article" })}
          className="inline-flex min-h-11 items-center rounded px-2 text-xs text-foreground underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
        >
          {lang === "bg" ? "Как работи" : "How it works"}
        </Link>
      )}
    </nav>
  </section>
);
