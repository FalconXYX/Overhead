import type LineString from "ol/geom/LineString";
import { fromLonLat } from "ol/proj";
import { describe, expect, it } from "vitest";
import { createTracksLayer, writeTracks } from "../../src/map/ground/layers/tracks";
import { WORLD_WIDTH_M } from "../../src/map/pick";
import type { TrackOut } from "../../src/workers/protocol";

const track = (index: number, lonLat: number[]): TrackOut => ({
  index,
  firstPointMs: 0,
  lonLatDeg: Float64Array.from(lonLat),
});

describe("ground tracks layer", () => {
  it("draws one LineString per track in EPSG:3857, keeping unwrapped longitudes past ±180°", () => {
    const tracks = createTracksLayer();
    writeTracks(
      tracks,
      new Map([
        [4, track(4, [179, 10, 181.5, 11, 184, 12])],
        [7, track(7, [-20, 0, -19, 0.5])],
      ]),
      4,
    );
    const features = tracks.source.getFeatures();
    expect(features.length).toBe(2);
    const byIndex = new Map(features.map((f) => [f.get("index"), f]));
    const crossing = byIndex.get(4);
    const coords = (crossing?.getGeometry() as LineString | undefined)?.getCoordinates() ?? [];
    expect(coords.length).toBe(3);
    const expected = [fromLonLat([179, 10]), fromLonLat([181.5, 11]), fromLonLat([184, 12])];
    coords.forEach((c, i) => {
      expect(c[0]).toBeCloseTo(expected[i]?.[0] ?? Number.NaN, 6);
      expect(c[1]).toBeCloseTo(expected[i]?.[1] ?? Number.NaN, 6);
    });
    // Past the antimeridian: x beyond half a world, not wrapped back (gotcha 12).
    expect(coords[2]?.[0]).toBeGreaterThan(WORLD_WIDTH_M / 2);
    expect(crossing?.get("selected")).toBe(true);
    expect(byIndex.get(7)?.get("selected")).toBe(false);
  });

  it("skips tracks with fewer than two points and replaces the previous tracks", () => {
    const tracks = createTracksLayer();
    writeTracks(tracks, new Map([[1, track(1, [0, 0, 1, 1])]]), null);
    writeTracks(
      tracks,
      new Map([
        [2, track(2, [5, 5])],
        [3, track(3, [])],
      ]),
      null,
    );
    expect(tracks.source.getFeatures()).toEqual([]);
  });

  it("keeps the canvas source's default wrapX", () => {
    expect(createTracksLayer().source.getWrapX()).toBe(true);
  });
});
