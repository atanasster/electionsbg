import { describe, expect, it } from "vitest";
import type { StoryMember } from "./data";
import { personReadings, storyPeople } from "./storyPersons";

const member = (
  domain: string,
  id: string,
  persons: StoryMember["persons"],
): StoryMember =>
  ({ domain, article_id: id, persons }) as unknown as StoryMember;

const radev = (bucket_index: number) => ({
  id: "mp-5142",
  name: "Румен Радев",
  value: 0,
  bucket_index,
});

describe("storyPeople", () => {
  it("counts outlets, most-covered first", () => {
    const people = storyPeople([
      member("a.bg", "1", [radev(1)]),
      member("a.bg", "2", [radev(1)]),
      member("b.bg", "3", [
        radev(2),
        { id: "x", name: "Х", value: 0, bucket_index: 2 },
      ]),
    ]);
    expect(people.map((p) => [p.id, p.outlets, p.articles])).toEqual([
      ["mp-5142", 2, 3],
      ["x", 1, 1],
    ]);
  });
});

describe("personReadings", () => {
  it("one outlet's two readings are not a spread", () => {
    const { state } = personReadings(
      [member("a.bg", "1", [radev(1)]), member("a.bg", "2", [radev(3)])],
      "mp-5142",
    );
    expect(state).toBe("single_source");
  });

  it("two outlets on different buckets are a spread; on one bucket, alike", () => {
    expect(
      personReadings(
        [member("a.bg", "1", [radev(1)]), member("b.bg", "2", [radev(2)])],
        "mp-5142",
      ).state,
    ).toBe("distribution");
    expect(
      personReadings(
        [member("a.bg", "1", [radev(2)]), member("b.bg", "2", [radev(2)])],
        "mp-5142",
      ).state,
    ).toBe("uniform");
  });
});
