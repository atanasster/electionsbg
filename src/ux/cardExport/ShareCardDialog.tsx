import { FC, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Download, Copy, Share2, Check } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  filenameBase: string;
  render: () => Promise<Blob>;
};

export const ShareCardDialog: FC<Props> = ({
  open,
  onOpenChange,
  title,
  filenameBase,
  render,
}) => {
  const { t } = useTranslation();
  const [blob, setBlob] = useState<Blob | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setBlob(null);
    setPreviewUrl(null);
    setError(null);
    render()
      .then((b) => {
        if (cancelled) return;
        setBlob(b);
        setPreviewUrl(URL.createObjectURL(b));
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e?.message ?? "render failed");
      });
    return () => {
      cancelled = true;
    };
  }, [open, render]);

  // Revoke object URLs when they change to avoid leaks.
  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  const filename = `${filenameBase}.png`;

  const handleDownload = () => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleCopy = async () => {
    if (!blob) return;
    try {
      // Clipboard image support is gated behind isSecureContext in some browsers.
      const ClipboardItemCtor = (
        window as unknown as { ClipboardItem?: typeof ClipboardItem }
      ).ClipboardItem;
      if (!ClipboardItemCtor) throw new Error("ClipboardItem unavailable");
      await navigator.clipboard.write([
        new ClipboardItemCtor({ "image/png": blob }),
      ]);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch (e) {
      setError((e as Error)?.message ?? "copy failed");
    }
  };

  const handleNativeShare = async () => {
    if (!blob || !("share" in navigator)) return;
    try {
      const file = new File([blob], filename, { type: "image/png" });
      if (
        "canShare" in navigator &&
        navigator.canShare &&
        !navigator.canShare({ files: [file] })
      ) {
        throw new Error("not shareable");
      }
      await navigator.share({ files: [file], title });
    } catch (e) {
      const msg = (e as Error)?.message ?? "share failed";
      // AbortError when user cancels — don't show as a real error.
      if (!/abort/i.test(msg)) setError(msg);
    }
  };

  const canNativeShare =
    typeof navigator !== "undefined" && "share" in navigator;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="md:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{t("share_card_description")}</DialogDescription>
        </DialogHeader>
        <div className="bg-muted rounded-lg overflow-hidden border">
          {previewUrl ? (
            <img
              src={previewUrl}
              alt={title}
              className="w-full h-auto"
              style={{ aspectRatio: "1200 / 630" }}
            />
          ) : error ? (
            <div className="aspect-[1200/630] flex items-center justify-center text-sm text-rose-600 px-4 text-center">
              {error}
            </div>
          ) : (
            <div className="aspect-[1200/630] flex items-center justify-center text-sm text-muted-foreground">
              {t("loading")}
            </div>
          )}
        </div>
        <DialogFooter className="flex flex-row flex-wrap gap-2 sm:justify-end">
          <Button
            variant="outline"
            disabled={!blob}
            onClick={handleCopy}
            aria-label={t("share_copy")}
          >
            {copied ? (
              <Check className="h-4 w-4 mr-2 text-emerald-600" />
            ) : (
              <Copy className="h-4 w-4 mr-2" />
            )}
            {copied ? t("share_copied") : t("share_copy")}
          </Button>
          {canNativeShare && (
            <Button
              variant="outline"
              disabled={!blob}
              onClick={handleNativeShare}
            >
              <Share2 className="h-4 w-4 mr-2" />
              {t("share_native")}
            </Button>
          )}
          <Button disabled={!blob} onClick={handleDownload}>
            <Download className="h-4 w-4 mr-2" />
            {t("share_download")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
