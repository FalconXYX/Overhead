// src/ui/Credits.tsx — every credit in use (README Credits). [Redesign] One [Credits] button, always in the header,
// opens the full list (redesign spec section 5): the camera's credit and terms first, then GIBS, OSM, CelesTrak, the
// star catalogue and names, and the terrain sources. Nothing else about credits is on screen. The list stays in the
// DOM while closed (hidden), so it is the same list either way.
import { useState } from "react";
import {
  dataCredits,
  GOES_SUBTITLE,
  starCredits,
  TERRAIN_CREDIT,
  TERRAIN_SOURCE_STATEMENTS,
  TRUE_COLOR_INSTRUMENT,
  terrainInUse,
} from "../app/credits";
import { useAppState } from "../state/hooks";
import { selectActiveCamera, selectHorizonStatus, selectTrueColorDate } from "../state/selectors";
import type { Credit } from "../state/types";
import { Popover } from "./Popover";

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
  // [M6] The full "Required attribution" block while terrain data is in use (README Credits).
  const horizonStatus = useAppState(selectHorizonStatus);
  const terrain = terrainInUse(layers.hillshade, horizonStatus);
  const [open, setOpen] = useState(false);

  return (
    <Popover
      label="Credits"
      title="Credits"
      open={open}
      onOpenChange={setOpen}
      className="credits"
      buttonClassName="header-button"
    >
      <h2 className="popover-title">Credits</h2>
      <ul className="credits-list">
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
        {gibsReady && layers.goesIr ? (
          <li>{`Imagery: ${GOES_SUBTITLE}, Band 13 Clean Infrared`}</li>
        ) : null}
        {stars.map((credit) => (
          <li key={credit.text}>
            <CreditLine credit={credit} />
          </li>
        ))}
        {terrain ? (
          <li>
            <CreditLine credit={TERRAIN_CREDIT} />
            <ul>
              {TERRAIN_SOURCE_STATEMENTS.map((statement) => (
                <li key={statement}>{statement}</li>
              ))}
            </ul>
          </li>
        ) : null}
      </ul>
    </Popover>
  );
}
