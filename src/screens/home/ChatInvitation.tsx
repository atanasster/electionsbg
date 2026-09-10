import { Link } from "react-router-dom";
import { trackEvent } from "@/lib/analytics";
import {
  CHAT_LAUNCH_REVIEWABLE,
  CHAT_LAUNCH_SLUG,
  CHAT_LAUNCH_STARTERS,
  chatQuestionPath,
} from "@/lib/chatLaunch";

export const ChatInvitation = ({ lang }: { lang: "bg" | "en" }) => (
  <section
    aria-label={lang === "bg" ? "Попитай Наясно" : "Ask Наясно"}
    data-chat-invitation=""
    className="flex flex-col gap-2 rounded-xl border border-border bg-card p-3"
  >
    <Link
      to="/chat"
      onClick={() => trackEvent("chat_invitation", { entry: "primary" })}
      className="flex min-h-11 shrink-0 flex-col justify-center rounded px-1 text-foreground hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
    >
      <h2 className="font-title text-lg font-semibold leading-6">
        {lang === "bg" ? "Попитай Наясно" : "Ask Наясно"}
      </h2>
      <span className="text-xs leading-5 text-muted-foreground">
        {lang === "bg" ? "Задай въпрос →" : "Ask a question →"}
      </span>
    </Link>
    <img
      src="/images/chat/invitation.webp"
      alt=""
      width={720}
      height={480}
      decoding="async"
      className="h-32 w-full rounded object-contain"
    />
    <nav
      aria-label={lang === "bg" ? "Готови въпроси" : "Starter questions"}
      className="flex flex-wrap items-center gap-1"
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
          className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md bg-muted px-1.5 text-xs font-medium text-foreground hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
        >
          {starter.label[lang]}
        </Link>
      ))}
      {CHAT_LAUNCH_REVIEWABLE && (
        <Link
          to={`/articles/${CHAT_LAUNCH_SLUG}`}
          onClick={() => trackEvent("chat_invitation", { entry: "article" })}
          className="inline-flex min-h-11 items-center rounded px-1.5 text-xs text-foreground underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
        >
          {lang === "bg" ? "Как работи" : "How it works"}
        </Link>
      )}
    </nav>
  </section>
);
