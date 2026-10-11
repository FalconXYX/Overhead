# scripts/fixtures/iss-pass-skyfield.py: Skyfield reference passes of the ISS over Maunakea (M3 step 4).
#
# Writes tests/fixtures/iss-pass-maunakea.json, the reference for orbits.test.ts "ISS vs Skyfield".
# Run by hand from the repository root, after the CelesTrak snapshot is in tests/fixtures/gp/:
#
#   uv run --with skyfield==1.55 --with sgp4==2.27 python scripts/fixtures/iss-pass-skyfield.py
#
# Generated on 2026-10-11 with Skyfield 1.55 and sgp4 2.27 (uv 0.11.19 resolved numpy 2.5.4 and
# jplephem 2.24 on CPython 3.12.13, macOS arm64) and DE421. It prints
#   3 passes, 93 samples, 31 shadow transitions -> <absolute path of the fixture>
# and two runs give byte-identical output (7,783 bytes).
#
# Inputs: ISS 25544 from tests/fixtures/gp/stations.json; the window start is meta.json
# stations.fetchedAtMs. de421.bsp (17 MB) is read from ~/.cache/skyfield, outside the repository;
# Skyfield downloads it there once if it is missing. CI never runs this script, and it never calls
# CelesTrak. Regenerate the fixture whenever tests/fixtures/gp/ changes.
#
# Output, one line of compact JSON. Times are Unix epoch ms (UTC), angles degrees, range km.
# - generator, skyfield, sgp4, ephemeris, noradId, ommEpoch (the OMM EPOCH string), site, startMs,
#   endMs (startMs + 24 h), minAltDeg, stepSec and columns.
# - passes: one { riseMs, culminationMs, setMs, maxAltDeg } per complete pass above minAltDeg in
#   the window. Times come from find_events, rounded to the ms; maxAltDeg is the highest sampled
#   altitude (the 10 s grid), not the altitude at culminationMs.
# - samples: each pass sampled on the absolute 10 s grid (multiples of 10,000 ms inside
#   [riseMs, setMs]), rows laid out as columns:
#   [timeMs, azDeg, altDeg, rangeKm, subLatDeg, subLonDeg, sunlit]. Altitudes are geometric (no
#   refraction); the sub-point is wgs84.subpoint_of; sunlit is is_sunlit (Sun-centre criterion).
# - shadowTransitions: is_sunlit scanned over [startMs, endMs] at 1 s; one
#   [firstMsOfNewState, newState] row per flip, newState being the sunlit flag (false = entered
#   Earth's shadow).
# Angles are rounded to 1e-5 deg and the range to 1e-4 km. The rounding error (at most 5e-6 deg and
# 5e-5 km) is over 70 times smaller than the smallest difference orbits.test.ts measures against
# satellite.js (sub-point 0.00038 deg, range 0.037 km).
import json
import sys
from datetime import UTC, datetime, timedelta
from pathlib import Path

import sgp4
import skyfield
from skyfield.api import EarthSatellite, Loader, wgs84

ROOT = Path(__file__).resolve().parents[2]
GP_DIR = ROOT / "tests" / "fixtures" / "gp"
OUT_PATH = ROOT / "tests" / "fixtures" / "iss-pass-maunakea.json"
GENERATOR = "scripts/fixtures/iss-pass-skyfield.py"
EPHEMERIS = "de421.bsp"

NORAD_ID = 25544
LAT_DEG = 19.8253  # the Polaris site (README "Fixtures")
LON_DEG = -155.4689
HEIGHT_M = 4204
WINDOW_MS = 86_400_000  # 24 h from stations.fetchedAtMs
MIN_ALT_DEG = 10
STEP_SEC = 10  # pass samples, on the absolute grid
SCAN_STEP_SEC = 1  # is_sunlit scan
COLUMNS = ["timeMs", "azDeg", "altDeg", "rangeKm", "subLatDeg", "subLonDeg", "sunlit"]
DEG_DECIMALS = 5
KM_DECIMALS = 4

UNIX_EPOCH = datetime(1970, 1, 1, tzinfo=UTC)


def ms_to_datetime(ms):
    return UNIX_EPOCH + timedelta(milliseconds=ms)


def time_to_ms(t):
    """A Skyfield Time as the nearest whole Unix millisecond, in integer arithmetic."""
    us = (t.utc_datetime() - UNIX_EPOCH) // timedelta(microseconds=1)
    return (us + 500) // 1000


def rounded(x, decimals):
    """A float rounded for the fixture; -0.0 is written as 0.0."""
    v = round(float(x), decimals)
    return 0.0 if v == 0 else v


def load_iss():
    with open(GP_DIR / "stations.json", encoding="utf-8") as f:
        stations = json.load(f)
    with open(GP_DIR / "meta.json", encoding="utf-8") as f:
        meta = json.load(f)
    matches = [r for r in stations if int(r["NORAD_CAT_ID"]) == NORAD_ID]
    if len(matches) != 1:
        raise SystemExit(f"expected one record for NORAD {NORAD_ID} in stations.json, found {len(matches)}")
    start_ms = meta["stations"]["fetchedAtMs"]
    if not isinstance(start_ms, int):
        raise SystemExit("meta.json stations.fetchedAtMs must be an integer")
    return matches[0], start_ms


def find_passes(sat, site, t0, t1):
    """(rise, culmination, set) Times of every complete pass; passes cut by the window edges are dropped.

    A pass that grazes MIN_ALT_DEG can report two culminations; the higher one is kept.
    """
    times, events = sat.find_events(site, t0, t1, altitude_degrees=MIN_ALT_DEG)  # 0 rise, 1 culmination, 2 set
    passes = []
    rise = None
    culminations = []
    for t, event in zip(times, events):
        if event == 0:
            rise, culminations = t, []
        elif rise is None:
            continue  # culmination or set of a pass already in progress at t0
        elif event == 1:
            culminations.append(t)
        else:
            if culminations:
                alts = [(sat - site).at(c).altaz()[0].degrees for c in culminations]
                passes.append((rise, culminations[alts.index(max(alts))], t))
            rise, culminations = None, []
    return passes


def main():
    omm, start_ms = load_iss()
    end_ms = start_ms + WINDOW_MS

    load = Loader(str(Path.home() / ".cache" / "skyfield"))  # keeps de421.bsp (17 MB) out of the repository
    ts = load.timescale()
    eph = load(EPHEMERIS)
    sat = EarthSatellite.from_omm(ts, omm)
    site = wgs84.latlon(LAT_DEG, LON_DEG, elevation_m=HEIGHT_M)

    t0 = ts.from_datetime(ms_to_datetime(start_ms))
    t1 = ts.from_datetime(ms_to_datetime(end_ms))

    step_ms = STEP_SEC * 1000
    passes = []
    samples = []
    for rise, culmination, set_ in find_passes(sat, site, t0, t1):
        rise_ms = time_to_ms(rise)
        set_ms = time_to_ms(set_)
        grid_ms = list(range(-(-rise_ms // step_ms) * step_ms, set_ms + 1, step_ms))
        t = ts.from_datetimes([ms_to_datetime(ms) for ms in grid_ms])
        alt, az, dist = (sat - site).at(t).altaz()  # geometric: no refraction
        geo = sat.at(t)
        sub = wgs84.subpoint_of(geo)
        lit = geo.is_sunlit(eph)
        for i, ms in enumerate(grid_ms):
            samples.append([
                ms,
                rounded(az.degrees[i], DEG_DECIMALS),
                rounded(alt.degrees[i], DEG_DECIMALS),
                rounded(dist.km[i], KM_DECIMALS),
                rounded(sub.latitude.degrees[i], DEG_DECIMALS),
                rounded(sub.longitude.degrees[i], DEG_DECIMALS),
                bool(lit[i]),
            ])
        passes.append({
            "riseMs": rise_ms,
            "culminationMs": time_to_ms(culmination),
            "setMs": set_ms,
            "maxAltDeg": rounded(max(alt.degrees), DEG_DECIMALS),
        })

    scan_ms = list(range(start_ms, end_ms + 1, SCAN_STEP_SEC * 1000))
    scan_lit = [bool(v) for v in sat.at(ts.from_datetimes([ms_to_datetime(ms) for ms in scan_ms])).is_sunlit(eph)]
    transitions = [[scan_ms[i], scan_lit[i]] for i in range(1, len(scan_ms)) if scan_lit[i] != scan_lit[i - 1]]

    fixture = {
        "generator": GENERATOR,
        "skyfield": skyfield.__version__,
        "sgp4": sgp4.__version__,
        "ephemeris": EPHEMERIS,
        "noradId": NORAD_ID,
        "ommEpoch": omm["EPOCH"],
        "site": {"latDeg": LAT_DEG, "lonDeg": LON_DEG, "heightM": HEIGHT_M},
        "startMs": start_ms,
        "endMs": end_ms,
        "minAltDeg": MIN_ALT_DEG,
        "stepSec": STEP_SEC,
        "columns": COLUMNS,
        "passes": passes,
        "samples": samples,
        "shadowTransitions": transitions,
    }
    text = json.dumps(fixture, separators=(",", ":"), ensure_ascii=False, allow_nan=False) + "\n"
    with open(OUT_PATH, "w", encoding="utf-8", newline="\n") as f:
        f.write(text)
    print(f"{len(passes)} passes, {len(samples)} samples, {len(transitions)} shadow transitions -> {OUT_PATH}")


if __name__ == "__main__":
    sys.exit(main())
