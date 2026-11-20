import { describe, it, expect } from "vitest";
import { tidyDots } from "./tidyDots";

describe("tidyDots", () => {
  it("collapses the period an abbreviation already ends a sentence with", () => {
    expect(tidyDots("изразходвала €4,7 млрд..")).toBe(
      "изразходвала €4,7 млрд.",
    );
    expect(tidyDots("€2,9 млрд.. Салдото")).toBe("€2,9 млрд. Салдото");
    expect(tidyDots("spent €4.7bn.")).toBe("spent €4.7bn.");
  });
  it("leaves an ellipsis alone", () => {
    expect(tidyDots("и още...")).toBe("и още...");
  });
});
