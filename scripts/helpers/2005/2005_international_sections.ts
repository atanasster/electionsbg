import { ElectionSettlement } from "@/data/dataTypes";
import { COUNTRIES } from "scripts/parsers/country_codes";

export const lookupCountryNumbers_2005 = (
  settlement: string,
  settlements: ElectionSettlement[],
) => {
  const code = lookupInternationalSections(settlement);
  return settlements.find((s) => s.kmetstvo === code);
};
export const lookupInternationalSections = (settlement: string): string => {
  switch (settlement) {
    case "Диуания":
      return COUNTRIES.IRAQ;
    case "Луанда":
      return COUNTRIES.ANGOLA;
    case "Тел Авив":
      return COUNTRIES.ISRAEL;
    case "Триполи":
      return COUNTRIES.LIBYA;
    case "Краснодар":
      return COUNTRIES.RUSSIA;
    case "Шутгарт":
      return COUNTRIES.GERMANY;
    case "Острава":
      return COUNTRIES.CZECH_REPUBLIC;
    case "Отава":
    case "Торонто":
      return COUNTRIES.CANADA;
    case "Доха":
      return COUNTRIES.QATAR;
    case "Лимасол":
    case "Никозия":
      return COUNTRIES.CYPRUS;
    case "Пекин":
      return COUNTRIES.CHINA;

    case "Сеул":
      return COUNTRIES.KOREA;
    case "Прищина":
      return COUNTRIES.KOSOVO;
    case "Кувейт":
      return COUNTRIES.KUWAIT;
    case "Бенгази":
      return COUNTRIES.LIBYA;
    case "Бейрут":
      return COUNTRIES.LEBANON;
    case "Скопие":
      return COUNTRIES.NORTH_MACEDONIA;
    case "Ла Валета":
      return COUNTRIES.MALTA;
    case "Казабланка":
    case "Рабат":
    case "Фес":
      return COUNTRIES.MOROCCO;
    case "Мексико":
      return COUNTRIES.MEXICO;
    case "Кишинев":
      return COUNTRIES.MOLDOVA;
    case "Абуджа":
    case "Лагос":
      return COUNTRIES.NIGERIA;

    case "Айндховен":
    case "Амстердам":
    case "Ротердам":
    case "Хага":
      return COUNTRIES.NETHERLANDS;
    case "Оукланд":
      return COUNTRIES.NEW_ZEALAND;
    case "Осло":
      return COUNTRIES.NORWAY;
    case "Дубай":
      return COUNTRIES.UAE;
    case "Варшава":
    case "Вроцлав":
    case "Краков":
      return COUNTRIES.POLAND;

    case "Абулфейра":
    case "Брежао":
    case "Гимараеш":
    case "Кашкаиш":
    case "Лисабон":
    case "Мангуалде":
    case "Портимао":
    case "Порто":
    case "Тавира":
      return COUNTRIES.PORTUGAL;
    case "Букурещ":
    case "Тимишоара":
      return COUNTRIES.ROMANIA;
    case "Екатеринбург":
    case "Москва":
    case "Москва ЦП":
    case "Санкт Петербург":
    case "Стари Оскол":
      return COUNTRIES.RUSSIA;
    case "Арлингтън":
    case "Атланта":
    case "Атлантик сити":
    case "Балтимор":
    case "Бостън":
    case "Вашингтон":
    case "Вирджиния Бийч":
    case "Далас":
    case "Детройт/Диърборн":
    case "Джаксънвил":
    case "Канзас":
    case "Колорадо":
    case "Конкорд":
    case "Лас Вегас":
    case "Лексингтън":
    case "Лос Анджелис":
    case "Маями":
    case "Норидж":
    case "Ню Йорк":
    case "Ориндж Каунти":
    case "Орландо":
    case "Остин":
    case "Питсбърг":
    case "Сакраменто":
    case "Сан Диего":
    case "Сант Питърсбърг":
    case "Санта Барбара":
    case "Санта Клара":
    case "Сент Луис":
    case "Сиатъл":
    case "Сиракюз":
    case "Тампа":
    case "Филаделфия":
    case "Финикс":
    case "Форт Лодърдейл":
    case "Хаянис":
    case "Хонолуло":
    case "Хюстън":
    case "Чикаго":
    case "Портланд":
    case "Солт Леик Сити":
    case "Ню Хейвън":
      return COUNTRIES.USA;
    case "Сингапур":
      return COUNTRIES.SINGAPORE;
    case "Алеп":
    case "Дамаск":
    case "Хомс":
      return COUNTRIES.SYRIA;
    case "Братислава":
    case "Кошице":
      return COUNTRIES.SLOVAKIA;
    case "Любляна":
      return COUNTRIES.SLOVENIA;
    case "Хартум":
      return COUNTRIES.SUDAN;

    case "Белград":
    case "Босилеград":
    case "Димитровград":
      return COUNTRIES.SERBIA;
    case "Тунис":
      return COUNTRIES.TUNISIA;
    case "Анкара":
    case "Анталия":
    case "Бурса":
    case "Измир":
    case "Измит":
    case "Ескишехир":
    case "Истанбул":
    case "Къркларали":
    case "Одрин":
    case "Текирдаг":
    case "Черкезкъой":
    case "Чорлу":
    case "Ялова":
    case "Люлебургаз":
      return COUNTRIES.TURKEY;
    case "Ташкент":
      return COUNTRIES.UZBEKISTAN;
    case "Киев":
    case "Одеса":
    case "Сколе- Дубина":
      return COUNTRIES.UKRAINE;
    case "Будапеща":
      return COUNTRIES.HUNGARY;
    case "Хелзинки":
      return COUNTRIES.FINLAND;
    case "Берлин":
    case "Бон":
    case "Кобленц":
    case "Мюнхен":
    case "Франкфурт на Майн":
    case "Хамбург":
    case "Щутгарт":
      return COUNTRIES.GERMANY;
    case "Марсилия":
    case "Париж":
    case "Страсбург":
      return COUNTRIES.FRANCE;
    case "Загреб":
      return COUNTRIES.CROATIA;
    case "Бърно":
    case "Прага":
      return COUNTRIES.CZECH_REPUBLIC;
    case "Сантяго":
      return COUNTRIES.CHILE;
    case "Берн":
    case "Женева":
    case "Цюрих":
      return COUNTRIES.SWITZERLAND;
    case "Гъотеборг":
    case "Стокхолм":
      return COUNTRIES.SWEDEN;
    case "Дърбан":
    case "Йоханесбург":
    case "Кейптаун":
    case "Претория":
      return COUNTRIES.SOUTH_AFRICA;
    case "Айчи":
    case "Токио":
      return COUNTRIES.JAPAN;
    case "Ярославъл":
      return COUNTRIES.RUSSIA;
    case "Каракас":
      return COUNTRIES.VENEZUELA;
    case "Тбилиси":
      return COUNTRIES.GEORGIA;
    case "Атина":
    case "Солун":
      return COUNTRIES.GREECE;
    case "Копенхаген":
    case "Орхус":
      return COUNTRIES.DENMARK;
    case "Кайро":
      return COUNTRIES.EGYPT;
    case "Хараре":
      return COUNTRIES.ZIMBABWE;
    case "Хайфа":
    case "Яфо":
      return COUNTRIES.ISRAEL;
    case "Техеран":
      return COUNTRIES.IRAN;
    case "Дъблин":
    case "Корк":
      return COUNTRIES.IRELAND;
    case "Рейкявик":
      return COUNTRIES.ICELAND;
    case "Аликанте":
    case "Алкала де Енарес":
    case "Алмерия":
    case "Барселона":
    case "Торремолинос":
    case "Елче":
    case "Майорга":
    case "Бургос":
    case "Валенсия":
    case "Валядолид":
    case "Вила Франка дел Пенедес":
    case "Виялба":
    case "Гандия":
    case "Дения":
    case "Ехе де лос Кабайерос":
    case "Искар":
    case "Канталехо":
    case "Куеляр":
    case "Латина -Kарабанчел":
    case "Мадрид":
    case "Малага":
    case "Марбея":
    case "Мурсия":
    case "Палма де Майорка":
    case "Памплона":
    case "Рокетас де мар":
    case "Салоу":
    case "Сеговия":
    case "Тенерифе":
    case "Торревиеха":
    case "Хетафе":
      return COUNTRIES.SPAIN;
    case "Анцио":
    case "Бари":
    case "Ладисполи":
    case "Милано":
    case "Неапол":
    case "Пескара":
    case "Рим":
    case "Торино":
    case "Флоренция":
      return COUNTRIES.ITALY;
    case "Сана":
      return COUNTRIES.YEMEN;
    case "Аман":
      return COUNTRIES.JORDAN;
    case "Кабул":
      return COUNTRIES.AFGHANISTAN;
    case "Аделаида":
    case "Бризбън":
    case "Канбера":
    case "Мелбърн":
    case "Пърт":
    case "Сидни":
      return COUNTRIES.AUSTRALIA;
    case "Виена":
    case "Грац":
    case "Залцбург":
    case "Линц":
      return COUNTRIES.AUSTRIA;
    case "Тирана":
      return COUNTRIES.ALBANIA;
    case "Алжир":
      return COUNTRIES.ALGERIA;
    case "Буенос Айрес":
      return COUNTRIES.ARGENTINA;
    case "Минск":
      return COUNTRIES.BELARUS;
    case "Брюксел":
    case "Лъовен":
      return COUNTRIES.BELGIUM;
    case "Сараево":
      return COUNTRIES.BOSNIA_HERZEGOVINA;
    case "Актън/Иълинг":
    case "Бирмингам":
    case "Гилфорд":
    case "Дънди - Шотландия":
    case "Кент-Oрпингтън":
    case "Кройдън":
    case "Лондон":
    case "Манчестър":
    case "Оксфорд":
    case "Ричмънд":
    case "Дъръм":
    case "Уайт Чапeл":
      return COUNTRIES.UNITED_KINGDOM;
    case "Алмати":
      return COUNTRIES.KAZAKHSTAN;
    default:
      throw new Error("Could not find city " + settlement);
  }
};
