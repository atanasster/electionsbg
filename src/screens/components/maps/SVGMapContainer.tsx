import { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { MapCoordinates } from "@/layout/dataview/MapLayout";
import { Button } from "@/components/ui/button";
import { ArrowUpDown, Layers2 } from "lucide-react";
import { useOptions } from "@/layout/dataview/OptionsContext";

export const SVGMapContainer = ({
  size,
  children,
  supportsShiftArrows = true,
  supportsNames = true,
}: {
  size: MapCoordinates;
  children: ReactNode;
  supportsShiftArrows?: boolean;
  supportsNames?: boolean;
}) => {
  const { withNames, setWithNames, withShiftArrows, setWithShiftArrows } =
    useOptions();
  const { t } = useTranslation();
  const buttonCount = (supportsShiftArrows ? 1 : 0) + (supportsNames ? 1 : 0);
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
      {buttonCount > 0 && (
        <div
          className={`flex items-center space-x-2 absolute top-0`}
          style={{
            left: size[0] - buttonCount * 48,
          }}
        >
          {supportsShiftArrows && (
            <Button
              variant="outline"
              role="switch"
              aria-checked={withShiftArrows}
              aria-label={t("map_shift_arrows")}
              title={t("map_shift_arrows")}
              data-state={withShiftArrows ? "checked" : "unchecked"}
              className="data-[state=checked]:bg-accent data-[state=checked]:text-accent-foreground"
              onClick={() => {
                setWithShiftArrows(!withShiftArrows);
              }}
            >
              <ArrowUpDown />
            </Button>
          )}
          {supportsNames && (
            <Button
              variant="outline"
              role="switch"
              aria-checked={withNames}
              aria-label={t("with_names")}
              title={t("with_names")}
              data-state={withNames ? "checked" : "unchecked"}
              className="data-[state=checked]:bg-accent data-[state=checked]:text-accent-foreground"
              onClick={() => {
                setWithNames(!withNames);
              }}
            >
              <Layers2 />
            </Button>
          )}
        </div>
      )}
    </>
  );
};
