import React from "react";
import { ChatMessage } from "@/ai/types";
import { User, Bot } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Language, translations } from "@/ai/constants";

interface MessageProps {
  message: ChatMessage;
  sendUserMessage: (message: string) => void;
  language: Language;
}

const Message: React.FC<MessageProps> = ({
  message,
  sendUserMessage,
  language,
}) => {
  const isUser = message.role === "user";
  const part = message.parts[0];

  const Icon = isUser ? User : Bot;
  const messageAlignment = isUser ? "items-end" : "items-start";
  const bubbleStyles = isUser
    ? "bg-primary text-primary-foreground rounded-br-none"
    : "bg-muted rounded-bl-none";

  const handleLinkClick = (href: string | undefined) => {
    if (!href || !href.startsWith("/query/")) return;

    const parts = href.split("/").filter((p) => p);
    if (parts.length < 3) return;

    const [, entityType, ...rest] = parts;
    const queryTemplates = translations[language].linkQueries;
    let query = "";

    if (entityType === "location") {
      const locationType = rest[0];
      const locationName = decodeURIComponent(rest.slice(1).join("/"));
      query = queryTemplates.location
        .replace("{locationType}", locationType)
        .replace("{locationName}", locationName);
    } else {
      const entityName = decodeURIComponent(rest.join("/"));
      switch (entityType) {
        case "party":
          query = queryTemplates.party.replace("{entityName}", entityName);
          break;
        case "election":
          query = queryTemplates.election.replace("{entityName}", entityName);
          break;
        case "station":
          query = queryTemplates.station.replace("{entityName}", entityName);
          break;
        case "candidate":
          query = queryTemplates.candidate.replace("{entityName}", entityName);
          break;
        default:
          query = queryTemplates.default
            .replace("{entityType}", entityType)
            .replace("{entityName}", entityName);
      }
    }

    if (query) {
      sendUserMessage(query);
    }
  };

  const renderMessageContent = () => {
    if (!part) return <div className="text-sm">[Empty Message]</div>;

    if (isUser && "text" in part) {
      return <div className="text-sm whitespace-pre-wrap">{part.text}</div>;
    }

    if (!isUser) {
      if ("functionCall" in part) {
        return (
          <em className="text-sm text-muted-foreground">
            Calling function: {part.functionCall.name}...
          </em>
        );
      }
      if ("text" in part) {
        return (
          <div className="markdown-content">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                a: ({ href, ...props }) => {
                  if (href && href.startsWith("/query/")) {
                    return (
                      <a
                        {...props}
                        href={href}
                        onClick={(e) => {
                          e.preventDefault();
                          handleLinkClick(href);
                        }}
                        title={`Click to learn more about ${props.children}`}
                      />
                    );
                  }
                  // External link
                  return (
                    <a
                      target="_blank"
                      rel="noopener noreferrer"
                      href={href}
                      {...props}
                    />
                  );
                },
              }}
            >
              {part.text}
            </ReactMarkdown>
          </div>
        );
      }
    }

    return <div className="text-sm">[Message Error]</div>;
  };

  return (
    <div className={cn("flex flex-col gap-2", messageAlignment)}>
      <div className={cn("flex gap-3", isUser && "flex-row-reverse")}>
        <Avatar>
          <AvatarFallback>
            <Icon className="w-5 h-5" />
          </AvatarFallback>
        </Avatar>
        <div className={cn("px-4 py-3 rounded-lg max-w-lg", bubbleStyles)}>
          {renderMessageContent()}
        </div>
      </div>
    </div>
  );
};

export default Message;
