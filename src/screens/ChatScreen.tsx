import { chatView, normalizeChatUrl } from "@/lib/chatRoute";
import { useEffect, useMemo } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { App as ChatApp } from "../../ai/App";
import { EvalsScreen } from "../../ai/app/EvalsScreen";
import { ChatNavigationContext } from "../../ai/app/navigation";
import { Header } from "@/layout/header/Header";
import { SEO } from "@/ux/SEO";
import { SITE_ORIGIN } from "@/lib/siteOrigin";
import { setDbOrigin } from "../../ai/tools/dataClient";

// This lazy entry is only used by the main app. Its Hosting project owns /api/db;
// the standalone AI entry keeps the environment's cross-origin configuration.
setDbOrigin("");

export const ChatScreen = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { i18n } = useTranslation();
  const lang: "bg" | "en" = i18n.language.startsWith("bg") ? "bg" : "en";
  const prefix = window.location.pathname.startsWith("/en/") ? "/en" : "";
  const navigation = useMemo(
    () => ({
      pathname: `${prefix}${location.pathname}`,
      search: location.search,
      lang,
      navigate: (url: string) =>
        void navigate(
          prefix && url.startsWith(`${prefix}/`)
            ? url.slice(prefix.length)
            : url,
        ),
    }),
    [location.pathname, location.search, lang, navigate, prefix],
  );
  const normalizedUrl = normalizeChatUrl(window.location.href);
  const needsNormalization = normalizedUrl !== window.location.href;
  useEffect(() => {
    if (needsNormalization) window.location.replace(normalizedUrl);
  }, [needsNormalization, normalizedUrl]);
  const view = chatView(location.pathname);
  const evals = view === "evals";
  const tools = view === "tools";
  const title =
    lang === "bg"
      ? evals
        ? "Оценка на асистента"
        : tools
          ? "Инструменти и данни"
          : "Попитай Наясно"
      : evals
        ? "Assistant evaluation"
        : tools
          ? "Tools and data"
          : "Ask Наясно";
  const description =
    lang === "bg"
      ? "Задайте въпрос за публичните данни за България и проверете източниците зад отговора."
      : "Ask about Bulgaria’s public data and check the sources behind the answer.";
  if (needsNormalization) return null;
  return (
    <ChatNavigationContext.Provider value={navigation}>
      <SEO
        title={title}
        fullTitle={`${title} | Наясно`}
        description={description}
        canonical={`${SITE_ORIGIN}${prefix}${location.pathname.replace(/\/+$/, "")}`}
      />
      {!evals && !tools && <h1 className="sr-only">{title}</h1>}
      <Header />
      <div className="pt-[var(--header-height,70px)]">
        {evals ? (
          <EvalsScreen integrated />
        ) : (
          <ChatApp integrated initialView={tools ? "tools" : "chat"} />
        )}
      </div>
    </ChatNavigationContext.Provider>
  );
};
