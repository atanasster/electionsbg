// Which parliamentary list PUBLICLY BACKED a presidential pair the ballot records as
// committee-nominated.
//
// ⚠⚠ THIS IS THE ONE PLACE IN THE PRESIDENTIAL FAMILY THAT ASSERTS SOMETHING THE REGISTER DOES
// NOT. Everywhere else, a pairing comes from ЦИК's own nominator field — `build_split_ticket`
// folds the nominator's NAME and then requires the ballot NUMBER to agree, so two independent
// facts from the source have to line up before a row is published. An endorsement is not in
// that source at all: ЦИК prints „инициативен комитет" and stops. So every entry here is
// curated, and every entry carries the publication it is curated FROM. A row without a source
// is not a weaker row, it is a different kind of claim, and the builder refuses it.
//
// ⚠⚠ IT MUST NEVER BE FOLDED INTO `pairs`. The arithmetic is identical — the floor is
// Σ|ticket − list| over disjoint sections either way, and it holds for ANY two columns of the
// same protocols — but the SENTENCE differs: „ДПС's list voters and ДПС's ticket voters" is a
// fact about one entity on one ballot, while „ГЕРБ-СДС's list voters and the pair ГЕРБ-СДС
// backed" is two entities joined by a political fact somebody else published. The artifact
// keeps them in separate arrays so a surface cannot render one under the other's heading, and
// so a future consumer summing „all pairs" cannot silently mix the two bases.
//
// ⚠⚠ A MULTI-PARTY ENDORSEMENT HAS NO ENTRY, AND RUMEN RADEV IS THE CASE THAT MATTERS. In
// November 2021 he was backed by several parties standing on SEPARATE lists (БСП за България,
// Има такъв народ, Изправи се БГ), so there is no single list his ticket can be set against —
// picking one would publish an affiliation he did not have, and summing them would compare his
// vote against a coalition that did not exist on the ballot. The consequence is asymmetric and
// has to be said out loud rather than left for a reader to notice: this file lets the analysis
// cover ONE of 2021's two finalists. `build_split_ticket` states that in the artifact's own
// copy, because a table showing Герджиков and not Радев, with no reason given, reads as a
// choice about the two men.
//
// ⚠ ADDING A CYCLE IS NOT MECHANICAL. Endorsement is a judgement about what „backed" means —
// a party leader campaigning beside a candidate is not a party decision, and a coalition
// partner's separate endorsement is not the coalition's. Only put an entry here when the party
// itself announced support for that pair, and link the announcement.

export interface TicketEndorsement {
  /** The presidential ballot number, as `tickets.json` records it. */
  ticket: number;
  /** The parliamentary ballot number, as the same-day `cik_parties.json` records it. */
  listNumber: number;
  /** ⚠ REQUIRED — see this file's header. Where the backing was published. */
  sourceUrl: string;
}

/**
 * Keyed by presidential cycle folder. A cycle with no entry produces no endorsement rows, which
 * is the correct default: silence here means „nobody has curated this", never „nobody was
 * backed".
 */
export const TICKET_ENDORSEMENTS: Record<string, TicketEndorsement[]> = {
  "2021_11_14_pvr": [
    {
      // Анастас Герджиков / Невяна Митева ← ГЕРБ-СДС (parliamentary list #32).
      // Борисов announcing it, 01.10.2021.
      //
      // ⚠ „ПОДКРЕПЕН ОТ", NEVER „КАНДИДАТ НА", AND HE SAID SO HIMSELF. Герджиков publicly
      // rejected being described as ГЕРБ's candidate while accepting the party's support
      // (Mediapool, „Анастас Герджиков обяви, че не е кандидат на ГЕРБ за президентските
      // избори"). The distinction is the whole licence for this file: an endorsement is
      // something a party did, a candidacy is something the ballot records, and here they
      // point different ways.
      ticket: 15,
      listNumber: 32,
      sourceUrl:
        "https://webcafe.bg/politika/gerb-podkrepya-kandidaturata-na-atanas-gerdzhikov-za-prezident.html",
    },
    {
      // Лозан Панов / Мария Касимова-Моасе ← Демократична България (list #30).
      //
      // ⚠ THE COALITION'S OWN ANNOUNCEMENT, 06.10.2021 — „коалиция „Демократична България –
      // Обединение" обявява своята политическа подкрепа за гражданската кандидатура на г-н
      // Лозан Панов за президент" — and it states the инициативен комитет nomination in the
      // same text, so both halves of the row's claim come from one primary source.
      ticket: 19,
      listNumber: 30,
      sourceUrl:
        "https://dabulgaria.bg/demokratichna-balgariya-podkrepya-lozan-panov-za-prezident/",
    },
  ],
};

export const endorsementsFor = (cycle: string): TicketEndorsement[] =>
  TICKET_ENDORSEMENTS[cycle] ?? [];
