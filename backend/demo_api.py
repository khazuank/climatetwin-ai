"""Validated API contracts for the synthetic demonstration."""

from typing import Literal

from pydantic import BaseModel, ConfigDict, StrictBool, field_validator, model_validator


Risk = Literal["NORMAL", "WATCH", "WARNING", "CRITICAL"]
ZoneId = Literal["D1", "D2", "POND"]
HomeId = Literal["H1", "H2", "H3", "H4"]
TravelMode = Literal["WALK", "CAR", "MOTORCYCLE"]
Role = Literal["management", "resident"]


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Position(StrictModel):
    x: float
    y: float


class HistoryPoint(StrictModel):
    minute: int
    rainfall_mm_h: float
    depths_cm: dict[ZoneId, float]


class ThresholdEta(StrictModel):
    status: Literal["FLOODED_NOW", "ESTIMATED", "NOT_PREDICTED", "UNAVAILABLE"]
    minutes: float | None


class BaselineForecast(StrictModel):
    horizon_min: Literal[5, 10, 20]
    predicted_cm: float


class ZoneView(StrictModel):
    id: ZoneId
    name: str
    position: Position
    depth_cm: float
    capacity_cm: float
    capacity_percent: float
    trend: Literal["INSUFFICIENT", "STABLE", "RISING", "FALLING"]
    rate_cm_min: float | None
    risk: Risk
    flood_threshold_cm: float
    flood_eta: ThresholdEta
    projected_threshold_minutes: float | None
    forecast_10_min_cm: float
    baseline_forecasts: list[BaselineForecast]
    forecast_note: str
    road_hazard_cm: float
    linked_road_ids: list[str]
    linked_house_ids: list[str]
    explanation: str


class PumpView(StrictModel):
    id: Literal["P1", "P2"]
    zone_id: ZoneId
    capacity_m3_min: float
    minimum_depth_cm: float
    position: Position
    on: bool


class RoadView(StrictModel):
    id: str
    start_node: str
    end_node: str
    weight: float
    zone_id: ZoneId
    via: list[Position]
    accessible: bool
    reason: str
    distance_m: float
    walk_minutes: float
    road_class: Literal["MAIN", "RESIDENTIAL", "PEDESTRIAN"]
    allowed_modes: list[TravelMode]
    status: Literal["OPEN", "AT_RISK", "CLOSED"]
    closure_eta: ThresholdEta


class NodeView(StrictModel):
    id: str
    position: Position


class HouseView(StrictModel):
    id: HomeId
    name: str
    node_id: str
    zone_id: ZoneId
    position: Position


class ShelterView(StrictModel):
    id: str
    name: str
    node_id: str
    position: Position
    status: str


class SchoolView(StrictModel):
    id: str
    name: str
    position: Position


class TimeModelView(StrictModel):
    forecast_horizon_min: int
    map_width_m: float
    map_height_m: float
    walk_speed_m_min: float
    mode_speed_m_min: dict[TravelMode, float]
    junction_delay_min: dict[TravelMode, float]
    note: str


class RouteSegmentView(StrictModel):
    road_id: str
    distance_m: float
    walk_minutes: float
    travel_minutes: float
    arrival_min: float
    closure_eta_min: float | None
    margin_min: float | None
    exposure: float


class RouteView(StrictModel):
    home_id: HomeId
    shelter_id: str
    available: bool
    road_ids: list[str]
    node_ids: list[str]
    total_weight: float | None
    message: str
    reason: str
    kind: Literal["recommended", "fastest", "shortest", "alternative"]
    distance_m: float | None
    walk_minutes: float | None
    travel_minutes: float | None
    mode: TravelMode
    safety_margin_min: float | None
    earliest_closure_min: float | None
    exposure_score: float | None
    segments: list[RouteSegmentView]
    forecast_assessment: Literal["NO_ROUTE", "CLOSURE_MARGIN", "WINDOW_CLEAR"]


class PumpBranchView(StrictModel):
    available: bool
    reason: str | None
    depth_cm: float | None
    flood_eta: ThresholdEta | None
    closed_road_ids: list[str] | None


class PumpOutlookView(StrictModel):
    pump_id: Literal["P1", "P2"]
    zone_id: ZoneId
    horizon_min: int
    off: PumpBranchView
    on: PumpBranchView
    depth_reduction_cm: float | None
    source: Literal["DETERMINISTIC_SIMULATION"]


class IncidentView(StrictModel):
    id: str
    kind: Literal["ROAD_BLOCKED", "ZONE_RISK"]
    location: str
    description: str


class EventView(StrictModel):
    id: int
    minute: int
    timestamp_utc: str
    title: str
    description: str
    kind: str
    severity: Risk
    audience: Literal["management", "resident", "both"]
    location: str
    acknowledged_by: dict[Role, bool]


class DemoStateResponse(StrictModel):
    source: Literal["SYNTHETIC_DEMO"]
    version: int
    run_id: str
    server_timestamp_utc: str
    minute: int
    simulated_time: str
    speed: float
    paused: bool
    scenario: Literal["CLEAR", "MODERATE", "HEAVY", "EXTREME", "GUIDED"]
    rainfall_mm_h: float
    target_rainfall_mm_h: float
    overall_risk: Risk
    zones: list[ZoneView]
    pumps: list[PumpView]
    roads: list[RoadView]
    nodes: list[NodeView]
    houses: list[HouseView]
    shelter: ShelterView
    school: SchoolView
    time_model: TimeModelView
    route: RouteView
    route_options: list[RouteView]
    pump_outlooks: list[PumpOutlookView]
    incidents: list[IncidentView]
    notifications: list[EventView]
    events: list[EventView]
    history: list[HistoryPoint]
    recommendation: str
    total_spill_m3: float


class DemoHistoryResponse(StrictModel):
    minute: int
    history: list[HistoryPoint]


class DemoCommandInput(StrictModel):
    action: Literal["set_scenario", "run_demo", "set_speed", "set_paused", "set_pump"]
    scenario: Literal["CLEAR", "MODERATE", "HEAVY", "EXTREME"] | None = None
    speed: float | None = None
    paused: StrictBool | None = None
    pump_id: Literal["P1", "P2"] | None = None
    on: StrictBool | None = None

    @field_validator("speed", mode="before")
    @classmethod
    def valid_speed(cls, value: object) -> object:
        if value is not None and (isinstance(value, bool) or not isinstance(value, (int, float)) or value not in (0.5, 1, 2, 4)):
            raise ValueError("speed must be 0.5, 1, 2, or 4")
        return value

    @model_validator(mode="after")
    def require_exact_action_fields(self) -> "DemoCommandInput":
        expected = {
            "set_scenario": {"action", "scenario"},
            "run_demo": {"action"},
            "set_speed": {"action", "speed"},
            "set_paused": {"action", "paused"},
            "set_pump": {"action", "pump_id", "on"},
        }[self.action]
        if self.model_fields_set != expected or any(getattr(self, field) is None for field in expected - {"action"}):
            raise ValueError(f"{self.action} requires exactly: {', '.join(sorted(expected - {'action'}))}")
        return self


class DemoAcknowledgementInput(StrictModel):
    event_id: int
    role: Role
