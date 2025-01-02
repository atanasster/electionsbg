import { useRef, useState, useLayoutEffect, JSX } from "react";
import { Button } from "@/components/ui/button";
import { Layers2 } from "lucide-react";

export type MapCoordinates = [number, number, number, number];
export const MapLayout: React.FC<{
  children: (dimension: MapCoordinates, withNames: boolean) => JSX.Element;
}> = ({ children }) => {
  const [withNames, setWithNames] = useState(
    localStorage.getItem("map_with_names") === "true",
  );

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
      <div className="flex items-center space-x-2 pb-4 justify-end">
        <Button
          variant="outline"
          role="radio"
          data-state={withNames ? "checked" : "unchecked"}
          className="data-[state=checked]:bg-muted text-muted-foreground"
          onClick={() => {
            const value = !withNames;
            localStorage.setItem("map_with_names", value ? "true" : "false");
            setWithNames(value);
          }}
        >
          <Layers2 />
        </Button>
      </div>
      <div
        ref={refContainer}
        className="min-h-96 md:min-h-[420px] lg:min-h-[600px]"
      >
        {dimensions ? children(dimensions, withNames) : null}
      </div>
    </div>
  );
};
