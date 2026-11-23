import { describe, expect, test } from "vitest";
import {
  decodeDocumentAccessToken,
  extractCrActs,
  extractFeedActs,
  fiscalYearOf,
  isGfoFamily,
  parseAnnouncedDate,
} from "./announced_acts";

// Real tokens from the 2026-11-23 CR capture of ЕИК 148032090. Each embeds an ActID the
// TR daily feed lists for the same company (2026-10-09 / 2026-10-10 files).
const TOKEN_2008 =
  "MTQ4MDMyMDkwJmUmMmQwYWQ3NzNjMjQxNGNhZTkxYjA0MGQ5ODZmN2FkYzAqlOPWvc5PsyN-O6zET8VF0xD3u8JEHBlpJN--c7SpmA";
const TOKEN_2009 =
  "MTQ4MDMyMDkwJmUmZmFjN2YyYTg1NDBjNGI0OWIwZTlhMzEwNDBiMzc1ZjcnZQv7apLxfyB0ONW3JB3Ej8YQK4WWDjAbUwA1_tVY2A";

describe("decodeDocumentAccessToken", () => {
  test("recovers the UIC and the feed's ActID", () => {
    expect(decodeDocumentAccessToken(TOKEN_2008)).toEqual({
      uic: "148032090",
      actId: "2d0ad773c2414cae91b040d986f7adc0",
    });
    expect(decodeDocumentAccessToken(TOKEN_2009)?.actId).toBe(
      "fac7f2a8540c4b49b0e9a31040b375f7",
    );
  });

  test("rejects a token of another shape", () => {
    expect(
      decodeDocumentAccessToken(Buffer.from("hello").toString("base64url")),
    ).toBeNull();
    expect(decodeDocumentAccessToken("")).toBeNull();
  });
});

const feed = (statements: Record<string, unknown>, uic = "148032090") => ({
  Message: [
    {
      Body: [
        {
          Deeds: [
            {
              Deed: [
                {
                  $: { UIC: uic, LegalForm: "EOOD" },
                  SubDeed: [
                    { $: { SubUICType: "MainCircumstances" } },
                    {
                      $: { SubUICType: "G1_ActAnnouncement" },
                      ...statements,
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
  ],
});

describe("extractFeedActs", () => {
  test("reads every Statements* container with its FieldIdent", () => {
    const acts = extractFeedActs(
      feed({
        StatementsB: [
          {
            $: { FieldIdent: "10019B" },
            StatementB: [
              {
                $: {
                  ActModeValue: "2",
                  ActModeText: "Годишен финансов отчет",
                  Description: "Годишен финансов отчет за 2008 г.",
                  ActDate: "",
                  ActYear: "",
                  ActID: "2d0ad773c2414cae91b040d986f7adc0",
                  ActWithErasedPersonalData: "0",
                },
              },
              {
                $: {
                  ActModeValue: "2",
                  ActModeText: "Годишен финансов отчет",
                  Description: "Годишен финансов отчет",
                  ActYear: "2009",
                  ActID: "FAC7F2A8540C4B49B0E9A31040B375F7",
                  ActWithErasedPersonalData: "1",
                },
              },
            ],
          },
        ],
        StatementsAJ: [
          {
            $: { FieldIdent: "1001AJ" },
            StatementAJ: [
              {
                $: {
                  ActModeValue: "36",
                  ActModeText:
                    "Актуален дружествен договор/учредителен акт/устав",
                  ActID: "cbe42ee7273140198cc01df44cd9bf1b",
                },
              },
            ],
          },
        ],
      }),
    );
    expect(acts).toHaveLength(3);
    const [a2008, a2009, statute] = acts;
    expect(a2008).toMatchObject({
      uic: "148032090",
      actMode: 2,
      fieldIdent: "10019B",
      description: "Годишен финансов отчет за 2008 г.",
      actYear: null,
      erasedPersonalData: false,
    });
    // ActID is normalised to lower case; a description repeating the kind is dropped.
    expect(a2009).toMatchObject({
      actId: "fac7f2a8540c4b49b0e9a31040b375f7",
      description: null,
      actYear: 2009,
      erasedPersonalData: true,
    });
    expect(statute).toMatchObject({ actMode: 36, fieldIdent: "1001AJ" });
    expect(fiscalYearOf(a2008)).toBe(2008);
    expect(fiscalYearOf(a2009)).toBe(2009);
    expect(fiscalYearOf(statute)).toBeNull();
  });

  test("ignores other SubDeeds, malformed ActIDs and duplicates", () => {
    const item = {
      $: {
        ActModeValue: "2",
        ActModeText: "Годишен финансов отчет",
        ActID: "2d0ad773c2414cae91b040d986f7adc0",
      },
    };
    const acts = extractFeedActs(
      feed({
        StatementsB: [
          {
            $: { FieldIdent: "10019B" },
            StatementB: [item, item, { $: { ...item.$, ActID: "not-an-id" } }],
          },
        ],
      }),
    );
    expect(acts).toHaveLength(1);
    expect(extractFeedActs(null)).toEqual([]);
    expect(extractFeedActs({ Message: [] })).toEqual([]);
  });
});

const rec = (token: string, body: string) =>
  `<div class='record-container record-container--preview'><p class='field-text'>${body.replace("%LINK%", `<a href='DocumentAccess/${token}' target='_blank'><i class='ui-icon'></i>`)}</p></div>`;

const crBody = (uic: string, html: string, fieldIdent = "10019B") =>
  JSON.stringify({
    uic,
    sections: [
      {
        nameCode: "CR_GL_ANNOUNCED_ACTS_L",
        subDeeds: [
          {
            groups: [
              {
                nameCode: "CR_GL_ANNOUNCED_ACTS_L",
                fields: [
                  { nameCode: "CR_F_1001_L", fieldIdent, htmlData: html },
                ],
              },
            ],
          },
        ],
      },
    ],
  });

describe("extractCrActs", () => {
  const html = [
    rec(
      TOKEN_2008,
      "Годишен финансов отчет<br />%LINK%Годишен финансов отчет за 2008 г.</a><br/>Дата на обявяване: 22.06.2009 г. 18:02:14",
    ),
    rec(
      TOKEN_2009,
      "Годишен финансов отчет<br/>Година: 2009г.<br />%LINK%Годишен финансов отчет</a><br/>Подмяна с акт със заличени лични данни<br/>Дата на обявяване: 13.04.2011 г. 16:02:21",
    ),
  ].join("<hr class='hr--report' />");

  test("parses kind, year, description, date and erased flag per record", () => {
    const acts = extractCrActs(crBody("148032090", html), "148032090");
    expect(acts).toEqual([
      {
        actId: "2d0ad773c2414cae91b040d986f7adc0",
        uic: "148032090",
        actMode: null,
        actModeText: "Годишен финансов отчет",
        fieldIdent: "10019B",
        description: "Годишен финансов отчет за 2008 г.",
        actYear: null,
        announcedLocal: "2009-06-22 18:02:14",
        erasedPersonalData: null,
      },
      {
        actId: "fac7f2a8540c4b49b0e9a31040b375f7",
        uic: "148032090",
        actMode: null,
        actModeText: "Годишен финансов отчет",
        fieldIdent: "10019B",
        description: null,
        actYear: 2009,
        announcedLocal: "2011-04-13 16:02:21",
        erasedPersonalData: true,
      },
    ]);
    expect(acts.every(isGfoFamily)).toBe(true);
  });

  test("refuses a token minted for another company", () => {
    expect(extractCrActs(crBody("000022044", html), "000022044")).toEqual([]);
  });

  test("survives an unparseable body", () => {
    expect(extractCrActs("not json", "148032090")).toEqual([]);
  });
});

test("parseAnnouncedDate", () => {
  expect(parseAnnouncedDate("Дата на обявяване: 05.10.2026 г. 15:33:45")).toBe(
    "2026-10-05 15:33:45",
  );
  expect(parseAnnouncedDate("Дата: 05.10.2026")).toBeNull();
});
