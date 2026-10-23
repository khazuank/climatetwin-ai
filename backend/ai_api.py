"""Versioned prediction response contract; distinct model and simulation sources."""

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict

from demo_api import ZoneId


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Forecast(StrictModel):
    horizon_min: Literal[5, 10, 20]
    predicted_cm: float
    threshold_outlook: Literal["LOWER", "ELEVATED"]
    threshold_model_score: float
    holdout_mae_cm: float
    holdout_p80_absolute_error_cm: float


class Factor(StrictModel):
    feature: str
    observed_value: float
    global_mae_increase_cm: float


class ZonePrediction(StrictModel):
    id: ZoneId
    current_cm: float
    capacity_cm: float
    forecasts: list[Forecast]
    factors: list[Factor]


class PastPrediction(StrictModel):
    minute: int
    due_minute: int
    zone_id: ZoneId
    predicted_cm: float
    observed_cm: float | None


class Branch(StrictModel):
    available: bool
    reason: str | None = None
    D2_depth_cm: float | None = None
    blocked_road_ids: list[str] | None = None
    central_route_available: bool | None = None


class Intervention(StrictModel):
    source: Literal["DETERMINISTIC_SIMULATION"]
    horizon_min: int
    assumption: str
    p2_off: Branch
    p2_on: Branch
    D2_reduction_cm: float | None
    recommendation: str


class ModelMetadata(StrictModel):
    version: str
    training_source: Literal["SYNTHETIC_SIMULATION"]
    scenario_count: int
    split: str
    metrics: dict[str, Any]


class AiPredictionResponse(StrictModel):
    schema_version: Literal[1]
    status: Literal["ready", "unavailable", "unsupported"]
    reason: str | None
    predicted_at_utc: str
    simulation_minute: int
    scenario: Literal["CLEAR", "MODERATE", "HEAVY", "EXTREME", "GUIDED"]
    run_id: str
    model: ModelMetadata | None
    zones: list[ZonePrediction]
    prediction_history: list[PastPrediction]
    intervention: Intervention | None
