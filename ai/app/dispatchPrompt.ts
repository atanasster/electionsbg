import {
  runToolChoice,
  type LLMProvider,
  type RespondOpts,
} from "../llm/provider";
import type { ToolArgs, ToolContext } from "../tools/types";

export const dispatchPrompt = (
  provider: LLMProvider,
  text: string,
  ctx: ToolContext,
  onDelta?: (text: string) => void,
  options?: RespondOpts,
  intent?: { tool: string; args: ToolArgs },
) => {
  if (!intent) return provider.respond(text, ctx, onDelta, options);
  return provider.runChoice
    ? provider.runChoice(intent.tool, intent.args, ctx, onDelta)
    : runToolChoice(
        { bg: "Без AI (офлайн)", en: "Basic (offline)" },
        intent.tool,
        intent.args,
        ctx,
      );
};
