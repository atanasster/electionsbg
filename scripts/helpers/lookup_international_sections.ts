import { ElectionSettlement } from "@/data/dataTypes";
import { COUNTRIES } from "scripts/parsers/country_codes";

export const lookup_international_sections = (
  settlement: string,
  region: string,
  settlements: ElectionSettlement[],
) => {
  const settlementParts = settlement.split(", ");
  let code: string | undefined = undefined;
  switch (region) {
    case "Великобритания": {
      code = COUNTRIES.UNITED_KINGDOM;
      break;
    }
    case "Корея": {
      code = COUNTRIES.KOREA;
      break;
    }

    case "Република Македония": {
      code = COUNTRIES.NORTH_MACEDONIA;
      break;
    }
    case "ФР Германия": {
      code = COUNTRIES.GERMANY;
      break;
    }
    case "Чешка република": {
      code = COUNTRIES.CZECH_REPUBLIC;
      break;
    }
    case "Република Южна Африка": {
      code = COUNTRIES.SOUTH_AFRICA;
      break;
    }
    default: {
      if (settlementParts.length > 1 || region) {
        const r = region || settlementParts[0].trim();
        const settlement = settlements.find(
          (s) => s.name === r && s.oblast === "32",
        );
        if (settlement) {
          return settlement;
        }
      }
      code = lookupInternationalSections(
        settlementParts[settlementParts.length - 1].trim(),
      );
    }
  }
  if (!code) {
    //console.log(`${region} ${settlement}`);
    //return settlements.find((s) => s.kmetstvo === COUNTRIES.ALBANIA);
    throw new Error(`Could not find country for: %{r} ${settlement}`);
  }
  return settlements.find((s) => s.kmetstvo === code);
};
const lookupInternationalSections = (
  settlement: string,
): string | undefined => {
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
    case "Аугсбург":
    case "Бремен":
    case "Бремерхафен":
    case "Вюрцбург":
    case "Гютерсло":
    case "Дармщат":
    case "Дитценбах":
    case "Дрезден":
    case "Дуисбург":
    case "Дюселдорф":
    case "Ерфурт":
    case "Есен":
    case "Карлсруе":
    case "Касел":
    case "Кьолн":
    case "Лайпциг":
    case "Ландсхут":
    case "Лудвигсхафен":
    case "Магдебург":
    case "Майнц":
    case "Манхайм":
    case "Меминген":
    case "Мюнстер":
    case "Ноймаркт":
    case "Ноймюнстер":
    case "Нюрнберг":
    case "Офенбург":
    case "Папенбург":
    case "Регенсбург":
    case "Ройтлинген":
    case "Саарбрюкен":
    case "Трир":
    case "Улм":
    case "Фрайбург":
    case "Хайлброн":
    case "Хайделберг":
    case "Хановер":
    case "Бренерхафен":
    case "Вюртсбург":
    case "Ландскут":
    case "Хайлделберг":
    case "Диценбах":
    case "Фрайсен":
    case "Щутгард":
    case "Дармщадт":
      return COUNTRIES.GERMANY;
    case "Острава":
    case "Ихлава":
    case "Либерец":
    case "Млада Болеслав":
    case "Пардубице":
    case "Пилзен":
    case "Хоржовице":
      return COUNTRIES.CZECH_REPUBLIC;
    case "Отава":
    case "Торонто":
      return COUNTRIES.CANADA;
    case "Доха":
      return COUNTRIES.QATAR;
    case "Бразилия":
      return COUNTRIES.BRAZIL;
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
    case "Манама":
      return COUNTRIES.BAHRAIN;
    case "Скопие":
    case "Битоля":
    case "Кавадарци":
    case "Охрид":
    case "Прилеп":
    case "Струмица":
    case "Щип":
    case "Велес":
    case "Битолия":
    case "Тетово":
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
    case "Абу Даби":
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
    case "Рияд":
      return COUNTRIES.SAUDI_ARABIA;
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
    case "Дортмунд":
    case "Мьонхенгладбах":
    case "Аахен":
    case "Айленбург":
    case "Алзей":
    case "Аполда":
    case "Бад Мускау":
    case "Бад Наухайм":
    case "Бамберг":
    case "Билефелд":
    case "Вайнхайм":
    case "Вилдесхаузен":
    case "Висбаден":
    case "Вормс":
    case "Вуперал":
    case "Гелзенкирхен":
    case "Гьотинген":
    case "Делменхорст":
    case "Йена":
    case "Кемниц":
    case "Констанц":
    case "Любек":
    case "Марбург":
    case "Мюнхенгладбах":
    case "Оберамергау":
    case "Оснабрюк":
    case "Офенбах на Майн":
    case "Пасау":
    case "Плауен":
    case "Пфафенхофен":
    case "Равенсбург":
    case "Розенхайм":
    case "Тегернзее":
    case "Фирнхайм":
    case "Фрайзен":
    case "Фройденщад":
    case "Фюрт":
    case "Хам":
    case "Швебиш Гмюнд":
    case "Щраубинг":
    case "Ааахен":
    case "Вупертал":
    case "Хоф":
      return COUNTRIES.GERMANY;
    case "Марсилия":
    case "Париж":
    case "Страсбург":
      return COUNTRIES.FRANCE;
    case "Загреб":
      return COUNTRIES.CROATIA;
    case "Бърно":
    case "Прага":
    case "Карлови Вари":
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
    case "Мидранд":
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
    case "Баку":
      return COUNTRIES.AZERBAIJAN;
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
    case "Брегенц":
    case "Велс":
    case "Инсбрук":
    case "Клагенфурт":
      return COUNTRIES.AUSTRIA;
    case "Тирана":
    case "Елбасан":
    case "Корча":
    case "Кукъс":
      return COUNTRIES.ALBANIA;
    case "Ереван":
      return COUNTRIES.ARMENIA;
    case "Алжир":
      return COUNTRIES.ALGERIA;
    case "Буенос Айрес":
      return COUNTRIES.ARGENTINA;
    case "Минск":
      return COUNTRIES.BELARUS;
    case "Брюксел":
    case "Лъовен":
    case "Антверпен":
    case "Варегем":
    case "Гент":
    case "Льовен":
    case "Маасмехелен":
    case "Хаселт":
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
    case "Абърдийн":
    case "Арма":
    case "Базилдън":
    case "Бедфорд":
    case "Бейзингстоук":
    case "Белфаст":
    case "Бишъпс Стортфорд":
    case "Богнър Реджис":
    case "Борнмът":
    case "Брайтън":
    case "Бристол":
    case "Глазгоу":
    case "Глостър":
    case "Есекс":
    case "Сейнт Хелиър":
    case "Дънди":
    case "Единбург":
    case "Екзитър":
    case "Енискилън":
    case "Ийстбърн":
    case "Имингъм":
    case "Ипсуич":
    case "Йорк":
    case "Кардиф":
    case "Кеймбридж":
    case "Кентърбъри":
    case "Килкийл":
    case "Кингс Лин":
    case "Ковънтри":
    case "Колчестър":
    case "Кроули":
    case "Крю":
    case "Ланкастър":
    case "Лестър":
    case "Ливърпул":
    case "Лийдс":
    case "Линкълн":
    case "Лутън":
    case "Мейдстоун":
    case "Милтън Кийнс":
    case "Норич":
    case "Нотингам":
    case "Нюкасъл":
    case "Озуъстри":
    case "Дъглас":
    case "Питърбъро":
    case "Плимут":
    case "Портсмут":
    case "Престън":
    case "Рединг":
    case "Рексъм":
    case "Саутенд-он-сии":
    case "Саутхемптън":
    case "Стафорд":
    case "Стоук он Трент":
    case "Стърминстър Нютън":
    case "Суиндън":
    case "Тънбридж Уелс":
    case "Уестън Супер Мер":
    case "Уисбийч":
    case "Уорингтън":
    case "Уотфорд":
    case "Устър/Уочестър":
    case "Уулвърхамптън":
    case "Флийтууд":
    case "Хемел-Хемпстед":
    case "Херефорд":
    case "Хъл":
    case "Чатъм":
    case "Челмсфорд":
    case "Честър":
    case "Шефилд":
    case "Бърнли/Флийтууд":
    case "Телфорд":
    case "Кумбрия":
    case "Баркинг":
    case "Барнет и Енфийлд":
    case "Бромли":
    case "Гринуич":
    case "Ийлинг":
    case "Канада Уотър":
    case "Принцес Парк":
    case "Лейтънстоун":
    case "Норбъри":
    case "Палмърс Грийн":
    case "Ричмънд ъпон Темз":
    case "Ромфорд":
    case "Сатън":
    case "Стратфорд":
    case "Сърбитън":
    case "Тотнъм":
    case "Уимбълдън":
    case "Уолтъмстоу":
    case "Уорчестър Парк":
    case "Ууд Грийн":
    case "Финсбъри Парк":
    case "Хароу":
    case "Хаунслоу":
    case "Чанел Айлъндс":
    case "Фелтъм":
    case "Хелмсфорд":
    case "Бъртън ъпон Трент":
    case "Бъртън ъпон Тренд":
    case "Даунпатрик/Килкийл":
    case "Остров Ман":
    case "Престън/Ланкастър":
    case "UK":
    case "Борнмут":
    case "Ейлинг":
    case "Екситър":
    case "Имингам":
    case "Манчестер":
    case "Нюкасъл на Тайн":
    case "Чатам":
    case "Лондон,Тотнъм":
    case "Лондон Уимбълдън - Мъртън Роуд":
    case "Абъристуит":
    case "Богнър Риджис":
    case "Нюкасъл на Tайн":
    case "Питърбороу":
    case "Лондон Иилинг":
    case "Колчестер":
      return COUNTRIES.UNITED_KINGDOM;
    case "Алмати":
      return COUNTRIES.KAZAKHSTAN;
    default:
      return undefined;
    //throw new Error("Could not find city " + settlement);
  }
};
