"""Read-only ML inference and separate, deterministic intervention branches."""

from datetime import datetime, timezone
from pathlib import Path
from threading import RLock

import joblib
import sklearn

from ai_features import FEATURE_NAMES, HORIZONS, ZONES, feature_vector
from demo import PUMP_CONFIG, ZONE_CONFIG, _balance, _roads, _route, target_rainfall


MODEL_PATH = Path(__file__).resolve().parent / "models" / "flood_ai_v1.joblib"


def intervention_branch(state: dict, p2_on: bool, horizon: int = 20) -> dict:
    """Project a copy of current state; never call a live engine command."""
    depths = {zone["id"]: float(zone["depth_cm"]) for zone in state["zones"]}
    if p2_on and depths["D2"] <= PUMP_CONFIG["P2"]["minimum_depth_cm"]:
        return {"available": False, "reason": "P2 cannot start below its 12 cm dry-run limit."}
    pumps = {pump["id"]: bool(pump["on"]) for pump in state["pumps"]}
    pumps["P2"] = p2_on
    blocked = {road["id"]: not road["accessible"] for road in state["roads"]}
    rainfall = float(state["rainfall_mm_h"])
    for step in range(1, horizon + 1):
        minute = state["minute"] + step
        target = target_rainfall(state["scenario"], minute)
        rainfall += max(-12.0, min(12.0, target - rainfall))
        for pump_id, config in PUMP_CONFIG.items():
            if pumps[pump_id] and depths[config["zone_id"]] <= config["minimum_depth_cm"]:
                pumps[pump_id] = False
        depths, _ = _balance(depths, rainfall, pumps)
        for road in state["roads"]:
            limit = ZONE_CONFIG[road["zone_id"]]["road_hazard_cm"]
            if not blocked[road["id"]] and depths[road["zone_id"]] >= limit:
                blocked[road["id"]] = True
            elif blocked[road["id"]] and depths[road["zone_id"]] < limit - 4:
                blocked[road["id"]] = False
    roads = _roads(depths)
    for road in roads:
        road["accessible"] = not blocked[road["id"]]
    route = _route("H2", roads)
    return {"available": True, "D2_depth_cm": round(depths["D2"], 1),
            "blocked_road_ids": [road["id"] for road in roads if not road["accessible"]],
            "central_route_available": route["available"]}


def compare_p2(state: dict) -> dict:
    off = intervention_branch(state, False)
    on = intervention_branch(state, True)
    reduction = round(off["D2_depth_cm"] - on["D2_depth_cm"], 1) if on["available"] else None
    if reduction is None:
        recommendation = "P2 is below its start depth; continue monitoring the virtual drain."
    elif any(pump["id"] == "P2" and pump["on"] for pump in state["pumps"]):
        recommendation = "Virtual P2 is already on; compare subsequent D2 readings with the projected branch."
    elif state["rainfall_mm_h"] < 20 and off["D2_depth_cm"] < ZONE_CONFIG["D2"]["road_hazard_cm"]:
        recommendation = "No immediate P2 intervention indicated under current simulated conditions."
    elif reduction >= 2:
        recommendation = (f"P2 ON projects {reduction:.1f} cm less D2 water after 20 minutes. "
                          "Consider the virtual pump and check subsequent readings and roads.")
    else:
        recommendation = "The 20-minute P2 difference is small in this scenario; keep monitoring."
    return {"source": "DETERMINISTIC_SIMULATION", "horizon_min": 20,
            "assumption": "Known guided weather schedule or current manual scenario; all other controls held fixed.",
            "p2_off": off, "p2_on": on, "D2_reduction_cm": reduction,
            "recommendation": recommendation}


class AiService:
    def __init__(self, path: Path = MODEL_PATH) -> None:
        self.path = path
        self.bundle: dict | None = None
        self.error: str | None = "Model has not been loaded."
        self.lock = RLock()
        self.records: list[dict] = []
        self.last_minute = -1

    def load(self) -> None:
        """Called once at application startup; a missing artifact remains visible."""
        try:
            if not self.path.is_file():
                raise FileNotFoundError("Trained model artifact is missing; run backend/train_ai.py.")
            bundle = joblib.load(self.path)
            if bundle.get("version") != "synthetic-hgb-v1" or tuple(bundle.get("features", ())) != FEATURE_NAMES:
                raise ValueError("Model version or feature schema does not match this application")
            if set(bundle.get("models", {})) != {str(horizon) for horizon in HORIZONS}:
                raise ValueError("The model is missing one or more forecast horizons")
            if bundle["report"]["sklearn_version"] != sklearn.__version__:
                raise ValueError("The installed scikit-learn version differs from the trained artifact")
            self.bundle = bundle
            self.error = None
        except Exception as exc:
            self.bundle = None
            self.error = f"Could not load trained model: {exc}"

    def clear_history(self) -> None:
        with self.lock:
            self.records.clear()
            self.last_minute = -1

    def predict(self, state: dict) -> dict:
        with self.lock:
            response = {"schema_version": 1, "status": "unavailable", "reason": self.error,
                        "predicted_at_utc": datetime.now(timezone.utc).isoformat(),
                        "simulation_minute": state.get("minute", 0),
                        "scenario": state.get("scenario", "CLEAR"),
                        "run_id": state.get("run_id", "unknown"), "model": None, "zones": [],
                        "prediction_history": [], "intervention": None}
            try:
                response["intervention"] = compare_p2(state)
            except (ValueError, KeyError, TypeError) as exc:
                response.update({"status": "unsupported", "reason": f"Unsupported simulation input: {exc}"})
                return response
            if self.bundle is None:
                return response
            report = self.bundle["report"]
            response["model"] = {"version": self.bundle["version"], "training_source": "SYNTHETIC_SIMULATION",
                                 "scenario_count": report["scenario_count"], "split": report["split"],
                                 "metrics": report["metrics"]}
            try:
                history = state["history"][-7:]
                pumps = {pump["id"]: pump["on"] for pump in state["pumps"]}
                zones = []
                for zone in state["zones"]:
                    zone_id = zone["id"]
                    if zone["capacity_cm"] != ZONE_CONFIG[zone_id]["capacity_cm"] or abs(
                        zone["depth_cm"] - history[-1]["depths_cm"][zone_id]
                    ) > 0.05:
                        raise ValueError(f"{zone_id} capacity or current depth differs from training inputs")
                    features = feature_vector(history, zone_id, state["rainfall_mm_h"],
                                              state["target_rainfall_mm_h"], pumps)
                    forecasts = []
                    for horizon in HORIZONS:
                        model = self.bundle["models"][str(horizon)]
                        level = float(model["level"].predict([features])[0])
                        score = float(model["threshold"].predict_proba([features])[0][1])
                        eval_zone = report["metrics"][str(horizon)]["zones"][zone_id]
                        forecasts.append({
                            "horizon_min": horizon, "predicted_cm": round(level, 1),
                            "threshold_outlook": "ELEVATED" if score >= 0.5 else "LOWER",
                            "threshold_model_score": round(score, 3),
                            "holdout_mae_cm": eval_zone["mae_cm"],
                            "holdout_p80_absolute_error_cm": eval_zone["p80_absolute_error_cm"],
                        })
                    important = report["zone_10m_permutation_importance"][zone_id][:4]
                    factors = [{"feature": item["feature"],
                                "observed_value": round(features[FEATURE_NAMES.index(item["feature"])], 2),
                                "global_mae_increase_cm": item["mae_increase_cm"]}
                               for item in important]
                    zones.append({"id": zone_id, "current_cm": zone["depth_cm"],
                                  "capacity_cm": zone["capacity_cm"], "forecasts": forecasts,
                                  "factors": factors})
            except (ValueError, KeyError, TypeError, IndexError) as exc:
                response.update({"status": "unsupported", "reason": f"Cannot construct model features: {exc}"})
                return response
            response.update({"status": "ready", "reason": None, "zones": zones})
            minute = state["minute"]
            if minute < self.last_minute:
                self.records.clear()
            self.last_minute = minute
            observations = {row["minute"]: row["depths_cm"] for row in state["history"]}
            for record in self.records:
                if record["observed_cm"] is None and record["due_minute"] in observations:
                    record["observed_cm"] = round(observations[record["due_minute"]][record["zone_id"]], 1)
            for zone in zones:
                forecast = next(item for item in zone["forecasts"] if item["horizon_min"] == 10)
                existing = next((item for item in self.records if item["minute"] == minute and
                                 item["zone_id"] == zone["id"]), None)
                record = {"minute": minute, "due_minute": minute + 10,
                          "zone_id": zone["id"], "predicted_cm": forecast["predicted_cm"],
                          "observed_cm": None}
                if existing:
                    existing.update(record)
                else:
                    self.records.append(record)
            self.records = self.records[-180:]
            response["prediction_history"] = [record.copy() for record in self.records[-90:]]
            return response
