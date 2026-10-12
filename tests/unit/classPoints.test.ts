import Feature from "ol/Feature";
import MultiPoint from "ol/geom/MultiPoint";
import VectorSource from "ol/source/Vector";
import { describe, expect, it } from "vitest";
import { writeClassPoints } from "../../src/map/classPoints";

/** As the layers build it: one coordinate, not added to its source (README Errors: never drawn at 0, 0). */
function classFeature(): {
  source: VectorSource;
  feature: Feature<MultiPoint>;
  geometry: MultiPoint;
} {
  const geometry = new MultiPoint([[0, 0]]);
  return {
    source: new VectorSource({ useSpatialIndex: false }),
    feature: new Feature(geometry),
    geometry,
  };
}

describe("writeClassPoints", () => {
  it("adds the feature on the first non-empty write and removes it while empty (gotcha 10)", () => {
    const { source, feature, geometry } = classFeature();
    expect(writeClassPoints(source, feature, [], 0)).toBe(false);
    expect(source.hasFeature(feature)).toBe(false);

    // Counts 1 → 0 → 2 → 0 → 3, as measured on WebGLVector in step 14.2.
    expect(writeClassPoints(source, feature, [1, 2], 1)).toBe(true);
    expect(source.hasFeature(feature)).toBe(true);
    expect(geometry.getFlatCoordinates()).toEqual([1, 2]);

    expect(writeClassPoints(source, feature, [], 0)).toBe(true);
    expect(source.hasFeature(feature)).toBe(false);

    expect(writeClassPoints(source, feature, [3, 4, 5, 6], 2)).toBe(true);
    expect(source.hasFeature(feature)).toBe(true);
    expect(geometry.getFlatCoordinates()).toEqual([3, 4, 5, 6]);

    expect(writeClassPoints(source, feature, [], 0)).toBe(true);
    expect(writeClassPoints(source, feature, [7, 8, 9, 10, 11, 12, 99], 3)).toBe(true);
    expect(geometry.getFlatCoordinates()).toEqual([7, 8, 9, 10, 11, 12]);
    expect(source.getFeatures()).toEqual([feature]);
  });

  it("writes in place into the geometry's live array and fires one change", () => {
    const { source, feature, geometry } = classFeature();
    const live = geometry.getFlatCoordinates();
    let changes = 0;
    geometry.on("change", () => {
      changes++;
    });
    writeClassPoints(source, feature, [1, 2, 3, 4], 2);
    expect(geometry.getFlatCoordinates()).toBe(live);
    expect(changes).toBe(1);
    expect(geometry.getCoordinates()).toEqual([
      [1, 2],
      [3, 4],
    ]);
    // A new extent follows the change (OpenLayers caches it by revision).
    expect(geometry.getExtent()).toEqual([1, 2, 3, 4]);
    writeClassPoints(source, feature, [5, 6], 1);
    expect(changes).toBe(2);
    expect(geometry.getExtent()).toEqual([5, 6, 5, 6]);
  });

  it("does nothing when the points are unchanged, so a paused map is not redrawn", () => {
    const { source, feature, geometry } = classFeature();
    writeClassPoints(source, feature, [1, 2, 3, 4], 2);
    const revision = geometry.getRevision();
    let sourceChanges = 0;
    source.on("change", () => {
      sourceChanges++;
    });
    expect(writeClassPoints(source, feature, [1, 2, 3, 4, 8, 8], 2)).toBe(false);
    expect(geometry.getRevision()).toBe(revision);
    expect(sourceChanges).toBe(0);
    // The same values with a different count is a change.
    expect(writeClassPoints(source, feature, [1, 2, 3, 4, 8, 8], 3)).toBe(true);
  });

  it("is a no-op for a feature without a geometry", () => {
    const source = new VectorSource({ useSpatialIndex: false });
    const feature = new Feature<MultiPoint>();
    expect(writeClassPoints(source, feature, [1, 2], 1)).toBe(false);
    expect(source.hasFeature(feature)).toBe(false);
  });
});
