/**
 * The WHOLE corpus per language — core plus every deferred bundle — for tests
 * that assert on rendered copy.
 *
 * TESTS ONLY. The app must never import this: it is a static import of all
 * three chunks at once, which is exactly the thing src/locales/bundles.ts
 * exists to avoid, and pulling it into a screen would put the budget corpus
 * back on the critical path of that route with nothing failing.
 * scripts/i18n/bundle_reachability.test.ts holds that.
 *
 * Component tests import this rather than translation.json so that moving a key
 * into a bundle — which the splitter does mechanically, from the route tags —
 * cannot quietly turn an assertion on real copy into an assertion on a raw
 * identifier.
 */
import bgTranslation from "./bg/translation.json";
import bgBudget from "./bg/budget.json";
import bgMethodology from "./bg/methodology.json";
import enTranslation from "./en/translation.json";
import enBudget from "./en/budget.json";
import enMethodology from "./en/methodology.json";

export const bgCorpus: Record<string, string> = {
  ...bgTranslation,
  ...bgBudget,
  ...bgMethodology,
};

export const enCorpus: Record<string, string> = {
  ...enTranslation,
  ...enBudget,
  ...enMethodology,
};
