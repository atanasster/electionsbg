import { useRef, useState, useLayoutEffect } from "react";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useTranslation } from "react-i18next";

export type MapCoordinates = [number, number, number, number];
export const MapLayout: React.FC<{
  children: (dimension: MapCoordinates, withNames: boolean) => JSX.Element;
}> = ({ children }) => {
  const { t } = useTranslation();
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
        <Switch
          id="with-names-mode"
          checked={withNames}
          onCheckedChange={(value) => {
            localStorage.setItem("map_with_names", value ? "true" : "false");
            setWithNames(value);
          }}
        />
        <Label
          className="text-secondary-foreground"
          htmlFor={"with-names-mode"}
        >
          {t("with_names")}
        </Label>
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
