// A box that measures itself and hands its size to a map.
//
// ⚠ EXTRACTED BECAUSE TWO CALLERS NEEDED IT AND THE SECOND WOULD HAVE COPIED IT. Every
// election map takes an explicit `MapCoordinates` rather than filling its parent, so each
// mount point has to measure — and the height is part of the measurement. A second copy in
// the shell's map adapter would be correct on the day it was written and would drift from
// the tile's the first time either height moved, which is a layout shift nobody would trace
// back to a duplicated `useLayoutEffect`.

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
    <div ref={ref} className={className ?? `w-full ${MAP_BOX_HEIGHT_CLASS}`}>
      {size && children(size)}
    </div>
  );
};
