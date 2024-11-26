export type RegionFeature = {
  type: "Feature";
  geometry: {
    type: string;
    coordinates: [][][];
  };
};

export type RegionGeoJSON = {
  type: "FeatureCollection";
  features: {
    type: "Feature";
    geometry: {
      type: string;
      coordinates: [][][];
    };
    properties: { nuts3: string };
  }[];
};

export type MunicipalityGeoJSON = {
  type: "FeatureCollection";
  features: {
    type: "Feature";
    geometry: {
      type: string;
      coordinates: [][][];
    };
    properties: { nuts4: string; nuts3: string };
  }[];
};

export type SettlementGeoJSON = {
  type: "FeatureCollection";
  features: {
    type: "Feature";
    geometry: {
      type: string;
      coordinates: [][][];
    };
    properties: { ekatte: string; nuts4: string; nuts3: string };
  }[];
};
