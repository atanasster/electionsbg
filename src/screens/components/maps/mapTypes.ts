export type GeoFeature = {
  type: "Feature";
  geometry: {
    type: string;
    coordinates: [][][];
  };
};

export type RegionJSONProps = { nuts3: string };
export type MunicipalityJSONProps = { nuts4: string; nuts3: string };
export type SettlementJSONProps = {
  ekatte: string;
  nuts4: string;
  nuts3: string;
};

export type GeoJSONProps =
  | RegionJSONProps
  | MunicipalityJSONProps
  | SettlementJSONProps;

export type GeoJSONFeature<PropType extends GeoJSONProps> = GeoFeature & {
  properties: PropType;
};
export type GeoJSONMap<PropType extends GeoJSONProps> = {
  type: "FeatureCollection";
  features: GeoJSONFeature<PropType>[];
};

export type RegionGeoJSON = GeoJSONMap<RegionJSONProps>;

export type MunicipalityGeoJSON = GeoJSONMap<MunicipalityJSONProps>;

export type SettlementGeoJSON = GeoJSONMap<SettlementJSONProps>;
