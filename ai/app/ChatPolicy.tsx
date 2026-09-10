import policy from "../../functions/llm_public_policy.json";
import type { Lang } from "../tools/types";

export const ChatPolicy = ({ lang, id }: { lang: Lang; id?: string }) => (
  <details id={id} className="rounded border p-3 text-sm">
    <summary className="cursor-pointer font-medium">
      {lang === "bg" ? "Лимити и поверителност" : "Limits and privacy"}
    </summary>
    <div className="mt-3 max-w-3xl space-y-2 text-muted-foreground">
      <p>
        {lang === "bg"
          ? `AI допуска до ${policy.sessionDaily} започнати въпроса на проверена сесия за ден и до ${policy.ipDaily} на IP адрес за ден, с до ${policy.perMinute} за последните 60 секунди на сесия. Сесията изтича след ${policy.sessionMs / 3600000} час. Дневните квоти се отчитат по UTC (подновяване в 00:00 UTC), а не по местния часовник.`
          : `AI allows up to ${policy.sessionDaily} question starts per verified session per day and ${policy.ipDaily} per IP address per day, with up to ${policy.perMinute} in the last 60 seconds per session. Sessions expire after ${policy.sessionMs / 3600000} hour. Daily allowances use UTC (renewal at 00:00 UTC), not your local clock.`}
      </p>
      <p>
        {lang === "bg"
          ? "Това не е лична дневна квота: хора в една мрежа споделят IP ограничението. Нова проверка създава нова сесия, но не изчиства IP квотата или общия бюджет на услугата. Неуспешни или прекъснати заявки също могат да изразходват лимит. Общият бюджет може временно да спре AI по-рано. Без AI остава достъпно; за извличане на данните е нужен интернет."
          : "This is not a personal daily allowance: people on one network share the IP limit. Reverification creates a new session but does not clear IP allowances or the service budget. Failed or interrupted requests can also consume allowance. The shared budget may stop AI earlier. No AI remains available; fetching data still requires internet access."}
      </p>
      <p>
        {lang === "bg"
          ? "Разговорът и историята на въпросите се пазят в този браузър, за този домейн. Използвайте износа, преди да смените домейна или да изчистите браузъра. Споделеният линк съдържа последния въпрос и го задава отново; той не е копие на целия разговор. Не включвайте лични или поверителни данни във въпроси, които споделяте."
          : "Conversation and prompt history are stored in this browser for this domain. Export before changing domains or clearing the browser. A shared link contains the last question and asks it again; it is not a copy of the whole conversation. Avoid personal or confidential information in questions you share."}
      </p>
      <p>
        {lang === "bg"
          ? "В AI режим въпросът и контекстът се изпращат през нашия сървър към Google Gemini. Cloudflare Turnstile проверява за злоупотреба. Сървърът използва хеширан IP идентификатор за квотите; токенът за проверената сесия се пази само в паметта на страницата. Проверявайте периода, обхвата и източниците на всеки отговор."
          : "In AI mode, the question and context are sent through our server to Google Gemini. Cloudflare Turnstile checks for abuse. The server uses a hashed IP identifier for allowances; the verified-session token stays in page memory. Check every answer’s period, scope and sources."}
      </p>
    </div>
  </details>
);
