// What this box matches ON — the thing that changed in the port, and the thing
// that broke.
//
// Adding the НЕИСПУО id to the fold keys looked obviously right (it is the
// number on every school form) and was a regression: Bulgarian school names
// routinely START with a number, so `130` returned eight schools whose id
// merely contained those digits while the school actually named 130 fell to
// rank 29. These assertions pin the key set so that cannot come back.

import { describe, expect, it } from "vitest";
import { buildEntityIndex, searchIndex } from "@/lib/entitySearchIndex";

type S = {
  id: string;
  name: string;
  obshtinaName: string;
  address?: string;
  latestScore: number | null;
};

const SCHOOLS: S[] = [
  {
    id: "1300102",
    name: "Гимназия с висок успех",
    obshtinaName: "София",
    address: "ГР.СОФИЯ",
    latestScore: 5.5,
  },
  {
    id: "1301999",
    name: "Друга гимназия",
    obshtinaName: "София",
    address: "ГР.СОФИЯ",
    latestScore: 5.4,
  },
  {
    id: "2200456",
    name: '130. средно училище "Стефан Караджа"',
    obshtinaName: "София",
    address: "ГР.СОФИЯ",
    latestScore: 4.0,
  },
  {
    id: "1700789",
    name: "ОУ Христо Ботев",
    obshtinaName: "Дулово",
    address: "С.ОКОРШ",
    latestScore: 3.9,
  },
];

// Mirrors EducationSearchBox exactly — name, obshtina, address; NOT id.
const index = () =>
  buildEntityIndex(
    SCHOOLS,
    (s) => ({
      id: s.id,
      label: s.name,
      sub: s.obshtinaName,
      href: `/school/${s.id}`,
    }),
    (s) => [s.name, s.obshtinaName, s.address],
    (s) => s.latestScore ?? 0,
  );

describe("education search keys", () => {
  it("puts a numeric NAME first, not the ids that contain those digits", () => {
    // The regression: two higher-ranked schools have "130" inside their id.
    const got = searchIndex(index(), "130", 8);
    expect(got[0].label).toBe('130. средно училище "Стефан Караджа"');
  });

  it("finds a school by a settlement that is not its municipality", () => {
    // The 221-school win the address key actually buys — Окорш is in Дулово,
    // so the old name+obshtina finder could not reach it by town.
    expect(searchIndex(index(), "окорш")[0].label).toBe("ОУ Христо Ботев");
  });

  it("still finds by name and by municipality", () => {
    expect(searchIndex(index(), "ботев")[0].label).toBe("ОУ Христо Ботев");
    expect(searchIndex(index(), "дулово")[0].label).toBe("ОУ Христо Ботев");
  });

  it("ranks by matura score within a tier, as the old finder sorted", () => {
    const got = searchIndex(index(), "гимназия", 8);
    expect(got.map((r) => r.label)).toEqual([
      "Гимназия с висок успех",
      "Друга гимназия",
    ]);
  });

  it("accepts shliokavitsa", () => {
    expect(searchIndex(index(), "dulovo")[0].label).toBe("ОУ Христо Ботев");
  });
});
