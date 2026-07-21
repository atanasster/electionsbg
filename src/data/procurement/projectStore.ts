// Project-file persistence (v1 = localStorage only, no backend/no auth — the
// /procurement/watchlist precedent). A saved project is its ProjectFileSpec
// under `naiasno.projects.<id>`; the same spec URL-encodes into ?q= so a file is
// shareable by link. See docs/plans/procurement-project-lifecycle-v1.md §2 storage.
//
// `id` is a stable slug of the title (or a hash of the search) — never
// Math.random / a timestamp — so re-saving the same file overwrites, not duplicates.

import type { ProjectFileSpec } from "./useProjectFile";

const PREFIX = "naiasno.projects.";

export const encodeSpec = (spec: ProjectFileSpec): string =>
  encodeURIComponent(JSON.stringify(spec));

/** The shareable/deep-link href for a spec. */
export const projectHref = (spec: ProjectFileSpec): string =>
  `/procurement/project?q=${encodeSpec(spec)}`;

/**
 * Seed a project file from ONE contract (the "проследи като досие" on-ramp,
 * §4.3b). Its title seeds both the dossier title and the search, and the contract
 * (plus its originating procedure, when the УНП is known) is force-included so the
 * dossier always contains the row the user came from; they refine the search from
 * there. `titleSeed` is the caller-split object title (drops the lot qualifier).
 */
export const projectFromContract = (opts: {
  key: string;
  unp?: string | null;
  titleSeed: string;
}): ProjectFileSpec => {
  const terms = opts.titleSeed.trim() || "договор";
  return {
    title: { bg: terms },
    search: [{ terms }],
    includes: {
      contractKeys: [opts.key],
      ...(opts.unp ? { tenderUnps: [opts.unp] } : {}),
    },
  };
};

/** Seed a project file from ONE procedure (tender). The procedure is
 *  force-included so its lineage (sibling lots + contracts) resolves. §4.3b */
export const projectFromTender = (opts: {
  unp: string;
  titleSeed: string;
}): ProjectFileSpec => {
  const terms = opts.titleSeed.trim() || "процедура";
  return {
    title: { bg: terms },
    search: [{ terms }],
    includes: { tenderUnps: [opts.unp] },
  };
};

const slugify = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);

// djb2 — a short stable hash for spec-derived ids when there's no usable title.
const hash = (s: string): string => {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(36);
};

/** Stable id for a spec: the title slug, else a hash of the search threads. */
export const projectId = (spec: ProjectFileSpec): string => {
  const title = spec.title?.bg || spec.title?.en || "";
  const slug = slugify(title);
  return slug || `q-${hash(JSON.stringify(spec.search ?? []))}`;
};

export interface SavedProject {
  id: string;
  spec: ProjectFileSpec;
}

const store = (): Storage | null => {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null; // localStorage can throw (private mode / disabled)
  }
};

/** Save (or overwrite) a project. Returns its id; a no-op returning the id when
 *  localStorage is unavailable (SSR/prerender/private mode). */
export const saveProject = (spec: ProjectFileSpec): string => {
  const id = projectId(spec);
  const s = store();
  if (s) {
    try {
      s.setItem(PREFIX + id, JSON.stringify(spec));
    } catch {
      /* quota / disabled — the shareable link is the real backup */
    }
  }
  return id;
};

export const listProjects = (): SavedProject[] => {
  const s = store();
  if (!s) return [];
  const out: SavedProject[] = [];
  for (let i = 0; i < s.length; i++) {
    const k = s.key(i);
    if (!k || !k.startsWith(PREFIX)) continue;
    const raw = s.getItem(k);
    if (!raw) continue;
    try {
      out.push({ id: k.slice(PREFIX.length), spec: JSON.parse(raw) });
    } catch {
      /* skip a corrupt entry */
    }
  }
  return out;
};

export const deleteProject = (id: string): void => {
  const s = store();
  if (s) s.removeItem(PREFIX + id);
};
