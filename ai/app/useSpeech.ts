// Text-to-speech for answer narration via the browser SpeechSynthesis API
// (free, offline, no key). Picks a voice matching the answer's language; if the
// platform ships no voice for that language the hook reports `supported: false`
// so the caller can hide the speaker button rather than read in a wrong accent.

import { useCallback, useEffect, useRef, useState } from "react";
import type { Lang } from "../tools/types";

const BCP47: Record<Lang, string> = { bg: "bg-BG", en: "en-US" };

const pickVoice = (
  voices: SpeechSynthesisVoice[],
  lang: Lang,
): SpeechSynthesisVoice | undefined => {
  const tag = BCP47[lang];
  const prefix = lang === "bg" ? "bg" : "en";
  return (
    voices.find((v) => v.lang === tag) ??
    voices.find((v) => v.lang?.toLowerCase().startsWith(prefix))
  );
};

export const useSpeech = (lang: Lang) => {
  const synth = typeof window !== "undefined" ? window.speechSynthesis : null;
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [speakingId, setSpeakingId] = useState<string | null>(null);
  const utterRef = useRef<SpeechSynthesisUtterance | null>(null);

  // Voice lists load async on most browsers; subscribe until they arrive.
  useEffect(() => {
    if (!synth) return;
    const load = () => setVoices(synth.getVoices());
    load();
    synth.addEventListener("voiceschanged", load);
    return () => synth.removeEventListener("voiceschanged", load);
  }, [synth]);

  // Cancel any in-flight utterance on unmount so navigating away stops audio.
  useEffect(() => () => synth?.cancel(), [synth]);

  const voice = pickVoice(voices, lang);
  // While voices are still loading we optimistically allow speech (the engine
  // falls back to its default voice); once loaded, gate on a language match.
  const supported = !!synth && (voices.length === 0 || !!voice);

  const stop = useCallback(() => {
    synth?.cancel();
    setSpeakingId(null);
  }, [synth]);

  const speak = useCallback(
    (id: string, text: string) => {
      if (!synth || !text.trim()) return;
      // Toggle: clicking the speaker on a playing answer stops it.
      if (speakingId === id) {
        stop();
        return;
      }
      synth.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = BCP47[lang];
      if (voice) u.voice = voice;
      u.onend = () => setSpeakingId((cur) => (cur === id ? null : cur));
      u.onerror = () => setSpeakingId((cur) => (cur === id ? null : cur));
      utterRef.current = u;
      setSpeakingId(id);
      synth.speak(u);
    },
    [synth, lang, voice, speakingId, stop],
  );

  return { supported, speak, stop, speakingId };
};
