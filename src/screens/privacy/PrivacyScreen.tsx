import { Fragment, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { SEO } from "@/ux/SEO";
import { H1 } from "@/ux/H1";
import {
  PRIVACY_TITLE,
  PRIVACY_UPDATED,
  parseInline,
  privacySections,
  type Lang,
} from "./privacyContent";

const linkClass =
  "text-accent underline underline-offset-4 decoration-accent/40 hover:decoration-accent transition-colors";

const Inline = ({ text }: { text: string }): ReactNode =>
  parseInline(text).map((r, i) =>
    r.href ? (
      <a
        key={i}
        href={r.href}
        className={linkClass}
        {...(r.href.startsWith("http")
          ? { target: "_blank", rel: "noopener noreferrer" }
          : {})}
      >
        {r.text}
      </a>
    ) : (
      <Fragment key={i}>{r.text}</Fragment>
    ),
  );

const DESCRIPTION: Record<Lang, string> = {
  bg: "Как Наясно обработва лични данни: без бисквитки и реклама, собствена статистика без проследяване, AI чат, публичните регистри и вашите права.",
  en: "How Naiasno handles personal data: no cookies or ads, self-hosted cookieless statistics, the AI chat, public registers and your rights.",
};

export const PrivacyScreen = () => {
  const { i18n } = useTranslation();
  const lang: Lang = i18n.language === "en" ? "en" : "bg";
  return (
    <div className="text-foreground w-full">
      <SEO title={PRIVACY_TITLE[lang]} description={DESCRIPTION[lang]} />
      <article className="mx-auto max-w-3xl px-4 sm:px-6 lg:px-8 py-8 md:py-16">
        <H1 className="text-4xl md:text-5xl text-left py-0 mb-4 text-foreground">
          {PRIVACY_TITLE[lang]}
        </H1>
        <p className="mb-10 text-sm text-muted-foreground">
          {lang === "bg" ? "Последна промяна" : "Last updated"}:{" "}
          {PRIVACY_UPDATED}
        </p>
        {privacySections().map((s) => (
          <section key={s.id} id={s.id} className="mb-10 scroll-mt-24">
            <h2 className="font-display text-2xl font-bold tracking-tight text-foreground">
              {s.heading[lang]}
            </h2>
            {s.blocks.map((b, i) =>
              b.kind === "p" ? (
                <p
                  key={i}
                  className="mt-4 text-base leading-relaxed text-muted-foreground"
                >
                  <Inline text={b.text[lang]} />
                </p>
              ) : b.kind === "ul" ? (
                <ul
                  key={i}
                  className="mt-4 list-disc space-y-2 pl-6 text-base leading-relaxed text-muted-foreground"
                >
                  {b.items.map((it, j) => (
                    <li key={j}>
                      <Inline text={it[lang]} />
                    </li>
                  ))}
                </ul>
              ) : (
                <div key={i} className="mt-4 overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr className="border-b border-border">
                        {b.head.map((h, j) => (
                          <th key={j} className="py-2 pr-4 font-semibold">
                            {h[lang]}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {b.rows.map((r, j) => (
                        <tr key={j} className="border-b border-border/50">
                          {r.map((c, k) => (
                            <td
                              key={k}
                              className={
                                k === 0
                                  ? "w-2/5 py-2 pr-4 align-top font-mono text-xs [overflow-wrap:anywhere]"
                                  : "py-2 pr-4 align-top text-muted-foreground"
                              }
                            >
                              <Inline text={c[lang]} />
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ),
            )}
          </section>
        ))}
      </article>
    </div>
  );
};
