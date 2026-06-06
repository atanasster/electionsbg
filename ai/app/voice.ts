// Browser voice input via the Web Speech API (SpeechRecognition). Chromium and
// Safari expose it (webkit-prefixed on Safari); Firefox doesn't — hence the
// feature-detect, so the mic button only renders where dictation actually works.
// The recognizer transcribes in the chat's current language and streams interim
// results, so the textarea fills live as the user speaks. No audio leaves the
// recognizer beyond what the browser itself does for speech-to-text.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Lang } from "../tools/types";

// Minimal structural types for the slice of the Web Speech API we touch — the
// DOM lib's SpeechRecognition typings aren't reliably present, so we model just
// what we use and avoid `any`.
type RecognitionAlternative = { transcript: string };
type RecognitionResult = ArrayLike<RecognitionAlternative> & {
  isFinal: boolean;
};
type RecognitionEvent = { results: ArrayLike<RecognitionResult> };
type Recognition = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((e: RecognitionEvent) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};
type RecognitionCtor = new () => Recognition;

const getCtor = (): RecognitionCtor | undefined => {
  if (typeof window === "undefined") return undefined;
  const w = window as unknown as {
    SpeechRecognition?: RecognitionCtor;
    webkitSpeechRecognition?: RecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
};

export const useVoiceInput = ({
  lang,
  onStart,
  onResult,
}: {
  lang: Lang;
  // fired the moment dictation begins, so the caller can snapshot whatever is
  // already in the field (the transcript is appended to it)
  onStart?: () => void;
  // the full transcript of the current dictation session (interim + final)
  onResult: (text: string) => void;
}) => {
  const Ctor = useMemo(getCtor, []);
  const supported = !!Ctor;
  const [listening, setListening] = useState(false);
  const recRef = useRef<Recognition | null>(null);
  // keep the latest callbacks/lang without re-creating start() on every render
  const cbRef = useRef({ onStart, onResult, lang });
  cbRef.current = { onStart, onResult, lang };

  const stop = useCallback(() => {
    recRef.current?.stop();
  }, []);

  const start = useCallback(() => {
    if (!Ctor || recRef.current) return;
    const rec = new Ctor();
    rec.lang = cbRef.current.lang === "bg" ? "bg-BG" : "en-US";
    rec.interimResults = true;
    rec.continuous = false;
    rec.onresult = (e) => {
      let text = "";
      for (let i = 0; i < e.results.length; i++)
        text += e.results[i][0]?.transcript ?? "";
      cbRef.current.onResult(text.trim());
    };
    const finish = () => {
      setListening(false);
      recRef.current = null;
    };
    rec.onend = finish;
    rec.onerror = finish;
    recRef.current = rec;
    cbRef.current.onStart?.();
    setListening(true);
    try {
      rec.start();
    } catch {
      finish(); // already-started / permission race — reset cleanly
    }
  }, [Ctor]);

  const toggle = useCallback(() => {
    if (recRef.current) stop();
    else start();
  }, [start, stop]);

  // abort any live session if the component unmounts
  useEffect(() => () => recRef.current?.abort(), []);

  return { supported, listening, toggle };
};
