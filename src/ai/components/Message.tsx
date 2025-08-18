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
    if (parts.length < 2) return; // Must have at least /query/type

    // Decode all parts of the URL *before* using them to construct the user-facing query text.
    // This prevents URL-encoded characters like '%20' from appearing in the chat input.
    const decodedParts = parts.map(decodeURIComponent);

    const [, entityType, ...rest] = decodedParts;
    const queryTemplates = translations[language].linkQueries;
    let query = "";

    if (entityType === "location") {
      // Handles correctly formed location links: /query/location/region/Stara Zagora
      if (rest.length >= 2) {
        const locationType = rest[0];
        const locationName = rest.slice(1).join("/");
        query = queryTemplates.location
          .replace("{locationType}", locationType)
          .replace("{locationName}", locationName);
      }
      // Handles malformed location links gracefully: /query/location/Stara Zagora
      else if (rest.length === 1) {
        const locationName = rest[0];
        // Fallback to the generic template to create a sensible query.
        query = queryTemplates.default
          .replace("{entityType}", "location")
          .replace("{entityName}", locationName);
      } else {
        return; // Not enough parts for a valid location query.
      }
    } else {
      const entityName = rest.join("/");
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
          // This handles cases like /query/region/Stara Zagora, treating 'region' as the type.
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
                // eslint-disable-next-line @typescript-eslint/no-unused-vars
                a: ({ node, href, ...props }) => {
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
