// English labels for the ИСУН organisation-type / organisation-form
// categories. The source data carries these only in Bulgarian; the BG UI
// shows them as-is, the EN UI maps them. Unknown values fall back to the
// original string.

const ORG_TYPE_EN: Record<string, string> = {
  Компания: "Company",
  "Държавна администрация": "State administration",
  "Учебно заведение": "Educational institution",
  "Нестопанска организация": "Non-profit organisation",
  "Научноизследователска организация": "Research organisation",
  "Медицинско заведение": "Healthcare institution",
  "Съдебна система": "Judiciary",
  "Сдружение на собствениците": "Owners' association",
  Друга: "Other",
};

const ORG_FORM_EN: Record<string, string> = {
  "Публично правна": "Public-law",
  "Частно правна": "Private-law",
};

const isEn = (lang: string): boolean => lang.toLowerCase().startsWith("en");

export const orgTypeLabel = (key: string, lang: string): string =>
  isEn(lang) ? (ORG_TYPE_EN[key] ?? key) : key;

export const orgFormLabel = (key: string, lang: string): string =>
  isEn(lang) ? (ORG_FORM_EN[key] ?? key) : key;
