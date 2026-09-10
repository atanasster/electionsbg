import { chatPath } from "../navigationPaths";
import type { ChatNavigation } from "../navigation";
import { navigationPath } from "./workspace";
import { TOOLS_BY_NAME } from "../../tools/registry";
import { validateArguments } from "../../orchestrator/validateArguments";
import type { Lang, ToolArgs } from "../../tools/types";
export const URL_LIMIT = 6000;
export type ToolsLocation = { tool?: string; args?: ToolArgs; error?: boolean };
export const parseToolsLocation = (search: string): ToolsLocation => {
  if (search.length > URL_LIMIT) return { error: true };
  const params = new URLSearchParams(search);
  const tool = params.get("tool");
  if (!tool)
    return params.has("args") || params.has("v") ? { error: true } : {};
  if (
    params.get("v") !== "1" ||
    !Object.prototype.hasOwnProperty.call(TOOLS_BY_NAME, tool)
  )
    return { error: true };
  if (!params.has("args")) return { tool };
  try {
    const raw: unknown = JSON.parse(params.get("args")!);
    if (!raw || typeof raw !== "object" || Array.isArray(raw))
      return { error: true };
    const keys = new Set(TOOLS_BY_NAME[tool].params.map((p) => p.name));
    if (Object.keys(raw).some((k) => !keys.has(k))) return { error: true };
    const checked = validateArguments(tool, raw);
    if (Object.keys(checked.errors).length) return { error: true };
    return { tool, args: checked.args };
  } catch {
    return { error: true };
  }
};
export const toolsHref = (
  tool: string | undefined,
  lang: Lang,
  search: string,
  args?: ToolArgs,
  pathname = typeof window === "undefined" ? "/" : window.location.pathname,
) => {
  const params = new URLSearchParams(
    /^\/(en\/)?chat(?:\/|$)/.test(pathname) ? {} : { lang },
  );
  const area = new URLSearchParams(search).get("area");
  if (area) params.set("area", area);
  if (tool) {
    params.set("v", "1");
    params.set("tool", tool);
  }
  if (args !== undefined) {
    if (!tool) throw new Error("Missing tool");
    const checked = validateArguments(tool, args, { defaults: true });
    if (Object.keys(checked.errors).length) throw new Error("Invalid settings");
    params.set("args", JSON.stringify(checked.args));
  }
  const query = `?${params}`;
  if (query.length > URL_LIMIT || parseToolsLocation(query).error)
    throw new Error("Invalid or oversized link");
  return `${chatPath("tools", pathname)}${query}`;
};
export const recentIds = (raw: unknown): string[] =>
  Array.isArray(raw)
    ? [
        ...new Set(
          raw.filter(
            (id): id is string =>
              typeof id === "string" &&
              Object.prototype.hasOwnProperty.call(TOOLS_BY_NAME, id),
          ),
        ),
      ].slice(0, 8)
    : [];

export const navigateView = (
  current: "chat" | "tools",
  next: "chat" | "tools",
  navigation?: ChatNavigation,
) => {
  if (current === next) return;
  if (navigation) {
    navigation.navigate(
      navigationPath(next, navigation.search, navigation.pathname),
    );
    return;
  }
  window.history.pushState(
    null,
    "",
    navigationPath(next, window.location.search),
  );
  window.dispatchEvent(new PopStateEvent("popstate"));
};
