// src/ui/StageHint.tsx — [Redesign] a quiet line under the control bar: the colour key (redesign spec section 4, "a
// small legend … under the video") and how to learn what a dot is. Static text; the full key is also in Layers.
export function StageHint() {
  return (
    <p className="stage-hint">
      <span className="stage-hint-key">
        <span>
          <span aria-hidden="true" className="kind-dot kind-iss" /> Space Station
        </span>
        <span>
          <span aria-hidden="true" className="kind-dot kind-satellite" /> Satellites
        </span>
        <span>
          <span aria-hidden="true" className="kind-dot kind-starlink" /> Starlink
        </span>
        <span>
          <span aria-hidden="true" className="kind-dot kind-planet" /> Planets and Moon
        </span>
      </span>
      <span className="stage-hint-tip">Click a dot on the video or the map to see what it is.</span>
    </p>
  );
}
