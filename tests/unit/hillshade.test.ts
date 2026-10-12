// tests/unit/hillshade.test.ts — M6 step 11.1: the hillshade layer builds in Node over a z15 ImageTile source, its full
// style parses into GLSL (the GPU compile is covered by terrain.spec.ts), and an undeclared style variable throws on
// the first render, not in the constructor (M6 gotcha 12).
import WebGLTileLayer from "ol/layer/WebGLTile";
import ImageTile from "ol/source/ImageTile";
import { describe, expect, it } from "vitest";
import { TERRARIUM_URL } from "../../src/domain/terrain";
import {
  COS_INCIDENCE,
  createHillshadeLayer,
  NIGHT_SUN_ALT_DEG,
  NIGHT_SUN_AZ_DEG,
} from "../../src/map/ground/layers/hillshade";

/** Every ["var", name] in an expression. */
function variablesOf(expression: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(expression)) {
    if (expression[0] === "var" && typeof expression[1] === "string") out.add(expression[1]);
    for (const part of expression) variablesOf(part, out);
  }
  return out;
}

/** Every operator name in an expression. */
function operatorsOf(expression: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(expression)) {
    if (typeof expression[0] === "string") out.add(expression[0]);
    for (const part of expression) operatorsOf(part, out);
  }
  return out;
}

describe("createHillshadeLayer", () => {
  it("builds in Node: hidden, ImageTile over Terrarium, max zoom 15, nearest sampling", () => {
    const { layer, source } = createHillshadeLayer();
    expect(layer).toBeInstanceOf(WebGLTileLayer);
    expect(source).toBeInstanceOf(ImageTile);
    expect(layer.getSource()).toBe(source);
    expect(layer.getVisible()).toBe(false);
    expect(source.getTileGrid()?.getMaxZoom()).toBe(15); // z16 returns 404
    expect(source.getInterpolate()).toBe(false);
    expect(TERRARIUM_URL).toContain("/terrarium/{z}/{x}/{y}.png");
    layer.dispose();
  });

  it("createRenderer parses the full style into GLSL without throwing", () => {
    const { layer } = createHillshadeLayer();
    expect(() => layer.createRenderer()).not.toThrow();
    layer.dispose();
  });

  it("COS_INCIDENCE uses only the declared variables, and no atan or '^' (SwiftShader, gotcha 11)", () => {
    expect([...variablesOf(COS_INCIDENCE)].sort()).toEqual([
      "sunAltDeg",
      "sunAzDeg",
      "texelGroundM",
    ]);
    const ops = operatorsOf(COS_INCIDENCE);
    expect(ops.has("atan")).toBe(false);
    expect(ops.has("^")).toBe(false);
    expect([NIGHT_SUN_AZ_DEG, NIGHT_SUN_ALT_DEG]).toEqual([315, 45]);
  });

  it("an undeclared ['var', 'nope'] throws from createRenderer, not from the constructor", () => {
    const { source } = createHillshadeLayer();
    let layer: WebGLTileLayer | null = null;
    expect(() => {
      layer = new WebGLTileLayer({
        source,
        style: {
          variables: { sunAzDeg: 315 },
          color: ["color", ["*", 255, ["clamp", ["var", "nope"], 0, 1]], 1],
        },
      });
    }).not.toThrow();
    expect(() => (layer as WebGLTileLayer | null)?.createRenderer()).toThrow(
      "Missing 'nope' in style variables",
    );
  });
});
