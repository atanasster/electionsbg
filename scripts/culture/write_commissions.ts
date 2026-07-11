// Generator: write data/culture/commissions.json — the current compositions of
// the НФЦ национални художествени комисии (feature / documentary / animation),
// i.e. "кой решава" which film projects get state money. Plan §5.1 tile 9a / §6.
//
// Source of truth: the executive-director appointment order that names all three
// commissions in one document (Заповед № 59/12.03.2026), published on nfc.bg. The
// order PDF carries an OCR text layer, but OCR is artifact-prone and the data
// changes only ~twice a year (per 6-month mandate), so the composition is
// HAND-KEYED here from the verified PDF (mirrors write_funding_streams.ts) rather
// than parsed live. Members are drawn by lottery (жребий) from the expert register
// under чл. 15 ЗФИ — a public, low-defamation-risk transparency fact: this tile
// publishes WHO decides, and asserts nothing about their decisions.
//
// To refresh: download the newest appointment order from the nfc.bg „Заповеди"
// page, read it (pdftotext -layout), and update the mandate + members below.
//   npx tsx scripts/culture/write_commissions.ts

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const OUT = path.resolve(__dirname, "../../data/culture/commissions.json");

type Status = "titular" | "reserve"; // титуляр / резервен
interface Member {
  name: string;
  role: "chair" | "member";
  status: Status;
  /** Register section (чл. 15 ЗФИ) the expert is drawn from. */
  section: string;
}
interface Commission {
  id: "feature" | "documentary" | "animation";
  bg: string;
  en: string;
  members: Member[];
}

const chair = (name: string, status: Status, section: string): Member => ({
  name,
  role: "chair",
  status,
  section,
});
const member = (name: string, status: Status, section: string): Member => ({
  name,
  role: "member",
  status,
  section,
});

const commissions: Commission[] = [
  {
    id: "feature",
    bg: "Игрално кино",
    en: "Feature film",
    members: [
      chair("Виктор Божидаров Божинов", "titular", "Режисьори"),
      member("Ивайло Бориславов Пенчев", "reserve", "Режисьори"),
      member("Елена Людмилова Георгиева-Мошолова", "reserve", "Продуценти"),
      member("Христо Асенов Христов", "reserve", "Сценаристи"),
      member("Ирмена Светлозарова Чичикова", "titular", "Актьори"),
      member("Елица Стефанова Матеева", "titular", "Кинокритици"),
      member("Галина Жекова Жекова", "reserve", "Кинокритици"),
    ],
  },
  {
    id: "documentary",
    bg: "Документално кино",
    en: "Documentary film",
    members: [
      chair("Боя Красимирова Харизанова", "reserve", "Режисьори"),
      member("Марио Цветанов Марков", "reserve", "Режисьори"),
      member("Пламен Александров Герасимов", "reserve", "Продуценти"),
      member("Михаил Александров Венков", "titular", "Сценаристи"),
      member("Васко Милков Мавриков", "titular", "Сценаристи"),
      member("Добромир Красимиров Николов", "reserve", "Оператори"),
      member("Янко Йорданов Терзиев", "reserve", "Кинокритици"),
    ],
  },
  {
    id: "animation",
    bg: "Анимационно кино",
    en: "Animation film",
    members: [
      chair("Невелина Миткова Попова", "reserve", "Сценаристи"),
      member("Иван Любомиров Цонов", "reserve", "Режисьори"),
      member("Велислав Христов Казаков", "reserve", "Режисьори"),
      member("Лъчезар Аврамов Велинов", "reserve", "Продуценти"),
      member("Павлина Колева Желева", "reserve", "Продуценти"),
      member("Красимир Иванов Иванов", "titular", "Сценаристи"),
      member(
        "Пенчо Кунчев Кунчев",
        "reserve",
        "Художник-постановчици в анимационното кино",
      ),
    ],
  },
];

// Self-verify: each commission is a 7-member panel with exactly one chair; refuse
// to write a malformed roster (a keying slip) rather than ship a wrong composition.
for (const c of commissions) {
  if (c.members.length !== 7)
    throw new Error(`${c.id}: expected 7 members, got ${c.members.length}`);
  const chairs = c.members.filter((m) => m.role === "chair").length;
  if (chairs !== 1) throw new Error(`${c.id}: expected 1 chair, got ${chairs}`);
}

const out = {
  generatedAt: new Date().toISOString(),
  order: "Заповед № 59/12.03.2026",
  orderUrl:
    "https://www.nfc.bg/wp-content/uploads/2025/12/%D0%97%D0%B0%D0%BF%D0%BE%D0%B2%D0%B5%D0%B4-%E2%84%96-59-%D0%BE%D1%82-12.03.2026-%D0%B3.-%D0%9D%D0%B0%D0%B7%D0%BD%D0%B0%D1%87%D0%B0%D0%B2%D0%B0%D0%BD%D0%B5-%D1%81%D1%8A%D1%81%D1%82%D0%B0%D0%B2%D0%B8%D1%82%D0%B5-%D0%BD%D0%B0-%D0%9D%D0%A5%D0%9A%D0%98%D0%9A-%D0%9D%D0%A5%D0%9A%D0%94%D0%9A-%D0%9D%D0%A5%D0%9A%D0%90%D0%9A-1.pdf",
  mandateStart: "2026-05-03",
  mandateEnd: "2026-11-03",
  lotteryDate: "2026-02-10",
  secretary: "Ирина Любенова",
  director: "Петър Тодоров",
  note: {
    bg: "Членовете на националните художествени комисии се теглят чрез жребий от експертите, вписани в регистъра по чл. 15 от Закона за филмовата индустрия, за мандат от шест месеца. Комисиите оценяват проектите за държавно финансиране на кино. Тук е публикуван съставът им — кой решава — без оценка на самите решения.",
    en: "The national artistic commissions' members are drawn by lottery from the experts on the register under art. 15 of the Film Industry Act, for a six-month mandate. The commissions score the projects that apply for state film funding. This publishes their composition — who decides — without any judgement of the decisions themselves.",
  },
  commissions,
};

fs.writeFileSync(OUT, JSON.stringify(out, null, 2) + "\n");
console.log(
  `wrote ${path.relative(process.cwd(), OUT)} — ${commissions.length} commissions, ${commissions.reduce((s, c) => s + c.members.length, 0)} members (${out.order})`,
);
