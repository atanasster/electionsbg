import type { ReactNode } from "react";
import { useChatNavigation } from "./navigation";
import { integratedLegacyUrl } from "./legacyRoutes";

// Standalone entry only: the integrated bundle never imports this transition.
export const LegacyTransition = ({ children }: { children: ReactNode }) => {
  const { pathname, search, lang } = useChatNavigation();
  const en = lang === "en";
  return (
    <div className="flex h-dvh flex-col bg-card text-foreground">
      <aside
        className="max-h-[40dvh] shrink-0 overflow-y-auto border-b px-4 py-2 text-sm"
        aria-label={
          en ? "Chat move and export" : "Преместване и изтегляне на чата"
        }
      >
        <p>
          {en
            ? "Chat is moving to the main site. Your saved conversation stays in this browser on this old address; it does not transfer automatically. To save it, use Share → Markdown or PDF above the conversation below."
            : "Чатът се премества в основния сайт. Запазеният разговор остава в този браузър на стария адрес и не се прехвърля автоматично. Изтегли го от Сподели → Markdown или PDF над разговора по-долу."}
        </p>
        <div className="flex flex-wrap gap-x-5">
          <a
            className="inline-flex min-h-11 items-center rounded font-semibold underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
            href={integratedLegacyUrl(pathname, search)}
            referrerPolicy="no-referrer"
          >
            {en ? "Open chat on the main site" : "Отвори чата в основния сайт"}
          </a>
          <a
            className="inline-flex min-h-11 items-center rounded underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
            href={`/legacy-export${en ? "?lang=en" : ""}`}
          >
            {en
              ? "Recover / export this browser's conversation"
              : "Възстанови / изтегли разговора от този браузър"}
          </a>
        </div>
      </aside>
      <div className="min-h-0 flex-1 overflow-y-auto [&>div]:h-full">
        {children}
      </div>
    </div>
  );
};
