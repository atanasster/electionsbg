// Shared types for the AI-chat deterministic tools layer ("Brain 1").
//
// Every tool returns a normalized `Envelope`. The renderer maps the envelope to
// the existing site UI primitives (@/components/ui/chart, @/components/ui/table).
// The LLM ("Brain 2") only ever narrates `Envelope.facts` and never computes a
// number itself.

export type Lang = "bg" | "en";

// Renderable chart kinds. (No "pie": the renderer only draws bar/line/hemicycle,
// so a pie envelope would silently fall back to a line — keep the type honest.)
// "hemicycle" draws a parliament-style semicircle of seats (one dot per seat,
// coloured by party); it reads `rows` (party, seats, color) rather than series.
export type VizType = "line" | "bar" | "hemicycle" | "none";

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

// ---- geographic overlay (optional Leaflet map on an answer) ------------------
// A tool may attach a `geo` block when its result maps onto real places. The
// renderer (ai/render/GeoChoropleth.tsx) fetches the geojson `source`, joins
// each feature to an area by `joinKey`, and colours it. The numbers always also
// live in the envelope's table/scalar/facts — the map is purely additive.

export type GeoLevel = "oblast" | "municipality" | "settlement";
// "choropleth" colours many areas by value/winner; "locator" highlights one (or
// a few) area(s) — used for single-place answers.
export type GeoMode = "choropleth" | "locator";

export type GeoArea = {
  // join value matching the geojson feature property named by `joinKey`:
  // an oblast/МИР code (nuts3), an obshtina code (nuts4), or an EKATTE (ekatte).
  code: string;
  label: string; // tooltip name, already resolved to ctx.lang
  value?: number | null; // metric used for the ramp + tooltip
  display?: string; // pre-formatted tooltip value (overrides `value` formatting)
  color?: string; // explicit fill (winner maps); used when colorMode "explicit"
};

export type GeoOverlay = {
  level: GeoLevel;
  mode: GeoMode;
  // geojson URL(s) to fetch (relative to the data bucket). An array is merged
  // into one FeatureCollection (e.g. the 31 per-oblast files for a nation map).
  source: string | string[];
  joinKey: "nuts3" | "nuts4" | "ekatte";
  metricLabel: string; // legend / tooltip metric name, resolved to ctx.lang
  format?: ColumnFormat;
  // "ramp" shades by value (min→max); "explicit" uses each area's own `color`.
  colorMode?: "ramp" | "explicit";
  areas: GeoArea[];
  // codes to highlight + fit the viewport to (locator target; defaults to all
  // matched areas when omitted).
  focus?: string[];
};

// ---- disambiguation (ask-the-user) ------------------------------------------
// When a name lookup is ambiguous — several settlements/municipalities share a
// name ("с. Баня"), or distinct people share a candidate name — a tool returns a
// `clarify` envelope instead of guessing. The renderer pops a chooser; picking an
// option re-runs `tool` with `args` carrying a stable disambiguator (an EKATTE /
// obshtina pin in the place arg, or a partyNum), so the re-run resolves to
// exactly one entity. Produced inside the tools, so BOTH the offline router and
// the LLM path get it for free (each just runs the tool and renders the env).

export type ClarifyOption = {
  label: string; // primary line, resolved to ctx.lang (e.g. "гр. Баня")
  sublabel?: string; // disambiguating context (e.g. "общ. Карлово · обл. Пловдив")
  tool: string; // tool to re-run on pick (usually the same one)
  args: ToolArgs; // unambiguous args (carry the pin/id)
};

export type ClarifyRequest = {
  prompt: string; // the question to the user, resolved to ctx.lang
  options: ClarifyOption[];
};

export type Envelope = {
  tool: string;
  domain?: Domain;
  kind: EnvelopeKind;
  title: string; // resolved to ctx.lang
  subtitle?: string;
  // set when the tool needs the user to disambiguate before it can answer; the
  // renderer shows a chooser and the kind/viz payload below is empty.
  clarify?: ClarifyRequest;
  // table payload
  columns?: Column[];
  rows?: Row[];
  // series payload (line/bar). `categories` are the shared x-axis values.
  categories?: (string | number)[];
  series?: Series[];
  viz: VizType;
  // optional chart annotations (series envelopes only). `markers` flag notable
  // x-positions (the renderer also derives peak/trough automatically when none
  // are given); `bands` shade an x-range (e.g. a cabinet's tenure).
  markers?: { x: string | number; label?: string; kind?: "peak" | "trough" }[];
  bands?: {
    fromX: string | number;
    toX: string | number;
    label: string;
    color?: string;
  }[];
  // Optional headline numeric for a scalar envelope (the same figure also lives,
  // formatted, in `facts`). Lets a multi-election-year combine plot one bar per
  // election; the single-answer renderer ignores it.
  value?: number;
  valueFormat?: ColumnFormat;
  // optional geographic map overlay (Leaflet choropleth / locator). Rendered in
  // addition to the kind viz; absent for non-geographic answers.
  geo?: GeoOverlay;
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
  | "person"
  | "metric"
  | "region"
  | "cycle"
  | "place"
  | "oblast"
  | "year"
  | "indicator";

// Groups tools for the router + the Explorer dropdown.
export type Domain =
  | "elections"
  | "local"
  | "fiscal"
  | "people"
  | "indicators"
  | "place";

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
  domain: Domain;
  description: { bg: string; en: string };
  params: ToolParam[];
  // example utterances (bg/en) used for few-shot prompting + the harness
  examples: { bg: string; en: string }[];
  run: ToolRun;
};
