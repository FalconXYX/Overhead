// src/ui/LayerToggles.tsx — the Layers button and panel (M1 step 15). Each toggle lands with its layer.
import { TRUE_COLOR_INSTRUMENT } from "../app/credits";
import { useActions, useAppState } from "../state/hooks";
import { selectTrueColorDate } from "../state/selectors";
import { gibsStatusText } from "./gibsStatus";

export function LayerToggles() {
  const actions = useActions();
  const open = useAppState((s) => s.ui.panel === "layers");
  const trueColor = useAppState((s) => s.layers.trueColor);
  const coastlines = useAppState((s) => s.layers.coastlines);
  const gibs = useAppState((s) => s.data.gibs);
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
      </section>
    </div>
  );
}
