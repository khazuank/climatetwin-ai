# ClimateTwin AI — synthetic flood digital twin

The active product is a shared, fully synthetic township flood demonstration.
FastAPI owns the clock, weather, water balance, risk, roads, virtual pumps,
events, and acknowledgements. A separate scikit-learn model trained on synthetic
episodes predicts future zone levels and threshold exceedance. Next.js renders
management and resident views of the same server state. No ESP32, ultrasonic
sensor, physical pump, pipe calibration, real map, or cloud service is needed.

All depths, forecasts, warnings, geography, shelters, and routes are
**illustrative simulation output**. They are not validated flood warnings or
safe evacuation guidance. The trained model has no real-world validation.

## Run locally (PowerShell, manually)

Configure Management credentials once as described in `backend/README.md`.
On every later start, run the backend without setting credentials again:

```powershell
cd backend
.\.venv\Scripts\python.exe -m uvicorn main:app --host 127.0.0.1 --port 8000
```

Start Next.js from a second window:

```powershell
cd frontend
npm.cmd run dev
```

Open `http://localhost:3000`. Choose Management Sign In or continue directly
to public Resident Safety. The default same-origin proxy connects to
`http://127.0.0.1:8000`. If FastAPI uses another address, set
`FASTAPI_BASE_URL` for the Next.js server and restart Next.js. The browser
never calls FastAPI directly. Use a single Uvicorn worker: all state is
in-memory and belongs to that process.

For a phone on the same local network, start Next.js with a network bind:

```powershell
npm.cmd run dev -- --hostname 0.0.0.0
```

Open the laptop's LAN address on the phone, subject to local firewall and
hotspot settings. Both devices will poll the same backend simulation. Keep
FastAPI bound to loopback and use HTTPS if the site is exposed beyond the
trusted local demo network.

For the two-interface demonstration, sign in at `/management` on one tab,
open `/resident` in another, select a home and travel mode, then change
rainfall, operate a virtual pump when water is above its dry-run threshold,
or reset from Management. The public page updates automatically. To test
access control, use a **private browser session** for `/resident` and direct
management API calls; ordinary tabs share authentication cookies.

## Guided 60–120 second demonstration

1. In **Management**, select **Start guided flood demo**. This resets and starts the
   reproducible guided weather sequence. Simulated time is labelled separately
   from wall time. Default speed is one simulated minute per second; 2× and 4×
   are available under **Scenario studio and playback controls**.
2. In the **AI Intelligence Centre**, choose D1, D2, or POND. Compare the
   actual simulated level with trained 5, 10, and 20-minute forecasts and the
   100 cm threshold outlook. Each horizon also shows a fixed-rainfall model
   baseline. The chart separates observations from ML forecasts; earlier
   10-minute predictions are checked against later simulated levels. The
   model evaluation honestly shows lower water-level MAE for the baseline.
3. The map's D2 countdown is a **deterministic scenario projection** to the
   75 cm warning rule, not an ML prediction. Select a road to inspect its own
   linked-zone closure estimate. As the guided storm develops, roads become
   at risk and then close under their separate road hazard rules.
4. Open **Resident safety** and select Central homes (H2). Compare the
   lowest-exposure recommended route with the fastest path and any distinct
   alternative. Inspect metres, walking minutes and road-specific closure
   margin. The selected route is highlighted on the same API-driven map.
5. Return to Management. Compare the **P2 OFF** and **P2 ON** 20-minute
   simulation branches, which do not change live state. When the rule-based
   recommendation proposes P2, switch it **on**. Its removal capacity changes
   D2's later trajectory; it does not control hardware. Pump cards also show
   non-mutating OFF/ON outlooks for P1 and P2.
6. Let the scripted rain subside. Observe drainage, road reopening, route
   changes, alerts, and recovery in the activity timeline and observed-outcome
   panel. Acknowledge an in-app notification. Pause or reset at any time.

The four manual weather buttons can replace the guided sequence at any point.
P1 drains D1; P2 drains D2. Both have dry-run protection. The resident view
does not expose pump controls. Switching roles is a demonstration convenience,
not authentication or production authorization.

## Architecture

- `backend/demo.py`: one locked synthetic engine, scaled water-volume balance,
  scenarios, risk persistence, graph routing, virtual pumps, and event log.
- `backend/train_ai.py` and `backend/ai_features.py`: reproducible offline
  training episodes, complete-scenario holdout, gradient-boosting models,
  baseline evaluation, and permutation importance. Artifacts are in
  `backend/models/`.
- `backend/ai_service.py`: trained inference, recorded prediction checks, and
  non-mutating P2 simulation branches. Missing models have an explicit status.
- `backend/demo_api.py`: validated request and response contracts. `backend/main.py`
  exposes the demo endpoints alongside isolated legacy telemetry endpoints.
- `src/app/api/demo/[...path]/route.ts`: uncached same-origin proxy to FastAPI.
- `src/lib/demo.ts` and `src/lib/demo-client.ts`: browser contract validation
  and API client.
- `src/components/demo-provider.tsx`: one polling and action layer for both
  roles. Commands are confirmed by the backend before the UI changes.
- `src/components/demo-ai-centre.tsx`: trained forecasts, chart, evaluation
  context, and separately labelled intervention branches.
- `src/components/demo-dashboard.tsx`, `demo-map.tsx`, `src/app/demo.css`, and
  `src/app/demo-redesign.css`: management and resident experiences with a
  larger API-driven township map, readable risk countdowns, route comparison,
  pump operations and the ClimateTwin blue/lime/charcoal design.

The old `simulation-provider.tsx`, simulation model, Command Centre,
telemetry panel, and ESP32 firmware remain in the repository for reference.
They are **not imported by the active page**. The physical telemetry and
intelligence endpoints remain isolated legacy APIs; the synthetic engine does
not post invented readings to them. See `backend/README.md` for model units,
parameters, risk thresholds, road rules, endpoints, and limitations.

## Active API

`GET /api/demo/state`, `GET /api/demo/history`, `GET /api/demo/route`,
`GET /api/demo/ai/v1/predictions`,
`POST /api/demo/command`, `POST /api/demo/reset`, and
`POST /api/demo/acknowledge` are available through both FastAPI and the Next.js
same-origin proxy. The state route accepts `home_id=H1|H2|H3|H4`; a route is
recomputed after road accessibility changes. Events and acknowledgement
counts are shared between clients. Browser notifications are optional and
require the user's permission; no SMS, email, WhatsApp, or closed-browser push
integration exists.

The state also returns `school`, `time_model`, 29 enriched streets and paths with
`status` and `closure_eta`, zone `flood_eta`, 5/10/20-minute deterministic
`baseline_forecasts`, `route_options` with distance/time/road-specific margins,
and read-only `pump_outlooks`. The standalone route endpoint returns the same
recommended route. The trained AI endpoint and saved artifacts are unchanged.
Management follows the approved three-row dashboard: a compact status header,
the interactive township map beside three simultaneous zone cards, and Selected
Location / Virtual Pump Operations / Recent Alerts below. D1 is blue, D2 orange,
and POND green on both the map and cards. Secondary labelled risk badges and
warning rings preserve Watch, Warning, and Critical severity independently of
zone identity.

Current and trained +5/+10/+20-minute percentages use each zone's configured
`flood_threshold_cm`: depth / warning reference × 100. Percentages can exceed
100%; progress bars remain bounded inside their containers. Negative trained
outputs are floored at 0 cm for display, using the existing display helper.
The saved model, raw predictions, deterministic projections, and evaluation
are unchanged. Forecasts retain their latest valid values during refreshes,
show their source minute, and disappear when the scenario or run changes.

The header's Simulation controls panel contains weather, guided demo, play/pause,
reset, speed, and simulated time. Manual pump switches use the existing backend
commands and minimum-depth constraints. Automatic control is not implemented:
there is no shared backend auto-mode ownership, policy state, or override
contract, so no decorative Auto (AI) switches are shown. The Compare action
opens the existing deterministic pump comparisons. Activity history remains
available from the footer, and View all opens the existing notification drawer.
Resident Safety remains available from the footer and retains its existing UI.

The state and route endpoints accept `mode=WALK|CAR|MOTORCYCLE` (default WALK).
Resident Safety recalculates routes on the backend when the mode changes and
keeps alternatives distinct. R18, the northern landscaped path, permits walking
only. Speeds and per-edge junction delays are illustrative and configurable in
`backend/demo.py`; see `backend/README.md`. The map's housing blocks and
landscaping are visual parcels, not extra routable roads. Home markers are
offset from graph access nodes. A selected home's panel shows its linked
drainage-zone and node-adjacent road evidence; home-level flood exposure stays
**unknown** because no building elevation or inundation model exists.

## Quality checks (run manually)

```powershell
cd backend
.\.venv\Scripts\python.exe -m unittest discover -s tests -v

cd ..\frontend
npm.cmd test
npm.cmd run lint
npm.cmd run build
```

Then run both servers and inspect desktop and phone layouts, the guided
scenario, pump on/off, route changes, acknowledgements, and browser console.
With both servers running, `node tests/management-browser-check.mjs` checks the
reference layout, forecasts, controls, storms, map selection, pump limits,
refresh recovery, and mobile stacking. It captures screenshots in
`.artifacts/qa`.
The legacy browser-check script targets the former local simulation UI; it is
retained as historical test code and is not an active demo acceptance check.

## Prototype limits

Model parameters, map positions, road hazard levels, shelter, and forecasts
are illustrative. The trained model uses only synthetic episodes; its held-out
10-minute level MAE is 3.658 cm versus 1.915 cm for the existing fixed-rainfall
continuation on the same test scenarios. These are not real-world accuracy
claims. The rule-based 10-minute continuation holds current rain and pump
settings fixed, while the numeric threshold ETA extrapolates a recent trend.
The guided scenario may change future rainfall, so neither is a guarantee.
The new 40-minute scenario projection follows the guided schedule or selected
manual weather, but later commands can change it. A map warning ETA refers to
the 75 cm WARNING rule; road closure thresholds are D1 80 cm, D2 70 cm and
POND 85 cm. No projected crossing within 40 simulated minutes is reported as
such, never as an invented countdown. Road depth is inherited from its zone,
not measured on the street. Normalized map geometry uses an illustrative
700 m × 448 m scale and 1.2 m/s base walking pace, not surveyed distances.
Route feasibility compares a walker’s expected arrival at each road with that
road's projected closure; beyond the forecast window, accessibility is unknown.
State, water history, incidents, and acknowledgements disappear on backend
restart. Run one backend worker for a shared local demo. A real deployment
would need calibrated data, verified roads and shelters, persistent storage,
authentication, and operational review.
