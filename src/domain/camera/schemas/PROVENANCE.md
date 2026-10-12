# GeoPose.Basic.YPR.Schema.json

Vendored byte for byte. Never fetch it at runtime or in CI; `validateGeoPose` (`../geopose.ts`) imports this file.

| Field | Value |
| ----- | ----- |
| URL | <https://schemas.opengis.net/geopose/1.0/schemata/GeoPose.Basic.YPR.Schema.json> |
| sha256 | `5508d26aed6f546384ac1e1b9d1117f201179a2b32200ad28af3e5209c765640` |
| Size | 969 bytes |
| `Last-Modified` | Wed, 09 Apr 2025 01:48:37 GMT |
| Retrieved | 2026-10-11 |
| Standard | OGC GeoPose 1.0 Data Exchange Standard (OGC 21-056r11), Basic-YPR |

Check the copy with:

```sh
curl -sS -o GeoPose.Basic.YPR.Schema.json https://schemas.opengis.net/geopose/1.0/schemata/GeoPose.Basic.YPR.Schema.json
shasum -a 256 GeoPose.Basic.YPR.Schema.json   # 5508d26aed6f546384ac1e1b9d1117f201179a2b32200ad28af3e5209c765640
```

The four official instances used as test fixtures (`tests/fixtures/geopose/GeoPose.Basic.YPR.Instance.00.json` … `.03.json`, 174, 173, 173 and 174 bytes) come from `https://schemas.opengis.net/geopose/1.0/instances/`, retrieved the same day. Their angles are in radians; the tests use them only as schema checks.

## Licence

Copyright (c) 2022 Open Geospatial Consortium.

The byte-identical copy in <https://github.com/opengeospatial/GeoPose> (`standard/standard/schemata/`) is distributed under the Apache License, Version 2.0 (<https://www.apache.org/licenses/LICENSE-2.0>).

## Warning

Use only this schema. Never use `GeoPose.Basic.Euler.Schema.json`, and never use the draft under the repository's `Data/Schemata`, which names the position `location` instead of `position`.
