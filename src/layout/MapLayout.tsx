import { useRef, useState, useLayoutEffect } from "react";

export type MapCoordinates = [number, number, number, number];
export const MapLayout: React.FC<{
  children: (dimension: MapCoordinates) => JSX.Element;
}> = ({ children }) => {
  const refContainer = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState<MapCoordinates | undefined>();
  useLayoutEffect(() => {
    if (refContainer.current) {
      const resizeObserver = new ResizeObserver(() => {
        if (refContainer.current) {
          setDimensions([
            refContainer.current.offsetWidth,
            refContainer.current.offsetHeight,
            refContainer.current.offsetLeft,
            refContainer.current.offsetTop,
          ]);
        }
      });
      setDimensions([
        refContainer.current.offsetWidth,
        refContainer.current.offsetHeight,
        refContainer.current.offsetLeft,
        refContainer.current.offsetTop,
      ]);
      resizeObserver.observe(refContainer.current);
      return () => resizeObserver.disconnect(); // clean up
    }
  }, []);
  return (
    <div className={`w-full lg:pb-8 pb-2 px-4 md:px-8`}>
      <div ref={refContainer} className="min-h-[100vh]">
        {dimensions ? children(dimensions) : null}
      </div>
    </div>
  );
};
