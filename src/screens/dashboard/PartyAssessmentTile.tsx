import { FC, useState } from "react";
import { useTranslation } from "react-i18next";
import { Sparkles, ChevronDown, ChevronUp, Copy, Check } from "lucide-react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useQuery, QueryFunctionContext } from "@tanstack/react-query";
import { PartyDashboardSummary } from "@/data/dashboard/partyDashboardTypes";
import { useElectionContext } from "@/data/ElectionContext";
import { Hint } from "@/ux/Hint";
import { StatCard } from "./StatCard";

type Lang = "bg" | "en";

type PartyAssessment = {
  generatedAt: string;
  model: string;
  partyNum: number;
  nickName: string;
  bg: string;
  en: string;
};

const queryFn = async ({
  queryKey,
}: QueryFunctionContext<
  [string, string | null | undefined, number | null | undefined]
>): Promise<PartyAssessment | undefined> => {
  const [, election, partyNum] = queryKey;
  if (!election || !partyNum) return undefined;
  const res = await fetch(`/${election}/parties/assessment/${partyNum}.json`);
  if (!res.ok) return undefined;
  return res.json();
};

type Props = { data: PartyDashboardSummary };

export const PartyAssessmentTile: FC<Props> = ({ data }) => {
  const { t, i18n } = useTranslation();
  const { selected } = useElectionContext();
  const lang: Lang = i18n.language === "bg" ? "bg" : "en";
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

  const { data: assessment, isLoading } = useQuery({
    queryKey: ["party_assessment", selected, data.partyNum] as [
      string,
      string | null | undefined,
      number | null | undefined,
    ],
    queryFn,
  });

  const body = assessment ? assessment[lang] || assessment.en : null;

  const handleCopy = async () => {
    if (!body) return;
    try {
      await navigator.clipboard.writeText(body);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard write blocked (e.g. insecure context) — silently no-op
    }
  };

  return (
    <StatCard
      label={
        <div className="flex items-center justify-between w-full gap-2">
          <Hint text={t("dashboard_party_assessment_hint")} underline={false}>
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4" />
              <span>{t("dashboard_party_assessment")}</span>
            </div>
          </Hint>
          <div className="flex items-center gap-3">
            {assessment ? (
              <span className="text-[10px] text-muted-foreground italic">
                {t("dashboard_editorial")} · {assessment.model}
              </span>
            ) : null}
            {body ? (
              <button
                type="button"
                onClick={handleCopy}
                aria-label={
                  copied
                    ? t("dashboard_assessment_copied")
                    : t("dashboard_assessment_copy")
                }
                title={
                  copied
                    ? t("dashboard_assessment_copied")
                    : t("dashboard_assessment_copy")
                }
                className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-muted-foreground hover:text-foreground transition-colors normal-case"
              >
                {copied ? (
                  <>
                    <Check className="h-3.5 w-3.5 text-positive" />
                    <span className="text-positive">
                      {t("dashboard_assessment_copied")}
                    </span>
                  </>
                ) : (
                  <>
                    <Copy className="h-3.5 w-3.5" />
                    <span>{t("dashboard_assessment_copy")}</span>
                  </>
                )}
              </button>
            ) : null}
          </div>
        </div>
      }
    >
      {isLoading ? (
        <div className="text-sm text-muted-foreground">
          {t("dashboard_loading")}
        </div>
      ) : body ? (
        <>
          <div
            className={`relative text-sm leading-relaxed mt-2 max-w-3xl overflow-hidden transition-[max-height] duration-300 ease-out ${
              expanded ? "max-h-none" : "max-h-[180px]"
            }`}
          >
            <Markdown
              remarkPlugins={[remarkGfm]}
              components={{
                h2: ({ children }) => (
                  <h2 className="text-base font-semibold uppercase tracking-wide text-foreground mt-5 mb-2 first:mt-0 border-b border-border/50 pb-1">
                    {children}
                  </h2>
                ),
                h3: ({ children }) => (
                  <h3 className="text-sm font-semibold text-foreground mt-3 mb-1">
                    {children}
                  </h3>
                ),
                p: ({ children }) => (
                  <p className="my-2 text-foreground/90">{children}</p>
                ),
                ul: ({ children }) => (
                  <ul className="my-2 space-y-1.5 list-disc pl-5 marker:text-muted-foreground">
                    {children}
                  </ul>
                ),
                li: ({ children }) => (
                  <li className="text-foreground/90 leading-relaxed">
                    {children}
                  </li>
                ),
                strong: ({ children }) => (
                  <strong className="font-semibold text-foreground">
                    {children}
                  </strong>
                ),
                em: ({ children }) => (
                  <em className="italic text-foreground/90">{children}</em>
                ),
                code: ({ children }) => (
                  <code className="px-1 py-0.5 rounded bg-muted text-[0.85em] font-mono">
                    {children}
                  </code>
                ),
              }}
            >
              {body}
            </Markdown>
            {!expanded && (
              <div
                aria-hidden
                className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-card to-transparent pointer-events-none"
              />
            )}
          </div>
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="mt-2 inline-flex items-center gap-1 self-start text-xs font-medium text-primary hover:underline"
          >
            {expanded ? (
              <>
                {t("dashboard_assessment_show_less")}
                <ChevronUp className="h-3.5 w-3.5" />
              </>
            ) : (
              <>
                {t("dashboard_assessment_show_more")}
                <ChevronDown className="h-3.5 w-3.5" />
              </>
            )}
          </button>
        </>
      ) : (
        <div className="text-sm text-muted-foreground italic">
          {t("dashboard_assessment_not_generated")}
        </div>
      )}
    </StatCard>
  );
};
