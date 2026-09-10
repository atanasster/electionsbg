// Development-only browser harness; not imported by the application entry or
// included in the AI production build. No live data is fetched by this fixture.
import { useState } from "react";
import { createRoot } from "react-dom/client";
import "@/index.css";
import "@/App.css";
import { ThemeContextProvider } from "@/theme/ThemeContext";
import { TooltipProvider } from "@/components/ui/tooltip";
import { TOOLS_BY_NAME } from "../../tools/registry";
import { ToolWorkspace } from "./ToolWorkspace";
import type { WorkspaceState } from "./workspace";
import type { Envelope } from "../../tools/types";
if (!import.meta.env.DEV) throw new Error("Development fixture only");
let scenario = "success";
TOOLS_BY_NAME.contractSearch.run = async (args) => {
  const selected = scenario;
  await new Promise((resolve) =>
    setTimeout(resolve, selected === "slow" ? 1500 : 30),
  );
  if (selected === "error") throw new Error("Fixture: source unavailable");
  const env: Envelope = {
    tool: "contractSearch",
    kind: "table",
    title: `Fixture result for ${args.company}`,
    rows: [{ company: String(args.company), contracts: 3 }],
    columns: [
      { key: "company", label: "Company" },
      { key: "contracts", label: "Contracts", numeric: true },
    ],
    facts: { count: 3 },
    provenance: ["Deterministic browser fixture"],
    viz: "none",
  };
  return selected === "clarify" && args.company !== "Resolved Ltd"
    ? {
        ...env,
        clarify: {
          prompt: "Choose a company",
          options: [
            {
              label: "Resolved Ltd",
              tool: "contractSearch",
              args: { company: "Resolved Ltd", count: 12 },
            },
          ],
        },
      }
    : env;
};
export function Fixture() {
  const [state, onChange] = useState<WorkspaceState>({
    draft: { company: "Example Ltd" },
  });
  const [mode, setMode] = useState(scenario);
  return (
    <main className="mx-auto max-w-4xl space-y-5 p-5">
      <h1>Development fixture — deterministic responses</h1>
      <label>
        Scenario{" "}
        <select
          value={mode}
          onChange={(e) => {
            scenario = e.target.value;
            setMode(scenario);
          }}
        >
          {["success", "slow", "error", "clarify"].map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
      </label>
      <ToolWorkspace
        name="contractSearch"
        lang="en"
        state={state}
        onChange={onChange}
        onOpenChat={() => {}}
      />
    </main>
  );
}
createRoot(document.getElementById("root")!).render(
  <ThemeContextProvider>
    <TooltipProvider>
      <Fixture />
    </TooltipProvider>
  </ThemeContextProvider>,
);
