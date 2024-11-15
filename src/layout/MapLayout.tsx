import { useRef, useState, useEffect } from "react";

export const MapLayout: React.FC<{
  children: (dimension: [number, number]) => JSX.Element;
}> = ({ children }) => {
  const refContainer = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState<[number, number] | undefined>();
  useEffect(() => {
    if (refContainer.current) {
      let resizing: boolean = false;
      const resizeObserver = new ResizeObserver(() => {
        if (!resizing) {
          resizing = true;
          if (refContainer.current) {
            setDimensions([
              refContainer.current.offsetWidth,
              refContainer.current.offsetHeight,
            ]);
          }
        }
      });
      setDimensions([
        refContainer.current.offsetWidth,
        refContainer.current.offsetHeight,
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
