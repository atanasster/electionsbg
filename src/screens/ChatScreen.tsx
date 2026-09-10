import { chatView, normalizeChatUrl } from "@/lib/chatRoute";
import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { App as ChatApp } from "../../ai/App";
import { EvalsScreen } from "../../ai/app/EvalsScreen";
import { ChatNavigationContext } from "../../ai/app/navigation";
import { Layout } from "@/layout/Layout";
import { SEO } from "@/ux/SEO";
import { SITE_ORIGIN } from "@/lib/siteOrigin";
import { ChatToolbar } from "../../ai/app/ChatToolbar";
import { clearSavedChat } from "../../ai/app/chatStorage";
import { chatToolbarPath } from "../../ai/app/navigationPaths";
import { setDbOrigin } from "../../ai/tools/dataClient";

// This lazy entry is only used by the main app. Its Hosting project owns /api/db;
// the standalone AI entry keeps the environment's cross-origin configuration.
setDbOrigin("");

export const ChatScreen = () => {
  const location = useLocation();
  const [conversationKey, setConversationKey] = useState(0);
  const [resetTarget, setResetTarget] = useState<string | null>(null);
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
  // Router navigation may commit in a transition. Unmount the old conversation
  // first, then remount only after its old ?q= is gone, so reset cannot re-ask it.
  useEffect(() => {
    if (
      resetTarget !== null &&
      navigation.pathname + navigation.search === resetTarget
    ) {
      clearSavedChat();
      setConversationKey((key) => key + 1);
      setResetTarget(null);
    }
  }, [resetTarget, navigation.pathname, navigation.search]);
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
          : "Ask Naiasno";
  const description =
    lang === "bg"
      ? "Задайте въпрос за публичните данни за България и проверете източниците зад отговора."
      : "Ask about Bulgaria’s public data and check the sources behind the answer.";
  if (needsNormalization) return null;
  return (
    <ChatNavigationContext.Provider value={navigation}>
      {/* No `fullTitle`: SEO's own rule appends the locale suffix only when the
          title does not already name the brand, so „Попитай Наясно" stays as it
          is and „Инструменти и данни" gains „| Наясно". A hard-coded
          `${title} | Наясно` here bypassed that — it doubled the brand on /chat
          and put a Cyrillic suffix on every /en variant. */}
      <SEO
        title={title}
        description={description}
        canonical={`${SITE_ORIGIN}${prefix}${location.pathname.replace(/\/+$/, "")}`}
      />
      {!evals && !tools && <h1 className="sr-only">{title}</h1>}
      <Layout fullWidth showCommunity={false}>
        <ChatToolbar
          onNewChat={() => {
            clearSavedChat();
            const target = chatToolbarPath(
              "chat",
              navigation.pathname,
              navigation.search,
            );
            setResetTarget(target);
            navigation.navigate(target);
          }}
        />
        {resetTarget !== null ? null : evals ? (
          <EvalsScreen integrated />
        ) : (
          <ChatApp
            key={conversationKey}
            integrated
            initialView={tools ? "tools" : "chat"}
          />
        )}
      </Layout>
    </ChatNavigationContext.Provider>
  );
};
