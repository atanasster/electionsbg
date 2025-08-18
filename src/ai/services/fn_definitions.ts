import { FunctionDeclaration, Type } from "@google/genai";
import { AdminLevel, DonorType, SortOrder, VoteType } from "@/ai/types";

export const functionDeclarations: FunctionDeclaration[] = [
  {
    name: "get_list_of_elections",
    description:
      "Returns a list of all available elections, sorted from most recent to oldest. Use this to find the identifiers for queries like 'the last two elections'. / Връща списък с всички налични избори, сортирани от най-новите към най-старите. Използвайте това, за да намерите идентификаторите за заявки като 'последните два избора'.",
    parameters: { type: Type.OBJECT, properties: {} },
  },
  {
    name: "get_list_of_regions",
    description:
      "Returns a list of all available administrative regions in Bulgaria, with their Bulgarian and English names and unique identifiers. Use this to discover available locations for queries. / Връща списък с всички налични административни области в България, с техните български и английски имена и уникални идентификатори. Използвайте това, за да откриете налични местоположения за заявки.",
    parameters: { type: Type.OBJECT, properties: {} },
  },
  {
    name: "get_list_of_municipalities",
    description:
      "Returns a list of all municipalities in Bulgaria. Can be filtered by a region name to show only municipalities within that region. / Връща списък с всички общини в България. Може да се филтрира по име на област, за да се покажат само общините в тази област.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        region_name: {
          type: Type.STRING,
          description:
            "Optional. The name of the region (e.g., 'Burgas', 'София') to filter municipalities by. / Незадължително. Името на областта (напр. 'Бургас', 'София'), по която да се филтрират общините.",
        },
      },
    },
  },
  {
    name: "get_list_of_settlements",
    description:
      "Returns a list of all settlements (cities, towns, villages) in Bulgaria. Can be filtered by region and/or municipality name. / Връща списък с всички населени места (градове, села) в България. Може да се филтрира по име на област и/или община.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        region_name: {
          type: Type.STRING,
          description:
            "Optional. The name of the region (e.g., 'Burgas', 'София') to filter settlements by. / Незадължително. Името на областта (напр. 'Бургас', 'София'), по която да се филтрират населените места.",
        },
        municipality_name: {
          type: Type.STRING,
          description:
            "Optional. The name of the municipality (e.g., 'Sozopol', 'Созопол') to filter settlements by. / Незадължително. Името на общината (напр. 'Созопол', 'Созопол'), по която да се филтрират населените места.",
        },
      },
    },
  },
  {
    name: "get_national_vote_type_summary",
    description:
      "Fetches and calculates the national percentage of paper vs. machine votes for a list of elections. This is highly efficient for trend analysis of voting methods. / Извлича и изчислява националния процент на хартиени срещу машинни гласове за списък от избори. Това е високо ефективно за анализ на тенденциите в методите на гласуване.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        election_identifiers: {
          type: Type.ARRAY,
          items: { type: Type.STRING },
          description:
            "A list of one or more election identifiers (e.g., ['2023-04', '2022-10']) to get the summary for. / Списък с един или повече идентификатори на избори (напр. ['2023-04', '2022-10']), за които да се получи обобщение.",
        },
      },
      required: ["election_identifiers"],
    },
  },
  {
    name: "get_available_elections_for_year",
    description:
      "Checks a given year and returns all distinct elections that occurred in it. Use this to resolve ambiguity when a user only specifies a year. / Проверява дадена година и връща всички отделни избори, проведени в нея. Използвайте това за разрешаване на неясноти, когато потребителят посочи само година.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        year: {
          type: Type.INTEGER,
          description:
            "The year to check for elections. / Годината, за която да се проверят изборите.",
        },
      },
      required: ["year"],
    },
  },
  {
    name: "get_election_results",
    description:
      "Fetches election results for a given election. Data is available at the national and regional levels. It can resolve location names for regions, municipalities, and settlements, automatically using the parent region if needed. / Извлича изборни резултати за дадени избори. Данните са налични на национално и областно ниво. Може да разпознава имена на области, общини и населени места, като автоматично използва родителската област, ако е необходимо.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        election_identifier: {
          type: Type.STRING,
          description:
            "The unique identifier for the election (e.g., '2023-10'). Defaults to the most recent election if not specified. / Уникалният идентификатор на изборите (напр. '2023-10'). По подразбиране се използват последните избори, ако не е посочен.",
        },
        party_names: {
          type: Type.ARRAY,
          items: { type: Type.STRING },
          description:
            "Optional list of party names to filter by. / Незадължителен списък с имена на партии за филтриране.",
        },
        level: {
          type: Type.STRING,
          enum: Object.values(AdminLevel),
          description:
            "The administrative level for the results. / Административното ниво за резултатите.",
        },
        location_name: {
          type: Type.STRING,
          description:
            "The name of the location (region, municipality, or settlement) to filter results. / Името на местоположението (област, община или населено място) за филтриране на резултатите.",
        },
        vote_type: {
          type: Type.STRING,
          enum: Object.values(VoteType),
          description:
            "Filter by total, paper, or machine votes. / Филтриране по общ брой гласове, хартиени или машинни.",
        },
      },
      required: [],
    },
  },
  {
    name: "get_turnout_statistics",
    description:
      "Provides voter turnout statistics, including data on voters from additional lists. Can be filtered by a specific election, or can return data for all elections since a given start year. Can also be filtered by location and turnout percentage for individual polling stations. Returns an array of results. / Предоставя статистика за избирателната активност, включително данни за гласоподаватели от допълнителни списъци. Може да се филтрира по конкретни избори, или да върне данни за всички избори от дадена начална година. Може да се филтрира и по местоположение и процент на активност за отделни секции. Връща масив с резултати.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        election_identifier: {
          type: Type.STRING,
          description:
            "The unique identifier for a single election. Use this OR start_year. / Уникалният идентификатор на единични избори. Използвайте това ИЛИ start_year.",
        },
        start_year: {
          type: Type.INTEGER,
          description:
            "Fetches national turnout for all elections since this year. Use this for questions about trends over time. / Извлича националната активност за всички избори от тази година насам. Използвайте за въпроси относно тенденциите във времето.",
        },
        level: {
          type: Type.STRING,
          enum: Object.values(AdminLevel),
          description:
            "The administrative level. Data is available for 'national' and 'region' levels. / Административното ниво. Данните са налични за 'национално' и 'областно' ниво.",
        },
        location_name: {
          type: Type.STRING,
          description:
            "Optional. The specific location name (e.g., a region or municipality) to filter stations. / Незадължително. Конкретното име на местоположението (напр. регион или община) за филтриране на секции.",
        },
        min_turnout_threshold: {
          type: Type.NUMBER,
          description:
            "Optional. Filters for stations with turnout percentage *above* this value. / Незадължително. Филтрира за секции с избирателна активност *над* тази стойност.",
        },
        max_turnout_threshold: {
          type: Type.NUMBER,
          description:
            "Optional. Filters for stations with turnout percentage *below* this value. / Незадължително. Филтрира за секции с избирателна активност *под* тази стойност.",
        },
      },
      required: [],
    },
  },
  {
    name: "get_new_parties",
    description:
      "Returns a list of political parties that were established after a given year. Useful for identifying 'newer' parties. / Връща списък с политически партии, създадени след дадена година. Полезно за идентифициране на 'по-нови' партии.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        established_after_year: {
          type: Type.INTEGER,
          description:
            "The year after which parties should be considered 'new'. For example, 2021 would return parties from 2022 onwards. / Годината, след която партиите да се считат за 'нови'. Например, 2021 ще върне партии от 2022 г. нататък.",
        },
      },
      required: ["established_after_year"],
    },
  },
  {
    name: "get_vote_adoption_by_region",
    description:
      "Fetches the breakdown of machine vs. paper votes for specified regions over one or more elections. Useful for analyzing voting method adoption trends. / Извлича разбивката на машинни срещу хартиени гласове за определени региони за едни или повече избори. Полезно за анализ на тенденциите в приемането на методи за гласуване.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        election_identifiers: {
          type: Type.ARRAY,
          items: { type: Type.STRING },
          description:
            "List of one or more election identifiers to fetch data for. / Списък с един или повече идентификатори на избори, за които да се извлекат данни.",
        },
        region_names: {
          type: Type.ARRAY,
          items: { type: Type.STRING },
          description:
            "Optional. List of region names to filter by. If omitted, data for all available regions will be returned. / Незадължително. Списък с имена на региони за филтриране. Ако бъде пропуснато, ще бъдат върнати данни за всички налични региони.",
        },
      },
      required: ["election_identifiers"],
    },
  },
  {
    name: "get_candidate_performance",
    description:
      "Retrieves candidate performance by preference votes. Can be filtered by region and/or party. If no region is specified, it returns the top candidates nationally. / Извлича представянето на кандидатите по преференциални гласове. Може да се филтрира по регион и/или партия. Ако не е посочен регион, връща най-добрите кандидати на национално ниво.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        election_identifier: {
          type: Type.STRING,
          description:
            "The unique identifier for the election. Defaults to the most recent election if not specified. / Уникалният идентификатор на изборите. По подразбиране се използват последните избори, ако не е посочен.",
        },
        region_name: {
          type: Type.STRING,
          description:
            "Optional. The name of the electoral region (e.g. 'Sofia', 'Plovdiv'). If omitted, searches across the entire country. / Незадължително. Името на избирателния район (напр. 'София', 'Пловдив'). Ако се пропусне, търси в цялата страна.",
        },
        party_name: {
          type: Type.STRING,
          description:
            "Optional party name to filter candidates. / Незадължително име на партия за филтриране.",
        },
        sort_order: {
          type: Type.STRING,
          enum: Object.values(SortOrder),
          description:
            "Sort order for results. / Ред на сортиране на резултатите.",
        },
        limit: {
          type: Type.INTEGER,
          description:
            "Number of results to return. Defaults to 5 if not specified. / Брой резултати за връщане. По подразбиране е 5, ако не е посочен.",
        },
      },
      required: [],
    },
  },
  {
    name: "find_preference_anomalies",
    description:
      "Identifies cases where a candidate lower on a party list received more preference votes than the list leader. / Идентифицира случаи, в които кандидат по-надолу в партийна листа е получил повече преференциални гласове от водача на листата.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        election_identifier: {
          type: Type.STRING,
          description:
            "The unique identifier for the election. Defaults to the most recent election if not specified. / Уникалният идентификатор на изборите. По подразбиране се използват последните избори, ако не е посочен.",
        },
        region_name: {
          type: Type.STRING,
          description:
            "Optional electoral region to search within. / Незадължителен избирателен район за търсене.",
        },
      },
      required: [],
    },
  },
  {
    name: "get_campaign_finances",
    description:
      "Gets a detailed financial report for specified parties. For 'income', it provides a breakdown by source (e.g., state subsidy, donors). For 'expenses', it provides a breakdown by category (e.g., marketing, ads, events). If party_names is omitted, it will return data for all parties. / Получава подробен финансов отчет за посочени партии. За 'income' предоставя разбивка по източник (напр. държавна субсидия, дарители). За 'expenses' предоставя разбивка по категория (напр. маркетинг, реклама, събития). Ако party_names се пропусне, ще върне данни за всички партии.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        election_identifier: {
          type: Type.STRING,
          description:
            "The unique identifier for the election. Defaults to the most recent election if not specified. / Уникалният идентификатор на изборите. По подразбиране се използват последните избори, ако не е посочен.",
        },
        party_names: {
          type: Type.ARRAY,
          items: { type: Type.STRING },
          description:
            "Optional. A list of party names. If omitted, data for all parties is returned. / Незадължително. Списък с имена на партии. Ако се пропусне, се връщат данни за всички партии.",
        },
        finance_type: {
          type: Type.STRING,
          enum: ["income", "expenses"],
          description:
            "Whether to fetch income or expenses. / Дали да се извлекат приходи или разходи.",
        },
      },
      required: ["finance_type"],
    },
  },
  {
    name: "get_top_donors",
    description:
      "Lists the top donors for an election. If a party name is provided, the result will also include information about whether those donors have contributed to other parties. / Изброява топ дарителите за дадени избори. Ако е посочено име на партия, резултатът ще включва и информация дали тези дарители са допринесли и за други партии.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        election_identifier: {
          type: Type.STRING,
          description:
            "The unique identifier for the election. Defaults to the most recent election if not specified. / Уникалният идентификатор на изборите. По подразбиране се използват последните избори, ако не е посочен.",
        },
        party_name: {
          type: Type.STRING,
          description:
            "Optional party name to filter by. / Незадължително име на партия за филтриране.",
        },
        donor_type: {
          type: Type.STRING,
          enum: Object.values(DonorType),
          description:
            "Filter by donor type (individual, candidate, or all). / Филтриране по тип дарител (физическо лице, кандидат или всички).",
        },
        limit: {
          type: Type.INTEGER,
          description:
            "Number of top donors to return. Defaults to 5 if not specified. / Брой топ дарители за връщане. По подразбиране е 5, ако не е посочен.",
        },
      },
      required: [],
    },
  },
  {
    name: "get_total_state_subsidy",
    description:
      "Calculates and returns the total amount of state subsidy received by all political parties for a specific calendar year. This is not tied to a single election campaign. / Изчислява и връща общата сума на държавната субсидия, получена от всички политически партии за определена календарна година. Тази сума не е обвързана с конкретна предизборна кампания.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        year: {
          type: Type.INTEGER,
          description:
            "The calendar year for which to calculate the total subsidy. / Календарната година, за която да се изчисли общата субсидия.",
        },
      },
      required: ["year"],
    },
  },
  {
    name: "compare_election_results",
    description:
      "Compares performance for one or more parties across multiple elections in a specific location. / Сравнява представянето на една или повече партии на няколко избора в определено местоположение.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        election_identifiers: {
          type: Type.ARRAY,
          items: { type: Type.STRING },
          description:
            "List of two or more election identifiers to compare. / Списък с два или повече идентификатори на избори за сравнение.",
        },
        party_names: {
          type: Type.ARRAY,
          items: { type: Type.STRING },
          description:
            "A list of one or more party names to compare. / Списък с едно или повече имена на партии за сравнение.",
        },
        level: {
          type: Type.STRING,
          enum: Object.values(AdminLevel),
          description:
            "The administrative level for comparison. Defaults to National if not specified. / Административното ниво за сравнение. По подразбиране е национално, ако не е посочено.",
        },
        location_name: {
          type: Type.STRING,
          description:
            "The specific location for comparison (e.g., 'Sofia'). Required if level is not 'national'. / Конкретното местоположение за сравнение (напр. 'София'). Задължително, ако нивото не е 'national'.",
        },
      },
      required: ["election_identifiers", "party_names"],
    },
  },
  {
    name: "compare_campaign_finances",
    description:
      "Compares financial data (income or expenses) for one or more parties across multiple elections. / Сравнява финансови данни (приходи или разходи) за една или повече партии на няколко избора.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        election_identifiers: {
          type: Type.ARRAY,
          items: { type: Type.STRING },
          description:
            "List of two or more election identifiers to compare. / Списък с два или повече идентификатори на избори за сравнение.",
        },
        party_names: {
          type: Type.ARRAY,
          items: { type: Type.STRING },
          description:
            "A list of one or more party names to compare. / Списък с едно или повече имена на партии за сравнение.",
        },
        finance_type: {
          type: Type.STRING,
          enum: ["income", "expenses"],
          description:
            "Whether to compare income or expenses. / Дали да се сравняват приходи или разходи.",
        },
      },
      required: ["election_identifiers", "party_names", "finance_type"],
    },
  },
  {
    name: "find_voting_discrepancies",
    description:
      "Finds significant discrepancies, either between initial counts and recounts, or between machine and paper votes. / Намира значителни несъответствия, или между първоначалното преброяване и повторното, или между машинния и хартиения вот.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        election_identifier: {
          type: Type.STRING,
          description:
            "The unique identifier for the election. Defaults to the most recent election if not specified. / Уникалният идентификатор на изборите. По подразбиране се използват последните избори, ако не е посочен.",
        },
        discrepancy_type: {
          type: Type.STRING,
          enum: ["recount_vs_initial", "machine_vs_paper"],
          description:
            "The type of discrepancy to find. / Типът несъответствие за намиране.",
        },
        min_threshold: {
          type: Type.NUMBER,
          description:
            "The minimum percentage difference to report. / Минималната процентна разлика за докладване.",
        },
      },
      required: ["discrepancy_type"],
    },
  },
  {
    name: "find_discrepancies_between_vote_types",
    description:
      "Finds locations (e.g., municipalities) where any single political party's machine vote percentage is above a certain minimum, while their paper vote percentage is below a certain maximum. / Намира населени места (напр. общини), където процентът на машинния вот за дадена политическа партия е над определен минимум, докато процентът на хартиения вот е под определен максимум.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        election_identifier: {
          type: Type.STRING,
          description:
            "The unique identifier for the election. Defaults to the most recent election if not specified. / Уникалният идентификатор на изборите. По подразбиране се използват последните избори, ако не е посочен.",
        },
        level: {
          type: Type.STRING,
          enum: Object.values(AdminLevel),
          description:
            "The administrative level to analyze (e.g., 'municipality'). / Административното ниво за анализ (напр. 'община').",
        },
        min_machine_vote_percentage: {
          type: Type.NUMBER,
          description:
            "The minimum percentage of machine votes a party must have received to be included (e.g., 90 for 90%). / Минималният процент машинен вот, който партията трябва да е получила (напр. 90 за 90%).",
        },
        max_paper_vote_percentage: {
          type: Type.NUMBER,
          description:
            "The maximum percentage of paper votes a party must have received to be included (e.g., 30 for 30%). / Максималният процент хартиен вот, който партията трябва да е получила (напр. 30 за 30%).",
        },
      },
      required: [
        "level",
        "min_machine_vote_percentage",
        "max_paper_vote_percentage",
      ],
    },
  },
  {
    name: "calculate_campaign_efficiency",
    description:
      "Calculates and compares the national campaign efficiency (cost-per-vote) for political parties. If no party names are provided, it will analyze all parties and return the most efficient ones. / Изчислява и сравнява националната ефективност на кампанията (цена на глас) за политическите партии. Ако не са посочени имена на партии, ще анализира всички партии и ще върне най-ефективните.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        election_identifier: {
          type: Type.STRING,
          description:
            "The unique identifier for the election. Defaults to the most recent election if not specified. / Уникалният идентификатор на изборите. По подразбиране се използват последните избори, ако не е посочен.",
        },
        party_names: {
          type: Type.ARRAY,
          items: { type: Type.STRING },
          description:
            "Optional. List of party names to analyze. If omitted, all parties will be analyzed. / Незадължително. Списък с имена на партии за анализ. Ако се пропусне, ще бъдат анализирани всички партии.",
        },
        limit: {
          type: Type.INTEGER,
          description:
            "Optional. The number of top efficient parties to return. Defaults to 5. / Незадължително. Броят на най-ефективните партии за връщане. По подразбиране е 5.",
        },
      },
      required: [],
    },
  },
  {
    name: "suggest_campaign_focus_areas",
    description:
      "Suggests areas for a political party to focus on, based on weakest performance or highest growth potential. / Предлага области, върху които дадена политическа партия да се съсредоточи, въз основа на най-слабо представяне или най-висок потенциал за растеж.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        party_name: {
          type: Type.STRING,
          description: "The name of the party. / Името на партията.",
        },
        analysis_type: {
          type: Type.STRING,
          enum: ["weakest_areas", "growth_potential"],
          description:
            "The type of analysis to perform. / Типът анализ за извършване.",
        },
        election_identifier: {
          type: Type.STRING,
          description:
            "The primary election for analysis. Defaults to the most recent election if not specified. / Основните избори за анализ. По подразбиране се използват последните избори, ако не е посочен.",
        },
        comparison_election_identifier: {
          type: Type.STRING,
          description:
            "An earlier election to compare against for trend analysis. If the user asks to compare against the 'previous election', this parameter can be omitted, and the system will automatically use the election immediately prior to the primary one. / Предишни избори за сравнение при анализ на тенденции. Ако потребителят поиска сравнение с 'предишните избори', този параметър може да бъде пропустнат и системата автоматично ще използва изборите непосредствено преди основните.",
        },
        limit: {
          type: Type.INTEGER,
          description:
            "Number of areas to suggest. Defaults to 5 if not specified. / Брой области за предложение. По подразбиране е 5, ако не е посочен.",
        },
      },
      required: ["party_name", "analysis_type"],
    },
  },
  {
    name: "find_stations_with_high_invalid_ballots",
    description:
      "Identifies polling stations with an unusually high percentage of invalid ballots compared to their regional average. 'Unusually high' is defined as being above a certain multiplier of the regional average. / Идентифицира избирателни секции с необичайно висок процент невалидни бюлетини в сравнение със средния за техния регион. 'Необичайно висок' се дефинира като над определен множител на средния за региона.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        election_identifier: {
          type: Type.STRING,
          description:
            "The unique identifier for the election. Defaults to the most recent election if not specified. / Уникалният идентификатор на изборите. По подразбиране се използват последните избори, ако не е посочен.",
        },
        region_name: {
          type: Type.STRING,
          description:
            "Optional. The specific region to search within. / Незадължително. Конкретният регион за търсене.",
        },
        threshold_multiplier: {
          type: Type.NUMBER,
          description:
            "Optional. The multiplier for the regional average to determine the threshold. E.g., a value of 2 means stations with more than double the regional average invalid ballots will be returned. Defaults to 1.5. / Незадължително. Множителят на средния регионален процент за определяне на прага. Напр. стойност 2 означава, че ще бъдат върнати секции с над два пъти повече невалидни бюлетини от средното за региона. По подразбиране е 1.5.",
        },
      },
      required: [],
    },
  },
  {
    name: "find_stations_with_high_additional_voters",
    description:
      "Identifies polling stations with a high number of votes cast by individuals on the 'additional' voter list. This can be an indicator for fairness assessment. / Идентифицира избирателни секции с висок брой гласове, подадени от лица в 'допълнителния' избирателен списък. Това може да бъде индикатор за оценка на честността на изборите.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        election_identifier: {
          type: Type.STRING,
          description:
            "The unique identifier for the election. Defaults to the most recent election if not specified. / Уникалният идентификатор на изборите. По подразбиране се използват последните избори, ако не е посочен.",
        },
        region_name: {
          type: Type.STRING,
          description:
            "Optional. The specific region to search within. / Незадължително. Конкретният регион за търсене.",
        },
        min_percentage_threshold: {
          type: Type.NUMBER,
          description:
            "Optional. The minimum percentage of additional voters relative to total ballots cast to be considered 'high'. Defaults to 10 if no absolute threshold is given. / Незадължително. Минималният процент на допълнителните гласоподаватели спрямо общия брой подадени бюлетини, който да се счита за 'висок'. По подразбиране е 10, ако не е зададен абсолютен праг.",
        },
        min_absolute_threshold: {
          type: Type.NUMBER,
          description:
            "Optional. The minimum absolute number of additional voters to be considered 'high'. The function returns stations that meet EITHER the percentage or absolute threshold. / Незадължително. Минималният абсолютен брой допълнителни гласоподаватели, който да се счита за 'висок'. Функцията връща секции, които отговарят на процентния ИЛИ на абсолютния праг.",
        },
      },
      required: [],
    },
  },
  {
    name: "get_aggregated_additional_voters",
    description:
      "Returns a sorted list of administrative locations (e.g., regions or municipalities) by the total number of voters who cast a ballot from an 'additional' list. / Връща сортиран списък с административни местоположения (напр. региони или общини) по общия брой гласоподаватели, гласували от 'допълнителен' списък.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        election_identifier: {
          type: Type.STRING,
          description:
            "The unique identifier for the election. Defaults to the most recent election. / Уникалният идентификатор на изборите. По подразбиране са последните избори.",
        },
        level: {
          type: Type.STRING,
          enum: [AdminLevel.Region, AdminLevel.Municipality],
          description:
            "The administrative level to aggregate. Defaults to Region. / Административното ниво за агрегиране. По подразбиране е Регион.",
        },
        sort_order: {
          type: Type.STRING,
          enum: Object.values(SortOrder),
          description:
            "Sort order. Defaults to descending. / Ред на сортиране. По подразбиране е низходящ.",
        },
        limit: {
          type: Type.INTEGER,
          description:
            "Number of results to return. Defaults to 5. / Брой резултати за връщане. По подразбиране е 5.",
        },
      },
      required: [],
    },
  },
  {
    name: "get_none_of_the_above_stats",
    description:
      "Finds the locations (regions, municipalities) with the most 'I do not support anyone' votes, either by absolute number or percentage. / Намира местоположенията (области, общини) с най-много гласове 'Не подкрепям никого', по абсолютен брой или по процент.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        election_identifier: {
          type: Type.STRING,
          description:
            "The election to analyze. Defaults to the most recent. / Изборите за анализ. По подразбиране са последните.",
        },
        level: {
          type: Type.STRING,
          enum: [AdminLevel.Region, AdminLevel.Municipality],
          description:
            "The administrative level to analyze. / Административното ниво за анализ.",
        },
        sort_by: {
          type: Type.STRING,
          enum: ["votes", "percentage"],
          description:
            "Whether to sort by absolute votes or percentage. Defaults to 'votes'. / Дали да се сортира по абсолютен брой гласове или по процент. По подразбиране е 'votes'.",
        },
        limit: {
          type: Type.INTEGER,
          description:
            "Number of results to return. Defaults to 5. / Брой резултати за връщане. По подразбиране е 5.",
        },
      },
      required: ["level"],
    },
  },
  {
    name: "get_ballot_summary",
    description:
      "Returns a summary of ballot counts for a specific election, including the number of invalid ballots, the total number of valid votes, and the percentage of invalid ballots out of all cast ballots. / Връща обобщение на броя на бюлетините за определени избори, включително броя на невалидните бюлетини, общия брой на валидните гласове и процента на невалидните бюлетини от всички подадени бюлетини.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        election_identifier: {
          type: Type.STRING,
          description:
            "The election to analyze. Defaults to the most recent. / Изборите за анализ. По подразбиране са последните.",
        },
      },
      required: [],
    },
  },
  {
    name: "find_machine_vote_discrepancies",
    description:
      "Compares the official machine votes from the protocol with the data from the machine's flash memory (SUEMG) to find discrepancies at a national level. This can be used to identify potential errors in the counting process. / Сравнява официалните машинни гласове от протокола с данните от флаш паметта на машината (СУЕМГ) за откриване на несъответствия на национално ниво. Това може да се използва за идентифициране на потенциални грешки в процеса на броене.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        election_identifier: {
          type: Type.STRING,
          description:
            "The election to analyze. Defaults to the most recent. / Изборите за анализ. По подразбиране са последните.",
        },
        min_difference_threshold: {
          type: Type.NUMBER,
          description:
            "Optional. The minimum absolute difference between protocol and flash memory votes to report as a discrepancy. Defaults to 0, which reports all differences. / Незадължително. Минималната абсолютна разлика между гласовете от протокола и флаш паметта, която да се отчете като несъответствие. По подразбиране е 0, което отчита всички разлики.",
        },
      },
      required: [],
    },
  },
  {
    name: "get_party_info",
    description:
      "Retrieves basic information about a political party, such as its official website. / Извлича основна информация за политическа партия, като например официалния й уебсайт.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        party_name: {
          type: Type.STRING,
          description:
            "The name of the party to look up. / Името на партията за търсене.",
        },
      },
      required: ["party_name"],
    },
  },
];
