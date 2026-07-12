# Infographic tile-hub kit

A reusable pattern for **hub dashboards** — a page that fronts a set of
destinations as medium tiles, each carrying a bespoke infographic vignette
(*not* an icon). First used by the Държавни сектори hub
(`src/screens/governance/GovernanceSectorsScreen.tsx`).

Two things make it a system rather than a one-off: a fixed **scene drawing
contract** (so any teammate can add art that themes correctly) and a
presentation-only **tile + grid** (so a new hub is data, not markup).

## Building a hub

```tsx
import { TileHubGrid, TILE_ACCENTS } from "@/ux/infographic";
import { MY_SCENES } from "./myScenes";

const sections = [
  {
    heading: t("cluster_a"),
    tiles: [
      { to: "/foo", title: t("foo"), badge: "ABC", desc: t("foo_desc"),
        accent: TILE_ACCENTS.teal, scene: MY_SCENES.foo, cta: t("open") },
    ],
  },
];

<TileHubGrid sections={sections} />;
```

- `<TileHubGrid>` renders each section as an `<h2>` + hairline over a responsive
  grid (1 col mobile → 2 / 3 / 4 up).
- `<InfographicTile>` is a **compact horizontal row on phones** and a
  **banner-on-top card from `sm` up** — one component, no duplicate markup.
- Colours: pass an accent **token** (`TILE_ACCENTS.*`), never a raw hex. The tile
  sets `--sector` from it and derives text/badge/CTA by mixing the accent toward
  the theme foreground, so they stay legible in light and dark.

## The scene contract

A scene is a zero-prop `FC` that renders **inside `<SceneFrame>`**:

```tsx
import { SceneFrame, PAPER, Bars, Donut } from "@/ux/infographic";

const Foo: FC = () => (
  <SceneFrame>
    {/* ink — flips with the theme */}
    <path d="…" stroke="currentColor" strokeWidth="2" fill="none" />
    {/* accent — the tile's colour */}
    <circle cx="150" cy="58" r="20" fill="var(--sector)" />
    {/* a shape UNDER ink → paper, reads on both grounds */}
    <rect x="40" y="40" width="60" height="30" fill={PAPER} />
    {/* reuse marks instead of re-drawing them */}
    <Bars x={210} baseline={104} heights={[20, 34, 52]} />
    <Donut cx={250} cy={40} pct={0.62} />
  </SceneFrame>
);

export const MY_SCENES: Record<string, FC> = { foo: Foo };
```

Rules:

| Element | Use | Why |
|---|---|---|
| viewBox | always `SCENE_VIEWBOX` (300×116) | same aspect on banner + thumbnail |
| structural ink | `stroke`/`fill="currentColor"` | flips light/dark for free |
| the one accent | `var(--sector)` | set by the tile from its token |
| under-ink fills | `PAPER` (`hsl(var(--card))`) | reads on cream **and** navy |
| **stat overlay** | keep the **lower-left ~⅔ clear** | a tile with a `metric` overlays a big number at the banner's bottom-left; dense/dark marks there fight it. Put bars, dark fills and the trend on the **right half and top** — see the `Analysis` scene in `procurementScenes.tsx`. (The tile also glows the number with a card halo as a safety net, but don't lean on it.) |
| accessibility | none per scene | `SceneFrame` is `aria-hidden`; the tile title is the label. Never add a per-scene `aria-label` (duplicates the title, isn't localized) |

The stat number is wide for euro values (`€1 млрд.`), so on a scene that hosts one
keep marks clear of roughly `x < 180` in the lower band.

The scenes-registry file exports a `Record<string, FC>` alongside its component
definitions, which trips `react-refresh/only-export-components`; disable that rule
at the top of the registry file (it's a lookup table, not a fast-refresh
boundary).

## Adding an accent

Add one hex to `tileAccents.ts`, mid lightness (~48–58%) + moderate chroma so it
holds on both grounds, then eyeball it on `/governance/sectors` with the theme
toggle before shipping.
