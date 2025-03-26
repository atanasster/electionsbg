import { ReactNode } from "react";
import { MapCoordinates } from "@/layout/dataview/MapLayout";
import { Button } from "@/components/ui/button";
import { Layers2 } from "lucide-react";
import { useOptions } from "@/layout/dataview/OptionsContext";

export const SVGMapContainer = ({
  size,
  children,
}: {
  size: MapCoordinates;
  children: ReactNode;
}) => {
  const { withNames, setWithNames } = useOptions();
  return (
    <>
      <svg
        className="absolute top-0 left-0 overflow-hidden bg-transparent"
        width={size[0]}
        height={size[1]}
        xmlns="http://www.w3.org/2000/svg"
        viewBox={`0 0 ${size[0]} ${size[1]}`}
      >
        <defs>
          <filter id="colored-bg" x="-5%" width="110%" y="0%" height="100%">
            <feFlood floodColor="rgba(0,0,0,0.5)" />
            <feComposite operator="over" in="SourceGraphic"></feComposite>
          </filter>
        </defs>
        {children}
      </svg>
      <div
        className={`flex items-center space-x-2 absolute top-0`}
        style={{
          left: size[0] - 48,
        }}
      >
        <Button
          variant="outline"
          role="radio"
          data-state={withNames ? "checked" : "unchecked"}
          className="data-[state=checked]:bg-muted text-muted-foreground"
          onClick={() => {
            setWithNames(!withNames);
          }}
        >
          <Layers2 />
        </Button>
      </div>
    </>
  );
};
