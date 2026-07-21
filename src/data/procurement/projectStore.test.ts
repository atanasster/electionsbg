import { describe, it, expect, beforeEach } from "vitest";
import {
  projectId,
  projectHref,
  encodeSpec,
  saveProject,
  listProjects,
  deleteProject,
  projectFromContract,
  projectFromTender,
} from "./projectStore";
import { parseProjectSpec } from "./useProjectFile";
import type { ProjectFileSpec } from "./useProjectFile";

const ringRoad: ProjectFileSpec = {
  title: { bg: "Софийски околовръстен — Западна дъга" },
  search: [{ terms: "западна дъга", distinctive: ["дъга"] }],
};

describe("projectId", () => {
  it("slugs the title, and is stable", () => {
    const id = projectId(ringRoad);
    expect(id).toBe(projectId(ringRoad));
    expect(id.length).toBeGreaterThan(0);
    expect(id).not.toMatch(/\s/);
  });
  it("falls back to a hash of the search when there is no title", () => {
    const a = projectId({ search: [{ terms: "бюлетин" }] });
    const b = projectId({ search: [{ terms: "бюлетин" }] });
    const c = projectId({ search: [{ terms: "суемг" }] });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a.startsWith("q-")).toBe(true);
  });
});

describe("encodeSpec / projectHref", () => {
  it("round-trips through the URL encoding", () => {
    const q = encodeSpec(ringRoad);
    const back = JSON.parse(decodeURIComponent(q)) as ProjectFileSpec;
    expect(back.search[0].terms).toBe("западна дъга");
  });
  it("builds the deep-link href", () => {
    expect(projectHref(ringRoad)).toMatch(/^\/procurement\/project\?q=/);
  });
});

describe("projectFromContract / projectFromTender — detail-page on-ramp (§4.3b)", () => {
  it("seeds a valid spec from a contract (title + force-included key & procedure)", () => {
    const spec = projectFromContract({
      key: "k1",
      unp: "u1",
      titleSeed: "Модернизация Видин–Ботевград",
    });
    expect(spec.search[0].terms).toBe("Модернизация Видин–Ботевград");
    expect(spec.includes?.contractKeys).toEqual(["k1"]);
    expect(spec.includes?.tenderUnps).toEqual(["u1"]);
    // must survive the untrusted-?q= validator so the deep link resolves
    expect(parseProjectSpec(JSON.stringify(spec))).not.toBeNull();
  });
  it("omits tenderUnps when the contract has no УНП", () => {
    const spec = projectFromContract({ key: "k1", titleSeed: "Договор" });
    expect(spec.includes?.tenderUnps).toBeUndefined();
  });
  it("falls back to a non-empty search when the title is blank (spec stays valid)", () => {
    const spec = projectFromContract({ key: "k1", titleSeed: "   " });
    expect(spec.search[0].terms.length).toBeGreaterThan(0);
    expect(parseProjectSpec(JSON.stringify(spec))).not.toBeNull();
  });
  it("seeds a valid spec from a tender (force-included УНП)", () => {
    const spec = projectFromTender({
      unp: "u9",
      titleSeed: "Строеж на магистрала",
    });
    expect(spec.includes?.tenderUnps).toEqual(["u9"]);
    expect(parseProjectSpec(JSON.stringify(spec))).not.toBeNull();
  });
  it("falls back to a non-empty search when the tender title is blank", () => {
    const spec = projectFromTender({ unp: "u9", titleSeed: "  " });
    expect(spec.search[0].terms.length).toBeGreaterThan(0);
    expect(parseProjectSpec(JSON.stringify(spec))).not.toBeNull();
  });
});

describe("save / list / delete (localStorage)", () => {
  beforeEach(() => localStorage.clear());
  it("saves, lists, and deletes a project; re-save overwrites (no dup)", () => {
    const id = saveProject(ringRoad);
    saveProject(ringRoad); // same id → overwrite
    let list = listProjects();
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe(id);
    expect(list[0].spec.search[0].terms).toBe("западна дъга");
    deleteProject(id);
    list = listProjects();
    expect(list).toHaveLength(0);
  });
  it("ignores unrelated + corrupt localStorage entries", () => {
    localStorage.setItem("something.else", "x");
    localStorage.setItem("naiasno.projects.bad", "{not json");
    saveProject(ringRoad);
    expect(listProjects()).toHaveLength(1);
  });
});
