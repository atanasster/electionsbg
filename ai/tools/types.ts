// Shared types for the AI-chat deterministic tools layer ("Brain 1").
//
// Every tool returns a normalized `Envelope`. The renderer maps the envelope to
// the existing site UI primitives (@/components/ui/chart, @/components/ui/table).
// The LLM ("Brain 2") only ever narrates `Envelope.facts` and never computes a
// number itself.

export type Lang = "bg" | "en";

export type VizType = "line" | "bar" | "pie" | "none";

export type SeriesPoint = { x: string | number; y: number | null };

export type Series = {
  key: string; // stable dataKey for recharts + ChartConfig
  label: string; // human label (already resolved to ctx.lang)
  color?: string; // explicit hex/hsl; falls back to chart-1..5 theme vars
  points: SeriesPoint[];
};

export type ColumnFormat = "int" | "pct" | "text";

export type Column = {
  key: string;
  label: string;
  numeric?: boolean;
  format?: ColumnFormat;
};

export type Row = Record<string, string | number | null>;

export type EnvelopeKind = "scalar" | "table" | "series";

export type Envelope = {
  tool: string;
  kind: EnvelopeKind;
  title: string; // resolved to ctx.lang
  subtitle?: string;
  // table payload
  columns?: Column[];
  rows?: Row[];
  // series payload (line/bar). `categories` are the shared x-axis values.
  categories?: (string | number)[];
  series?: Series[];
  viz: VizType;
  // flat numbers/labels handed to the LLM to narrate. Keep keys descriptive.
  facts: Record<string, string | number>;
  // human-readable source identifiers, e.g. "elections.json", "2026_04_19/national_summary.json"
  provenance: string[];
};

// ---- tool definitions -------------------------------------------------------

export type ParamType =
  | "election"
  | "electionList"
  | "count"
  | "party"
  | "metric"
  | "region";

export type ToolParam = {
  name: string;
  type: ParamType;
  required?: boolean;
  default?: string | number;
  description: { bg: string; en: string };
};

export type ToolContext = {
  lang: Lang;
  // default election when a tool's `election` arg is omitted (the selected one;
  // defaults to the latest election).
  election: string;
};

export type ToolArgs = Record<string, string | number | string[] | undefined>;

export type ToolRun = (
  args: ToolArgs,
  ctx: ToolContext,
) => Promise<Envelope> | Envelope;

export type ToolDef = {
  name: string;
  description: { bg: string; en: string };
  params: ToolParam[];
  // example utterances (bg/en) used for few-shot prompting + the harness
  examples: { bg: string; en: string }[];
  run: ToolRun;
};
