// UI-free scope constants — shared by the React scope hook AND the Node
// loader (scripts/db/lib/riskGradeScoped.ts). Kept in its own module (no
// react-router / react imports) so the loader can import it without pulling the
// browser runtime in.

// The years the corpus actually covers — the earliest contract is 2011-01-03.
// The pscope selector's `y:` options and the precomputed scoped-grade windows
// MUST share this floor, else the UI requests a `y:` scope with no precomputed
// rows and the leaderboard tile goes silently empty.
export const SCOPE_FIRST_YEAR = 2011;
