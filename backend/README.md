# ClimateTwin AI backend

## Active product: synthetic flood digital twin

The active Next.js interface uses `demo.py` as its only environmental state
source. No ESP32, ultrasonic reading, physical pump, pipe calibration, cloud
service, or external map is required. All model data and geography are
synthetic. The legacy physical telemetry API remains below for reference but
is **not used by the active interface**.

Run one Uvicorn worker. The demo state is held in memory, protected by a
re-entrant lock, and resets on backend restart. A monotonic wall clock is
converted to one simulated minute per second at 1× speed. Polling from many
clients advances that single clock once under the lock. At 0.5×, 2×, or 4×,
only the conversion rate changes. A paused clock does not advance. The server
does not need a separate timer or any ESP32 POST request.

### Active endpoints

| Endpoint | Purpose |
| --- | --- |
| `GET /api/demo/state?home_id=H2&mode=WALK` | Validated shared snapshot and mode-specific route for a selected illustrative home. |
| `GET /api/demo/history` | Full bounded water-level history. |
| `GET /api/demo/route?home_id=H2&mode=CAR` | Recommended flood-aware route, travel estimate and road-specific margins for a selected home. |
| `GET /api/demo/ai/v1/predictions` | Versioned trained forecasts, model status, prior prediction checks and separate P2 simulation branches. |
| `POST /api/demo/command` | Set weather, speed, pause state, virtual P1/P2 state, or start guided demo. |
| `POST /api/demo/reset` | Reproducible initial clear-weather state. |
| `POST /api/demo/acknowledge` | Acknowledge an in-app event for the management or resident view. |

Commands use exactly the fields for their action. Examples:

```json
{"action":"set_scenario","scenario":"EXTREME"}
{"action":"set_speed","speed":2}
{"action":"set_paused","paused":true}
{"action":"set_pump","pump_id":"P2","on":true}
{"action":"run_demo"}
```

Pump commands require depth above 12 cm and change only virtual model state.
Duplicate or invalid actions return 409 or 422. Role switching is a UI demo,
not authentication; this local API has no production authorization.

### Model assumptions and rules

`ZONE_CONFIG`, `PUMP_CONFIG`, `NODES`, `ROAD_DEFINITIONS`, `HOUSES`, and
`SHELTER` in `demo.py` are the configuration. Map positions are normalized to
0–1, allowing the illustrative SVG to be replaced later without changing the
road graph or routing algorithm. No named real roads or verified shelters are
claimed.

Each simulated minute uses **m³** as the water-balance unit:

`new volume = old volume + rainfall runoff + incoming transfer − base drainage − outgoing transfer − active virtual pump removal`.

Depth in centimetres is `volume × 100 / surface area (m²)`. Rain input in
m³/min is `rainfall (mm/h) × catchment area (m²) × runoff coefficient / 60,000`.
Drain transfers enter the pond with the same volume they leave D1/D2. Water
cannot fall below zero. The model caps depth at 135% of configured capacity
and accounts for excess as synthetic spill. These scaled parameters are for a
coherent demonstration, not calibrated hydrology.

Default capacities are 100 cm per zone. Risk rises at 55% (WATCH), 75%
(WARNING), and 100% (CRITICAL) of capacity. Escalation requires two model
minutes. Downgrades require three and lower bands of 50%, 70%, and 94% to
avoid flicker. Road closures use D1 80 cm, D2 70 cm, and POND 85 cm. A road
reopens only after depth falls 4 cm below its closure rule. These are
configurable **prototype** rules, not real-world flood thresholds.

Recent depth history produces a median pairwise slope in cm per simulated
minute. A numeric threshold ETA requires at least four readings, a rise of
at least 0.25 cm/min, and ongoing synthetic rain of at least 20 mm/h. It
extrapolates the present rate linearly. The 10-minute continuation instead
repeats the same water-balance model while holding current rainfall and pump
settings constant. Neither calculation claims certainty or trained AI accuracy.

The new `flood_eta` is a separate, read-only **40-minute deterministic scenario
projection** to each zone's 75 cm WARNING threshold. It copies current depth,
rainfall and pump states, then follows the selected manual scenario or known
guided schedule with the same 12 mm/h-per-minute rain ramp, water balance and
pump dry-run rule as live ticks. It reports `FLOODED_NOW`, `ESTIMATED`,
`NOT_PREDICTED` (within 40 minutes), or `UNAVAILABLE`. The older
`projected_threshold_minutes` remains a recent-trend extrapolation to the
100 cm capacity rule for backward compatibility. `baseline_forecasts` at
5/10/20 minutes keep current rain and pump settings fixed; they are distinct
from both the scenario projection and the trained ML forecasts. Future manual
commands can change any projected ETA.

Roads are weighted, bidirectional graph edges. Dijkstra excludes blocked
edges; route output contains the exact edge IDs drawn in the map. If all
paths close, it returns the explicit no-route message. Events are created on
meaningful scenario, risk, rapid-rise, road, route, pump, and recovery changes,
not on every poll. Acknowledgement is tracked separately by role.

The township graph has 29 orthogonal street and footpath edges, three prominent
junctions, perimeter
alternatives, a school, four home areas and the existing shelter. All edge
geometry comes from `NODES` and `ROAD_DEFINITIONS` in `demo.py`; the SVG draws
those edges from the API. R18 is the northern pedestrian-only landscaped path. No road
crosses the retention pond. The map is *not surveyed*: normalized width 1.0
represents an illustrative 700 m, height 1.0 represents 448 m. Each edge's
`distance_m` is the sum of its polyline segment lengths in that scale. Base
walking speed is 72 m/min (1.2 m/s), with an illustrative 1.08 factor on
main/perimeter links and 0.92 on residential links. Playback speed never
changes walking estimates; one simulated forecast minute is compared with one
illustrative physical walking minute only for this prototype route assessment.
`mode=WALK|CAR|MOTORCYCLE` defaults to WALK on both state and route endpoints.
Vehicle speeds are illustrative 300 m/min (18 km/h) for a car and 360 m/min
(21.6 km/h) for a motorcycle, with 0.18 and 0.12 travel minute per edge for
junction/turn delay respectively. These constants are in `MODE_SPEED_M_MIN`
and `JUNCTION_DELAY_MIN` and returned in `time_model`. Both vehicle modes
exclude R18. `travel_minutes` is independent of playback speed; the legacy
`walk_minutes` field remains the walking estimate on every route. Home symbols
are offset into their residential blocks from their graph access nodes; these
short access walks are not included in route distance or duration.

`route_options` deduplicates lowest-exposure recommended, fastest, shortest,
and one spur alternative where useful. Dijkstra-style search excludes closed
edges and rejects any edge whose linked-zone closure rule is projected to fire
by the time a walker finishes it. Safest scoring sums `edge distance / 100 ×
(current zone depth / road hazard depth)²`, with a 0.5-point penalty per minute
of closure margin below 10 minutes. Fastest minimizes walking minutes; shortest
minimizes metres. A route margin is the minimum *road-specific* closure ETA
minus arrival time at the end of that road, never the township-wide minimum.
`WINDOW_CLEAR` means no route road is projected to close in the 40-minute
window, not that the route is verified safe. Road `AT_RISK` means closure is
projected within 20 minutes or the linked zone is within 8 cm of its road
hazard rule. All road ETAs inherit a zone depth; no street-level sensor exists.

`pump_outlooks` projects P1 and P2 OFF/ON branches for 20 minutes from copied
state and reports their own zone depth, warning ETA and linked road closures.
The same 4 cm road reopening buffer is applied in these branches. The existing
trained-AI endpoint continues to provide its independent P2 intervention
comparison. Neither preview switches a live pump. P1 removes up to 0.80
m³/min from D1; P2 removes up to 1.20 m³/min from D2. Pumped water is removed
from this model, not transferred to the pond. Both stop at or below 12 cm.

The guided scenario begins clear, transitions through moderate and heavy rain,
peaks at extreme rain, and then subsides. It **does not** turn on a pump for
the presenter. Activating P2 manually changes the same balance used by depth,
forecast, road, and route calculations. At 1×, approximately 100–120 seconds
of active polling shows escalation and recovery; the exact timing depends on
when the virtual pump is switched on.

### Offline trained flood intelligence

Install `requirements.txt`, then reproduce the checked-in model and evaluation:

```powershell
.\.venv\Scripts\python.exe train_ai.py
```

The trainer generates 120 isolated 105-minute episodes with varied rainfall
patterns, initial levels, pump timing, and offline drainage factors. Each step
uses the same `_balance` function as the live simulator. Features contain only
current and past levels, current rainfall and target, current pump states,
configured zone variables and drainage factors. Later weather or interventions
are never passed to the model as features. Complete episodes are split 96/24
between training and testing with seed 20261019. Three
`HistGradientBoostingRegressor` models predict 5, 10 and 20-minute levels;
three classifiers predict whether 100 cm is reached within each horizon.
The live drainage factor is 1.0. Training-time restrictions do not change
the live engine configuration.

The saved artifact is `models/flood_ai_v1.joblib`; the reproducible report is
`models/evaluation.json`. The checked-in evaluation on 3,096 held-out
zone/time rows per horizon is:

| Horizon | ML level MAE | Fixed-rainfall simulation MAE | Threshold precision | Threshold recall | Brier score |
| --- | ---: | ---: | ---: | ---: | ---: |
| 5 min | 2.734 cm | 0.555 cm | 0.9917 | 0.9927 | 0.0034 |
| 10 min | 3.658 cm | 1.915 cm | 0.9806 | 0.9787 | 0.0092 |
| 20 min | 6.729 cm | 6.268 cm | 0.9340 | 0.9460 | 0.0299 |

The deterministic continuation is more accurate overall on this held-out
synthetic set, especially at short horizons. That is expected because the
training labels come from the same known balance and many episodes maintain
rainfall. The trained model is shown separately, never substituted for that
continuation. Its threshold score is a synthetic-data model output, not a
validated real-world flood probability. The UI uses a categorical outlook and
shows held-out error statistics instead of arbitrary confidence percentages.
The table's threshold precision and recall include inputs already above
100 cm. Among the 2,206 held-out rows starting below 100 cm, the 10-minute
new-crossing prevalence was 0.0657, precision 0.8601, and recall 0.8483.
The full horizon and zone breakdown is in `models/evaluation.json`.

The prediction service loads the artifact once at application startup. If it
is missing or incompatible, the API returns `status: unavailable` and a reason
with no fabricated ML values. Unsupported features return `status: unsupported`.
Restart an already-running backend after training or replacing the artifact.
Ten-minute predictions are retained in server memory and matched to later
simulated levels as they arrive. This comparison history resets with the demo
and does not survive a server restart.

The P2 OFF/ON comparison is a separate, non-mutating 20-minute branch of the
deterministic simulator. It uses the known guided schedule, or the selected
manual scenario, and holds other controls fixed. Road and central-home route
outcomes are recalculated. It is not a machine-learning prediction. The
displayed feature factors are zone-specific held-out permutation importance
for the 10-minute level model, with current values for context. Shuffling
importance describes model reliance, not causation for an individual forecast.

All metrics describe synthetic scenarios generated from an illustrative
simulator. No real-world accuracy, hydrological calibration, or verified safety
guidance is claimed.

### Active test commands (run manually)

```powershell
cd backend
.\.venv\Scripts\python.exe -m unittest discover -s tests -v
.\.venv\Scripts\python.exe -m uvicorn main:app --host 0.0.0.0 --port 8000
```

The Next.js server uses `FASTAPI_BASE_URL` (default
`http://127.0.0.1:8000`) through same-origin API proxies. For a phone demo,
bind Next.js to the laptop's network interface and use its LAN address on the
phone; local firewall and hotspot settings must allow access. Use one backend
process so every client sees the same in-memory state.

## Management sign-in and public Resident Safety

The current website uses `/` for entry, `/login` for Management sign-in,
`/management` for the protected dashboard, and `/resident` for public safety
information. FastAPI is the single in-memory authority; run **one Uvicorn
worker**. Management sessions are stored in process memory for eight hours,
are carried by an HttpOnly, SameSite=Lax cookie, and use a session-bound CSRF
token for mutations. HTTPS requests set Secure cookies. A backend restart
expires all sessions. Ten failed sign-ins from one source within five minutes
temporarily block further attempts. No account exists until credentials are
configured.

For local development, configure the Management account once from `backend`.
The script prompts for the password twice and writes a salted PBKDF2 hash to
`backend/.env`; the password itself is never saved. This file is ignored by Git.

```powershell
.\.venv\Scripts\python.exe setup_management.py your-management-name
```

On later starts, launch FastAPI normally, without setting environment variables:

```powershell
.\.venv\Scripts\python.exe -m uvicorn main:app --host 127.0.0.1 --port 8000
```

The backend resolves `.env` relative to its own Python module, so credentials
load even if Uvicorn is started from another working directory with
`--app-dir` pointing to `backend`. Explicit `CLIMATETWIN_MANAGEMENT_USERNAME`
and `CLIMATETWIN_MANAGEMENT_PASSWORD_HASH` process variables override the
local file when intentionally supplied for deployment. Restart FastAPI after
changing `.env`. To check for an older server before starting another, run
`Get-NetTCPConnection -State Listen -LocalPort 8000 | Select-Object LocalPort,OwningProcess`
and inspect the PID with `Get-CimInstance Win32_Process -Filter "ProcessId = <PID>"`.
Stop the terminal running that process with Ctrl+C, or use
`Stop-Process -Id <PID>` after confirming it is this project's Uvicorn process.
Only one backend should listen on port 8000.

Do not put the password or hash in frontend source or commit it to Git. For a
LAN phone demo, bind FastAPI to `127.0.0.1` and expose only Next.js on the LAN.
Use HTTPS if exposing the site beyond a trusted local demo network.

Public `GET /api/resident/state` returns current home, drainage, road, shelter,
route, map and resident alert data. Its `forecast` field contains only trained
ML water-depth predictions for D1, D2 and POND at +10 and +20 simulated
minutes, with status and simulation timestamp. Current depths remain available
when the trained forecast is unavailable. Management read endpoints
`/api/demo/state`, `/api/demo/history`, `/api/demo/route`,
`/api/demo/ai/v1/predictions`, `/api/telemetry/latest`, and
`/api/intelligence` require a valid session. Management mutations
`/api/demo/command`, `/api/demo/reset`, `/api/demo/acknowledge`, and
`/api/telemetry` require the session and matching `X-CSRF-Token`. Authentication
routes are `/api/auth/login`, `/api/auth/session`, and `/api/auth/logout`.
Logout also requires CSRF. The legacy telemetry API remains available to
signed-in Management only.

Install `requirements-dev.txt` to run the complete suite, including API tests:

```powershell
.\.venv\Scripts\python.exe -m pip install -r requirements-dev.txt
.\.venv\Scripts\python.exe -m unittest discover -s tests -v
```

In another terminal, start Next.js from `frontend` with `npm.cmd run dev`.
Open `http://localhost:3000/management`, sign in, and start the guided demo.
Open `http://localhost:3000/resident` in another tab to watch the same
simulation. A second tab in the same browser shares cookies, so use a private
browser session to verify that `/management` redirects to `/login` and that
management mutation calls are rejected while public resident reads succeed.
Resident home and mode choices are stored per browser tab in session storage.

## Legacy IoT endpoints (inactive in the current product)

This FastAPI service accepts distance readings in centimetres from ESP32 B's
three ultrasonic positions: D1, D2, and POND. It retains the latest accepted
packet per channel for the original telemetry API and a bounded physical-only
history for rule-based flood analysis. Restarting the server clears both stores
and the warning transition log. Use one Uvicorn worker so these stores remain
consistent. Pump control, notification delivery, and trained prediction models
are not implemented.

## Run on the laptop (PowerShell)

Open PowerShell in the project root and run these commands manually:

```powershell
cd .\backend
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe -m uvicorn main:app --host 0.0.0.0 --port 8000
```

The existing `backend/.venv` is used, so activation is unnecessary. Keep this
PowerShell window open while testing. `0.0.0.0` binds the server to the laptop's
network interfaces; it is not the address to put in an ESP32 request.

From a second PowerShell window, test the API on the laptop:

```powershell
Invoke-RestMethod -Uri 'http://localhost:8000/health'
Invoke-RestMethod -Uri 'http://localhost:8000/api/telemetry/latest' | ConvertTo-Json -Depth 5
Invoke-RestMethod -Uri 'http://localhost:8000/api/intelligence' | ConvertTo-Json -Depth 8

$body = @{ sensor_id = 'D1'; distance_cm = 12.3; simulated = $true } | ConvertTo-Json
Invoke-RestMethod -Uri 'http://localhost:8000/api/telemetry' -Method Post -ContentType 'application/json' -Body $body | ConvertTo-Json -Depth 5
Invoke-RestMethod -Uri 'http://localhost:8000/api/telemetry/latest' | ConvertTo-Json -Depth 5
```

The `12.3` cm value above is arbitrary **simulated test data**, not a physical
measurement. A successful POST prints that reading in the server's PowerShell
window. The API documentation is at `http://localhost:8000/docs`.

## ESP32 B request format

When the laptop and ESP32 are on the Android hotspot, ESP32 B can POST to:

```text
http://10.170.154.37:8000/api/telemetry
```

The IP address is the laptop's current hotspot address and may change after a
reconnect. It is not configured in the FastAPI source. Use this JSON format for
one sensor reading per request:

```json
{
  "sensor_id": "D1",
  "distance_cm": 12.3,
  "simulated": true
}
```

Use `"D1"`, `"D2"`, or `"POND"` exactly. The distance must be a finite,
nonnegative JSON number in centimetres. Set `simulated` to `true` for generated
test values and `false` only for readings from an attached sensor. The server
adds `received_at_utc`; clients should not send a timestamp. Invalid requests
receive HTTP 422 with validation details and do not change stored readings.

Successful POST response:

```json
{
  "status": "accepted",
  "reading": {
    "sensor_id": "D1",
    "distance_cm": 12.3,
    "simulated": true,
    "received_at_utc": "2026-10-19T00:00:00Z"
  }
}
```

The timestamp above illustrates the response format; the server supplies the
actual UTC time. `GET /api/telemetry/latest` returns a `readings` object with
`D1`, `D2`, and `POND` keys. Each value is its latest reading, or `null` until
that sensor has sent a valid reading. `GET /health` returns `{"status":"ok"}`.

The Next.js frontend runs separately on port 3000 and reads both
`/api/telemetry/latest` and `/api/intelligence` through server-side proxies.

## Calibration and physical limits

`intelligence.py` contains one independent `SensorCalibration` entry for each
channel in `SENSOR_CALIBRATIONS`. All three are initially **UNCONFIGURED**.
This avoids assigning the known pipe geometry to a channel without evidence.
The `PIPE_50_40_PROPOSAL` template is sensor height 50 cm, overflow height
40 cm, and minimum reliable distance 25 cm. Its status is **UNVERIFIED**.
After identifying which channel is mounted on that pipe, assign the proposal
to that channel only. Keep `verified=False` until ruler measurements confirm
the sensor face, bottom, overflow outlet, and actual water depth at several
levels. Then set `verified=True` for that channel. Configure other channels
from their own measurements. Restart FastAPI after configuration changes.

For a verified sensor with a valid physical distance, depth is
`sensor_height_cm - distance_cm`, and fill is
`depth / overflow_height_cm × 100`. A missing, stale, non-finite, negative,
out-of-range, blind-zone, or abrupt spike reading produces no depth or fill.
The telemetry ingress rejects non-finite and negative JSON values with 422;
analysis performs its own validation. A reading becomes stale after 10 seconds
without a new physical packet. At distances below the configured minimum,
depth and fill become unknown. They are never silently set to zero or 100%.

The JSN-SR04T's typical blind zone is about 20–25 cm. With a sensor face 50 cm
above the bottom and a 25 cm minimum distance, only depths up to 25 cm are
directly observable; the 40 cm overflow opening lies beyond that range.
Furthermore, a 3 cm diameter pipe can generate wall echoes even for distances
that pass range checks. Ruler verification and independent physical checks are
essential. The calculation does not prove overflow.

## Explainable analysis and warning rules

The engine keeps at most 120 physical readings per channel. It uses valid
readings from the last 45 seconds to calculate a Theil–Sen median pairwise
slope in cm/min. A trend requires at least five samples spanning at least
20 seconds. Rates below 0.5 cm/min in magnitude are classified STABLE. A
numeric overflow ETA additionally requires a verified calibration, fresh valid
reading, rising rate of at least 1 cm/min, first-half to second-half median
distance decrease of at least 0.8 cm, and positive movement in at least 60%
of adjacent steps. ETA is `(overflow_height - current_depth) / rise_rate`.
It is a linear extrapolation, not an exact flood prediction; the outlet can
change the actual rate, and the ETA can extend into the sensor's blind zone.
An 8 cm or larger jump against the median of three recent valid distances
within five seconds is marked SPIKE and excluded from depth and trend analysis.

Prototype warning thresholds, based on verified fill or credible ETA:
The defaults are in `WarningThresholds` in `intelligence.py` and can be
changed as a coherent set; construction rejects inverted thresholds.

| State | Rule |
| --- | --- |
| NORMAL | Fill below 50% and no ETA within 10 minutes. |
| WATCH | Fill at least 50% or ETA at most 10 minutes. |
| WARNING | Fill at least 75% or ETA at most 5 minutes. |
| CRITICAL | Fill at least 90% or ETA at most 2 minutes. This is **not** confirmed overflow. |
| UNKNOWN | Missing, stale, unreliable, or unverified reading/calibration. This takes precedence. |

The engine needs two consecutive physical assessments to raise a warning and
three to lower one. It changes to UNKNOWN immediately when quality or
calibration fails. While a higher warning awaits its second reading, the
presented state is UNKNOWN instead of showing the previous lower state. State
transitions are recorded in a bounded 50-entry log.
Township-wide status is UNKNOWN if any channel is UNKNOWN, so incomplete sensor
coverage is visible. These thresholds are prototype demo rules; they have not
been scientifically validated for real-world flood decisions.

`GET /api/intelligence` returns a server timestamp, overall state, coverage
flag, per-sensor raw physical distance, validated depth and fill when available,
rise rate, trend, ETA or `null`, quality, calibration status, explanation,
recommendation, short depth history, and status transitions. It does not change
the ESP32 POST payload or the two existing telemetry endpoints. Simulated POSTs
still appear in `/api/telemetry/latest` but never enter the physical analysis.
The output is ready to be linked to verified road zones, resident alerts, and
response workflows in a later stage; no locations, routing, notifications, or
physical pump actions are inferred here.

## Run focused tests

From `backend`, run manually:

```powershell
.\.venv\Scripts\python.exe -m unittest discover -s tests -v
```
