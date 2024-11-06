import { useState, useContext } from "react";
import { RegionFeature } from "../data/json_types";
import { RegionContext } from "@/contexts/RegionContext";

export const RegionMap: React.FC<
  React.PropsWithChildren<{
    path: d3.GeoPath;
    name: string;
    feature: RegionFeature;
  }>
> = ({ path, name, feature }) => {
  const [active, setActive] = useState<boolean>(false);
  const { setCode } = useContext(RegionContext);
  return (
    <>
      <path
        fill="linen"
        stroke="black"
        strokeWidth={active ? 2.5 : 1}
        id={name}
        className="path"
        onMouseEnter={() => setActive(true)}
        onMouseLeave={() => {
          setActive(false);
          setCode();
        }}
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        d={path(feature as any) as string}
        onClick={() => {
          setCode(name);
        }}
        //style={{ filter: active ? "drop-shadow(2px 2px 1px rgb(5, 5, 5)" : "" }}
      />
    </>
  );
};
