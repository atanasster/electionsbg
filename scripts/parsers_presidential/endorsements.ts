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
// ⚠⚠ THE RULE IS ONE BACKER WITH A LIST, AND RUMEN RADEV IS WHY. He was backed by ELEVEN
// parties in November 2021 — ИТН, Изправи се.БГ, МИР, БСП, ВОЛТ, ПП, АБВ, Движение 21, ССД,
// ОБТ, ПДС — of which FIVE stood on their own list in the same-day parliamentary ballot (ИТН
// #24, ПП #25, МИР #26, ИСБ #31, БСП #33). No single one of them can stand for his vote.
//
// ⚠⚠ AND THE COST OF GETTING THAT WRONG IS MEASURED, NOT ARGUED. Computed over the 12,488
// shared sections, this is what a Radev row WOULD have published:
//
//     list        Радев      листа        floor   ratio
//     ПП      1,238,811    624,104      614,743   1.98x
//     БСП     1,238,811    262,705      976,574   4.72x
//     ИТН     1,238,811    225,189    1,013,832   5.50x
//     ИСБ     1,238,811     57,417    1,181,410  21.58x
//
// „поне 976 574 разминали се гласове" between Радев and БСП is arithmetically true and reads as
// a million-vote defection, when what it actually measures is that ten other parties also backed
// him. Against the two rows this file DOES publish, the contrast is the whole argument:
// Герджиков 590,594 against ГЕРБ-СДС's 578,726 (1.02x) and Панов 87,567 against ДБ's 149,396
// (0.59x) — one list accounting for the candidate's vote, so the residue is churn between two
// ballots rather than the arithmetic of a coalition.
//
// ⚠ THE GUARD IS DECLARATIVE, NOT A RATIO, and the table above is why: ПП at 1.98x sits right
// beside Панов's 0.59x, so no threshold separates them without also being arbitrary. What
// separates them is a fact about the world — how many of the backers had a list — so the entry
// DECLARES it and `build_split_ticket` refuses anything but one.
//
// The consequence is asymmetric and has to be said out loud rather than left for a reader to
// notice: this file lets the analysis cover ONE of 2021's two finalists. `build_split_ticket`
// puts that in the artifact's own copy, because a table showing Герджиков and not Радев, with
// no reason given, reads as a choice about the two men.
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
  /**
   * How many of the parties that backed this pair stood on their OWN list in the same-day
   * parliamentary ballot.
   *
   * ⚠⚠ IT MUST BE 1, AND THE BUILDER REFUSES ANYTHING ELSE. With two or more, the candidate's
   * vote is drawn from several lists and „разминали се гласове" against any one of them counts
   * the OTHER backers' voters — see the measured table in this file's header, where Радев
   * against БСП comes out at 976,574. Declaring the number here rather than inferring it keeps
   * the claim explicit: adding a multi-backed pair means typing a figure the builder will
   * reject, instead of quietly shipping a row that looks like every other one.
   */
  backersWithLists: number;
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
      // ГЕРБ, СДС, БЗНС and Движение „Гергьовден" backed him; ГЕРБ and СДС stood on the JOINT
      // list #32 and the other two on no list at all, so exactly one list is his.
      backersWithLists: 1,
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
      // Демократична България alone.
      backersWithLists: 1,
    },
  ],
};

export const endorsementsFor = (cycle: string): TicketEndorsement[] =>
  TICKET_ENDORSEMENTS[cycle] ?? [];
