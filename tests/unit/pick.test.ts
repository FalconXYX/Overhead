import { describe, expect, it } from "vitest";
import { PICK_RADIUS_PX, pickNearest, WORLD_WIDTH_M } from "../../src/map/pick";

const HALF_WORLD_M = WORLD_WIDTH_M / 2;

describe("pick constants", () => {
  it("match README section 6 and section 9 rule 4", () => {
    expect(WORLD_WIDTH_M).toBe(40_075_016.685578488);
    expect(PICK_RADIUS_PX).toBe(6);
  });
});

describe("pickNearest", () => {
  it("wraps dx by worldWidth only when worldWidth > 0", () => {
    // A pointer 2 km past the antimeridian edge, an object 1 km inside the opposite edge: 1 km apart, wrapped.
    const xy = [-HALF_WORLD_M + 1_000, 0];
    const skip = new Uint8Array(1);
    expect(pickNearest(HALF_WORLD_M + 2_000, 0, xy, skip, 1, 5_000, WORLD_WIDTH_M)).toBe(0);
    expect(pickNearest(HALF_WORLD_M + 2_000, 0, xy, skip, 1, 5_000, 0)).toBe(-1);
  });

  it("wraps across more than one world width", () => {
    const xy = [100, 0];
    const skip = new Uint8Array(1);
    expect(pickNearest(100 + 3 * WORLD_WIDTH_M + 3, 4, xy, skip, 1, 5, WORLD_WIDTH_M)).toBe(0);
    expect(pickNearest(100 - 2 * WORLD_WIDTH_M - 3, 4, xy, skip, 1, 5, WORLD_WIDTH_M)).toBe(0);
  });

  it("returns the nearest candidate within the radius", () => {
    const xy = [10, 0, 3, 4, -2, 0];
    const skip = new Uint8Array(3);
    expect(pickNearest(0, 0, xy, skip, 3, 6, 0)).toBe(2); // distances 10, 5, 2
  });

  it("respects skip", () => {
    const xy = [10, 0, 3, 4, -2, 0];
    const skip = Uint8Array.from([0, 0, 1]);
    expect(pickNearest(0, 0, xy, skip, 3, 6, 0)).toBe(1);
    skip[1] = 1;
    expect(pickNearest(0, 0, xy, skip, 3, 6, 0)).toBe(-1);
  });

  it("respects the radius, inclusive", () => {
    const xy = [3, 4];
    const skip = new Uint8Array(1);
    expect(pickNearest(0, 0, xy, skip, 1, 5, 0)).toBe(0);
    expect(pickNearest(0, 0, xy, skip, 1, 4.999, 0)).toBe(-1);
    expect(pickNearest(0, 0, xy, skip, 1, 0, 0)).toBe(-1);
  });

  it("looks only at the first count entries", () => {
    const xy = [50, 0, 1, 0];
    const skip = new Uint8Array(2);
    expect(pickNearest(0, 0, xy, skip, 1, 100, 0)).toBe(0);
    expect(pickNearest(0, 0, xy, skip, 2, 100, 0)).toBe(1);
    // A count beyond the arrays reads nothing past them.
    expect(pickNearest(0, 0, xy, skip, 10, 100, 0)).toBe(1);
  });

  it("keeps the first of two equally near candidates", () => {
    const xy = [1, 0, -1, 0];
    expect(pickNearest(0, 0, xy, new Uint8Array(2), 2, 5, 0)).toBe(0);
  });

  it("never picks a non-finite position, and a non-finite pointer picks nothing", () => {
    const xy = [Number.NaN, 0, 0, Number.POSITIVE_INFINITY, 2, 0];
    const skip = new Uint8Array(3);
    expect(pickNearest(0, 0, xy, skip, 3, 5, 0)).toBe(2);
    expect(pickNearest(0, 0, xy, skip, 2, 5, 0)).toBe(-1);
    expect(pickNearest(Number.NaN, 0, xy, skip, 3, 5, 0)).toBe(-1);
    expect(pickNearest(0, 0, xy, skip, 3, Number.NaN, 0)).toBe(-1);
  });
});
