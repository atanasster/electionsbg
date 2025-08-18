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
  const [error, setError] = useState<string | null>(null);
  const chatRef = useRef<Chat | null>(null);

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

  const sendUserMessage = useCallback(
    async (text: string) => {
      if (!text.trim() || isLoading) return;

      const newUserMessage: ChatMessage = {
        role: "user",
        parts: [{ text }],
        id: `user-${Date.now()}`,
      };

      setMessages((prev) => [...prev, newUserMessage]);
      setIsLoading(true);
      setError(null);

      try {
        if (!chatRef.current) {
          throw new Error("Chat not initialized");
        }

        const response = await sendMessage(chatRef.current, text);
        const modelResponseText = response.text || "Error empty response";

        const newModelMessage: ChatMessage = {
          role: "model",
          parts: [{ text: modelResponseText }],
          id: `model-${Date.now()}`,
        };
        setMessages((prev) => [...prev, newModelMessage]);
      } catch (e) {
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
      } finally {
        setIsLoading(false);
      }
    },
    [isLoading, language],
  );

  return { messages, isLoading, error, sendUserMessage };
};
