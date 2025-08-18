import React, { useState, useRef, useEffect } from "react";
import Message from "@/ai/components/Message";
import { Send, Bot, LoaderCircle, Square } from "lucide-react";
import type { Translations, Language } from "@/ai/constants";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ChatMessage } from "@/ai/types";

interface ChatWindowProps {
  translations: Translations;
  messages: ChatMessage[];
  isLoading: boolean;
  isStopping: boolean;
  thinkingMessage: string | null;
  sendUserMessage: (message: string) => void;
  stopGeneration: () => void;
  language: Language;
}

const ChatWindow: React.FC<ChatWindowProps> = ({
  messages,
  isLoading,
  isStopping,
  thinkingMessage,
  sendUserMessage,
  stopGeneration,
  translations,
  language,
}) => {
  const [input, setInput] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(scrollToBottom, [messages]);

  const handleSend = (messageText: string = input) => {
    if (messageText.trim()) {
      sendUserMessage(messageText);
      setInput("");
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <Card className="flex flex-col h-full max-w-4xl mx-auto">
      <CardContent className="flex-1 p-6 space-y-4 overflow-y-auto">
        {messages.map((msg) => (
          <Message
            key={msg.id}
            message={msg}
            sendUserMessage={sendUserMessage}
            language={language}
            translations={translations}
          />
        ))}
        {isLoading && (
          <div className="flex items-start gap-3">
            <div className="flex items-center justify-center h-10 w-10 shrink-0 overflow-hidden rounded-full bg-muted">
              <Bot className="w-5 h-5" />
            </div>
            <div className="flex items-center space-x-2 bg-muted text-muted-foreground rounded-lg p-3 max-w-lg">
              <LoaderCircle className="h-5 w-5 animate-spin" />
              <span>
                {isStopping ? translations.stoppingMessage : thinkingMessage}
              </span>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </CardContent>

      <CardFooter className="flex-col items-start gap-4 border-t p-4">
        <div className="relative flex w-full">
          <Textarea
            placeholder={translations.inputPlaceholder}
            rows={1}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            className="min-h-0 pr-16 resize-none"
            disabled={isLoading}
          />
          {isLoading ? (
            isStopping ? (
              <Button
                type="button"
                variant="outline"
                size="icon"
                disabled
                className="absolute right-2 top-1/2 -translate-y-1/2 h-8 w-8"
                aria-label="Stopping generation"
              >
                <LoaderCircle className="h-4 w-4 animate-spin" />
                <span className="sr-only">Stopping</span>
              </Button>
            ) : (
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={stopGeneration}
                className="absolute right-2 top-1/2 -translate-y-1/2 h-8 w-8"
                aria-label="Stop generation"
              >
                <svg
                  className="absolute h-full w-full animate-spin text-primary"
                  style={{ animationDuration: "1.5s" }}
                  fill="none"
                  viewBox="0 0 32 32"
                >
                  <circle
                    cx="16"
                    cy="16"
                    r="14"
                    stroke="currentColor"
                    strokeDasharray="25 63"
                    strokeLinecap="round"
                    strokeWidth="2"
                  />
                </svg>
                <Square className="h-4 w-4" />
                <span className="sr-only">Stop</span>
              </Button>
            )
          ) : (
            <Button
              type="submit"
              size="icon"
              onClick={() => handleSend()}
              disabled={!input.trim()}
              className="absolute right-2 top-1/2 -translate-y-1/2 h-8 w-8"
              aria-label="Send message"
            >
              <Send className="h-4 w-4" />
              <span className="sr-only">Send</span>
            </Button>
          )}
        </div>
      </CardFooter>
    </Card>
  );
};

export default ChatWindow;
