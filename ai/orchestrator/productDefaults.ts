import type { Route } from "./router";

// Product defaults supplied by the user, shared by rules and model routing.
export const PRODUCT_DEFAULTS =
  "Unless the user explicitly says province/oblast/region (област), Plovdiv/Пловдив means the city: use municipalityResults(place=Пловдив) for its election results, not province results. A new bare Plovdiv follow-up also means the city. Municipal transfers (общински трансфери) means totals by transfer type: municipalTransfers. Use budgetMunicipalTransfers only for explicit distribution/ranking across municipalities. Preserve an explicit province request or municipality-distribution request; retain dates and other applicable arguments.";

export const hasNationalScope = (question: string): boolean =>
  /националн|за цялата страна|цял(?:а|ата)\s+българия|national|nationwide|countrywide|(?:all|whole)(?: of)? (?:bulgaria|the country)/iu.test(
    question,
  );

export const plovdivScope = (
  question: string,
): "city" | "province" | undefined => {
  if (hasNationalScope(question)) return undefined;
  const place = "(?:пловдив|plovdiv)";
  if (!new RegExp(`(?<![\\p{L}])${place}(?![\\p{L}])`, "iu").test(question))
    return undefined;
  const qualifier = "(?:област|обл\\.|province|oblast|region)";
  return new RegExp(
    `(?:${qualifier}\\s+(?:of\\s+)?${place}|${place}\\s*[,(-]?\\s*${qualifier})`,
    "iu",
  ).test(question)
    ? "province"
    : "city";
};
export const transferDistribution = (q: string): boolean => {
  if (/по вид(?:ове)?|by (?:transfer )?type|by categor/iu.test(q)) return false;
  if (
    /(?:класаци|класира|подред|разпределени|rank|breakdown|distribution)/iu.test(
      q,
    ) &&
    /общин|municipalit/iu.test(q)
  )
    return true;
  return /(?:по|между|сред)\s+(?:отделните\s+)?общин(?:и|ите)|(?:всяка|кои)\s+общин|общин.*(?:най-много|най-малко)|(?:by|across|between|among|each|which)\s+(?:(?:individual|recipient)\s+)?municipalit|municipalit.*(?:most|least)|municipality\s+(?:ranking|breakdown)/iu.test(
    q,
  );
};

export function applyProductDefaults(selected: Route, question: string): Route {
  if (!selected) return selected; // Never turn an abstention into an action.
  const q =
    question.split(/(?:Current question|Текущ въпрос):/i).at(-1) ?? question;
  if (
    ["municipalTransfers", "budgetMunicipalTransfers"].includes(selected.tool)
  ) {
    // An explicit scope in a complete current question wins over prior history.
    // Bare year follow-ups are resolved by resolveFollowOn, retaining prior scope.
    if (/трансфер|transfer/iu.test(q))
      return {
        tool: transferDistribution(q)
          ? "budgetMunicipalTransfers"
          : "municipalTransfers",
        args: selected.args,
      };
  }
  const scope = plovdivScope(q);
  const selectedPlace = selected.args.place ?? selected.args.oblast;
  if (
    selectedPlace != null &&
    !/^(?:plovdiv|пловдив|PDV(?:-00)?)(?:\s*\([^)]*\))?$/iu.test(
      String(selectedPlace),
    )
  )
    return selected;
  if (scope === "city" && selected.tool === "regionHistory") return null;
  if (
    scope &&
    ["regionResults", "municipalityResults", "nationalResults"].includes(
      selected.tool,
    ) &&
    !/по\s+(?:общини|области|населени)|by\s+(?:municipality|province|region|settlement)|across\s+/iu.test(
      q,
    )
  ) {
    if (scope === "city" && selected.tool === "municipalityResults")
      return selected;
    const args = { ...selected.args };
    delete args.oblast;
    delete args.place;
    return {
      tool: scope === "city" ? "municipalityResults" : "regionResults",
      args: {
        ...args,
        [scope === "city" ? "place" : "oblast"]:
          scope === "city"
            ? /plovdiv/i.test(q)
              ? "plovdiv"
              : "пловдив"
            : "PDV",
      },
    };
  }
  return selected;
}
