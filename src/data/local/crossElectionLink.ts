// Bidirectional URL builders that bridge the local-elections page tree and the
// parliamentary page tree for the SAME place. The two data trees share their
// geographic identifiers verbatim — oblast code (e.g. "BLG"), obshtina code
// (e.g. "BLG03") and EKATTE (e.g. "04279") are identical on both sides — so the
// mapping is a pure URL rewrite with no lookup table.
//
// Parliamentary route scheme (historical, "off by one" from the level name):
//   region (oblast)     /municipality/:oblast        e.g. /municipality/BLG
//   município (obshtina)/settlement/:obshtinaCode     e.g. /settlement/BLG03
//   settlement (ekatte) /sections/:ekatte             e.g. /sections/04279
//   country             /                             national dashboard
//   Sofia city          /sofia                        (1 local SOF ↔ 3 МИР)

export type LocalGeoLevel =
  | "country"
  | "sofia"
  | "region"
  | "municipality"
  | "settlement";

const isSofiaShard = (code?: string): boolean =>
  code === "SOF" || /^S2\d{3}$/.test(code ?? "");

// Local place → parliamentary URL. Parliamentary data is the geographic
// superset of local (every município/oblast/settlement that held a local
// election also exists in the parliamentary tree), so these resolve reliably.
export const parliamentaryUrlForLocal = (args: {
  level: LocalGeoLevel;
  oblast?: string;
  obshtinaCode?: string;
  ekatte?: string;
}): string => {
  switch (args.level) {
    case "country":
      return "/";
    case "sofia":
      return "/sofia";
    case "region":
      return args.oblast ? `/municipality/${args.oblast}` : "/";
    case "municipality":
      // Sofia city + район shards have no 1:1 parliamentary município page;
      // route them to the Sofia city overview (which aggregates МИР 23/24/25).
      if (isSofiaShard(args.obshtinaCode)) return "/sofia";
      return args.obshtinaCode ? `/settlement/${args.obshtinaCode}` : "/";
    case "settlement":
      return args.ekatte ? `/sections/${args.ekatte}` : "/";
  }
};

// Parliamentary place → local URL, anchored to the given local cycle. The
// caller is responsible for confirming the place actually has local data in
// that cycle before rendering a link (see ToLocalLink's index guard).
export const localUrlForParliamentary = (args: {
  level: LocalGeoLevel;
  cycle: string;
  oblast?: string;
  obshtinaCode?: string;
  ekatte?: string;
}): string => {
  const c = args.cycle;
  switch (args.level) {
    case "country":
      return `/local/${c}`;
    case "sofia":
      return `/local/${c}/SOF`;
    case "region":
      return `/local/${c}/region/${args.oblast}`;
    case "municipality":
      return `/local/${c}/${args.obshtinaCode}`;
    case "settlement":
      return `/local/${c}/settlement/${args.ekatte}`;
  }
};
