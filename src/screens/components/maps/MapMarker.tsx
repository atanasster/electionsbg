import { LocationInfo, Votes } from "@/data/dataTypes";
import { totalActualVoters } from "@/data/utils";

const minMarkerScale = 0.5;
const maxMarkerScale = 2.0;
const scaleVotes = (value: number, minVotes: number, maxVotes: number) => {
  return (
    ((value - minVotes) * (maxMarkerScale - minMarkerScale)) /
      (maxVotes - minVotes) +
    minMarkerScale
  );
};

export const MapMarker = ({
  projection,
  info,
  minVotes,
  maxVotes,
  votes,
}: {
  projection: d3.GeoProjection;
  info?: LocationInfo;
  minVotes: number;
  maxVotes: number;
  votes?: Votes[];
}) => {
  const loc = info?.loc?.split(",");
  if (!loc) {
    return undefined;
  }
  const totalVoters = totalActualVoters(votes);
  const scale = totalVoters ? scaleVotes(totalVoters, minVotes, maxVotes) : 0;
  const x = parseFloat(loc[0]);
  const y = parseFloat(loc[1]);
  const p = projection([x, y]);
  if (p) {
    return (
      <g
        className="pointer-events-none"
        transform={`translate(${p[0] - (16 * scale) / 2}, ${p[1] - (24 * scale) / 2}) scale(${scale})`}
      >
        <path
          d="m12 0c-4.4183 2.3685e-15 -8 3.5817-8 8 0 1.421 0.3816 2.75 1.0312 3.906 0.1079 0.192 0.221 0.381 0.3438 0.563l6.625 11.531 6.625-11.531c0.102-0.151 0.19-0.311 0.281-0.469l0.063-0.094c0.649-1.156 1.031-2.485 1.031-3.906 0-4.4183-3.582-8-8-8zm0 4c2.209 0 4 1.7909 4 4 0 2.209-1.791 4-4 4-2.2091 0-4-1.791-4-4 0-2.2091 1.7909-4 4-4z"
          stroke="#000000"
          fill="#f4f4f4"
        />
      </g>
    );
  }
  return null;
};
