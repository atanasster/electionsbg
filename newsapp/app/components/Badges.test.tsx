import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { LeanBadge, StanceBadge } from "./Badges";

describe("analysis badge names", () => {
  it("names the material and preserves neutral versus non-applicable states", () => {
    render(
      <>
        <LeanBadge leaning="progressive" short />
        <LeanBadge leaning="neutral" short />
        <LeanBadge leaning="not_applicable" short />
        <StanceBadge stance="neutral" short />
        <StanceBadge stance="not_applicable" short />
      </>,
    );

    for (const name of [
      "Политическо рамкиране на материала: Прогресивно рамкиране",
      "Политическо рамкиране на материала: Без ясно идеологическо рамкиране",
      "Политическо рамкиране на материала: Извън политическата ос",
      "Позиция на материала спрямо Русия: Без ясно изразена позиция към Русия",
      "Позиция на материала спрямо Русия: Русия не е спомената",
    ]) {
      expect(screen.getByLabelText(name)).toBeVisible();
    }
  });
});
