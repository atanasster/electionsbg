// Definitions inspected against the local tender register's primary CPV labels.
// They classify subjects, never institution membership or execution location.
export const PROCUREMENT_SUBJECTS: Record<
  string,
  { label: { bg: string; en: string }; prefixes: readonly string[] }
> = {
  roads: {
    label: {
      bg: "Пътища, улици и настилки, включително пешеходни и велосипедни",
      en: "Roads, streets and paving, including pedestrian and cycle works",
    },
    prefixes: ["452331", "452332"],
  },
  roadRepair: {
    label: {
      bg: "Ремонт на пътища (CPV 45233142)",
      en: "Road repair (CPV 45233142)",
    },
    prefixes: ["45233142"],
  },
  medicalGoods: {
    label: {
      bg: "Медицински и фармацевтични продукти, лични грижи (CPV 33)",
      en: "Medical, pharmaceutical and personal-care goods (CPV 33)",
    },
    prefixes: ["33"],
  },
  medicalEquipment: {
    label: {
      bg: "Медицинско оборудване (CPV 331)",
      en: "Medical equipment (CPV 331)",
    },
    prefixes: ["331"],
  },
  healthServices: {
    label: {
      bg: "Услуги в здравеопазването (CPV 851)",
      en: "Health services (CPV 851)",
    },
    prefixes: ["851"],
  },
};
