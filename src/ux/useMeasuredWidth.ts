import { useLayoutEffect, useState } from "react";

/**
 * Measures the rendered width of a block element so an inline-SVG chart can be
 * drawn in CSS pixels instead of in a fixed viewBox stretched to the container.
 * A stretched viewBox scales the axis and tick labels along with the geometry,
 * which blows the type up on a wide screen and shrinks it below legibility on a
 * phone; drawing at the measured width keeps every label at its true px size.
 *
 *   const [setPlotEl, plotWidth] = useMeasuredWidth();
 *   const W = plotWidth || 720; // fallback for the first paint
 *   <div ref={setPlotEl}><svg width={W} viewBox={`0 0 ${W} ${H}`} /></div>
 *
 * Returns a callback ref rather than taking a `RefObject` because charts
 * commonly mount only once their data has loaded, so an effect keyed on `[]`
 * would observe a still-null node.
 */
export const useMeasuredWidth = (): [
  (el: HTMLElement | null) => void,
  number,
] => {
  const [el, setEl] = useState<HTMLElement | null>(null);
  const [width, setWidth] = useState(0);

  useLayoutEffect(() => {
    if (!el) return;
    const measure = () => setWidth(el.offsetWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);

  return [setEl, width];
};
