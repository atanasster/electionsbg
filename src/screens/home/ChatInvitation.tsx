import { Link } from "react-router-dom";
import { trackEvent } from "@/lib/analytics";

export const ChatInvitation = ({ lang }: { lang: "bg" | "en" }) => (
  <section
    aria-label={lang === "bg" ? "Попитай Наясно" : "Ask Наясно"}
    data-chat-invitation=""
    className="flex flex-col gap-2 rounded-xl border border-border bg-card p-3"
  >
    <Link
      to="/chat"
      onClick={() => trackEvent("chat_invitation", { entry: "primary" })}
      className="flex flex-col gap-2 rounded px-1 text-foreground hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
    >
      <h2 className="font-title text-lg font-semibold leading-6">
        {lang === "bg" ? "Попитай Наясно" : "Ask Наясно"}
      </h2>
      <img
        src="/images/chat/invitation.webp"
        alt=""
        width={720}
        height={480}
        decoding="async"
        className="h-auto w-full rounded object-contain"
      />
    </Link>
  </section>
);
