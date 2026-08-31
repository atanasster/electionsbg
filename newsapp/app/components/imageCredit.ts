import type { ImageRights } from "../data";

const URL_TOKEN = /https?:\/\/\S+/giu;
const FILE_TOKEN =
  /(?:^|\s)[^·/\\]+\.(?:avif|gif|jpe?g|png|svg|webp)(?:\s|$)/iu;
const CREDIT_PREFIX = /^(?:илюстрация|изображение|снимка)\s*[:·-]?\s*/iu;

const escapeRegExp = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const normalized = (value: string | null | undefined): string =>
  (value ?? "").replace(/\s+/gu, " ").trim();

/**
 * Build the short attribution used below images in dense card layouts.
 *
 * The complete reviewed credit remains in `ImageRights` and the credit link
 * still points at its authority. This formatter only removes payload-shaped
 * noise (raw URLs, file names and a duplicated licence) from visible card copy.
 */
export const compactImageCredit = (rights: ImageRights): string => {
  const creator = normalized(rights.creator);
  if (creator) return `Изображение: ${creator}`;

  const licence = normalized(rights.licence_name);
  const withoutLicence = licence
    ? rights.credit_text.replace(new RegExp(escapeRegExp(licence), "giu"), " ")
    : rights.credit_text;
  const candidates = withoutLicence
    .replace(URL_TOKEN, " ")
    .split("·")
    .map((part) => normalized(part).replace(CREDIT_PREFIX, "").trim())
    .filter((part) => part && !FILE_TOKEN.test(part));
  const credit = candidates.at(-1) ?? "проверен източник";

  return `Изображение: ${credit}`;
};
