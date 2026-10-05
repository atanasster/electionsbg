import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ModelPicker } from "./ModelPicker";
import { MODELS } from "../llm/models";
import type { ModelEngine } from "../llm/useModelEngine";

let verified: (() => void) | undefined;
vi.mock("./AiVerification", () => ({
  AiVerification: ({ onVerified }: { onVerified: () => void }) => {
    verified = onVerified;
    return <div>verification widget</div>;
  },
}));
vi.mock("./ChatPolicy", () => ({ ChatPolicy: () => null }));
vi.mock("../llm/session", () => ({
  hasAiSession: () => false,
  aiSessionNotice: () => "",
  subscribeAiSession: () => () => {},
}));
afterEach(() => {
  verified = undefined;
});

const engine = (): ModelEngine =>
  ({
    providerId: "rules",
    select: vi.fn(async () => {}),
  }) as unknown as ModelEngine;

const chooseAi = () => {
  fireEvent.click(screen.getByRole("button", { name: "Choose mode" }));
  fireEvent.click(screen.getByRole("button", { name: /AI assistant/ }));
};

it("switches to AI when verification finishes after the dialog was closed", () => {
  const e = engine();
  render(<ModelPicker engine={e} lang="en" />);
  chooseAi();
  const onVerified = verified!;
  fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
  expect(screen.queryByRole("dialog")).toBeNull();
  act(() => onVerified());
  expect(e.select).toHaveBeenCalledWith(MODELS[0].id);
});

it("does not override a later No AI choice with a late verification", () => {
  const e = engine();
  render(<ModelPicker engine={e} lang="en" />);
  chooseAi();
  const onVerified = verified!;
  fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
  fireEvent.click(screen.getByRole("button", { name: "Choose mode" }));
  fireEvent.click(screen.getByRole("button", { name: /^No AI/ }));
  act(() => onVerified());
  expect(e.select).toHaveBeenCalledTimes(1);
  expect(e.select).toHaveBeenCalledWith("rules");
});
