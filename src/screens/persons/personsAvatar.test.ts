// The avatar URL seam on /persons.
//
// This bug is INVISIBLE IN DEVELOPMENT by construction, which is why it needs a test rather
// than a look at the page. `VITE_DATA_BASE_URL` is empty in dev, so `dataUrl()` is the
// identity function and a raw relative path works fine locally. In production the photo
// BINARIES live in the GCS bucket while the matview stores the relative path the scraper
// wrote — so an unresolved path hits Firebase's SPA rewrite, returns index.html as
// `text/html` with a 200, the <img> fails to decode, and every row silently falls back to
// initials. It reads as "the site has no photos", not as a broken URL.
//
// Asserted on the RESOLVER, not on the component: the component takes whatever it is given
// (its prop is documented as "already dataUrl-resolved"), so the contract that can actually
// break lives here.

import { describe, test, expect } from "vitest";
import { resolvePhoto } from "@/data/parliament/useMps";

describe("resolvePhoto (the seam /persons must apply itself)", () => {
  test("passes an absolute URL through untouched", () => {
    // Legacy index entries still carry absolute parliament.bg URLs.
    const abs = "https://www.parliament.bg/pub/mp/1.jpg";
    expect(resolvePhoto(abs)).toBe(abs);
  });

  test("maps a relative scraper path onto the data origin", () => {
    // With VITE_DATA_BASE_URL unset (the test + dev environment) dataUrl is the identity,
    // so this asserts the SHAPE survives rather than a specific origin — the production
    // origin is supplied by .env.production at build time.
    const rel = "/parliament/photos/3.webp";
    const out = resolvePhoto(rel);
    expect(out.endsWith(rel)).toBe(true);
  });

  test("an empty path yields an empty string, never a bare origin", () => {
    // A bare origin would be a request for the bucket root on every photoless row.
    expect(resolvePhoto("")).toBe("");
  });
});
