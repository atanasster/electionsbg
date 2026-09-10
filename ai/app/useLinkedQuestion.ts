import { useEffect, useRef } from "react";

// URL changes can arrive while an answer is streaming. Keep only the currently
// requested question and wait for the active response; never run concurrently.
export const useLinkedQuestion = (
  search: string,
  busy: boolean,
  send: (question: string) => Promise<void>,
) => {
  const sendLatest = useRef(send);
  sendLatest.current = send;
  const consumed = useRef<string | null>(null);
  const question = new URLSearchParams(search).get("q");
  useEffect(() => {
    if (!question) {
      consumed.current = null;
      return;
    }
    if (busy || consumed.current === question) return;
    consumed.current = question;
    void sendLatest.current(question);
  }, [question, busy]);
};
