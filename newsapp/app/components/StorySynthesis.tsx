// T5.1 — the cited synthesis at the top of a story: what the sources
// report in common, what they dispute (attributed), and where they differ
// in emphasis. Every line cites a member article and quotes the words the
// build's gate found in it — a claim with no surviving quote never reached
// this file. Agreement among sources is not proof of truth, and the caveat
// sits with the claims rather than at the top of the page.
//
// ⚠️ THE FALLBACKS INVENT NOTHING. One outlet → an attributed single-source
// summary in the outlet's own words (its headline). No synthesis, a stale
// one, a failed generation → the block renders nothing at all; the page
// keeps its headlines and source links.

import type { StoryMember, StorySynthesis as Synthesis } from "../data";
import { useNewsLocale } from "../i18n";

// A quote that OPENS with a mark the article itself printed („Лукойл“ има …)
// keeps it — the build strips only a balanced outer pair — so the `<q>` must
// not add a second one in front.
const OPENS_WITH_QUOTE = /^[„"“«‟]/;

const Quote = ({ text }: { text: string }) => (
  <q
    lang="bg"
    className={OPENS_WITH_QUOTE.test(text) ? "[quotes:none]" : undefined}
  >
    {text}
  </q>
);

const Cite = ({
  url,
  quote,
  name,
}: {
  url: string | null;
  quote: string;
  name: string;
}) => (
  <span className="block text-xs text-muted-foreground">
    {url ? (
      <a
        href={url}
        target="_blank"
        rel="noreferrer noopener"
        className="font-medium text-foreground underline-offset-4 hover:underline"
      >
        {name}
      </a>
    ) : (
      <span className="font-medium text-foreground">{name}</span>
    )}
    : <Quote text={quote} />
  </span>
);

const foldTitle = (s: string | null | undefined) =>
  (s ?? "").toLowerCase().replace(/\s+/g, " ").trim();

export const StorySynthesisBlock = ({
  synthesis,
  members,
  outletNames,
  storyTitle,
}: {
  synthesis?: Synthesis;
  members: StoryMember[];
  outletNames: Map<string, string>;
  /** The page's own `<h1>`; a single-source headline equal to it is not repeated. */
  storyTitle?: string | null;
}) => {
  const { tr, language } = useNewsLocale();
  const name = (domain: string) => outletNames.get(domain) ?? domain;
  const outlets = new Set(members.map((m) => m.domain));

  // One outlet: say whose account this is, in its own words, and nothing more.
  if (outlets.size < 2) {
    const first = members.find((m) => m.title);
    if (!first) return null;
    const repeatsTitle = foldTitle(first.title) === foldTitle(storyTitle);
    return (
      <div
        className="mt-4 rounded-md border px-3 py-2"
        data-testid="story-synthesis-single"
      >
        <p className="text-sm">
          <span className="font-medium">
            {tr("Според", "According to")} {name(first.domain)}
            {repeatsTitle ? "" : ":"}
          </span>
          {repeatsTitle ? null : (
            <>
              {" "}
              <Quote text={first.title ?? ""} />
            </>
          )}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          {tr(
            "Само един източник отразява тази история; сравнение няма с какво да се направи.",
            "Only one source covers this story; there is nothing to compare it with.",
          )}
        </p>
      </div>
    );
  }

  const s = synthesis?.status === "ok" ? synthesis.synthesis : null;
  if (!s || !(s.common.length || s.disputed.length || s.emphasis.length)) {
    return null;
  }
  const caveat =
    (language === "en" ? synthesis?.caveat_en : synthesis?.caveat_bg) ?? null;
  return (
    <div
      className="mt-4 space-y-3 rounded-md border px-3 py-3"
      data-testid="story-synthesis"
    >
      {s.common.length ? (
        <section aria-labelledby="synth-common">
          <h2
            id="synth-common"
            className="text-xs font-semibold uppercase tracking-wide text-muted-foreground"
          >
            {tr("Съобщават еднакво", "Reported in common")}
          </h2>
          <ul className="mt-1 space-y-2 text-sm">
            {s.common.map((item, i) => (
              <li key={`c${i}`}>
                <p>{item.claim}</p>
                {item.supports.map((c, j) => (
                  <Cite
                    key={j}
                    url={c.url}
                    quote={c.quote}
                    name={name(c.domain)}
                  />
                ))}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {s.disputed.length ? (
        <section aria-labelledby="synth-disputed">
          <h2
            id="synth-disputed"
            className="text-xs font-semibold uppercase tracking-wide text-muted-foreground"
          >
            {tr("Разминават се", "Disputed")}
          </h2>
          <ul className="mt-1 space-y-2 text-sm">
            {s.disputed.map((item, i) => (
              <li key={`d${i}`}>
                <p>{item.claim}</p>
                {item.positions.map((p, j) => (
                  <Cite
                    key={j}
                    url={p.url}
                    quote={p.quote}
                    name={`${name(p.domain)} · ${p.attributed_to}`}
                  />
                ))}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {s.emphasis.length ? (
        <section aria-labelledby="synth-emphasis">
          <h2
            id="synth-emphasis"
            className="text-xs font-semibold uppercase tracking-wide text-muted-foreground"
          >
            {tr("Различен акцент", "Different emphasis")}
          </h2>
          <ul className="mt-1 space-y-2 text-sm">
            {s.emphasis.map((e, i) => (
              <li key={`e${i}`}>
                <p>{e.note}</p>
                <Cite url={e.url} quote={e.quote} name={name(e.domain)} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {caveat ? (
        <p className="text-xs text-muted-foreground" role="note">
          {caveat}
        </p>
      ) : null}
    </div>
  );
};
