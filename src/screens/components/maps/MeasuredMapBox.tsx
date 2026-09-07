// A box that measures itself and hands its size to a map.
//
// ⚠ EXTRACTED BECAUSE TWO CALLERS NEEDED IT AND THE SECOND WOULD HAVE COPIED IT. Every
// election map takes an explicit `MapCoordinates` rather than filling its parent, so each
// mount point has to measure — and the height is part of the measurement. A second copy in
// the shell's map adapter would be correct on the day it was written and would drift from
// the tile's the first time either height moved, which is a layout shift nobody would trace
// back to a duplicated `useLayoutEffect`.
//
// ⚠⚠ THE BOX IS `relative`, AND THAT IS A CORRECTNESS PROPERTY RATHER THAN STYLING.
// `SVGMapContainer` renders its `<svg>` as `absolute top-0 left-0`, so without a positioned
// ancestor here the map is laid out against whatever ancestor happens to be positioned — in
// practice the page shell — and paints ON TOP of the header, the promo banner and the title,
// at the full width it was measured at. `RegionsMap` never showed it because it adds its own
// `relative` wrapper INSIDE this box; the two presidential maps mount `SVGMapContainer`
// directly and did, on every `/presidential/:cycle` page.
//
// So the positioning lives with the box that owns the measured size, not with each caller —
// a caller that forgets it produces a page that looks broken everywhere except where the map
// belongs, and nothing fails.

import { FC, ReactNode, useLayoutEffect, useRef, useState } from "react";
import type { MapCoordinates } from "@/layout/dataview/MapLayout";

export const MAP_BOX_HEIGHT_CLASS = "h-[360px] md:h-[420px]";

export const MeasuredMapBox: FC<{
  children: (size: MapCoordinates) => ReactNode;
  className?: string;
}> = ({ children, className }) => {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<MapCoordinates | undefined>();

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () =>
      setSize([el.offsetWidth, el.offsetHeight, el.offsetLeft, el.offsetTop]);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    // ⚠ `relative` IS UNCONDITIONAL — outside the `className` fallback, so a caller that
    // overrides the size cannot silently drop the containing block with it.
    <div
      ref={ref}
      className={`relative ${className ?? `w-full ${MAP_BOX_HEIGHT_CLASS}`}`}
    >
      {size && children(size)}
    </div>
  );
};
