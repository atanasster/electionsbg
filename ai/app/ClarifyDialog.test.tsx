import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ClarifyDialog } from "./ClarifyDialog";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) =>
      ({
        pp_role_medical_center: "Управител на медицински център (ДКЦ/МЦ)",
      })[key] ?? key,
  }),
}));

describe("ClarifyDialog person labels", () => {
  it("localizes role and position codes with the existing person vocabulary", () => {
    render(
      <ClarifyDialog
        lang="bg"
        request={{
          prompt: "Кое лице имате предвид?",
          options: [
            {
              label: "Ани Яворова Стефанова",
              sublabel: "medical_center · София",
              personContext: {
                primaryRole: "medical_center",
                positionType: "public_sector",
                placeLabel: "София",
              },
              tool: "personProfile",
              args: { name: "ani-yavorova-stefanova" },
            },
            {
              label: "Явор Чавдаров Стефанов",
              sublabel: "private_sector",
              personContext: { positionType: "private_sector" },
              tool: "personProfile",
              args: { name: "Явор Чавдаров Стефанов" },
            },
          ],
        }}
        onPick={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(
      screen.getByText("Управител на медицински център (ДКЦ/МЦ) · София"),
    ).toBeInTheDocument();
    expect(screen.getByText("Частен сектор")).toBeInTheDocument();
    expect(
      screen.queryByText("medical_center · София"),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("private_sector")).not.toBeInTheDocument();
  });
});
