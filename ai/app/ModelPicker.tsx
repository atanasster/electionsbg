import { useState, useSyncExternalStore } from "react";
import { Check, ChevronDown } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { AiVerification } from "./AiVerification";
import { ChatPolicy } from "./ChatPolicy";
import {
  hasAiSession,
  aiSessionNotice,
  subscribeAiSession,
} from "../llm/session";
import { MODELS } from "../llm/models";
import type { ModelEngine } from "../llm/useModelEngine";
import type { Lang } from "../tools/types";

export const ModelPicker = ({
  engine,
  lang,
}: {
  engine: ModelEngine;
  lang: Lang;
}) => {
  const [open, setOpen] = useState(false);
  const [verifyId, setVerifyId] = useState<string | null>(null);
  const notice = useSyncExternalStore(
    subscribeAiSession,
    aiSessionNotice,
    () => "",
  );
  const t = (bg: string, en: string) => (lang === "bg" ? bg : en);
  const choices = [
    {
      id: "rules",
      title: t("Без AI", "No AI"),
      detail: t(
        "Структурирани отговори и данни",
        "Structured answers and data",
      ),
    },
    ...MODELS.map((model) => ({
      id: model.id,
      title: t("AI помощник", "AI assistant"),
      detail: model.label[lang],
    })),
  ];
  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label={t("Изберете режим", "Choose mode")}
            className="flex h-8 shrink-0 items-center gap-1 rounded-full border border-input bg-background px-2.5 text-xs text-foreground hover:bg-muted"
          >
            {engine.providerId === "rules"
              ? t("Без AI", "No AI")
              : t("AI помощник", "AI assistant")}
            <ChevronDown className="size-3" />
          </button>
        </PopoverTrigger>
        <PopoverContent
          side="top"
          align="end"
          className="max-h-[70dvh] w-[min(92vw,24rem)] overflow-y-auto p-2"
        >
          {choices.map((choice) => (
            <button
              key={choice.id}
              type="button"
              aria-pressed={engine.providerId === choice.id}
              className="flex w-full items-center justify-between rounded px-3 py-3 text-left hover:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
              onClick={() => {
                if (choice.id !== "rules" && !hasAiSession())
                  setVerifyId(choice.id);
                else void engine.select(choice.id);
                setOpen(false);
              }}
            >
              <span>
                <span className="block text-sm font-medium">
                  {choice.title}
                </span>
                <span className="block text-xs text-muted-foreground">
                  {choice.detail}
                </span>
              </span>
              {engine.providerId === choice.id && (
                <Check aria-hidden="true" className="size-4" />
              )}
            </button>
          ))}
          <p className="border-t px-3 pt-2 text-xs text-muted-foreground">
            {t(
              "AI изпраща въпросите и контекста на разговора към сървър за обработка в облака.",
              "AI sends questions and conversation context to a server for cloud processing.",
            )}
          </p>
          <ChatPolicy lang={lang} />
        </PopoverContent>
      </Popover>
      <Dialog
        open={!!verifyId}
        onOpenChange={(next) => {
          if (!next) setVerifyId(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("AI помощник", "AI assistant")}</DialogTitle>
            <DialogDescription>
              {t("Проверка срещу злоупотреба", "Abuse prevention verification")}
            </DialogDescription>
          </DialogHeader>
          <AiVerification
            lang={lang}
            onVerified={() => {
              if (verifyId) void engine.select(verifyId);
              setVerifyId(null);
            }}
          />
        </DialogContent>
      </Dialog>
      {notice && engine.providerId !== "rules" && (
        <p role="status" className="max-w-52 text-xs text-muted-foreground">
          {notice === "verification_required"
            ? t(
                "Нужна е проверка за AI. Отговорът е без AI.",
                "AI verification required. Answering without AI.",
              )
            : /limit/.test(notice)
              ? t(
                  "AI лимитът е достигнат. При кратко ограничение опитайте след минута; дневните квоти се подновяват в 00:00 UTC. Можете да продължите без AI.",
                  "AI allowance reached. For a short-term limit, retry after a minute; daily allowances renew at 00:00 UTC. You can continue without AI.",
                )
              : t(
                  "AI временно не е достъпен. Продължете без AI.",
                  "AI is temporarily unavailable. Continue without AI.",
                )}
          <button
            type="button"
            className="ml-1 underline"
            onClick={() => setVerifyId(MODELS[0].id)}
          >
            {t("Проверка", "Verify")}
          </button>
        </p>
      )}
    </>
  );
};
