import { describe, expect, it } from "vitest";

describe("unit-test network guard", () => {
  it("throws on any fetch", () => {
    expect(() => fetch("https://gibs.earthdata.nasa.gov/")).toThrow(
      /fetch is blocked in unit tests/,
    );
  });
});
