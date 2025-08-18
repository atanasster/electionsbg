import { useState, useCallback, useRef, useEffect } from "react";
import { ChatMessage } from "@/ai/types";
import {
  createChat,
  sendMessage,
  createChatWithHistory,
} from "@/ai/services/geminiService";
import type { Chat } from "@google/genai";
import { Language, translations } from "@/ai/constants";

export const useChat = (language: Language) => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isStopping, setIsStopping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [thinkingMessage, setThinkingMessage] = useState<string | null>(null);
  const chatRef = useRef<Chat | null>(null);
  const isCancelledRef = useRef(false);

  useEffect(() => {
    const initializeOrUpdateChat = async () => {
      if (chatRef.current) {
        // It's a language change.
        const history = await chatRef.current.getHistory();
        chatRef.current = createChatWithHistory(language, history);
      } else {
        // First initialization
        chatRef.current = createChat(language);
        setMessages([
          {
            role: "model",
            parts: [{ text: translations[language].welcomeMessage }],
            id: `initial-${Date.now()}`,
          },
        ]);
      }
    };

    initializeOrUpdateChat().catch((e) => {
      console.error("Failed to initialize or update chat:", e);
      const errorText = `${translations[language].errorMessagePrefix}: A critical error occurred while setting up the chat.`;
      const errorMsg: ChatMessage = {
        role: "model",
        parts: [{ text: errorText }],
        id: `error-${Date.now()}`,
      };
      setMessages((prev) => [...prev, errorMsg]);
      setError("Failed to initialize or update chat.");
    });
  }, [language]);

  const stopGeneration = useCallback(() => {
    isCancelledRef.current = true;
    setIsStopping(true);
  }, []);

  const sendUserMessage = useCallback(
    async (text: string) => {
      if (!text.trim() || isLoading) return;

      isCancelledRef.current = false; // Reset cancellation flag
      setIsStopping(false);
      const newUserMessage: ChatMessage = {
        role: "user",
        parts: [{ text }],
        id: `user-${Date.now()}`,
      };

      setMessages((prev) => [...prev, newUserMessage]);
      setIsLoading(true);
      setError(null);
      setThinkingMessage(translations[language].thinkingMessage);

      try {
        if (!chatRef.current) {
          throw new Error("Chat not initialized");
        }

        const { response, toolCalls } = await sendMessage(
          chatRef.current,
          text,
          isCancelledRef,
          (progressMessage) => setThinkingMessage(progressMessage),
        );

        if (isCancelledRef.current) {
          throw new Error("GENERATION_CANCELLED");
        }

        const modelResponseText = response.text || "Error empty response";

        const newModelMessage: ChatMessage = {
          role: "model",
          parts: [{ text: modelResponseText }],
          id: `model-${Date.now()}`,
          toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
        };
        setMessages((prev) => [...prev, newModelMessage]);
      } catch (e) {
        if (e instanceof Error && e.message === "GENERATION_CANCELLED") {
          console.log("Chat generation was cancelled by the user.");
          const stopMessage: ChatMessage = {
            role: "model",
            parts: [{ text: translations[language].generationStopped }],
            id: `stop-${Date.now()}`,
          };
          setMessages((prev) => [...prev, stopMessage]);
        } else {
          console.error("Failed to send message:", e);
          const errorMessage =
            e instanceof Error ? e.message : "An unknown error occurred.";
          setError(errorMessage);
          const errorText = `${translations[language].errorMessagePrefix}: ${errorMessage}`;
          const newErrorMessage: ChatMessage = {
            role: "model",
            parts: [{ text: errorText }],
            id: `error-${Date.now()}`,
          };
          setMessages((prev) => [...prev, newErrorMessage]);
        }
      } finally {
        setIsLoading(false);
        setIsStopping(false);
        isCancelledRef.current = false;
        setThinkingMessage(null);
      }
    },
    [isLoading, language],
  );

  return {
    messages,
    isLoading,
    isStopping,
    error,
    thinkingMessage,
    sendUserMessage,
    stopGeneration,
  };
};
