// The ask-the-user disambiguation modal. When a tool returns a `clarify`
// envelope (a name matched several settlements/municipalities, or distinct
// people share a candidate name), the chat pops this dialog so the user picks
// exactly which entity they meant. Picking re-runs the tool with a pinned id
// (handled by the chat's `choose`); dismissing leaves the chooser available
// again via the answer card's "Изберете" button.

import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import type { ClarifyOption, ClarifyRequest, Lang } from "../tools/types";

export const ClarifyDialog = ({
  request,
  lang,
  onPick,
  onClose,
}: {
  request: ClarifyRequest | null;
  lang: Lang;
  onPick: (opt: ClarifyOption) => void;
  onClose: () => void;
}) => {
  const t = (bg: string, en: string) => (lang === "bg" ? bg : en);
  return (
    <Dialog.Root
      open={!!request}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[92vw] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border bg-card p-4 shadow-lg focus:outline-none">
          <Dialog.Title className="pr-6 text-base font-semibold text-foreground">
            {request?.prompt}
          </Dialog.Title>
          <Dialog.Description className="sr-only">
            {t(
              "Изберете кое от съвпадащите имена имате предвид.",
              "Choose which of the matching names you mean.",
            )}
          </Dialog.Description>
          <ul className="mt-3 max-h-[60vh] space-y-1.5 overflow-auto">
            {request?.options.map((o, i) => (
              <li key={`${o.label}-${i}`}>
                <button
                  type="button"
                  onClick={() => onPick(o)}
                  className="w-full rounded-lg border border-input bg-background px-3 py-2 text-left transition-colors hover:bg-muted"
                >
                  <span className="block text-sm font-medium text-foreground">
                    {o.label}
                  </span>
                  {o.sublabel && (
                    <span className="block text-xs text-muted-foreground">
                      {o.sublabel}
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
          <Dialog.Close
            aria-label={t("Затвори", "Close")}
            className="absolute right-3 top-3 rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground focus:outline-none"
          >
            <X className="size-4" />
          </Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
};
