// The in-composer model picker: a status pill that lives at the left edge of the
// chat composer and opens a rich panel of model cards. It makes the on-device
// download cost a first-class, reversible thing — what's already downloaded, how
// big a new one is, an explicit confirm before committing gigabytes, cancel
// mid-download, and remove-to-free-space. Driven entirely by useModelEngine +
// the model registry, so enabling a model (flip ready:true) needs no UI change.

import { type ReactNode, useState } from "react";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  Download,
  Loader2,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { MODELS, type ModelOption, type ModelTag } from "../llm/models";
import type { ModelEngine } from "../llm/useModelEngine";
import type { Lang } from "../tools/types";

const TAG_LABELS: Record<ModelTag, { bg: string; en: string }> = {
  "bg-native": { bg: "Най-добър за български", en: "Best for Bulgarian" },
  routes: { bg: "Насочва инструменти", en: "Routes tools" },
  fast: { bg: "Бърз", en: "Fast" },
  test: { bg: "Тест", en: "Test" },
  multimodal: { bg: "Мултимодален", en: "Multimodal" },
  cloud: { bg: "Облачен", en: "Cloud" },
};

// Decimal GB to match the sizes HF/MLC report.
const formatGB = (bytes: number): string => `${(bytes / 1e9).toFixed(1)} GB`;

// Crude metered-connection check so we can warn before a multi-GB download on
// mobile data. Best-effort: the Network Information API is Chromium-only.
const onMeteredConnection = (): boolean => {
  if (typeof navigator === "undefined") return false;
  const conn = (
    navigator as unknown as {
      connection?: { saveData?: boolean; effectiveType?: string };
    }
  ).connection;
  if (!conn) return false;
  return (
    Boolean(conn.saveData) || /(^|-)(2g|3g)$/.test(conn.effectiveType ?? "")
  );
};

// A small status dot summarizing the active engine for the pill.
const StatusDot = ({
  tone,
}: {
  tone: "ready" | "loading" | "error" | "muted";
}) => (
  <span
    className={cn(
      "size-2 shrink-0 rounded-full",
      tone === "ready" && "bg-emerald-500",
      tone === "loading" && "animate-pulse bg-amber-500",
      tone === "error" && "bg-destructive",
      tone === "muted" && "bg-muted-foreground/50",
    )}
  />
);

const Tag = ({ tag, lang }: { tag: ModelTag; lang: Lang }) => (
  <span
    className={cn(
      "rounded-full border px-1.5 py-0.5 text-[10px] font-medium leading-none",
      tag === "bg-native"
        ? "border-primary/30 bg-primary/10 text-primary"
        : tag === "cloud"
          ? "border-sky-500/30 bg-sky-500/10 text-sky-600"
          : "border-input bg-muted text-muted-foreground",
    )}
  >
    {TAG_LABELS[tag][lang]}
  </span>
);

export const ModelPicker = ({
  engine,
  lang,
}: {
  engine: ModelEngine;
  lang: Lang;
}) => {
  const t = (bg: string, en: string) => (lang === "bg" ? bg : en);
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState<ModelOption | null>(null);
  const { providerId, load, cached, storage, hasWebGPU } = engine;

  // ---- pill (trigger) -------------------------------------------------------
  const activeModel = MODELS.find((m) => m.id === providerId);
  const pillLabel =
    providerId === "rules"
      ? t("Без AI", "Basic")
      : (activeModel?.label[lang] ?? t("Модел", "Model"));
  const pillTone: "ready" | "loading" | "error" | "muted" =
    load.phase === "loading"
      ? "loading"
      : load.phase === "error"
        ? "error"
        : load.phase === "unsupported"
          ? "muted"
          : "ready";

  // Open the panel + load fresh cache state (which models are on the device).
  const onOpenChange = (next: boolean) => {
    setOpen(next);
    if (next) void engine.refresh();
  };

  const startDownload = (m: ModelOption) => {
    setConfirm(null);
    void engine.select(m.id);
  };

  return (
    <>
      <Popover open={open} onOpenChange={onOpenChange}>
        <PopoverTrigger asChild>
          <button
            type="button"
            title={t("Изберете AI модел", "Choose AI model")}
            aria-label={t("Изберете AI модел", "Choose AI model")}
            className="flex h-8 shrink-0 items-center gap-1 rounded-full border border-input bg-background px-2.5 text-[11px] font-medium text-muted-foreground shadow-sm transition-colors hover:bg-muted hover:text-foreground"
          >
            {load.phase === "loading" ? (
              <Loader2 className="size-3 shrink-0 animate-spin text-amber-500" />
            ) : (
              <StatusDot tone={pillTone} />
            )}
            <span className="hidden max-w-[7rem] truncate sm:inline">
              {pillLabel}
              {load.phase === "loading" ? ` · ${load.pct}%` : ""}
            </span>
            <ChevronDown className="size-3 shrink-0 opacity-60" />
          </button>
        </PopoverTrigger>

        <PopoverContent
          side="top"
          align="end"
          sideOffset={8}
          className="w-[min(92vw,22rem)] overflow-hidden p-0"
        >
          <div className="flex items-center gap-1.5 border-b bg-muted/50 px-3 py-2">
            <ShieldCheck className="size-3.5 shrink-0 text-emerald-600" />
            <p className="text-[11px] leading-tight text-muted-foreground">
              {t(
                "Свалените модели работят изцяло във вашия браузър — въпросите ви не напускат устройството. Облачните модели изпращат въпроса към сървър.",
                "Downloaded models run entirely in your browser — your questions never leave your device. Cloud models send the question to a server.",
              )}
            </p>
          </div>

          {!hasWebGPU && (
            <div className="flex items-start gap-1.5 border-b bg-destructive/5 px-3 py-2 text-[11px] text-destructive">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
              <span>
                {t(
                  "Този браузър няма WebGPU — AI моделите не са налични. Използвайте Chrome/Edge на компютър. Чатът работи с правила.",
                  "This browser has no WebGPU — AI models aren't available. Use desktop Chrome/Edge. The chat works on rules.",
                )}
              </span>
            </div>
          )}

          <div className="max-h-[min(60vh,30rem)] divide-y overflow-y-auto">
            {/* Rules — the safe default: instant, no download, always works. */}
            <RulesCard engine={engine} lang={lang} />
            {MODELS.map((m) => (
              <ModelCard
                key={m.id}
                model={m}
                engine={engine}
                lang={lang}
                downloaded={!!cached[m.id]}
                onAskDownload={() => setConfirm(m)}
              />
            ))}
          </div>

          {storage && storage.quota > 0 && (
            <div className="border-t bg-muted/40 px-3 py-2 text-[11px] text-muted-foreground">
              {t("На това устройство:", "On this device:")}{" "}
              {formatGB(storage.usage)} {t("от", "of")}{" "}
              {formatGB(storage.quota)} {t("заети", "used")}
            </div>
          )}
        </PopoverContent>
      </Popover>

      {/* Confirm before committing a multi-GB download. Rendered as a sibling
          (portals to body) so it isn't tied to the popover's lifetime. */}
      <Dialog open={!!confirm} onOpenChange={(o) => !o && setConfirm(null)}>
        <DialogContent className="max-w-md">
          {confirm && (
            <>
              <DialogHeader>
                <DialogTitle>
                  {t("Свали", "Download")} {confirm.label[lang]}?
                </DialogTitle>
                <DialogDescription className="space-y-2 pt-1 text-left">
                  <span className="block">
                    {t(
                      `Еднократно сваляне от ${confirm.size?.[lang] ?? ""}. Моделът работи изцяло във вашия браузър — въпросите ви не напускат устройството, и работи и офлайн след това. Можете да го премахнете по всяко време.`,
                      `One-time ${confirm.size?.[lang] ?? ""} download. It runs entirely in your browser — your questions never leave your device, and it works offline afterwards. You can remove it any time.`,
                    )}
                  </span>
                  {confirm.vramNote && (
                    <span className="block text-xs">
                      {t("Изисква", "Requires")} {confirm.vramNote[lang]}.
                    </span>
                  )}
                  {onMeteredConnection() && (
                    <span className="flex items-start gap-1.5 text-xs text-amber-600">
                      <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                      {t(
                        "Изглежда сте на мобилни данни — това е голямо сваляне.",
                        "You appear to be on mobile data — this is a large download.",
                      )}
                    </span>
                  )}
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button variant="outline" onClick={() => setConfirm(null)}>
                  {t("Отказ", "Cancel")}
                </Button>
                <Button onClick={() => startDownload(confirm)}>
                  <Download className="mr-1.5 size-4" />
                  {t("Свали", "Download")} {confirm.size?.[lang] ?? ""}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
};

// ---- cards ------------------------------------------------------------------

const CardShell = ({
  active,
  children,
}: {
  active: boolean;
  children: ReactNode;
}) => (
  <div className={cn("px-3 py-2.5", active && "bg-primary/5")}>{children}</div>
);

const RulesCard = ({ engine, lang }: { engine: ModelEngine; lang: Lang }) => {
  const t = (bg: string, en: string) => (lang === "bg" ? bg : en);
  const active = engine.providerId === "rules";
  return (
    <CardShell active={active}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <StatusDot tone="ready" />
            <span className="text-xs font-semibold">
              {t("Без AI (офлайн)", "Basic (offline)")}
            </span>
          </div>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            {t(
              "Мигновено · без сваляне · работи винаги",
              "Instant · no download · always works",
            )}
          </p>
        </div>
        <div className="shrink-0">
          {active ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary">
              <Check className="size-3.5" />
              {t("Активен", "Active")}
            </span>
          ) : (
            <Button
              size="sm"
              variant="outline"
              onClick={() => void engine.select("rules")}
            >
              {t("Използвай", "Use")}
            </Button>
          )}
        </div>
      </div>
    </CardShell>
  );
};

const ModelCard = ({
  model,
  engine,
  lang,
  downloaded,
  onAskDownload,
}: {
  model: ModelOption;
  engine: ModelEngine;
  lang: Lang;
  downloaded: boolean;
  onAskDownload: () => void;
}) => {
  const t = (bg: string, en: string) => (lang === "bg" ? bg : en);
  const { providerId, load, hasWebGPU } = engine;
  const active = providerId === model.id;
  const isCloud = model.runtime === "cloud";
  const isLoading = active && load.phase === "loading";
  const isReady = active && load.phase === "ready";
  const isError = active && load.phase === "error";
  const unavailable = !model.ready; // needs MLC build / disabled
  const blockedByGpu = !hasWebGPU && !unavailable && !isCloud; // cloud needs no GPU

  return (
    <CardShell active={active}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            {isReady && <StatusDot tone="ready" />}
            <span
              className={cn(
                "text-xs font-semibold",
                (unavailable || blockedByGpu) && "text-muted-foreground",
              )}
            >
              {model.label[lang]}
            </span>
            {model.recommended && !unavailable && (
              <span className="rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-semibold leading-none text-primary-foreground">
                {t("Препоръчан", "Recommended")}
              </span>
            )}
            {downloaded && !active && (
              <span className="inline-flex items-center gap-0.5 rounded-full bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium leading-none text-emerald-600">
                <Check className="size-3" />
                {t("Свален", "Downloaded")}
              </span>
            )}
          </div>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            {model.advantage[lang]}
          </p>
          {model.tags && model.tags.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-1">
              {model.tags.map((tag) => (
                <Tag key={tag} tag={tag} lang={lang} />
              ))}
            </div>
          )}
          {/* meta line: size/vram for loadable, the reason for unavailable */}
          <p className="mt-1 text-[11px] text-muted-foreground/80">
            {isCloud
              ? model.sizeNote[lang]
              : unavailable
                ? model.sizeNote[lang]
                : [model.size?.[lang], model.vramNote?.[lang]]
                    .filter(Boolean)
                    .join(" · ")}
          </p>
          {isCloud && (
            <p className="mt-0.5 text-[11px] text-amber-600">
              {t(
                "Облачен модел · въпросът се изпраща към сървър",
                "Cloud model · your question is sent to a server",
              )}
            </p>
          )}
        </div>

        {/* action column */}
        <div className="flex shrink-0 flex-col items-end gap-1">
          {unavailable ? (
            <span className="rounded-full border border-dashed border-input px-2 py-1 text-[10px] text-muted-foreground">
              {t("Предстои", "Coming soon")}
            </span>
          ) : isCloud ? (
            isReady ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary">
                <Check className="size-3.5" />
                {t("Активен", "Active")}
              </span>
            ) : (
              <Button
                size="sm"
                variant="outline"
                onClick={() => void engine.select(model.id)}
              >
                {t("Използвай", "Use")}
              </Button>
            )
          ) : blockedByGpu ? (
            <span
              title={t("Нужен е WebGPU", "WebGPU required")}
              className="rounded-full border border-dashed border-input px-2 py-1 text-[10px] text-muted-foreground"
            >
              {t("Нужен WebGPU", "Needs WebGPU")}
            </span>
          ) : isLoading ? (
            <DownloadingControls engine={engine} load={load} lang={lang} />
          ) : isReady ? (
            <ActiveControls model={model} engine={engine} lang={lang} />
          ) : isError ? (
            <div className="flex flex-col items-end gap-1">
              <Button
                size="sm"
                variant="outline"
                onClick={() => void engine.select(model.id)}
              >
                {t("Опитай отново", "Retry")}
              </Button>
            </div>
          ) : downloaded ? (
            <div className="flex items-center gap-1">
              <Button
                size="sm"
                variant="default"
                onClick={() => void engine.select(model.id)}
              >
                {t("Използвай", "Use")}
              </Button>
              <RemoveButton model={model} engine={engine} lang={lang} />
            </div>
          ) : (
            <Button size="sm" variant="outline" onClick={onAskDownload}>
              <Download className="mr-1 size-3.5" />
              {t("Свали", "Download")}
              {model.size ? ` · ${model.size[lang]}` : ""}
            </Button>
          )}
        </div>
      </div>

      {isError && load.note && (
        <p className="mt-1.5 text-[11px] text-destructive">{load.note}</p>
      )}
    </CardShell>
  );
};

const DownloadingControls = ({
  engine,
  load,
  lang,
}: {
  engine: ModelEngine;
  load: ModelEngine["load"];
  lang: Lang;
}) => {
  const t = (bg: string, en: string) => (lang === "bg" ? bg : en);
  return (
    <div className="flex w-32 flex-col items-end gap-1">
      <div className="h-1 w-full overflow-hidden rounded bg-background">
        <div
          className="h-full bg-primary transition-all"
          style={{ width: `${load.pct}%` }}
        />
      </div>
      <span className="text-[10px] text-muted-foreground">
        {load.fromCache
          ? t("Зареждане (от кеша)", "Loading (cached)")
          : t("Сваляне", "Downloading")}{" "}
        {load.pct}%
      </span>
      {/* A cached load is fast + nothing to reclaim; only a real download
          gets a cancel. */}
      {!load.fromCache && (
        <Button
          size="sm"
          variant="ghost"
          className="h-6 px-2 text-xs text-destructive hover:text-destructive"
          onClick={() => engine.cancel()}
        >
          {t("Откажи", "Cancel")}
        </Button>
      )}
    </div>
  );
};

const ActiveControls = ({
  model,
  engine,
  lang,
}: {
  model: ModelOption;
  engine: ModelEngine;
  lang: Lang;
}) => {
  const t = (bg: string, en: string) => (lang === "bg" ? bg : en);
  return (
    <div className="flex items-center gap-1">
      <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary">
        <Check className="size-3.5" />
        {t("Активен", "Active")}
      </span>
      <RemoveButton model={model} engine={engine} lang={lang} />
    </div>
  );
};

const RemoveButton = ({
  model,
  engine,
  lang,
}: {
  model: ModelOption;
  engine: ModelEngine;
  lang: Lang;
}) => {
  const t = (bg: string, en: string) => (lang === "bg" ? bg : en);
  const [removing, setRemoving] = useState(false);
  const free = model.size?.[lang];
  return (
    <Button
      size="icon"
      variant="ghost"
      disabled={removing}
      title={
        free
          ? t(`Премахни (освободи ${free})`, `Remove (free ${free})`)
          : t("Премахни", "Remove")
      }
      aria-label={t("Премахни от устройството", "Remove from device")}
      className="size-8 text-muted-foreground hover:text-destructive"
      onClick={async () => {
        setRemoving(true);
        try {
          await engine.remove(model.id);
        } finally {
          setRemoving(false);
        }
      }}
    >
      {removing ? (
        <Loader2 className="size-4 animate-spin" />
      ) : (
        <Trash2 className="size-4" />
      )}
    </Button>
  );
};
