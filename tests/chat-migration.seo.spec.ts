import { expect, test } from "./edgeTest";
import { SITE_ORIGIN } from "../src/lib/siteOrigin";

for (const prefix of ["", "/en"])
  for (const path of ["chat", "chat/tools", "chat/evals"]) {
    test(`chat static metadata ${prefix}/${path}`, async ({ request }) => {
      const response = await request.get(
        `${prefix}/${path}?q=private-launch-test`,
      );
      expect(response.ok()).toBe(true);
      const html = await response.text();
      expect(html).toContain(
        `rel="canonical" href="${SITE_ORIGIN}${prefix}/${path}"`,
      );
      expect(html).toContain('hreflang="bg"');
      expect(html).toContain('hreflang="en"');
      expect(html).not.toContain("private-launch-test");
      expect(html).toContain('property="og:title"');
    });
  }
