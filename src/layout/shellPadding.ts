/**
 * The shell's horizontal padding, named once.
 *
 * `Layout.tsx` wraps every screen in `p-2`. A row that must run to the page
 * edge — a chip scroller, a full-bleed toolbar — cancels exactly that, and the
 * two values have to agree or the row either clips a chip mid-scroll or juts
 * past the page. They were written out twice and applied NESTED, which happened
 * to look right only because both were 0.5rem.
 */
export const SHELL_PAD = "p-2";
export const SHELL_BLEED = "-mx-2 w-[calc(100%+1rem)] px-2";
