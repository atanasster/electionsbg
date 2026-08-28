export const SAVED_NEWS_KEY = "naiasno.news.saved.v1";
export const isSavedNewsPath = (value: string): boolean =>
  /^\/story\/[\p{L}\p{N}_-]+$/u.test(value) ||
  /^\/article\/[A-Za-z0-9]+(?:[.-][A-Za-z0-9]+)*\/[\p{L}\p{N}_-]+$/u.test(
    value,
  );

export const readSavedNews = (storage: Pick<Storage, "getItem">): string[] => {
  try {
    const parsed: unknown = JSON.parse(storage.getItem(SAVED_NEWS_KEY) ?? "[]");
    return Array.isArray(parsed)
      ? [
          ...new Set(
            parsed.filter(
              (value): value is string =>
                typeof value === "string" && isSavedNewsPath(value),
            ),
          ),
        ]
      : [];
  } catch {
    return [];
  }
};

export const writeSavedNews = (
  storage: Pick<Storage, "setItem">,
  paths: string[],
): boolean => {
  try {
    const safePaths = [
      ...new Set(paths.filter((path) => isSavedNewsPath(path))),
    ].slice(0, 200);
    storage.setItem(SAVED_NEWS_KEY, JSON.stringify(safePaths));
    return true;
  } catch {
    return false;
  }
};

const browserStorage = (): Storage | null => {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
};

export const readSavedNewsFromBrowser = (): string[] => {
  const storage = browserStorage();
  return storage ? readSavedNews(storage) : [];
};

export const writeSavedNewsToBrowser = (paths: string[]): boolean => {
  const storage = browserStorage();
  return storage ? writeSavedNews(storage, paths) : false;
};
