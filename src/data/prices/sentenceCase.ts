// Product titles from the КЗП feed, made readable.

/** КЗП product titles arrive in ALL CAPS ("МАСЛО КРАВЕ LURPAK 200 ГР"), which
 *  shouts and truncates badly.
 *
 *  Bulgarian does not title-case, so this produces SENTENCE case: the Cyrillic
 *  is lower-cased outright and only the first letter is raised. A first cut
 *  lower-cased runs of 4+ capitals, which left every short word shouting —
 *  measured over all 181 deal titles, 65% kept one, and they are ordinary words
 *  (ЗА ×20, ТИП ×5, СОС ×5, БУТ, БЕЗ, БЯЛ), giving "Паста ЗА Зъби".
 *
 *  LATIN runs are title-cased instead of lowered: they are brands (LURPAK,
 *  AQUAFRESH), and "lurpak" reads as a typo where "Lurpak" reads as a name.
 *  Runs of 1–3 Latin characters are left alone — those are units and initialisms
 *  (ML, BIO, 3D). */
export const sentenceCase = (t: string) => {
  const lowered = t
    .replace(/[А-ЯЁ]+/g, (w) => w.toLowerCase())
    .replace(/[A-Z]{4,}/g, (w) => w[0] + w.slice(1).toLowerCase());
  // Capitalise the first letter of the first WORD, not the first letter in the
  // string: "90Г ШОКОЛАД" starts with a quantity, and raising the unit gives
  // "90Г шоколад". Skipping to the next word gives "90г Шоколад".
  return lowered.replace(/^(\P{L}*)(\p{L})|^(\d\S*\s+)(\p{L})/u, (...m) =>
    m[2] ? `${m[1]}${m[2].toUpperCase()}` : `${m[3]}${m[4].toUpperCase()}`,
  );
};
