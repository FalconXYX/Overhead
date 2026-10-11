// tests/unit/objectId.test.ts — `?sel=` and every other ObjectId string (M3 step 12.3, section 5).
import { describe, expect, it } from "vitest";
import { BODY_IDS } from "../../src/domain/astro";
import { noradIdOf, parseObjectId } from "../../src/state/objectId";

describe("parseObjectId", () => {
  it.each([
    "sat:25544",
    "sat:100882",
    "sat:1",
    "sat:999999999",
    "planet:Jupiter",
    "star:424",
    "star:1",
    "star:9110",
    "moon",
    "sun",
  ])("accepts %j unchanged", (raw) => {
    expect(parseObjectId(raw)).toBe(raw);
  });

  it("accepts every body id the sky map draws", () => {
    for (const id of BODY_IDS) expect(parseObjectId(id)).toBe(id);
  });

  it.each([
    "sat:",
    "sat:0",
    "sat:025544",
    "sat:1e5",
    "sat:1000000000", // 10 digits
    "sat:-5",
    "sat:25544.0",
    "sat: 25544",
    "planet:Pluto",
    "planet:jupiter",
    "planet:",
    "planet:Earth",
    "star:9111",
    "star:0",
    "star:0424",
    "star:",
    "Moon",
    "SUN",
    "sat:25544 ",
    " moon",
    "",
    "sat",
    "satellite:25544",
    "sat:25544&x",
  ])("rejects %j", (raw) => {
    expect(parseObjectId(raw)).toBeNull();
  });
});

describe("noradIdOf", () => {
  it("gives the number for sat: ids, up to 9 digits", () => {
    expect(noradIdOf("sat:25544")).toBe(25544);
    expect(noradIdOf("sat:100882")).toBe(100882);
    expect(noradIdOf("sat:999999999")).toBe(999999999);
  });

  it("is null for other ids and for null", () => {
    expect(noradIdOf("planet:Jupiter")).toBeNull();
    expect(noradIdOf("star:424")).toBeNull();
    expect(noradIdOf("moon")).toBeNull();
    expect(noradIdOf("sun")).toBeNull();
    expect(noradIdOf(null)).toBeNull();
  });

  it("is null for a sat: id that parseObjectId would reject", () => {
    // SatId is `sat:${number}`, so these type-check; they never come out of parseObjectId.
    expect(noradIdOf("sat:0")).toBeNull();
    expect(noradIdOf("sat:1e5")).toBeNull();
    expect(noradIdOf("sat:-5")).toBeNull();
    expect(noradIdOf("sat:2.5")).toBeNull();
  });

  it("round-trips through parseObjectId", () => {
    for (const n of [1, 5, 25544, 100882, 123456789]) {
      expect(noradIdOf(parseObjectId(`sat:${n}`))).toBe(n);
    }
  });
});
