"""Shared synthetic demo API with isolated legacy telemetry endpoints."""

from datetime import datetime, timezone
import math
from typing import Literal

from fastapi import Depends, FastAPI, HTTPException, Request, Response
from pydantic import BaseModel, ConfigDict, StrictBool, field_validator

from ai_api import AiPredictionResponse
from ai_service import AiService
from intelligence import FloodIntelligenceEngine, SENSOR_CALIBRATIONS
from demo import DemoEngine
from auth import login, logout, require_management, require_management_mutation, session
from demo_api import (
    DemoAcknowledgementInput, DemoCommandInput, DemoHistoryResponse,
    DemoStateResponse, HomeId, RouteView, TravelMode,
)


SensorId = Literal["D1", "D2", "POND"]


class TelemetryInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    sensor_id: SensorId
    distance_cm: float
    simulated: StrictBool

    @field_validator("distance_cm", mode="before")
    @classmethod
    def require_json_number(cls, value: object) -> object:
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            raise ValueError("distance_cm must be a JSON number")
        return value

    @field_validator("distance_cm")
    @classmethod
    def require_finite_nonnegative(cls, value: float) -> float:
        if not math.isfinite(value) or value < 0:
            raise ValueError("distance_cm must be finite and nonnegative")
        return value


class TelemetryReading(TelemetryInput):
    received_at_utc: datetime


class TelemetryResponse(BaseModel):
    status: Literal["accepted"] = "accepted"
    reading: TelemetryReading


class LatestReadings(BaseModel):
    D1: TelemetryReading | None
    D2: TelemetryReading | None
    POND: TelemetryReading | None


class LatestTelemetryResponse(BaseModel):
    readings: LatestReadings


class LoginInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    username: str
    password: str


app = FastAPI(title="ClimateTwin AI API", version="0.2.0")

_latest: dict[SensorId, TelemetryReading | None] = {
    "D1": None,
    "D2": None,
    "POND": None,
}
_intelligence = FloodIntelligenceEngine(SENSOR_CALIBRATIONS)
_demo = DemoEngine()
_ai = AiService()
_ai.load()


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/api/auth/login")
async def post_login(credentials: LoginInput, request: Request, response: Response) -> dict:
    csrf = login(credentials.username, credentials.password,
                 request.client.host if request.client else "unknown", response,
                 request.url.scheme == "https" or request.headers.get("x-forwarded-proto") == "https")
    return {"authenticated": True, "csrf_token": csrf}


@app.get("/api/auth/session")
async def get_session(request: Request) -> dict:
    _, csrf = session(request)
    return {"authenticated": True, "csrf_token": csrf}


@app.post("/api/auth/logout", dependencies=[Depends(require_management_mutation)])
async def post_logout(request: Request, response: Response) -> dict:
    logout(request, response)
    return {"authenticated": False}


@app.post("/api/telemetry", response_model=TelemetryResponse,
          dependencies=[Depends(require_management_mutation)])
async def post_telemetry(telemetry: TelemetryInput) -> TelemetryResponse:
    reading = TelemetryReading(
        **telemetry.model_dump(),
        received_at_utc=datetime.now(timezone.utc),
    )
    _latest[reading.sensor_id] = reading
    _intelligence.ingest(
        reading.sensor_id, reading.distance_cm, reading.received_at_utc,
        reading.simulated,
    )
    print(
        f"[{reading.received_at_utc.isoformat()}] telemetry "
        f"sensor_id={reading.sensor_id} distance_cm={reading.distance_cm} "
        f"simulated={reading.simulated}",
        flush=True,
    )
    return TelemetryResponse(reading=reading)


@app.get("/api/telemetry/latest", response_model=LatestTelemetryResponse,
         dependencies=[Depends(require_management)])
async def get_latest_telemetry() -> LatestTelemetryResponse:
    return LatestTelemetryResponse(readings=LatestReadings(**_latest))


@app.get("/api/intelligence", dependencies=[Depends(require_management)])
async def get_intelligence() -> dict:
    """Current physical analysis; simulated packets never enter this engine."""
    return _intelligence.snapshot()


# Synthetic demo endpoints are separate from the retained legacy IoT API.
@app.get("/api/demo/state", response_model=DemoStateResponse,
         dependencies=[Depends(require_management)])
async def get_demo_state(home_id: HomeId = "H2", mode: TravelMode = "WALK") -> dict:
    return _demo.snapshot(home_id, mode)


@app.get("/api/demo/history", response_model=DemoHistoryResponse,
         dependencies=[Depends(require_management)])
async def get_demo_history() -> dict:
    return _demo.history_snapshot()


@app.get("/api/demo/route", response_model=RouteView,
         dependencies=[Depends(require_management)])
async def get_demo_route(home_id: HomeId = "H2", mode: TravelMode = "WALK") -> dict:
    return _demo.route_snapshot(home_id, mode)


@app.get("/api/demo/ai/v1/predictions", response_model=AiPredictionResponse,
         dependencies=[Depends(require_management)])
async def get_demo_ai_predictions(home_id: HomeId = "H2") -> dict:
    return _ai.predict(_demo.snapshot(home_id))


@app.post("/api/demo/command", response_model=DemoStateResponse,
          dependencies=[Depends(require_management_mutation)])
async def post_demo_command(command: DemoCommandInput) -> dict:
    try:
        values = command.model_dump(exclude={"action"}, exclude_none=True)
        state = _demo.command(command.action, **values)
        if command.action == "run_demo":
            _ai.clear_history()
        return state
    except ValueError as error:
        raise HTTPException(status_code=409, detail=str(error)) from error


@app.post("/api/demo/reset", response_model=DemoStateResponse,
          dependencies=[Depends(require_management_mutation)])
async def post_demo_reset() -> dict:
    state = _demo.reset()
    _ai.clear_history()
    return state


@app.post("/api/demo/acknowledge", response_model=DemoStateResponse,
          dependencies=[Depends(require_management_mutation)])
async def post_demo_acknowledge(request: DemoAcknowledgementInput) -> dict:
    try:
        return _demo.acknowledge(request.event_id, request.role)
    except ValueError as error:
        raise HTTPException(status_code=409, detail=str(error)) from error


@app.get("/api/resident/state")
async def get_resident_state(home_id: HomeId = "H2", mode: TravelMode = "WALK") -> dict:
    state = _demo.snapshot(home_id, mode)
    prediction = _ai.predict(state)
    forecast = {
        "source": "TRAINED_ML", "status": prediction["status"],
        "run_id": prediction["run_id"],
        "simulation_minute": prediction["simulation_minute"],
        "predicted_at_utc": prediction["predicted_at_utc"],
        "zones": [
            {"id": zone["id"], "forecasts": [
                {"horizon_min": item["horizon_min"], "predicted_cm": item["predicted_cm"]}
                for item in zone["forecasts"] if item["horizon_min"] in (10, 20)
            ]}
            for zone in prediction["zones"] if zone["id"] in ("D1", "D2", "POND")
        ] if prediction["status"] == "ready" else [],
    }
    allowed = ("source", "version", "run_id", "server_timestamp_utc", "minute",
               "simulated_time", "overall_risk", "zones", "roads", "nodes",
               "houses", "shelter", "school", "time_model", "route", "route_options")
    return {**{key: state[key] for key in allowed},
            "forecast": forecast,
            "notifications": [
                {key: event[key] for key in ("id", "minute", "title", "description", "severity", "location")}
                for event in state["notifications"] if event["audience"] in ("resident", "both")
            ]}
