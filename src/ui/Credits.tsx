// src/ui/Credits.tsx — every credit, on screen at all times, outside every pane and panel (README Credits).
// (<footer aria-label> fails Biome's useAriaPropsSupportedByRole, so this is a labelled section.)
import { dataCredits, starCredits, TRUE_COLOR_INSTRUMENT } from "../app/credits";
import { useAppState } from "../state/hooks";
import { selectActiveCamera, selectTrueColorDate } from "../state/selectors";
import type { Credit } from "../state/types";

function ExternalLink({ href, children }: { href: string; children: string }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  );
}

function CreditLine({ credit }: { credit: Credit }) {
  return (
    <>
      {credit.href === null ? (
        credit.text
      ) : (
        <ExternalLink href={credit.href}>{credit.text}</ExternalLink>
      )}
      {credit.licence === null ? null : (
        <>
          {" ("}
          {credit.licenceHref === null ? (
            credit.licence
          ) : (
            <ExternalLink href={credit.licenceHref}>{credit.licence}</ExternalLink>
          )}
          {")"}
        </>
      )}
    </>
  );
}

export function Credits() {
  const camera = useAppState(selectActiveCamera);
  const layers = useAppState((s) => s.layers);
  const gibsReady = useAppState((s) => s.data.gibs === "ready");
  const date = useAppState(selectTrueColorDate);
  // dataCredits and starCredits return new arrays: called during render, never inside useAppState (React rule 6).
  const credits = dataCredits(layers, gibsReady);
  const stars = starCredits(layers.stars);

  return (
    <section aria-label="Credits">
      <h2>Credits</h2>
      <ul>
        {camera === undefined ? null : (
          <li>
            <CreditLine credit={camera.credit} />
            {camera.termsNote === "" ? null : ` — ${camera.termsNote}`}
          </li>
        )}
        {credits.map((credit) => (
          <li key={credit.text}>
            <CreditLine credit={credit} />
          </li>
        ))}
        {gibsReady && layers.trueColor && date !== null ? (
          <li>{`Imagery: ${TRUE_COLOR_INSTRUMENT}, ${date}`}</li>
        ) : null}
        {stars.map((credit) => (
          <li key={credit.text}>
            <CreditLine credit={credit} />
          </li>
        ))}
      </ul>
    </section>
  );
}
