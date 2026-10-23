"""Authoritative deterministic township flood demonstration.

All positions, rainfall, roads and water quantities are synthetic. The model
illustrates connected consequences; it is not a calibrated hydrological model.
"""

from collections import deque
from datetime import datetime, timezone
from heapq import heappop, heappush
from math import hypot
from statistics import median
from threading import RLock
from uuid import uuid4
from time import monotonic
from typing import Callable, Literal


ZoneId = Literal["D1", "D2", "POND"]
Risk = Literal["NORMAL", "WATCH", "WARNING", "CRITICAL"]
RISK_ORDER: tuple[Risk, ...] = ("NORMAL", "WATCH", "WARNING", "CRITICAL")
SCENARIO_RAIN_MM_H = {"CLEAR": 0.0, "MODERATE": 40.0, "HEAVY": 100.0, "EXTREME": 180.0}
SECONDS_PER_MODEL_MINUTE = 1.0
FORECAST_HORIZON_MIN = 40
MAP_WIDTH_M = 700.0
MAP_HEIGHT_M = 448.0
WALK_SPEED_M_MIN = 72.0  # Illustrative 1.2 m/s, independent of demo playback speed.
MODE_SPEED_M_MIN = {"WALK": WALK_SPEED_M_MIN, "CAR": 300.0, "MOTORCYCLE": 360.0}
JUNCTION_DELAY_MIN = {"WALK": 0.0, "CAR": 0.18, "MOTORCYCLE": 0.12}
PEDESTRIAN_ROADS = frozenset({"R18"})  # Northern landscaped shortcut, shown as a footpath.
MAX_HISTORY = 180
MAX_EVENTS = 100

# Areas and flows are scaled prototype assumptions. Depth cm * area m² / 100
# yields m³. Rain mm/h * catchment m² * runoff coefficient / 60_000 yields m³/min.
ZONE_CONFIG = {
    "D1": {"name": "Drain 1", "area_m2": 90.0, "catchment_m2": 900.0,
           "runoff": 0.80, "capacity_cm": 100.0, "drain_m3_min": 0.45,
           "transfer_m3_min": 0.15, "transfer_above_cm": 35.0,
           "road_hazard_cm": 80.0, "initial_cm": 26.0, "position": {"x": 0.25, "y": 0.38}},
    "D2": {"name": "Drain 2", "area_m2": 110.0, "catchment_m2": 1100.0,
           "runoff": 0.85, "capacity_cm": 100.0, "drain_m3_min": 0.50,
           "transfer_m3_min": 0.20, "transfer_above_cm": 40.0,
           "road_hazard_cm": 70.0, "initial_cm": 30.0, "position": {"x": 0.57, "y": 0.39}},
    "POND": {"name": "Retention pond", "area_m2": 170.0, "catchment_m2": 800.0,
             "runoff": 0.80, "capacity_cm": 100.0, "drain_m3_min": 0.75,
             "transfer_m3_min": 0.0, "transfer_above_cm": 0.0,
             "road_hazard_cm": 85.0, "initial_cm": 45.0, "position": {"x": 0.75, "y": 0.72}},
}
PUMP_CONFIG = {
    "P1": {"zone_id": "D1", "capacity_m3_min": 0.80, "minimum_depth_cm": 12.0,
           "position": {"x": 0.26, "y": 0.54}},
    "P2": {"zone_id": "D2", "capacity_m3_min": 1.20, "minimum_depth_cm": 12.0,
           "position": {"x": 0.59, "y": 0.55}},
}
RISK_UP = (0.55, 0.75, 1.00)
RISK_DOWN = (0.50, 0.70, 0.94)

# Coordinates are fractions of the illustrative map canvas. Roads form a
# connected graph; optional via points are part of the visible traversable edge.
NODES = {
    "A": (0.13, 0.22), "B": (0.37, 0.22), "C": (0.62, 0.22), "D": (0.86, 0.22),
    "E": (0.13, 0.52), "F": (0.37, 0.52), "G": (0.62, 0.52), "H": (0.86, 0.52),
    "I": (0.13, 0.82), "J": (0.37, 0.82), "K": (0.62, 0.82), "L": (0.86, 0.82),
    "M": (0.06, 0.52), "N": (0.06, 0.82),
    "O": (0.13, 0.94), "P": (0.37, 0.94), "Q": (0.62, 0.94), "R": (0.86, 0.94),
    "S": (0.94, 0.52), "T": (0.94, 0.82),
}
ROAD_DEFINITIONS = [
    ("R1", "A", "B", 0.24, "D1", []),
    ("R2", "B", "C", 0.25, "D2", []),
    ("R3", "C", "D", 0.24, "POND", []),
    ("R4", "E", "F", 0.24, "D1", []),
    ("R5", "F", "G", 0.25, "D2", []),
    ("R6", "G", "H", 0.24, "POND", []),
    ("R7", "I", "J", 0.24, "D1", []),
    ("R8", "J", "K", 0.25, "D2", []),
    ("R9", "K", "L", 0.24, "POND", []),
    ("R10", "A", "E", 0.30, "D1", []),
    ("R11", "E", "I", 0.30, "D1", []),
    ("R12", "B", "F", 0.30, "D2", []),
    ("R13", "F", "J", 0.30, "D2", []),
    ("R14", "C", "G", 0.30, "D2", []),
    ("R15", "G", "K", 0.30, "D2", []),
    ("R16", "D", "H", 0.30, "POND", []),
    ("R17", "H", "L", 0.30, "POND", []),
    ("R18", "B", "D", 0.76, "POND", [(0.37, 0.08), (0.86, 0.08)]),
    ("R19", "A", "M", 0.32, "D1", [(0.06, 0.22)]),
    ("R20", "M", "N", 0.30, "D1", []),
    ("R21", "N", "I", 0.09, "D1", []),
    ("R22", "I", "O", 0.12, "D1", []),
    ("R23", "O", "P", 0.24, "D1", []),
    ("R24", "P", "Q", 0.25, "D2", []),
    ("R25", "Q", "R", 0.24, "POND", []),
    ("R26", "R", "L", 0.12, "POND", []),
    ("R27", "D", "S", 0.32, "POND", [(0.94, 0.22)]),
    ("R28", "S", "T", 0.30, "POND", []),
    ("R29", "T", "L", 0.08, "POND", []),
]
HOUSES = [
    {"id": "H1", "name": "North homes", "node_id": "A", "zone_id": "D1", "position": {"x": 0.19, "y": 0.30}},
    {"id": "H2", "name": "Central homes", "node_id": "F", "zone_id": "D2", "position": {"x": 0.43, "y": 0.565}},
    {"id": "H3", "name": "South homes", "node_id": "I", "zone_id": "D1", "position": {"x": 0.19, "y": 0.88}},
    {"id": "H4", "name": "East homes", "node_id": "L", "zone_id": "POND", "position": {"x": 0.80, "y": 0.88}},
]
SHELTER = {"id": "S1", "name": "Community shelter", "node_id": "D",
           "position": {"x": 0.80, "y": 0.29}, "status": "Illustrative destination"}
SCHOOL = {"id": "SCH1", "name": "Township school", "position": {"x": 0.50, "y": 0.766}}


def _risk_candidate(depth: float, capacity: float) -> Risk:
    ratio = depth / capacity
    if ratio >= RISK_UP[2]:
        return "CRITICAL"
    if ratio >= RISK_UP[1]:
        return "WARNING"
    if ratio >= RISK_UP[0]:
        return "WATCH"
    return "NORMAL"


def target_rainfall(scenario: str, minute: int) -> float:
    """The same known scenario schedule used by live ticks and isolated branches."""
    if scenario != "GUIDED":
        return SCENARIO_RAIN_MM_H[scenario]
    if minute < 5:
        return 0.0
    if minute < 15:
        return 40.0
    if minute < 35:
        return 100.0
    if minute < 53:
        return 180.0
    if minute < 61:
        return 100.0
    if minute < 66:
        return 40.0
    return 0.0


def _balance(depths: dict[str, float], rainfall: float, pumps: dict[str, bool],
             drain_factors: dict[str, float] | None = None) -> tuple[dict[str, float], float]:
    """One minute of volume balance. Transfers are removed before entering POND."""
    volume = {}
    transfer_to_pond = 0.0
    for zone_id in ("D1", "D2", "POND"):
        config = ZONE_CONFIG[zone_id]
        rain_volume = rainfall * config["catchment_m2"] * config["runoff"] / 60_000
        available = depths[zone_id] * config["area_m2"] / 100 + rain_volume
        available -= min(available, config["drain_m3_min"] *
                         (drain_factors[zone_id] if drain_factors else 1.0))
        if zone_id != "POND" and depths[zone_id] > config["transfer_above_cm"]:
            transfer = min(available, config["transfer_m3_min"])
            available -= transfer
            transfer_to_pond += transfer
        for pump_id, pump in PUMP_CONFIG.items():
            if pumps[pump_id] and pump["zone_id"] == zone_id:
                reserve = pump["minimum_depth_cm"] * config["area_m2"] / 100
                removed = min(pump["capacity_m3_min"], max(0.0, available - reserve))
                available -= removed
        volume[zone_id] = available
    volume["POND"] += transfer_to_pond
    next_depths = {}
    spill_m3 = 0.0
    for zone_id, available in volume.items():
        config = ZONE_CONFIG[zone_id]
        maximum = config["capacity_cm"] * 1.35 * config["area_m2"] / 100
        spill_m3 += max(0.0, available - maximum)
        next_depths[zone_id] = max(0.0, min(available, maximum)) * 100 / config["area_m2"]
    return next_depths, spill_m3


def _trend(history: list[dict], zone_id: str) -> tuple[str, float | None]:
    recent = history[-7:]
    if len(recent) < 4 or recent[-1]["minute"] - recent[0]["minute"] < 3:
        return "INSUFFICIENT", None
    slopes = [
        (b["depths_cm"][zone_id] - a["depths_cm"][zone_id]) / (b["minute"] - a["minute"])
        for index, a in enumerate(recent) for b in recent[index + 1:]
        if b["minute"] > a["minute"]
    ]
    rate = median(slopes)
    if abs(rate) < 0.15:
        return "STABLE", 0.0
    return ("RISING" if rate > 0 else "FALLING"), rate


def _roads(depths: dict[str, float]) -> list[dict]:
    return [{
        "id": road_id, "start_node": start, "end_node": end,
        "weight": weight, "zone_id": zone_id,
        "via": [{"x": x, "y": y} for x, y in via],
        "accessible": depths[zone_id] < ZONE_CONFIG[zone_id]["road_hazard_cm"],
        "reason": ("Open in this scenario" if depths[zone_id] < ZONE_CONFIG[zone_id]["road_hazard_cm"]
                   else f"{zone_id} reached its {ZONE_CONFIG[zone_id]['road_hazard_cm']:.0f} cm road hazard rule"),
    } for road_id, start, end, weight, zone_id, via in ROAD_DEFINITIONS]


def _route(home_id: str, roads: list[dict], reason: str | None = None) -> dict:
    house = next((home for home in HOUSES if home["id"] == home_id), None)
    if house is None:
        raise ValueError("Unknown home ID")
    start = house["node_id"]
    goal = SHELTER["node_id"]
    adjacency: dict[str, list[tuple[float, str, str]]] = {node: [] for node in NODES}
    for road in roads:
        if road["accessible"]:
            adjacency[road["start_node"]].append((road["weight"], road["end_node"], road["id"]))
            adjacency[road["end_node"]].append((road["weight"], road["start_node"], road["id"]))
    queue = [(0.0, start, [], [start])]
    best: dict[str, float] = {}
    while queue:
        cost, node, road_ids, node_ids = heappop(queue)
        if node in best and best[node] <= cost:
            continue
        best[node] = cost
        if node == goal:
            return {"home_id": home_id, "shelter_id": SHELTER["id"], "available": True,
                    "road_ids": road_ids, "node_ids": node_ids, "total_weight": round(cost, 3),
                    "message": "Recommended route in this simulated road network.",
                    "reason": reason or "Shortest accessible route by configured traversal weight."}
        for weight, neighbor, road_id in adjacency[node]:
            if neighbor not in best:
                heappush(queue, (cost + weight, neighbor, road_ids + [road_id], node_ids + [neighbor]))
    return {"home_id": home_id, "shelter_id": SHELTER["id"], "available": False,
            "road_ids": [], "node_ids": [], "total_weight": None,
            "message": "No route available in this simulated road network.",
            "reason": reason or "Every connected path includes a blocked road."}


def _projection(depths: dict[str, float], rainfall: float, pumps: dict[str, bool],
                scenario: str, minute: int) -> list[dict[str, float]]:
    """Read-only continuation using the live rain ramp, balance and pump dry-run rule."""
    result = [depths.copy()]
    projected_pumps = pumps.copy()
    for offset in range(1, FORECAST_HORIZON_MIN + 1):
        target = target_rainfall(scenario, minute + offset)
        rainfall += max(-12.0, min(12.0, target - rainfall))
        for pump_id, config in PUMP_CONFIG.items():
            if projected_pumps[pump_id] and result[-1][config["zone_id"]] <= config["minimum_depth_cm"]:
                projected_pumps[pump_id] = False
        next_depths, _ = _balance(result[-1], rainfall, projected_pumps)
        result.append(next_depths)
    return result


def _threshold_eta(series: list[dict[str, float]], zone_id: str, threshold: float) -> dict:
    if not series:
        return {"status": "UNAVAILABLE", "minutes": None}
    if series[0][zone_id] >= threshold:
        return {"status": "FLOODED_NOW", "minutes": 0.0}
    for minute, depths in enumerate(series[1:], 1):
        if depths[zone_id] >= threshold:
            return {"status": "ESTIMATED", "minutes": float(minute)}
    return {"status": "NOT_PREDICTED", "minutes": None}


def _road_distance_m(road: dict) -> float:
    points = [NODES[road["start_node"]],
              *((point["x"], point["y"]) for point in road["via"]),
              NODES[road["end_node"]]]
    return round(sum(hypot((b[0] - a[0]) * MAP_WIDTH_M,
                           (b[1] - a[1]) * MAP_HEIGHT_M)
                     for a, b in zip(points, points[1:])), 1)


def _enrich_roads(roads: list[dict], depths: dict[str, float],
                  series: list[dict[str, float]]) -> list[dict]:
    enriched = []
    for road in roads:
        threshold = ZONE_CONFIG[road["zone_id"]]["road_hazard_cm"]
        eta = _threshold_eta(series, road["zone_id"], threshold)
        if not road["accessible"]:
            eta = {"status": "FLOODED_NOW", "minutes": 0.0}
        distance = _road_distance_m(road)
        # Main and perimeter roads are assumed to permit a steadier walking pace.
        speed_factor = 1.08 if int(road["id"][1:]) in (*range(1, 4), 18, *range(19, 30)) else 0.92
        status = ("CLOSED" if not road["accessible"] else "AT_RISK"
                  if eta["status"] == "ESTIMATED" and eta["minutes"] <= 20
                  or depths[road["zone_id"]] >= threshold - 8 else "OPEN")
        enriched.append({**road, "distance_m": distance,
                         "walk_minutes": round(distance / (WALK_SPEED_M_MIN * speed_factor), 2),
                         "road_class": "PEDESTRIAN" if road["id"] in PEDESTRIAN_ROADS else
                                       "MAIN" if int(road["id"][1:]) <= 3 or 19 <= int(road["id"][1:]) <= 29 else "RESIDENTIAL",
                         "allowed_modes": ["WALK"] if road["id"] in PEDESTRIAN_ROADS else
                                          ["WALK", "CAR", "MOTORCYCLE"],
                         "status": status, "closure_eta": eta})
    return enriched


def _find_route(home_id: str, roads: list[dict], depths: dict[str, float],
                criterion: str, banned: frozenset[str] = frozenset(), mode: str = "WALK") -> dict | None:
    start = next(home["node_id"] for home in HOUSES if home["id"] == home_id)
    goal = SHELTER["node_id"]
    adjacency: dict[str, list[tuple[str, dict]]] = {node: [] for node in NODES}
    for road in roads:
        if road["accessible"] and road["id"] not in banned and mode in road["allowed_modes"]:
            adjacency[road["start_node"]].append((road["end_node"], road))
            adjacency[road["end_node"]].append((road["start_node"], road))
    queue = [(0.0, 0.0, start, [], [start], [])]
    frontier: dict[str, list[tuple[float, float]]] = {}
    while queue:
        score, travel, node, path, nodes, segments = heappop(queue)
        if any(cost <= score and arrival <= travel for cost, arrival in frontier.get(node, [])):
            continue
        frontier.setdefault(node, []).append((score, travel))
        if node == goal:
            distance = sum(segment["distance_m"] for segment in segments)
            margins = [segment["margin_min"] for segment in segments if segment["margin_min"] is not None]
            return {"road_ids": path, "node_ids": nodes,
                    "distance_m": round(distance, 1),
                    "walk_minutes": round(sum(item["walk_minutes"] for item in segments), 1),
                    "travel_minutes": round(travel, 2),
                    "safety_margin_min": round(min(margins), 1) if margins else None,
                    "earliest_closure_min": min((segment["closure_eta_min"] for segment in segments
                                                 if segment["closure_eta_min"] is not None), default=None),
                    "exposure_score": round(sum(segment["exposure"] for segment in segments), 2),
                    "segments": segments}
        for neighbor, road in adjacency[node]:
            if neighbor in nodes:
                continue
            segment_travel = (road["walk_minutes"] if mode == "WALK" else
                              road["distance_m"] / MODE_SPEED_M_MIN[mode] + JUNCTION_DELAY_MIN[mode])
            arrival = travel + segment_travel
            eta = road["closure_eta"]["minutes"]
            if eta is not None and eta <= arrival:
                continue
            margin = None if eta is None else round(eta - arrival, 1)
            depth_ratio = depths[road["zone_id"]] / ZONE_CONFIG[road["zone_id"]]["road_hazard_cm"]
            exposure = road["distance_m"] / 100 * depth_ratio ** 2
            if margin is not None:
                exposure += max(0, 10 - margin) * 0.5
            cost = (road["distance_m"] if criterion == "shortest" else
                    segment_travel if criterion == "fastest" else exposure)
            segment = {"road_id": road["id"], "distance_m": road["distance_m"],
                       "walk_minutes": road["walk_minutes"],
                       "travel_minutes": round(segment_travel, 3), "arrival_min": round(arrival, 2),
                       "closure_eta_min": eta, "margin_min": margin, "exposure": round(exposure, 2)}
            heappush(queue, (score + cost, arrival, neighbor, path + [road["id"]],
                             nodes + [neighbor], segments + [segment]))
    return None


def _route_options(home_id: str, roads: list[dict], depths: dict[str, float],
                   reason: str | None = None, mode: str = "WALK") -> tuple[dict, list[dict]]:
    selected: list[dict] = []
    labels = (("recommended", "safest"), ("fastest", "fastest"),
              ("shortest", "shortest"))
    for label, criterion in labels:
        result = _find_route(home_id, roads, depths, criterion, mode=mode)
        if result and not any(item["road_ids"] == result["road_ids"] for item in selected):
            selected.append({"kind": label, **result})
    if selected:
        # A spur search supplies a distinct alternative when the primary metrics overlap.
        primary = selected[0]["road_ids"]
        spurs = [_find_route(home_id, roads, depths, "safest", frozenset((road_id,)), mode)
                 for road_id in primary]
        candidates = [item for item in spurs if item and not any(
            option["road_ids"] == item["road_ids"] for option in selected)]
        if candidates:
            selected.append({"kind": "alternative", **min(candidates,
                            key=lambda item: (item["exposure_score"], item["travel_minutes"]))})
    selected = selected[:3]
    if not selected:
        current_path = _route(home_id, [
            {**road, "accessible": road["accessible"] and mode in road["allowed_modes"]}
            for road in roads
        ])
        explanation = ("All currently open paths include a road projected to close before traversal."
                       if current_path["available"] else
                       f"No connected {mode.lower()}-permitted path through currently open roads.")
        return ({"home_id": home_id, "shelter_id": SHELTER["id"], "available": False,
                 "road_ids": [], "node_ids": [], "total_weight": None,
                 "message": "No feasible shelter route in this simulation.",
                 "reason": reason or explanation,
                 "kind": "recommended", "distance_m": None,
                 "walk_minutes": None, "travel_minutes": None, "mode": mode,
                 "safety_margin_min": None,
                 "earliest_closure_min": None, "exposure_score": None,
                 "segments": [], "forecast_assessment": "NO_ROUTE"}, [])
    options = []
    weights = {road["id"]: road["weight"] for road in roads}
    for option in selected:
        forecast_assessment = ("CLOSURE_MARGIN" if option["safety_margin_min"] is not None else
                               "WINDOW_CLEAR")
        options.append({"home_id": home_id, "shelter_id": SHELTER["id"],
                        "mode": mode,
                        "available": True, "total_weight": round(sum(weights[road_id]
                                                                      for road_id in option["road_ids"]), 3),
                        "message": "Illustrative shelter route through currently open roads.",
                        "reason": reason or "Road-specific closure estimates are checked at segment arrival time.",
                        "forecast_assessment": forecast_assessment, **option})
    return options[0], options


def _pump_outlooks(depths: dict[str, float], rainfall: float, pumps: dict[str, bool],
                   scenario: str, minute: int, road_blocked: dict[str, bool]) -> list[dict]:
    """OFF/ON comparisons from copied state; no active command or ML inference."""
    comparisons = []
    for pump_id, config in PUMP_CONFIG.items():
        branches = {}
        for enabled in (False, True):
            if enabled and depths[config["zone_id"]] <= config["minimum_depth_cm"]:
                branches["on"] = {"available": False, "reason": "Below the minimum operating depth.",
                                  "depth_cm": None, "flood_eta": None, "closed_road_ids": None}
                continue
            branch_pumps = {**pumps, pump_id: enabled}
            series = _projection(depths, rainfall, branch_pumps, scenario, minute)
            future = series[20]
            projected_blocked = road_blocked.copy()
            for step_depths in series[1:21]:
                for road_id, _start, _end, _weight, zone_id, _via in ROAD_DEFINITIONS:
                    limit = ZONE_CONFIG[zone_id]["road_hazard_cm"]
                    if not projected_blocked[road_id] and step_depths[zone_id] >= limit:
                        projected_blocked[road_id] = True
                    elif projected_blocked[road_id] and step_depths[zone_id] < limit - 4:
                        projected_blocked[road_id] = False
            branches["on" if enabled else "off"] = {
                "available": True, "reason": None,
                "depth_cm": round(future[config["zone_id"]], 1),
                "flood_eta": _threshold_eta(series, config["zone_id"],
                                            ZONE_CONFIG[config["zone_id"]]["capacity_cm"] * RISK_UP[1]),
                "closed_road_ids": [road_id for road_id, _start, _end, _weight, zone_id, _via
                                    in ROAD_DEFINITIONS if zone_id == config["zone_id"] and
                                    projected_blocked[road_id]],
            }
        reduction = (round(branches["off"]["depth_cm"] - branches["on"]["depth_cm"], 1)
                     if branches["on"]["available"] else None)
        comparisons.append({"pump_id": pump_id, "zone_id": config["zone_id"],
                            "horizon_min": 20, "off": branches["off"], "on": branches["on"],
                            "depth_reduction_cm": reduction,
                            "source": "DETERMINISTIC_SIMULATION"})
    return comparisons


class DemoEngine:
    def __init__(self, clock: Callable[[], float] = monotonic) -> None:
        self._clock = clock
        self.lock = RLock()
        self._reset_locked()

    def _reset_locked(self) -> None:
        self.run_id = uuid4().hex
        self.minute = 0
        self.speed = 1.0
        self.paused = False
        self.scenario = "CLEAR"
        self.rainfall = 0.0
        self.depths = {zone: config["initial_cm"] for zone, config in ZONE_CONFIG.items()}
        self.pumps = {pump: False for pump in PUMP_CONFIG}
        self.risk: dict[str, Risk] = {zone: "NORMAL" for zone in ZONE_CONFIG}
        self.risk_pending: dict[str, tuple[Risk, int] | None] = {zone: None for zone in ZONE_CONFIG}
        self.road_blocked = {road_id: False for road_id, *_ in ROAD_DEFINITIONS}
        self.rapid_rise = {zone: False for zone in ZONE_CONFIG}
        self.history: deque[dict] = deque(maxlen=MAX_HISTORY)
        self.history.append({"minute": 0, "rainfall_mm_h": 0.0, "depths_cm": self.depths.copy()})
        self.events: deque[dict] = deque(maxlen=MAX_EVENTS)
        self.next_event_id = 1
        self.last_route_change: str | None = None
        self.ever_hazardous = False
        self.recovery_reported = False
        self.total_spill_m3 = 0.0
        self.last_wall = self._clock()
        self.accumulator = 0.0
        self._event("Demo ready", "Synthetic township reset to reproducible clear-weather conditions.",
                    "system", "NORMAL", "both", "Township")

    def _event(self, title: str, description: str, kind: str, severity: Risk,
               audience: str, location: str) -> None:
        self.events.appendleft({
            "id": self.next_event_id, "minute": self.minute,
            "timestamp_utc": datetime.now(timezone.utc).isoformat(),
            "title": title, "description": description, "kind": kind,
            "severity": severity, "audience": audience, "location": location,
            "acknowledged_by": {"management": False, "resident": False},
        })
        self.next_event_id += 1

    def _target_rainfall(self) -> float:
        return target_rainfall(self.scenario, self.minute)

    def _current_roads(self) -> list[dict]:
        roads = _roads(self.depths)
        for road in roads:
            if self.road_blocked[road["id"]]:
                road["accessible"] = False
                if self.depths[road["zone_id"]] < ZONE_CONFIG[road["zone_id"]]["road_hazard_cm"]:
                    road["reason"] = f"{road['zone_id']} remains within the 4 cm reopening buffer"
        return roads

    def _update_roads(self) -> None:
        for road_id, _start, _end, _weight, zone_id, _via in ROAD_DEFINITIONS:
            depth = self.depths[zone_id]
            limit = ZONE_CONFIG[zone_id]["road_hazard_cm"]
            if not self.road_blocked[road_id] and depth >= limit:
                self.road_blocked[road_id] = True
            elif self.road_blocked[road_id] and depth < limit - 4:
                self.road_blocked[road_id] = False

    def _update_risk(self, zone_id: str) -> None:
        current = self.risk[zone_id]
        candidate = _risk_candidate(self.depths[zone_id], ZONE_CONFIG[zone_id]["capacity_cm"])
        if RISK_ORDER.index(candidate) < RISK_ORDER.index(current):
            # A downgrade waits until depth passes below the lower hysteresis band.
            if self.depths[zone_id] / ZONE_CONFIG[zone_id]["capacity_cm"] >= RISK_DOWN[RISK_ORDER.index(current) - 1]:
                candidate = current
        if candidate == current:
            self.risk_pending[zone_id] = None
            return
        pending = self.risk_pending[zone_id]
        count = pending[1] + 1 if pending and pending[0] == candidate else 1
        self.risk_pending[zone_id] = (candidate, count)
        required = 2 if RISK_ORDER.index(candidate) > RISK_ORDER.index(current) else 3
        if count >= required:
            self.risk[zone_id] = candidate
            self.risk_pending[zone_id] = None
            self._event(f"{zone_id} risk {candidate.lower()}",
                        f"{ZONE_CONFIG[zone_id]['name']} is {self.depths[zone_id]:.1f} cm deep, "
                        f"{self.depths[zone_id] / ZONE_CONFIG[zone_id]['capacity_cm'] * 100:.0f}% of configured capacity.",
                        "risk", candidate, "both", zone_id)
            if candidate != "NORMAL":
                self.ever_hazardous = True
                self.recovery_reported = False

    def _tick(self) -> None:
        old_depths = self.depths.copy()
        old_roads = self._current_roads()
        old_series = _projection(old_depths, self.rainfall, self.pumps, self.scenario, self.minute)
        old_route = _route_options("H2", _enrich_roads(old_roads, old_depths, old_series), old_depths)[0]
        self.minute += 1
        target = self._target_rainfall()
        self.rainfall += max(-12.0, min(12.0, target - self.rainfall))
        for pump_id, config in PUMP_CONFIG.items():
            if self.pumps[pump_id] and self.depths[config["zone_id"]] <= config["minimum_depth_cm"]:
                self.pumps[pump_id] = False
                self._event(f"{pump_id} stopped at minimum depth", "Virtual dry-run protection switched the pump off.",
                            "pump", "NORMAL", "management", config["zone_id"])
        self.depths, spill = _balance(self.depths, self.rainfall, self.pumps)
        self.total_spill_m3 += spill
        self.history.append({"minute": self.minute, "rainfall_mm_h": round(self.rainfall, 2),
                             "depths_cm": {zone: round(value, 4) for zone, value in self.depths.items()}})
        for zone_id in ZONE_CONFIG:
            self._update_risk(zone_id)
            rate = self.depths[zone_id] - old_depths[zone_id]
            rapid = rate >= 1.5 and self.rainfall >= 80
            if rapid and not self.rapid_rise[zone_id]:
                self._event(f"Rapid rise at {zone_id}",
                            f"Depth rose {rate:.1f} cm in one simulated minute under {self.rainfall:.0f} mm/h rainfall.",
                            "rise", "WATCH", "management", zone_id)
            self.rapid_rise[zone_id] = rapid
        self._update_roads()
        new_roads = self._current_roads()
        changed_roads = []
        for previous, current in zip(old_roads, new_roads):
            if previous["accessible"] != current["accessible"]:
                blocked = not current["accessible"]
                changed_roads.append(f"{current['id']} {'blocked' if blocked else 'reopened'}")
                self._event(f"{current['id']} {'blocked' if blocked else 'reopened'}",
                            current["reason"] if blocked else "Depth fell below the synthetic road hazard rule.",
                            "road", "WARNING" if blocked else "NORMAL", "both", current["id"])
                if blocked:
                    self.ever_hazardous = True
                    self.recovery_reported = False
        new_series = _projection(self.depths, self.rainfall, self.pumps, self.scenario, self.minute)
        new_route = _route_options("H2", _enrich_roads(new_roads, self.depths, new_series), self.depths)[0]
        if old_route["road_ids"] != new_route["road_ids"]:
            changed = ", ".join(changed_roads) or "Projected road closure changed the route timing"
            self.last_route_change = (f"{changed}; the lowest-exposure feasible route was recalculated."
                                      if new_route["available"] else
                                      f"{changed}; no route from central homes is feasible in this projection.")
            self._event("Central-home route changed", self.last_route_change,
                        "route", "WARNING" if not new_route["available"] else "WATCH",
                        "resident", "H2")
        if self.ever_hazardous and not self.recovery_reported and self.rainfall == 0 and all(
            risk == "NORMAL" for risk in self.risk.values()
        ) and all(road["accessible"] for road in new_roads):
            self.recovery_reported = True
            self._event("Modelled recovery", "Rain has stopped; all zones and roads returned below prototype warning rules.",
                        "recovery", "NORMAL", "both", "Township")

    def _advance_due(self) -> None:
        now = self._clock()
        elapsed = max(0.0, now - self.last_wall)
        self.last_wall = now
        if self.paused:
            return
        self.accumulator += elapsed * self.speed
        steps = min(240, int(self.accumulator / SECONDS_PER_MODEL_MINUTE))
        self.accumulator -= steps * SECONDS_PER_MODEL_MINUTE
        if steps == 240:
            self.accumulator = 0.0
        for _ in range(steps):
            self._tick()

    def command(self, action: str, **params) -> dict:
        with self.lock:
            self._advance_due()
            if action == "set_scenario":
                scenario = params["scenario"]
                if scenario not in SCENARIO_RAIN_MM_H:
                    raise ValueError("Unsupported scenario")
                if self.scenario == scenario:
                    raise ValueError("Scenario is already active")
                self.scenario = scenario
                self._event(f"{scenario.title()} weather selected", "Rainfall will move toward the selected synthetic scenario.",
                            "scenario", "WATCH" if scenario != "CLEAR" else "NORMAL", "both", "Township")
            elif action == "run_demo":
                self._reset_locked()
                self.scenario = "GUIDED"
                self._event("Guided flood demo started", "Rain will intensify, peak, and subside over simulated time. Pump decisions remain manual.",
                            "scenario", "NORMAL", "both", "Township")
            elif action == "set_speed":
                speed = params["speed"]
                if speed not in (0.5, 1.0, 2.0, 4.0):
                    raise ValueError("Unsupported speed")
                self.speed = speed
            elif action == "set_paused":
                self.paused = params["paused"]
                self.accumulator = 0.0
            elif action == "set_pump":
                pump_id = params["pump_id"]
                on = params["on"]
                if pump_id not in PUMP_CONFIG:
                    raise ValueError("Unknown pump")
                if self.pumps[pump_id] == on:
                    raise ValueError("Pump is already in the requested state")
                zone_id = PUMP_CONFIG[pump_id]["zone_id"]
                if on and self.depths[zone_id] <= PUMP_CONFIG[pump_id]["minimum_depth_cm"]:
                    raise ValueError("Dry-run protection: water depth is below the pump minimum")
                self.pumps[pump_id] = on
                self._event(f"Virtual {pump_id} switched {'on' if on else 'off'}",
                            f"{pump_id} {'now removes up to' if on else 'no longer removes'} "
                            f"{PUMP_CONFIG[pump_id]['capacity_m3_min']:.2f} m³/min from {zone_id} in the model.",
                            "pump", "NORMAL", "management", zone_id)
            else:
                raise ValueError("Unsupported command")
            return self._snapshot_locked(params.get("home_id", "H2"))

    def reset(self) -> dict:
        with self.lock:
            self._reset_locked()
            return self._snapshot_locked("H2")

    def acknowledge(self, event_id: int, role: str) -> dict:
        with self.lock:
            self._advance_due()
            event = next((event for event in self.events if event["id"] == event_id), None)
            if event is None:
                raise ValueError("Unknown event")
            if role not in ("management", "resident") or event["audience"] not in (role, "both"):
                raise ValueError("Event is not available to this view")
            event["acknowledged_by"][role] = True
            return self._snapshot_locked("H2")

    def snapshot(self, home_id: str = "H2", mode: str = "WALK") -> dict:
        with self.lock:
            self._advance_due()
            return self._snapshot_locked(home_id, mode)

    def history_snapshot(self) -> dict:
        with self.lock:
            self._advance_due()
            return {"minute": self.minute, "history": list(self.history)}

    def route_snapshot(self, home_id: str, mode: str = "WALK") -> dict:
        with self.lock:
            self._advance_due()
            series = _projection(self.depths, self.rainfall, self.pumps, self.scenario, self.minute)
            roads = _enrich_roads(self._current_roads(), self.depths, series)
            return _route_options(home_id, roads, self.depths,
                                  self.last_route_change if home_id == "H2" else None, mode)[0]

    def _snapshot_locked(self, home_id: str, mode: str = "WALK") -> dict:
        series = _projection(self.depths, self.rainfall, self.pumps, self.scenario, self.minute)
        roads = _enrich_roads(self._current_roads(), self.depths, series)
        route, route_options = _route_options(home_id, roads, self.depths,
                                              self.last_route_change if home_id == "H2" else None, mode)
        forecast_depths = self.depths.copy()
        baseline_depths = {}
        for step in range(1, 21):
            forecast_depths, _ = _balance(forecast_depths, self.rainfall, self.pumps)
            if step in (5, 10, 20):
                baseline_depths[step] = forecast_depths.copy()
        zones = []
        for zone_id, config in ZONE_CONFIG.items():
            depth = self.depths[zone_id]
            trend, rate = _trend(list(self.history), zone_id)
            eta = (0.0 if depth >= config["capacity_cm"] else
                   (config["capacity_cm"] - depth) / rate
                   if rate is not None and rate >= 0.25 and self.rainfall >= 20 else None)
            if trend == "RISING":
                explanation = (f"{zone_id} is rising under {self.rainfall:.0f} mm/h synthetic rainfall."
                               if self.rainfall >= 20 else
                               f"{zone_id} still has a rising recent trend; current rainfall has eased.")
            elif trend == "FALLING":
                explanation = f"{zone_id} is falling as modelled outflow exceeds inflow."
            else:
                explanation = f"{zone_id} is stable or has insufficient history for a trend."
            if eta is None:
                if rate is None:
                    explanation += " More history is needed before estimating threshold time."
                elif rate <= 0:
                    explanation += " No threshold countdown is available without a positive trend."
                elif self.rainfall < 20:
                    explanation += " Threshold time is withheld while rainfall is low or easing."
            forecast_note = "10-minute continuation holds current rainfall and pump states constant."
            if self.scenario == "GUIDED" or self.rainfall != self._target_rainfall():
                forecast_note += " The scenario is changing, so the actual model path can differ."
            zones.append({
                "id": zone_id, "name": config["name"], "position": config["position"],
                "depth_cm": round(depth, 2),
                "capacity_cm": config["capacity_cm"],
                "capacity_percent": round(depth / config["capacity_cm"] * 100, 1),
                "trend": trend, "rate_cm_min": round(rate, 3) if rate is not None else None,
                "risk": self.risk[zone_id],
                "flood_threshold_cm": config["capacity_cm"] * RISK_UP[1],
                "flood_eta": _threshold_eta(series, zone_id, config["capacity_cm"] * RISK_UP[1]),
                "projected_threshold_minutes": round(eta, 1) if eta is not None else None,
                "forecast_10_min_cm": round(baseline_depths[10][zone_id], 1),
                "baseline_forecasts": [{"horizon_min": horizon,
                                        "predicted_cm": round(baseline_depths[horizon][zone_id], 1)}
                                       for horizon in (5, 10, 20)],
                "forecast_note": forecast_note,
                "road_hazard_cm": config["road_hazard_cm"],
                "linked_road_ids": [road["id"] for road in roads if road["zone_id"] == zone_id],
                "linked_house_ids": [home["id"] for home in HOUSES if home["zone_id"] == zone_id],
                "explanation": explanation,
            })
        zone_by_id = {zone["id"]: zone for zone in zones}
        d2 = zone_by_id["D2"]
        if (d2["rate_cm_min"] is not None and d2["rate_cm_min"] >= 1.2
                and d2["depth_cm"] >= 50 and self.rainfall >= 80 and not self.pumps["P2"]):
            recommendation = "D2 is rising rapidly under rainfall. Prepare virtual Pump P2 to change its modelled trajectory."
        elif any(not road["accessible"] for road in roads):
            recommendation = "Inspect blocked simulated roads and the recalculated shelter route."
        elif any(self.pumps.values()):
            recommendation = "Compare the next readings with the 10-minute continuation to assess virtual pump drawdown."
        elif self.rainfall >= 80:
            recommendation = "Monitor D2 and road R12 as the synthetic storm intensifies."
        else:
            recommendation = "Continue monitoring the synthetic township conditions."
        incidents = [
            {"id": f"road-{road['id']}", "kind": "ROAD_BLOCKED", "location": road["id"],
             "description": road["reason"]}
            for road in roads if not road["accessible"]
        ] + [
            {"id": f"zone-{zone['id']}", "kind": "ZONE_RISK", "location": zone["id"],
             "description": f"{zone['risk']} at {zone['depth_cm']:.1f} cm"}
            for zone in zones if zone["risk"] in ("WARNING", "CRITICAL")
        ]
        events = list(self.events)
        return {
            "source": "SYNTHETIC_DEMO", "version": 1,
            "run_id": self.run_id,
            "server_timestamp_utc": datetime.now(timezone.utc).isoformat(),
            "minute": self.minute, "simulated_time": f"{(14 + self.minute // 60) % 24:02d}:{self.minute % 60:02d}",
            "speed": self.speed, "paused": self.paused, "scenario": self.scenario,
            "rainfall_mm_h": round(self.rainfall, 1),
            "target_rainfall_mm_h": self._target_rainfall(),
            "overall_risk": max(self.risk.values(), key=RISK_ORDER.index),
            "zones": zones,
            "pumps": [{"id": pump_id, "zone_id": config["zone_id"],
                       "capacity_m3_min": config["capacity_m3_min"],
                       "minimum_depth_cm": config["minimum_depth_cm"],
                       "position": config["position"], "on": self.pumps[pump_id]}
                      for pump_id, config in PUMP_CONFIG.items()],
            "roads": roads,
            "nodes": [{"id": node_id, "position": {"x": xy[0], "y": xy[1]}}
                      for node_id, xy in NODES.items()],
            "houses": HOUSES, "shelter": SHELTER,
            "school": SCHOOL,
            "time_model": {"forecast_horizon_min": FORECAST_HORIZON_MIN,
                           "map_width_m": MAP_WIDTH_M, "map_height_m": MAP_HEIGHT_M,
                           "walk_speed_m_min": WALK_SPEED_M_MIN,
                           "mode_speed_m_min": MODE_SPEED_M_MIN,
                           "junction_delay_min": JUNCTION_DELAY_MIN,
                           "note": "Illustrative map scale, speeds, and per-road vehicle junction delays. Forecast minutes are model time; journey minutes are estimated travel time. Playback speed changes only presentation time."},
            "route": route, "route_options": route_options,
            "pump_outlooks": _pump_outlooks(self.depths, self.rainfall, self.pumps,
                                             self.scenario, self.minute, self.road_blocked),
            "incidents": incidents,
            "notifications": [event for event in events if event["kind"] != "system"],
            "events": events,
            "history": list(self.history)[-90:],
            "recommendation": recommendation,
            "total_spill_m3": round(self.total_spill_m3, 3),
        }
