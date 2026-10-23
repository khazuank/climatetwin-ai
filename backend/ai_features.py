"""Observable, validated features shared by offline training and live inference."""

from math import isfinite

from demo import PUMP_CONFIG, ZONE_CONFIG


ZONES = tuple(ZONE_CONFIG)
HORIZONS = (5, 10, 20)
FEATURE_NAMES = tuple(
    name for zone in ZONES for name in
    (f"{zone}_depth_cm", f"{zone}_change_3m_cm", f"{zone}_change_6m_cm")
) + (
    "rainfall_mm_h", "target_rainfall_mm_h", "P1_on", "P2_on",
    "zone_D1", "zone_D2", "zone_POND", "zone_capacity_cm",
    "zone_drain_m3_min", "zone_area_m2", "zone_catchment_m2",
    "zone_runoff", "zone_transfer_m3_min", "zone_road_hazard_cm",
    "D1_drain_factor", "D2_drain_factor", "POND_drain_factor",
)


def _number(value: object, label: str, maximum: float = 1_000_000.0) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not isfinite(value) or not 0 <= value <= maximum:
        raise ValueError(f"{label} must be a finite nonnegative number")
    return float(value)


def feature_vector(history: list[dict], zone_id: str, rainfall: float, target_rainfall: float,
                   pumps: dict[str, bool], drain_factors: dict[str, float] | None = None) -> list[float]:
    if zone_id not in ZONE_CONFIG or not history:
        raise ValueError("Known zone and at least one observation are required")
    if set(pumps) != set(PUMP_CONFIG) or not all(type(value) is bool for value in pumps.values()):
        raise ValueError("Both virtual pump states must be boolean")
    factors = drain_factors or {zone: 1.0 for zone in ZONES}
    if set(factors) != set(ZONES) or any(_number(value, "drain factor", 1.0) <= 0 for value in factors.values()):
        raise ValueError("Drain factors must be in (0, 1]")
    current = history[-1]
    minute = current.get("minute")
    if type(minute) is not int or minute < 0:
        raise ValueError("Observation minute must be a nonnegative integer")
    previous = -1
    for row in history:
        time = row.get("minute")
        if type(time) is not int or time <= previous or time > minute:
            raise ValueError("Observation minutes must be strictly increasing")
        previous = time
        depths = row.get("depths_cm")
        if not isinstance(depths, dict) or set(depths) != set(ZONES):
            raise ValueError("Every observation needs all three zones")
        for zone in ZONES:
            _number(depths[zone], f"{zone} depth", ZONE_CONFIG[zone]["capacity_cm"] * 1.35 + 1)

    def past_depth(zone: str, lookback: int) -> float:
        eligible = next((row for row in reversed(history) if row["minute"] <= minute - lookback), history[0])
        return float(eligible["depths_cm"][zone])

    values = []
    for zone in ZONES:
        depth = float(current["depths_cm"][zone])
        values.extend((depth, depth - past_depth(zone, 3), depth - past_depth(zone, 6)))
    config = ZONE_CONFIG[zone_id]
    values.extend((
        _number(rainfall, "rainfall", 300), _number(target_rainfall, "target rainfall", 300),
        float(pumps["P1"]), float(pumps["P2"]),
        *(float(zone_id == zone) for zone in ZONES),
        config["capacity_cm"], config["drain_m3_min"], config["area_m2"],
        config["catchment_m2"], config["runoff"], config["transfer_m3_min"],
        config["road_hazard_cm"], *(float(factors[zone]) for zone in ZONES),
    ))
    return values
