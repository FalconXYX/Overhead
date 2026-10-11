// src/ui/LayerToggles.tsx — the Layers button and panel (M1 step 15). Each toggle lands with its layer.
import { TRUE_COLOR_INSTRUMENT } from "../app/credits";
import { useActions, useAppState } from "../state/hooks";
import { selectTrueColorDate } from "../state/selectors";
import { skyCache, starCountForLimit } from "../state/skyCache";
import type { LayerToggle, LoadStatus } from "../state/types";
import { gibsStatusText } from "./gibsStatus";

/** The sky view's toggles (M2), in panel order. */
const SKY_TOGGLES: readonly { key: LayerToggle; label: string }[] = [
  { key: "stars", label: "Stars" },
  { key: "planets", label: "Sun, Moon and planets" },
  { key: "grid", label: "Alt/az grid" },
];

/** "V ≤ 4.5 (904 stars)" once the catalogue is ready. Reads skyCache during render (React rule 5). */
function starLimitText(limit: number, stars: LoadStatus): string {
  if (stars === "ready") {
    const count = starCountForLimit(skyCache.rows, limit);
    return `V ≤ ${limit} (${count} ${count === 1 ? "star" : "stars"})`;
  }
  if (stars === "error") return `V ≤ ${limit} (star catalogue failed to load)`;
  return `V ≤ ${limit} (loading star catalogue)`;
}

export function LayerToggles() {
  const actions = useActions();
  const open = useAppState((s) => s.ui.panel === "layers");
  const trueColor = useAppState((s) => s.layers.trueColor);
  const coastlines = useAppState((s) => s.layers.coastlines);
  const gibs = useAppState((s) => s.data.gibs);
  const layers = useAppState((s) => s.layers);
  // Re-renders when the catalogue arrives, so the star count follows it.
  const stars = useAppState((s) => s.data.stars);
  const limitText = starLimitText(layers.starMagLimit, stars);
  // The requested date: after a tile-error revert the map may show an earlier one (DECISIONS, M1).
  const date = useAppState(selectTrueColorDate);
  const gibsText = gibsStatusText(gibs);
  const disabled = gibs !== "ready";

  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        aria-controls="layers-panel"
        onClick={() => actions.togglePanel("layers")}
      >
        Layers
      </button>
      <section id="layers-panel" aria-label="Layers" hidden={!open}>
        {gibsText === null ? null : <p>{gibsText}</p>}
        <p>
          <label>
            <input
              type="checkbox"
              checked={trueColor}
              disabled={disabled}
              onChange={() => actions.toggleLayer("trueColor")}
            />
            {date === null
              ? `True colour (${TRUE_COLOR_INSTRUMENT})`
              : `True colour (${TRUE_COLOR_INSTRUMENT}, ${date})`}
          </label>
        </p>
        <p>
          <label>
            <input
              type="checkbox"
              checked={coastlines}
              disabled={disabled}
              onChange={() => actions.toggleLayer("coastlines")}
            />
            Coastlines and place labels
          </label>
        </p>
        {SKY_TOGGLES.map(({ key, label }) => (
          <p key={key}>
            <label>
              <input
                type="checkbox"
                checked={layers[key]}
                onChange={() => actions.toggleLayer(key)}
              />
              {label}
            </label>
          </p>
        ))}
        <p>
          <label htmlFor="star-mag-limit">Star magnitude limit</label>{" "}
          {/* keyboard.ts ignores keys typed into an input, so the arrow keys move this, not the clock. */}
          <input
            id="star-mag-limit"
            type="range"
            min={1}
            max={6.5}
            step={0.5}
            value={layers.starMagLimit}
            aria-valuetext={limitText}
            onChange={(e) => actions.setStarMagLimit(Number(e.currentTarget.value))}
          />{" "}
          <output htmlFor="star-mag-limit">{limitText}</output>
        </p>
      </section>
    </div>
  );
}
