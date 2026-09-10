import type { ChatResponse } from "../../ai/llm/provider";
export const discoveryStatus = (
  response: ChatResponse,
  expectedTool: string,
) => {
  const env = response.env;
  if (!env) return "error";
  if (response.tool !== expectedTool) return "wrong-tool";
  if (env.clarify) return "needs-input";
  if (
    /no .*matching|not found|няма .*намерен|не намерих|no party/i.test(
      env.title,
    )
  )
    return "unresolved-entity";
  if (
    /^no .*data|^няма .*данни|^няма данни|unavailable|недостъпн/i.test(
      env.title,
    ) ||
    (!env.title.trim() && !env.rows?.length && !env.series?.length)
  )
    return "no-data";
  return "ok";
};
