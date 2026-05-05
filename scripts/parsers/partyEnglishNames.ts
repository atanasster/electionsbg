// English short names and full names for canonical parties.
//
// `id` matches `CanonicalParty.id` produced by `canonicalParties.ts`.
// `displayNameEn` parallels the Bulgarian `displayName` (the abbreviation/short
// label shown in tables and chips).
// `nameEn` is the default full English name for every election in the lineage.
// `nameByElection` overrides `nameEn` for specific elections where the
// coalition's composition or label changed enough to warrant a distinct
// translation (e.g. BSP appearing as "Coalition for Bulgaria" in 2005 vs.
// "BSP for Bulgaria" in 2017).
//
// Names follow established English usage where one exists (Wikipedia, EU
// election reports, English-language Bulgarian outlets). For obscure
// single-election parties we use a faithful translation of the Bulgarian name.

export type PartyEnglishOverride = {
  id: string;
  displayNameEn: string;
  nameEn: string;
  nameByElection?: Record<string, string>;
};

export const partyEnglishNames: PartyEnglishOverride[] = [
  // ============================================================
  // Multi-election / parliamentary parties (well-known English names)
  // ============================================================
  {
    id: "gerb",
    displayNameEn: "GERB-SDS",
    nameEn: "GERB-SDS",
    nameByElection: {
      "2009_07_05": "GERB (Citizens for European Development of Bulgaria)",
      "2013_05_12": "GERB (Citizens for European Development of Bulgaria)",
      "2014_10_05": "GERB (Citizens for European Development of Bulgaria)",
      "2017_03_26":
        "GERB Coalition (Citizens for European Development of Bulgaria – SDS)",
    },
  },
  {
    id: "bsp",
    displayNameEn: "BSP-UL",
    nameEn: "BSP – United Left",
    nameByElection: {
      "2005_06_25":
        "Coalition for Bulgaria (BSP, PBS, Social Democrats, DSH, Roma, CPB, BZNS – Stamboliyski, ZPB)",
      "2009_07_05": "Coalition for Bulgaria",
      "2013_05_12": "Coalition for Bulgaria",
      "2014_10_05": "BSP Left Bulgaria",
      "2017_03_26": "BSP for Bulgaria",
      "2021_04_04": "BSP for Bulgaria",
      "2021_07_11": "BSP for Bulgaria",
      "2021_11_14": "BSP for Bulgaria",
      "2022_10_02": "BSP for Bulgaria",
      "2023_04_02": "BSP for Bulgaria",
      "2024_06_09": "BSP for Bulgaria",
      "2024_10_27": "BSP – United Left",
      "2026_04_19": "BSP – United Left",
    },
  },
  {
    id: "ataka",
    displayNameEn: "Ataka",
    nameEn: "Attack",
    nameByElection: {
      "2005_06_25": "Attack Coalition",
      "2009_07_05": "Attack Party",
      "2013_05_12": "Attack",
    },
  },
  {
    id: "p_16",
    displayNameEn: "DPS",
    nameEn: "Movement for Rights and Freedoms",
  },
  {
    id: "p_29",
    displayNameEn: "DPS–NB",
    nameEn: "Movement for Rights and Freedoms – New Beginning",
  },
  {
    id: "p_10",
    displayNameEn: "APS",
    nameEn: "Alliance for Rights and Freedoms – APS",
  },
  {
    id: "p_0",
    displayNameEn: "ITN",
    nameEn: "There Is Such a People",
  },
  {
    id: "p_1",
    displayNameEn: "PD",
    nameEn: "Direct Democracy",
  },
  {
    id: "p_67",
    displayNameEn: "PP",
    nameEn: "We Continue the Change",
  },
  {
    id: "p_72",
    displayNameEn: "DB",
    nameEn: "Democratic Bulgaria – United (Yes Bulgaria, DSB, Green Movement)",
  },
  {
    id: "p_6",
    displayNameEn: "PP-DB",
    nameEn: "We Continue the Change – Democratic Bulgaria",
  },
  {
    id: "p_7",
    displayNameEn: "Vazrazhdane",
    nameEn: "Revival",
  },
  {
    id: "p_3",
    displayNameEn: "MECh",
    nameEn: "Morality, Unity, Honour",
  },
  {
    id: "p_13",
    displayNameEn: "Velichie",
    nameEn: "Greatness",
  },
  {
    id: "p_99",
    displayNameEn: "Volya",
    nameEn: "Volya Movement",
  },
  {
    id: "p_76",
    displayNameEn: "Volya",
    nameEn: "Volya Movement",
  },
  {
    id: "p_92",
    displayNameEn: "Volya/NFSB",
    nameEn: "Patriotic Coalition – Volya and NFSB",
  },
  {
    id: "p_84",
    displayNameEn: "Bulgarian Patriots",
    nameEn: "Bulgarian Patriots – VMRO, Volya and NFSB",
  },
  {
    id: "p_104",
    displayNameEn: "United Patriots",
    nameEn: "United Patriots – NFSB, Ataka and VMRO",
  },
  {
    id: "p_51",
    displayNameEn: "VMRO",
    nameEn: "VMRO – Bulgarian National Movement",
  },
  {
    id: "p_66",
    displayNameEn: "NFSB",
    nameEn: "National Front for the Salvation of Bulgaria",
  },
  {
    id: "p_74",
    displayNameEn: "PF",
    nameEn: "Patriotic Front – NFSB, BDS Radikali and BNDS Tselokupna Bulgaria",
  },
  {
    id: "p_58",
    displayNameEn: "NMSP",
    nameEn: "National Movement for Stability and Progress",
    nameByElection: {
      "2005_06_25": "National Movement Simeon II",
    },
  },
  {
    id: "p_81",
    displayNameEn: "ISMV",
    nameEn: "Stand Up! Mafia Out!",
  },
  {
    id: "p_70",
    displayNameEn: "Stand Up BG",
    nameEn: "Stand Up Bulgaria",
  },
  {
    id: "p_49",
    displayNameEn: "We Are Coming",
    nameEn: "We Are Coming",
  },
  {
    id: "p_111",
    displayNameEn: "RB",
    nameEn: "Reformist Bloc – BZNS, DBG, DSB, NPSD, SDS",
  },
  {
    id: "p_106",
    displayNameEn: "RB-VP",
    nameEn: "Reformist Bloc – Voice of the People",
  },
  {
    id: "p_113",
    displayNameEn: "BBC",
    nameEn: "Bulgaria Without Censorship Coalition",
  },
  {
    id: "p_138",
    displayNameEn: "Lider",
    nameEn: "Lider (Liberal Initiative for Democratic European Development)",
  },
  {
    id: "p_131",
    displayNameEn: "RZS",
    nameEn: "Order, Lawfulness and Justice",
  },
  {
    id: "p_163",
    displayNameEn: "BC",
    nameEn: "Blue Coalition",
  },
  {
    id: "p_173",
    displayNameEn: "BPU",
    nameEn:
      "Bulgarian People's Union (Union of Free Democrats, BZNS – People's Union, VMRO – Bulgarian National Movement)",
  },
  {
    id: "p_25",
    displayNameEn: "DOST",
    nameEn: "Democrats for Responsibility, Solidarity and Tolerance",
  },
  {
    id: "p_89",
    displayNameEn: "ABV",
    nameEn: "Alternative for Bulgarian Revival",
  },
  {
    id: "21",
    displayNameEn: "ABV/D21",
    nameEn: "ABV – Movement 21 Coalition",
  },
  {
    id: "21-2",
    displayNameEn: "D21",
    nameEn: "Movement 21",
  },
  {
    id: "p_100",
    displayNameEn: "BDC",
    nameEn: "Bulgarian Democratic Center",
  },
  {
    id: "p_60",
    displayNameEn: "MIR",
    nameEn: "Morality, Initiative, Patriotism",
  },
  {
    id: "p_39",
    displayNameEn: "BV",
    nameEn: "Bulgarian Rise",
  },
  {
    id: "p_43",
    displayNameEn: "Solidarna BG",
    nameEn: "Solidary Bulgaria",
  },
  {
    id: "p_87",
    displayNameEn: "RfB",
    nameEn: "Republicans for Bulgaria",
  },
  {
    id: "p_45",
    displayNameEn: "BNU",
    nameEn: "Bulgarian National Unification",
  },
  {
    id: "p_52",
    displayNameEn: "GM",
    nameEn: "Green Movement",
  },
  {
    id: "p_22",
    displayNameEn: "Greens",
    nameEn: "Party of the Greens",
  },
  {
    id: "p_118",
    displayNameEn: "The Greens",
    nameEn: "The Greens",
  },

  // ============================================================
  // 2026 election parties
  // ============================================================
  {
    id: "3",
    displayNameEn: "3M",
    nameEn: "Third March Coalition",
  },
  {
    id: "p_11",
    displayNameEn: "ACB",
    nameEn: "Anti-Corruption Bloc",
  },
  {
    id: "p_12",
    displayNameEn: "NB",
    nameEn: "Indomitable Bulgaria Movement",
  },
  {
    id: "p_18",
    displayNameEn: "BC",
    nameEn: "Bulgaria Can",
  },
  {
    id: "p_19",
    displayNameEn: "Siyanie",
    nameEn: "Radiance",
  },
  {
    id: "p_2",
    displayNameEn: "BB",
    nameEn: "Blue Bulgaria",
  },
  {
    id: "p_20",
    displayNameEn: "PB",
    nameEn: "Progressive Bulgaria",
  },
  {
    id: "p_21",
    displayNameEn: "Resistance",
    nameEn: "Resistance",
  },
  {
    id: "p_24",
    displayNameEn: "IC-Batkov",
    nameEn: "Initiative Committee Todor Todorov Batkov",
  },
  {
    id: "p_8",
    displayNameEn: "MB",
    nameEn: "My Bulgaria",
  },

  // ============================================================
  // Multi-election minor parties
  // ============================================================
  {
    id: "p_5",
    displayNameEn: "NPISI",
    nameEn: "People's Party 'The Truth and Only the Truth'",
  },
  {
    id: "p_56",
    displayNameEn: "NPISI",
    nameEn: "People's Party 'The Truth and Only the Truth'",
  },
  {
    id: "p_17",
    displayNameEn: "Nation",
    nameEn: "Nation",
  },
  {
    id: "p_23",
    displayNameEn: "VP",
    nameEn: "Voice of the People",
  },
  {
    id: "p_26",
    displayNameEn: "SPBP",
    nameEn: "Socialist Party 'Bulgarian Way'",
  },
  {
    id: "p_27",
    displayNameEn: "Bulgari",
    nameEn: "Bulgari",
  },
  {
    id: "p_28",
    displayNameEn: "MSB",
    nameEn: "My Country Bulgaria",
  },
  {
    id: "p_30",
    displayNameEn: "Brigade",
    nameEn: "Brigade",
  },
  {
    id: "p_31",
    displayNameEn: "Pravoto",
    nameEn: "The Right",
  },
  {
    id: "p_32",
    displayNameEn: "BNU-ND",
    nameEn: "Bulgarian National Union – New Democracy",
  },
  {
    id: "p_33",
    displayNameEn: "BSDD-DD",
    nameEn: "BSDD – Direct Democracy",
  },
  {
    id: "p_35",
    displayNameEn: "FV",
    nameEn: "Free Voters Coalition (RB, SSD and ZS)",
  },
  {
    id: "p_36",
    displayNameEn: "BTR",
    nameEn: "BTR – Bulgaria of Labour and Reason",
  },
  {
    id: "p_37",
    displayNameEn: "WHO",
    nameEn: "Competence, Responsibility and Truth (WHO)",
  },
  {
    id: "p_38",
    displayNameEn: "RfB",
    nameEn: "Russophiles for Bulgaria Coalition",
  },
  {
    id: "p_40",
    displayNameEn: "BG Voice",
    nameEn: "Bulgarian Voice",
  },
  {
    id: "p_41",
    displayNameEn: "CR",
    nameEn: "Coalition of the Rose",
  },
  {
    id: "p_42",
    displayNameEn: "Center",
    nameEn: "Center",
  },
  {
    id: "p_44",
    displayNameEn: "Unification",
    nameEn: "Unification",
  },
  {
    id: "p_46",
    displayNameEn: "CB",
    nameEn: "Civic Bloc Coalition",
  },
  {
    id: "p_47",
    displayNameEn: "SNB",
    nameEn: "Society for a New Bulgaria",
  },
  {
    id: "p_48",
    displayNameEn: "The Left",
    nameEn: "The Left!",
  },
  {
    id: "p_50",
    displayNameEn: "ND",
    nameEn: "Bulgarian National Union – New Democracy",
  },
  {
    id: "p_53",
    displayNameEn: "GB",
    nameEn: "For a Great Bulgaria",
  },
  {
    id: "p_54",
    displayNameEn: "BSDD",
    nameEn: "BSDD – Bulgarian Union for Direct Democracy",
  },
  {
    id: "p_55",
    displayNameEn: "NB",
    nameEn: "Neutral Bulgaria Coalition (Russophiles and Communists)",
  },
  {
    id: "p_57",
    displayNameEn: "Together",
    nameEn: "Together",
  },
  {
    id: "p_59",
    displayNameEn: "KOD",
    nameEn: "KOD (Conservative Union of the Right)",
  },
  {
    id: "p_61",
    displayNameEn: "BSD-EL",
    nameEn: "Bulgarian Social Democracy – EuroLeft",
  },
  {
    id: "p_62",
    displayNameEn: "Glas Naroden",
    nameEn: "Voice of the People Party",
  },
  {
    id: "p_63",
    displayNameEn: "Out EU/NATO",
    nameEn: "Out of the EU and NATO",
  },
  {
    id: "p_64",
    displayNameEn: "Unity",
    nameEn: "National Movement Unity",
  },
  {
    id: "p_65",
    displayNameEn: "JBC",
    nameEn: "Just Bulgaria Coalition",
  },
  {
    id: "p_68",
    displayNameEn: "CFYB",
    nameEn: "Coalition For You Bulgaria",
  },
  {
    id: "p_69",
    displayNameEn: "BNU-ND",
    nameEn: "Bulgarian National Union – New Democracy",
  },
  {
    id: "p_71",
    displayNameEn: "UPP",
    nameEn: "United People's Party",
  },
  {
    id: "p_73",
    displayNameEn: "RRF",
    nameEn: "Russophiles for the Revival of the Fatherland",
  },
  {
    id: "p_75",
    displayNameEn: "NUR",
    nameEn: "National Union of the Right",
  },
  {
    id: "p_77",
    displayNameEn: "POU",
    nameEn: "Prosperity – Unity – Constructiveness",
  },
  {
    id: "p_78",
    displayNameEn: "BNU-ND",
    nameEn: "Bulgarian National Union – New Democracy",
  },
  {
    id: "p_79",
    displayNameEn: "BPL",
    nameEn: "Bulgarian Progressive Line",
  },
  {
    id: "p_80",
    displayNameEn: "Freedom",
    nameEn: "Freedom Party",
  },
  {
    id: "p_82",
    displayNameEn: "Rise",
    nameEn: "Rise",
  },
  {
    id: "p_83",
    displayNameEn: "BG Summer",
    nameEn: "Bulgarian Summer Civic Platform",
  },
  {
    id: "p_85",
    displayNameEn: "LSCSR",
    nameEn: "Left Union for a Pure and Holy Republic",
  },
  {
    id: "p_86",
    displayNameEn: "NUR",
    nameEn: "National Union of the Right – KOD, BZNS, BDF, SEK",
  },
  {
    id: "p_88",
    displayNameEn: "We the Citizens",
    nameEn:
      "We, the Citizens (Coalition For You Bulgaria, Bulgarian Democratic Community)",
  },
  {
    id: "p_9",
    displayNameEn: "MNC",
    nameEn: "Movement of Non-Party Candidates",
  },
  {
    id: "p_90",
    displayNameEn: "VO",
    nameEn: "Revival of the Fatherland",
  },
  {
    id: "p_91",
    displayNameEn: "Protest",
    nameEn: "Citizens from the Protest",
  },
  {
    id: "p_93",
    displayNameEn: "BSDD",
    nameEn: "Bulgarian Union for Direct Democracy (BSDD)",
  },
  {
    id: "p_94",
    displayNameEn: "DROM",
    nameEn: "DROM",
  },
  {
    id: "p_95",
    displayNameEn: "BG Spring",
    nameEn: "Bulgarian Spring – Movement for Radical Change",
  },
  {
    id: "p_96",
    displayNameEn: "FB",
    nameEn: "Forward Bulgaria Movement",
  },
  {
    id: "p_97",
    displayNameEn: "New Republic",
    nameEn:
      "New Republic – DSB, Union for Plovdiv, Bulgarian Democratic Community",
  },
  {
    id: "p_98",
    displayNameEn: "Discontented",
    nameEn:
      "Coalition of the Discontented (BSD-Eurolevitsa, Bulgarian Social Democratic Party, Christian-Social Union)",
  },

  // ============================================================
  // 2017 single-election parties
  // ============================================================
  {
    id: "p_102",
    displayNameEn: "DPB",
    nameEn: "Reload Bulgaria Movement",
  },
  {
    id: "p_103",
    displayNameEn: "DaBG",
    nameEn: "Yes Bulgaria Movement Coalition (Greens, DEOS)",
  },
  {
    id: "p_105",
    displayNameEn: "NRP",
    nameEn: "National Republican Party",
  },

  // ============================================================
  // 2014 single-election parties
  // ============================================================
  {
    id: "p_108",
    displayNameEn: "NV",
    nameEn: "New Time",
  },
  {
    id: "p_109",
    displayNameEn: "OB",
    nameEn: "United Bulgaria",
  },
  {
    id: "p_110",
    displayNameEn: "SDP",
    nameEn: "Social Democratic Party",
  },
  {
    id: "p_112",
    displayNameEn: "NB",
    nameEn: "New Bulgaria Party",
  },
  {
    id: "p_114",
    displayNameEn: "Levitsa-ZP",
    nameEn: "The Left and Green Party",
  },
  {
    id: "p_115",
    displayNameEn: "NA",
    nameEn: "New Alternative",
  },
  {
    id: "p_116",
    displayNameEn: "The Right",
    nameEn: "The Right Coalition",
  },
  {
    id: "p_117",
    displayNameEn: "NS",
    nameEn: "New Force",
  },
  {
    id: "p_119",
    displayNameEn: "Republic BG",
    nameEn: "Republic BG",
  },

  // ============================================================
  // 2013 single-election parties
  // ============================================================
  {
    id: "p_120",
    displayNameEn: "DP",
    nameEn: "Democratic Party",
  },
  {
    id: "p_121",
    displayNameEn: "Nikola Petkov",
    nameEn: "Nikola Petkov Party",
  },
  {
    id: "p_122",
    displayNameEn: "CFD",
    nameEn: "Center – Freedom and Dignity Coalition",
  },
  {
    id: "p_123",
    displayNameEn: "BDU Radicals",
    nameEn: "Bulgarian Democratic Union 'Radicals'",
  },
  {
    id: "p_124",
    displayNameEn: "NDP",
    nameEn: "National-Democratic Party",
  },
  {
    id: "p_125",
    displayNameEn: "CL-MB",
    nameEn: "Civic List – Modern Bulgaria Coalition",
  },
  {
    id: "p_126",
    displayNameEn: "SDS",
    nameEn: "Union of Democratic Forces Coalition",
  },
  {
    id: "p_127",
    displayNameEn: "LA",
    nameEn: "Liberal Alliance",
  },
  {
    id: "p_128",
    displayNameEn: "CSU",
    nameEn: "Christian-Social Union",
  },
  {
    id: "p_129",
    displayNameEn: "USD",
    nameEn: "United Social Democracy",
  },
  {
    id: "p_130",
    displayNameEn: "Blue Unity",
    nameEn: "Blue Unity Party",
  },
  {
    id: "p_132",
    displayNameEn: "DCI",
    nameEn: "Democratic Civic Initiative",
  },
  {
    id: "p_133",
    displayNameEn: "CDPB",
    nameEn: "Christian-Democratic Party of Bulgaria",
  },
  {
    id: "p_134",
    displayNameEn: "NDPS",
    nameEn: "National Movement for Rights and Freedoms",
  },
  {
    id: "p_135",
    displayNameEn: "MEC",
    nameEn: "Middle European Class",
  },
  {
    id: "p_136",
    displayNameEn: "NPU",
    nameEn: "National Patriotic Unification",
  },
  {
    id: "p_137",
    displayNameEn: "ZNS",
    nameEn: "Agrarian People's Union",
  },
  {
    id: "p_139",
    displayNameEn: "DSB",
    nameEn:
      "Democrats for a Strong Bulgaria and Bulgarian Democratic Forum (DSB, BDF)",
  },
  {
    id: "p_140",
    displayNameEn: "Other Bulgaria",
    nameEn: "The Other Bulgaria",
  },
  {
    id: "p_141",
    displayNameEn: "BL",
    nameEn: "Bulgarian Left",
  },
  {
    id: "p_142",
    displayNameEn: "NIE",
    nameEn: "National Ideal for Unity",
  },
  {
    id: "p_143",
    displayNameEn: "Cause BG",
    nameEn: "Cause Bulgaria",
  },
  {
    id: "p_144",
    displayNameEn: "DBG",
    nameEn: "Bulgaria for Citizens Movement",
  },
  {
    id: "p_145",
    displayNameEn: "DANO",
    nameEn: "Democratic Alternative for National Unification",
  },
  {
    id: "p_146",
    displayNameEn: "Proud BG",
    nameEn: "Proud Bulgaria Coalition",
  },
  {
    id: "p_147",
    displayNameEn: "BZNS",
    nameEn: "Bulgarian Agrarian People's Union",
  },
  {
    id: "p_148",
    displayNameEn: "Ecoglasnost",
    nameEn: "Political Club 'Ecoglasnost'",
  },
  {
    id: "p_149",
    displayNameEn: "NDE",
    nameEn: "National Movement Unity",
  },
  {
    id: "p_150",
    displayNameEn: "Women's Party",
    nameEn: "Party of Bulgarian Women",
  },
  {
    id: "p_151",
    displayNameEn: "New Time",
    nameEn: "New Time",
  },
  {
    id: "p_152",
    displayNameEn: "UPP",
    nameEn: "United People's Party",
  },
  {
    id: "p_153",
    displayNameEn: "UCB",
    nameEn: "Union of Communists in Bulgaria",
  },
  {
    id: "p_154",
    displayNameEn: "IC ZhPN",
    nameEn: "Initiative Committee Joro Petrov NiChev",
  },

  // ============================================================
  // 2009 single-election parties
  // ============================================================
  {
    id: "p_155",
    displayNameEn: "Defense",
    nameEn: "Union of Patriotic Forces 'Defense'",
  },
  {
    id: "p_156",
    displayNameEn: "BLC",
    nameEn: "Bulgarian Left Coalition",
  },
  {
    id: "p_157",
    displayNameEn: "PLAM",
    nameEn: "Party of the Liberal Alternative and Peace (PLAM)",
  },
  {
    id: "p_158",
    displayNameEn: "Social Democrats",
    nameEn: "Social Democrats",
  },
  {
    id: "p_159",
    displayNameEn: "Other Bulgaria",
    nameEn: "The Other Bulgaria Party",
  },
  {
    id: "p_160",
    displayNameEn: "UBP",
    nameEn: "Union of the Bulgarian Patriots",
  },
  {
    id: "p_161",
    displayNameEn: "NMSF",
    nameEn: "National Movement for the Salvation of the Fatherland",
  },
  {
    id: "p_162",
    displayNameEn: "BNU-ND",
    nameEn: "Bulgarian National Union – ND",
  },
  {
    id: "p_164",
    displayNameEn: "For the Homeland",
    nameEn: "For the Homeland – DGI-NL",
  },

  // ============================================================
  // 2005 single-election parties
  // ============================================================
  {
    id: "p_165",
    displayNameEn: "FFB-UB",
    nameEn: "Federation of Free Business – Union Bulgaria",
  },
  {
    id: "p_166",
    displayNameEn: "FB",
    nameEn: "Forward Bulgaria Movement",
  },
  {
    id: "p_167",
    displayNameEn: "Granit",
    nameEn: "Civic Movement 'Granit'",
  },
  {
    id: "p_168",
    displayNameEn: "ChE",
    nameEn: "Chamber of Experts",
  },
  {
    id: "p_169",
    displayNameEn: "WBC",
    nameEn: "Worthy Bulgaria Coalition",
  },
  {
    id: "p_170",
    displayNameEn: "Long Live Bulgaria",
    nameEn: "National Coalition 'Long Live Bulgaria!'",
  },
  {
    id: "p_171",
    displayNameEn: "Euroroma",
    nameEn: "Euroroma Movement",
  },
  {
    id: "p_172",
    displayNameEn: "CR",
    nameEn: "Coalition of the Rose (BSD, NDPS and OBT)",
  },
  {
    id: "p_174",
    displayNameEn: "FAGO",
    nameEn: "FAGO",
  },
  {
    id: "p_175",
    displayNameEn: "UPP-BG",
    nameEn: "United Pensioners' Party of Bulgaria (UPP)",
  },
  {
    id: "p_176",
    displayNameEn: "BCC",
    nameEn: "Bulgarian Christian Coalition (BCC)",
  },
  {
    id: "p_177",
    displayNameEn: "UDF",
    nameEn:
      "United Democratic Forces – SDS, Democratic Party, George's Day Movement, BZNS NS – BZNS, DROM",
  },
  {
    id: "p_178",
    displayNameEn: "NPU-NP",
    nameEn: "Nikola Petkov People's Union",
  },
  {
    id: "p_179",
    displayNameEn: "FDP",
    nameEn: "Free Democrats Party",
  },
  {
    id: "p_180",
    displayNameEn: "Native Land",
    nameEn: "Native Land",
  },
];
