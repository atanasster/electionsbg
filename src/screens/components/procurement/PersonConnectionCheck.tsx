// „Проверка на връзка" — type a name, get the connection between that person and this one,
// at TWO degrees. Shared by the legacy name-matched page (dev/PersonScreen) and the
// resolved profile (person/PersonProfileScreen).
//
// ⚠️ IT IS NAME-MATCHED ON BOTH SIDES, and on the resolved profile that is a WEAKER
// standard than everything else on the page. That page's whole point is EIK-exact identity
// — `person_id`, no „съвпадение по име" — while `connection_between(a, b)` folds two names
// through `translit_bg_latin` and self-joins `tr_officers`. So it can surface a company
// belonging to a NAMESAKE the person layer deliberately refused to attribute. That is not a
// reason to withhold the tool: a reader who wants to check a specific pair has no other way
// to, and a refusal to answer is not a safer answer. It is a reason the basis line is not
// optional, and why `strictIdentity` makes it say so in the stronger terms that page needs.
//
// The negative-result copy is the part to leave alone. „Няма общи фирми между X и Y" reads
// as „these two are not connected", which this query cannot establish twice over: it is
// blind to declared stakes (the edge company_politicians is built on), and our tr_officers
// extract carries officers for a minority of companies. It therefore states what was
// searched, in whose data, and does not claim absence.
//
// ═════════════════════════════════════════════════════════════════════════════════════
// THE SECOND DEGREE (person_person_bridge, migration 192).
//
// A first-degree miss is frequently not the end of the story: the two share no company, but
// ONE person is entered alongside both. That is what `bridged` carries, and the block
// renders the WHOLE four-leg chain — each subject's role, each company, the bridge's role at
// both ends — because at degree 2 the answer is still four registry rows a reader can check
// in the Търговски регистър themselves. (Degree 3 is not: see 192's header for the fan-out.)
//
// Three rules about how it renders, all of them load-bearing:
//
//  1. IT ONLY RENDERS WHEN THE DIRECT CHECK IS EMPTY. A direct co-entry ANSWERS the question;
//     listing weaker indirect chains beneath it dilutes a fact with inferences. Same rule
//     CompanyConnectionCheck applies to its `deepPath`. The query still runs either way — it
//     is milliseconds, in parallel with one that has to run anyway.
//  2. THE DIRECT MISS IS STILL STATED FIRST. „не се срещат заедно в нито една фирма" is true
//     and is the stronger claim; the bridge is an addition to it, never a replacement.
//  4. „DID NOT FINISH" IS A THIRD OUTCOME. `bridgedTimedOut` says the second-degree query hit
//     the pool's statement_timeout, so its empty result means the check never completed. It
//     must NOT render as the miss copy: „не са вписани заедно и никой не ги свързва" would be
//     a claim about two named people that nothing established. The first degree still renders
//     — it succeeded, and the route is built so a timeout on the expensive half cannot take
//     the cheap half's answer away.
//  3. EVERY COMPANY PRINTS ITS OFFICER-BODY SIZE. „(7 вписани лица)" is the only thing on the
//     row that separates a real tie from a seven-member управителен съвет — and the reference
//     chain this feature was built for runs through two such bodies, which is precisely why
//     `person_connections()` (084, MAX_CO_OFFICERS = 6) refuses to publish it and this block
//     may. Dropping that count would make this surface the weaker of the two, not the wider.

import { FC, useCallback, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Link2, Search } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { decodeEntities } from "@/lib/decodeEntities";
import { trRoleList } from "@/lib/trRole";
import { EvidenceBasis } from "./EvidenceBasis";

export interface ConnectionRow {
  uic: string;
  company: string | null;
  status: string | null;
  a_roles: string | null;
  b_roles: string | null;
}

/** One second-degree chain: subject → company → bridge person → company → other name.
 *  Column names are the SQL's (snake_case), unwrapped straight from the route. */
export interface BridgeRow {
  bridge_name: string;
  /** Companies the bridge's NAME FOLD is entered in — the namesake signal, not a holding. */
  bridge_companies: number;
  a_eik: string;
  a_company: string | null;
  a_subject_roles: string | null;
  a_bridge_roles: string | null;
  a_body: number;
  b_eik: string;
  b_company: string | null;
  b_subject_roles: string | null;
  b_bridge_roles: string | null;
  b_body: number;
}

export interface ConnectionResult {
  shared: ConnectionRow[];
  bridged: BridgeRow[];
  /** The second-degree query hit the pool's statement_timeout, so `bridged` is empty because
   *  the check did not FINISH — not because nothing was found. The two must never render the
   *  same: an empty list that reads as „no indirect link" is a claim about two named people
   *  that nothing established. */
  bridgedTimedOut?: boolean;
}

/** The route's own appetite — `BRIDGE_LIMIT` in functions/db_routes.js. Mirrored here for
 *  ONE reason: at exactly this many rows the list may be truncated and has to say so. A cap
 *  a surface does not disclose reads as „that is all of them". */
export const BRIDGE_LIMIT = 25;

/** Above this, a bridge's own company count is worth showing beside their name: a name
 *  entered at many companies is likelier to be worn by more than one person. Below it the
 *  number is noise on every row. */
const NAMESAKE_HINT_FROM = 4;

const num = new Intl.NumberFormat("bg-BG");

export const PersonConnectionCheck: FC<{
  /** The subject, as the REGISTRY spells them — this is the string the query folds, so it
   *  is also the string the result must quote back. */
  personName: string;
  /** Set on a page whose other claims are identity-resolved, so the basis line can say
   *  that THIS block is not. */
  strictIdentity?: boolean;
  /** An in-page anchor to the block that covers declared stakes, when the page has one. */
  politicalAnchor?: string;
  /** Bulgarian copy, matching the surrounding page. */
  bg?: boolean;
  /** Injectable for tests; defaults to the live route. */
  fetchCheck?: (a: string, b: string) => Promise<ConnectionResult>;
}> = ({
  personName,
  strictIdentity,
  politicalAnchor,
  bg = true,
  fetchCheck,
}) => {
  const { t } = useTranslation();
  const [other, setOther] = useState("");
  const [result, setResult] = useState<ConnectionResult | null>(null);
  const [loading, setLoading] = useState(false);
  /** The name the LAST completed check queried — trimmed, frozen at submit. A result names
   *  two people, so it must name what was searched rather than what the box now holds. */
  const [queried, setQueried] = useState("");

  /** Errors are NOT misses. A rejected fetch, or a 500 whose JSON body carries `error`,
   *  used to land in the same `[]` as a genuine empty result — so the page said „X and Y
   *  do not appear together at any company" about two named people on the strength of a
   *  request that never answered. That is the exact class of claim the miss copy is
   *  written to avoid, arrived at from the other side. */
  const [failed, setFailed] = useState(false);
  /** Guards against a double submit: Enter is not gated on `loading`, so two in-flight
   *  requests could resolve out of order and render query A's companies under query B's
   *  names. Only the latest submission may write. */
  const seq = useRef(0);

  const run = useCallback(() => {
    const b = other.trim();
    if (!b) return;
    const mine = ++seq.current;
    setLoading(true);
    setResult(null);
    setFailed(false);
    setQueried(b);
    const load =
      fetchCheck ??
      ((x: string, y: string) =>
        fetch(
          `/api/db/connection?a=${encodeURIComponent(x)}&b=${encodeURIComponent(y)}`,
        )
          .then((r) => r.json())
          // `bridged` is absent on any deploy whose function predates migration 192, and on
          // any database where the route degraded. Absent must read as „not asked", which is
          // the same rendering as „nothing found" here — never as an error.
          .then((j) => {
            // `/api/db` answers a failure with `{error: "..."}` at a 500 — which RESOLVES,
            // so without this it would fall through to `?? []` and render as a miss.
            if (j?.error) throw new Error(String(j.error));
            return {
              shared: (j?.shared ?? []) as ConnectionRow[],
              bridged: (j?.bridged ?? []) as BridgeRow[],
            };
          }));
    load(personName, b)
      .then((r) => {
        if (seq.current !== mine) return;
        setResult(r);
      })
      .catch(() => {
        if (seq.current !== mine) return;
        setFailed(true);
      })
      .finally(() => {
        if (seq.current === mine) setLoading(false);
      });
  }, [other, personName, fetchCheck]);

  const shared = result?.shared ?? [];
  // Rule 1 in the header: the second degree is an answer to a MISS, not a supplement to a hit.
  const bridged = result && shared.length === 0 ? result.bridged : [];
  /** Rule 4: „did not finish" is a THIRD outcome beside „found" and „found nothing", and only
   *  matters where the second degree would have been shown. */
  const timedOut = Boolean(
    result && shared.length === 0 && result.bridgedTimedOut,
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Link2 className="h-4 w-4" />
          {bg ? "Проверка на връзка" : "Check a connection"}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <EvidenceBasis>
          {strictIdentity
            ? bg
              ? "Този блок сравнява ДВЕ ИМЕНА в Търговския регистър, а не установени самоличности. Съвпадение е насока, не доказателство — може да сочи съименник; а разминаване в изписването (напр. липсващо бащино име) не връща нищо, дори връзка да има. При връзка през трето лице и двата края се съпоставят по име, така че рискът се удвоява."
              : "This block compares TWO NAMES in the Commerce Registry, not established identities. A match is a lead, not proof — it may be a namesake; and a spelling that differs (a missing patronymic, say) returns nothing even when a link exists. On a link through a third person both ends are name-matched, so that risk doubles."
            : bg
              ? "Търси същото, което стои зад „Кръг от партньори“ — съвместно вписване в Търговския регистър — но за име по ваш избор и без изключенията там. Показва и връзките през едно междинно лице."
              : "Searches the same edge as “Inner circle” — co-entry in the Commerce Registry — but for a name you choose, and without the exclusions applied there. It also shows links through one intermediate person."}
        </EvidenceBasis>
        {/* `flex-1` + `shrink-0`, not a bare `max-w-md`: in a flex row the input was the
            only flexible item and gave all its width to the button, so on a phone the
            field compressed to about four characters („друго и…") while the button kept
            its full label. Wrapping under `sm` keeps both usable. */}
        <div className="mb-3 flex flex-col gap-2 sm:flex-row">
          <Input
            value={other}
            onChange={(e) => setOther(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && run()}
            placeholder={
              bg
                ? "друго име (напр. политик или лице)…"
                : "another name (e.g. a politician)…"
            }
            className="h-9 w-full flex-1 sm:max-w-md"
          />
          <Button onClick={run} disabled={loading} className="shrink-0">
            <Search className="mr-1 h-4 w-4" /> {bg ? "Провери" : "Check"}
          </Button>
        </div>
        {/* A FAILED request is its own state. Falling through to the miss copy would
            assert that two named people share no company on the strength of a request
            that never answered — the same unsupportable negative that copy exists to
            prevent, reached from the other direction. */}
        {failed && (
          <div className="text-sm text-muted-foreground">
            {bg
              ? "Проверката не можа да се изпълни. Това не е отговор за връзката — опитайте отново."
              : "The check could not run. That is not an answer about the connection — please try again."}
          </div>
        )}
        {!failed &&
          result !== null &&
          (shared.length === 0 ? (
            <div className="space-y-3 text-sm text-muted-foreground">
              {/* Rule 2: the direct miss leads whether or not a bridge was found. */}
              <div>
                {bg
                  ? `В нашите данни от Търговския регистър „${personName}“ и „${queried}“ не се срещат заедно в нито една фирма.`
                  : `In our Commerce Registry data, “${personName}” and “${queried}” do not appear together at any company.`}
              </div>
              {timedOut ? (
                <div>
                  {bg
                    ? "Проверката за връзка през трето лице не завърши навреме, така че за нея нямаме отговор — не че такава връзка няма."
                    : "The check for a link through a third person did not finish in time, so we have no answer for it — which is not the same as there being none."}
                </div>
              ) : bridged.length > 0 ? (
                <BridgeList
                  rows={bridged}
                  personName={personName}
                  queried={queried}
                  bg={bg}
                  t={t}
                />
              ) : (
                <div>
                  {bg
                    ? "Това не значи, че връзка няма. Разполагаме с вписани лица за част от фирмите, а декларирани дялове и длъжности регистърът невинаги отразява."
                    : "That does not mean there is no connection. We hold entered officers for only part of the registry, and declared holdings are not always recorded there."}
                  {politicalAnchor ? (
                    <>
                      {" "}
                      <a
                        href={politicalAnchor}
                        className="text-accent underline hover:text-foreground"
                      >
                        {bg ? "„Политически връзки“" : "“Political links”"}
                      </a>{" "}
                      {bg ? "по-долу ги обхваща." : "below covers those."}
                    </>
                  ) : null}
                </div>
              )}
            </div>
          ) : (
            <div className="text-sm">
              <div className="mb-1 text-muted-foreground">
                {bg ? "Общи фирми" : "Shared companies"} (
                {num.format(shared.length)}):
              </div>
              <ul className="space-y-1">
                {shared.map((c, i) => (
                  <li key={`${c.uic}-${i}`}>
                    <Link
                      to={`/company/${c.uic}`}
                      className="text-accent hover:underline"
                    >
                      {decodeEntities(c.company) || c.uic}
                    </Link>
                    <span className="text-muted-foreground">
                      {" "}
                      — „{personName}“: {trRoleList(c.a_roles, t) || "—"} · „
                      {queried}“: {trRoleList(c.b_roles, t) || "—"}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
      </CardContent>
    </Card>
  );
};

/** One company step in a chain: the firm, and how many people are entered in it. The count
 *  is not decoration — see rule 3 in the file header. */
const ChainCompany: FC<{
  eik: string;
  name: string | null;
  body: number;
  bg: boolean;
}> = ({ eik, name, body, bg }) => (
  <div className="pl-4 text-xs">
    <Link to={`/company/${eik}`} className="text-accent hover:underline">
      {decodeEntities(name) || eik}
    </Link>
    <span className="text-muted-foreground">
      {" · "}
      {bg
        ? `${num.format(body)} вписани лица`
        : `${num.format(body)} entered people`}
    </span>
  </div>
);

const BridgeList: FC<{
  rows: BridgeRow[];
  personName: string;
  queried: string;
  bg: boolean;
  t: (k: string) => string;
}> = ({ rows, personName, queried, bg, t }) => (
  <div>
    <div className="mb-1 font-medium text-foreground">
      {bg
        ? `Свързани през едно лице (2-ра степен) · ${num.format(rows.length)}`
        : `Linked through one person (2nd degree) · ${num.format(rows.length)}`}
    </div>
    <div className="mb-2">
      {bg
        ? "Не са вписани в обща фирма, но лицата по-долу са вписани заедно и с двамата."
        : "They share no company, but each person below is entered alongside both."}
    </div>
    <ul className="space-y-3">
      {rows.map((r, i) => (
        <li
          key={`${r.bridge_name}-${r.a_eik}-${r.b_eik}-${i}`}
          className="border-l-2 border-border pl-3"
        >
          <div className="text-foreground">
            „{personName}“
            <span className="text-muted-foreground">
              {" · "}
              {trRoleList(r.a_subject_roles, t) || "—"}
            </span>
          </div>
          <ChainCompany
            eik={r.a_eik}
            name={r.a_company}
            body={r.a_body}
            bg={bg}
          />
          <div className="text-foreground">
            <Link
              to={`/person/${encodeURIComponent(r.bridge_name)}`}
              className="text-accent hover:underline"
            >
              {decodeEntities(r.bridge_name)}
            </Link>
            <span className="text-muted-foreground">
              {" · "}
              {trRoleList(r.a_bridge_roles, t) || "—"}
              {" → "}
              {trRoleList(r.b_bridge_roles, t) || "—"}
              {r.bridge_companies >= NAMESAKE_HINT_FROM
                ? bg
                  ? ` · името е вписано в ${num.format(r.bridge_companies)} фирми`
                  : ` · this name is entered at ${num.format(r.bridge_companies)} companies`
                : ""}
            </span>
          </div>
          <ChainCompany
            eik={r.b_eik}
            name={r.b_company}
            body={r.b_body}
            bg={bg}
          />
          <div className="text-foreground">
            „{queried}“
            <span className="text-muted-foreground">
              {" · "}
              {trRoleList(r.b_subject_roles, t) || "—"}
            </span>
          </div>
        </li>
      ))}
    </ul>
    {/* No silent caps: at exactly the route's limit the list may be truncated, and a reader
        must not read a bounded list as an exhaustive one. */}
    {rows.length >= BRIDGE_LIMIT ? (
      <div className="mt-2 text-xs">
        {bg
          ? `Показани са първите ${num.format(BRIDGE_LIMIT)} — възможно е да има още.`
          : `Showing the first ${num.format(BRIDGE_LIMIT)} — there may be more.`}
      </div>
    ) : null}
  </div>
);
