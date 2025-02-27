import { ElectionSettlement } from "@/data/dataTypes";

export const findSofiaSettlements_2005 = (
  section: string,
  settlements: ElectionSettlement[],
): ElectionSettlement | undefined => {
  const regionCode = section.substring(0, 2);
  const scode = section.substring(4, 6);
  if (regionCode === "23") {
    switch (scode) {
      case "02":
        return settlements.find(
          (s) => s.oblast === "S23" && s.name === "Красно Село",
        );
      case "08":
        return settlements.find(
          (s) => s.oblast === "S23" && s.name === "Изгрев",
        );
      case "09":
        return settlements.find(
          (s) => s.oblast === "S23" && s.name === "Лозенец",
        );
      case "10":
        return settlements.find(
          (s) => s.oblast === "S23" && s.name === "Триадица",
        );
      case "15":
        return settlements.find(
          (s) => s.oblast === "S23" && s.name === "Младост",
        );
      case "16":
        return settlements.find(
          (s) => s.oblast === "S23" && s.name === "Студентски",
        );
      case "17":
        return settlements.find(
          (s) => s.oblast === "S23" && s.name === "Витоша",
        );
      case "23":
        return settlements.find(
          (s) => s.oblast === "S23" && s.name === "Панчарево",
        );
    }
  } else if (regionCode === "24") {
    switch (scode) {
      case "01":
        return settlements.find(
          (s) => s.oblast === "S24" && s.name === "Средец",
        );
      case "03":
        return settlements.find(
          (s) => s.oblast === "S24" && s.name === "Възраждане",
        );
      case "04":
        return settlements.find(
          (s) => s.oblast === "S24" && s.name === "Оборище",
        );
      case "05":
        return settlements.find(
          (s) => s.oblast === "S24" && s.name === "Сердика",
        );
      case "06":
        return settlements.find(
          (s) => s.oblast === "S24" && s.name === "Подуяне",
        );
      case "07":
        return settlements.find(
          (s) => s.oblast === "S24" && s.name === "Слатина",
        );
      case "14":
        return settlements.find(
          (s) => s.oblast === "S24" && s.name === "Искър",
        );
      case "22":
        return settlements.find(
          (s) => s.oblast === "S24" && s.name === "Кремиковци",
        );
    }
  } else if (regionCode === "25") {
    switch (scode) {
      case "11":
        return settlements.find(
          (s) => s.oblast === "S25" && s.name === "Красна Поляна",
        );
      case "12":
        return settlements.find(
          (s) => s.oblast === "S25" && s.name === "Илинден",
        );
      case "13":
        return settlements.find(
          (s) => s.oblast === "S25" && s.name === "Надежда",
        );
      case "18":
        return settlements.find(
          (s) => s.oblast === "S25" && s.name === "Овча Купел",
        );
      case "19":
        return settlements.find(
          (s) => s.oblast === "S25" && s.name === "Люлин",
        );
      case "20":
        return settlements.find(
          (s) => s.oblast === "S25" && s.name === "Връбница",
        );
      case "21":
        return settlements.find(
          (s) => s.oblast === "S25" && s.name === "Нови Искър",
        );
      case "24":
        return settlements.find(
          (s) => s.oblast === "S25" && s.name === "Банкя",
        );
    }
  }
  return undefined;
};
