// The 5 районни администрации of Община Варна. Pattern mirrors
// plovdiv_rayons.ts and sofia_rayons.ts.

export interface VarnaRayon {
  code: string;
  labelBg: string;
  labelEn: string;
  // Like Plovdiv, Varna is one obshtina (VAR06, EKATTE 10135) for the
  // whole city — there's no per-район obshtina code in the settlement
  // data. The frontend tile shows ALL 5 райони stacked on the single
  // Varna settlement / município page. obshtinaCode is reserved for
  // forward-compatibility with future municipalities that follow the
  // Sofia per-район obshtina pattern.
  obshtinaCode: string;
}

export const VARNA_RAYONS: VarnaRayon[] = [
  { code: "ODESOS", labelBg: "Одесос", labelEn: "Odesos", obshtinaCode: "" },
  {
    code: "PRIMORSKI",
    labelBg: "Приморски",
    labelEn: "Primorski",
    obshtinaCode: "",
  },
  { code: "MLADOST", labelBg: "Младост", labelEn: "Mladost", obshtinaCode: "" },
  {
    code: "ASPARUHOVO",
    labelBg: "Аспарухово",
    labelEn: "Asparuhovo",
    obshtinaCode: "",
  },
  {
    code: "VLADISLAV_VARNENCHIK",
    labelBg: "Владислав Варненчик",
    labelEn: "Vladislav Varnenchik",
    obshtinaCode: "",
  },
];
