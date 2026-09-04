// An explicit 0 where `formatThousands` returns the empty string.
//
// `formatThousands(0)` is `""` (utils.ts — `if (x)`), so an unguarded money cell renders a
// blank, and a blank in a money column reads as „not published" rather than as none. It is
// easy to forget one: the self-funding tile's per-row cells were guarded in the same change
// that left its HEADLINE rendering a bare „€" at zero. One helper so a cell cannot regress
// independently of its neighbours.

import { formatThousands } from "@/data/utils";

export const money = (x?: number): string => formatThousands(x) || "0";
