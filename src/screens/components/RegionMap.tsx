import { useState } from "react";
import { RegionFeature } from "../data/json_types";
import { createSearchParams, useNavigate } from "react-router-dom";

export const RegionMap: React.FC<
  React.PropsWithChildren<{
    path: d3.GeoPath;
    name: string;
    feature: RegionFeature;
    onMouseEnter?: (e: React.MouseEvent<SVGPathElement, MouseEvent>) => void;
    onMouseMove?: (e: React.MouseEvent<SVGPathElement, MouseEvent>) => void;
    onMouseLeave?: () => void;
  }>
> = ({ path, name, feature, onMouseEnter, onMouseMove, onMouseLeave }) => {
  const [active, setActive] = useState<boolean>(false);
  const navigate = useNavigate();
  return (
    <>
      <path
        fill="linen"
        stroke="black"
        strokeWidth={active ? 2.5 : 1}
        id={name}
        className="path"
        onMouseEnter={(e) => {
          setActive(true);
          if (onMouseEnter) onMouseEnter(e);
        }}
        onMouseMove={(e) => {
          if (onMouseMove) onMouseMove(e);
        }}
        onMouseLeave={() => {
          setActive(false);
          if (onMouseLeave) onMouseLeave();
        }}
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        d={path(feature as any) as string}
        onClick={() => {
          navigate({
            pathname: "/municipality",
            search: createSearchParams({
              region: name,
            }).toString(),
          });
        }}
        //style={{ filter: active ? "drop-shadow(2px 2px 1px rgb(5, 5, 5)" : "" }}
      />
    </>
  );
};
