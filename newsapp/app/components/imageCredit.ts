import type { ImageRights, ImageRole } from "../data";
import type { NewsLanguage } from "../i18n";

const URL_TOKEN = /https?:\/\/\S+/giu;
const FILE_TOKEN =
  /(?:^|\s)[^·/\\]+\.(?:avif|gif|jpe?g|png|svg|webp)(?:\s|$)/iu;
/**
 * A prefix this function itself would emit. Stripping it keeps the output
 * IDEMPOTENT — without the compound forms, re-crediting an already-credited
 * string produced „Официално изображение: Официално изображение: X".
 */
const CREDIT_PREFIX =
  /^(?:официално\s+изображение|илюстрация|изображение|снимка|official\s+image|illustration|image|photo)\s*[:·-]?\s*/iu;

const escapeRegExp = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const normalized = (value: string | null | undefined): string =>
  (value ?? "").replace(/\s+/gu, " ").trim();

/**
 * The person or body to name, with payload-shaped noise removed: raw URLs,
 * file names and a licence the caption's own link already carries.
 */
const attributionOf = (rights: ImageRights, language: NewsLanguage): string => {
  const creator = normalized(rights.creator);
  if (creator) return creator;

  const licence = normalized(rights.licence_name);
  const withoutLicence = licence
    ? rights.credit_text.replace(new RegExp(escapeRegExp(licence), "giu"), " ")
    : rights.credit_text;
  const candidates = withoutLicence
    .replace(URL_TOKEN, " ")
    .split("·")
    .map((part) => normalized(part).replace(CREDIT_PREFIX, "").trim())
    .filter((part) => part && !FILE_TOKEN.test(part));
  return (
    candidates.at(-1) ??
    (language === "en" ? "verified source" : "проверен източник")
  );
};

/**
 * ⚠️ A `Record` keyed on `ImageRole`, not a `switch` with a `default`. A
 * default arm swallows a NEW role member with no compile error and renders a
 * STATED role as unstated — the one failure this whole phase exists to prevent.
 * Adding a member to `ImageRole` breaks the build here until it is captioned.
 */
const ROLE_CAPTION: Record<
  ImageRole,
  (attribution: string, outlet: string, language: NewsLanguage) => string
> = {
  // The only branch that names a third party, so the only one that can be
  // wrong about one. It degrades to the narrower claim it can support rather
  // than to a vaguer publisher one.
  source_photo: (attribution, outlet, language) =>
    outlet
      ? language === "en"
        ? `From the article in ${outlet} · Photo: ${attribution}`
        : `От публикацията на ${outlet} · Снимка: ${attribution}`
      : language === "en"
        ? `Photo: ${attribution}`
        : `Снимка: ${attribution}`,
  illustration: (attribution, _outlet, language) =>
    language === "en"
      ? `Illustration: ${attribution}`
      : `Илюстрация: ${attribution}`,
  official_image: (attribution, _outlet, language) =>
    language === "en"
      ? `Official image: ${attribution}`
      : `Официално изображение: ${attribution}`,
};

/**
 * Build the short attribution shown below an image in dense card layouts.
 *
 * ⚠️ THE PREFIX IS A CLAIM, AND ONLY `role` LICENCES IT. „От публикацията на
 * X" says a named publisher ran this photograph with this article; „Илюстрация"
 * says we chose the picture ourselves. Getting that backwards either credits a
 * publisher for work they never published, or presents an independently chosen
 * picture as the outlet's own reporting. `role` is the reviewed field that
 * settles it, and the build refuses a `source_photo` whose evidence URL is not
 * on the outlet's own domain.
 *
 * ⚠️ AN UNSTATED ROLE GETS THE NEUTRAL LABEL, NEVER A GUESS. A bundle built
 * before the field existed carries no role at all, and every record in the
 * corpus today is an illustration — but defaulting to „Илюстрация" would state
 * that about the first source photograph the pipeline ever clears, before
 * anybody reviewed it. Neutral is the only safe absence.
 *
 * The licence is deliberately NOT repeated here: `ArticleImage` renders it as
 * its own focusable link beside this text.
 */
export const compactImageCredit = (
  rights: ImageRights,
  options: { language: NewsLanguage; outlet?: string | null } = {
    language: "bg",
  },
): string => {
  const { language } = options;
  const attribution = attributionOf(rights, language);
  const role = rights.role;
  const caption = role ? ROLE_CAPTION[role] : undefined;
  if (!caption)
    return language === "en"
      ? `Image: ${attribution}`
      : `Изображение: ${attribution}`;
  // ⚠️ THE EVIDENCE IS CHECKED HERE TOO, not only at build time. This function
  // is what makes the claim, so it must not be able to make one the record
  // cannot support — a caption naming a publisher on the strength of a `role`
  // string alone is exactly the shape a hand-edited bundle produces. The build
  // additionally proves the URL is on that outlet's own domain.
  const named =
    role === "source_photo" && !rights.source_article_url
      ? ""
      : normalized(options.outlet);
  return caption(attribution, named, language);
};
