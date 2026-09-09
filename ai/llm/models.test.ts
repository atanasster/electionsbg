import { describe, expect, it } from "vitest";
import { MODELS, modelById } from "./models";
import { experimentalModelById } from "./experimentalModels";
describe("public model boundary", () => {
  it("keeps browser experiments out of public selection while preserving evaluation", () => {
    expect(MODELS).toHaveLength(1);
    expect(MODELS[0].runtime).toBe("cloud");
    const id = "functiongemma-270m-it-q4f32_1-MLC";
    expect(modelById(id)).toBeUndefined();
    expect(experimentalModelById(id)?.appConfig?.model_list).toHaveLength(1);
  });
});
