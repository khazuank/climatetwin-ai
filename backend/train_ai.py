"""Reproducible offline training on independent synthetic simulation episodes.

Run: python train_ai.py. No live DemoEngine instance or production state is changed.
"""

import argparse
import json
from pathlib import Path
import random

import joblib
import numpy as np
import sklearn
from sklearn.ensemble import HistGradientBoostingClassifier, HistGradientBoostingRegressor
from sklearn.inspection import permutation_importance
from sklearn.metrics import brier_score_loss, mean_absolute_error, precision_score, recall_score

from ai_features import FEATURE_NAMES, HORIZONS, ZONES, feature_vector
from demo import PUMP_CONFIG, ZONE_CONFIG, _balance, target_rainfall


SEED = 20261019
MODEL_VERSION = "synthetic-hgb-v1"
DEFAULT_OUTPUT = Path(__file__).resolve().parent / "models"


def generate_episode(seed: int, minutes: int = 105) -> list[dict]:
    """Produce an isolated trajectory using the live water-balance step."""
    rng = random.Random(seed)
    pattern = rng.choice(("steady", "pulse", "ramp", "double", "guided"))
    levels = {zone: rng.uniform(18, 108) for zone in ZONES}
    factors = {zone: (rng.uniform(0.35, 0.8) if rng.random() < 0.35 else 1.0) for zone in ZONES}
    rain_levels = [rng.choice((0, 20, 40, 70, 100, 140, 180)) for _ in range(4)]
    switch_times = (0, rng.randint(15, 30), rng.randint(40, 55), rng.randint(65, 85))
    pump_starts = {pump: rng.randint(10, 75) if rng.random() < 0.55 else minutes + 1
                   for pump in PUMP_CONFIG}
    pump_ends = {pump: pump_starts[pump] + rng.randint(12, 45) for pump in PUMP_CONFIG}
    rainfall = rng.uniform(0, 40)
    rows = []
    for minute in range(minutes + 1):
        if pattern == "guided":
            target = target_rainfall("GUIDED", minute)
        elif pattern == "steady":
            target = rain_levels[0]
        elif pattern == "pulse":
            target = rain_levels[2] if switch_times[1] <= minute < switch_times[3] else rain_levels[0]
        elif pattern == "ramp":
            target = next(rain_levels[index] for index in reversed(range(4)) if minute >= switch_times[index])
        else:
            target = rain_levels[3] if switch_times[1] <= minute < switch_times[2] or minute >= switch_times[3] else rain_levels[0]
        pumps = {pump: pump_starts[pump] <= minute < pump_ends[pump] and
                 levels[config["zone_id"]] > config["minimum_depth_cm"]
                 for pump, config in PUMP_CONFIG.items()}
        rows.append({"minute": minute, "rainfall_mm_h": rainfall,
                     "target_rainfall_mm_h": float(target), "depths_cm": levels.copy(),
                     "pumps": pumps, "drain_factors": factors.copy()})
        rainfall += max(-12.0, min(12.0, target - rainfall))
        levels, _ = _balance(levels, rainfall, pumps, factors)
    return rows


def make_dataset(scenario_count: int = 120, minutes: int = 105) -> dict[int, dict[str, np.ndarray]]:
    if scenario_count < 12 or minutes < max(HORIZONS) + 10:
        raise ValueError("At least 12 scenarios and 30 simulated minutes are needed")
    records = {horizon: {"x": [], "y": [], "event": [], "current": [], "baseline": [],
                          "zone": [], "scenario": []} for horizon in HORIZONS}
    for scenario_id in range(scenario_count):
        rows = generate_episode(SEED + scenario_id * 9973, minutes)
        history = []
        for minute, current in enumerate(rows):
            history.append({"minute": minute, "depths_cm": current["depths_cm"]})
            if minute + max(HORIZONS) > minutes or minute % 2:
                continue
            for zone in ZONES:
                features = feature_vector(history[-7:], zone, current["rainfall_mm_h"],
                                          current["target_rainfall_mm_h"], current["pumps"],
                                          current["drain_factors"])
                baseline_depths = current["depths_cm"].copy()
                for step in range(1, max(HORIZONS) + 1):
                    baseline_depths, _ = _balance(baseline_depths, current["rainfall_mm_h"],
                                                   current["pumps"], current["drain_factors"])
                    if step not in HORIZONS:
                        continue
                    record = records[step]
                    record["x"].append(features)
                    record["y"].append(rows[minute + step]["depths_cm"][zone])
                    record["current"].append(current["depths_cm"][zone])
                    record["event"].append(int(max(row["depths_cm"][zone] for row in
                                                   rows[minute:minute + step + 1]) >= ZONE_CONFIG[zone]["capacity_cm"]))
                    record["baseline"].append(baseline_depths[zone])
                    record["zone"].append(zone)
                    record["scenario"].append(scenario_id)
    return {horizon: {key: np.asarray(values) for key, values in record.items()}
            for horizon, record in records.items()}


def train_model(output_dir: Path = DEFAULT_OUTPUT, scenario_count: int = 120,
                minutes: int = 105) -> dict:
    dataset = make_dataset(scenario_count, minutes)
    scenario_ids = list(range(scenario_count))
    random.Random(SEED).shuffle(scenario_ids)
    split = round(scenario_count * 0.8)
    train_ids, test_ids = set(scenario_ids[:split]), set(scenario_ids[split:])
    models = {}
    metrics = {}
    importance = {}
    zone_importance = {}
    for horizon, rows in dataset.items():
        train = np.isin(rows["scenario"], list(train_ids))
        test = np.isin(rows["scenario"], list(test_ids))
        x_train, x_test = rows["x"][train], rows["x"][test]
        y_train, y_test = rows["y"][train], rows["y"][test]
        event_train, event_test = rows["event"][train], rows["event"][test]
        if len(np.unique(event_train)) != 2:
            raise ValueError(f"Horizon {horizon} has only one training class")
        regressor = HistGradientBoostingRegressor(max_iter=90, max_leaf_nodes=23,
                                                   min_samples_leaf=25, l2_regularization=0.1,
                                                   random_state=SEED).fit(x_train, y_train)
        classifier = HistGradientBoostingClassifier(max_iter=90, max_leaf_nodes=15,
                                                     min_samples_leaf=25, l2_regularization=0.1,
                                                     random_state=SEED).fit(x_train, event_train)
        predicted = regressor.predict(x_test)
        probabilities = classifier.predict_proba(x_test)[:, 1]
        classified = probabilities >= 0.5
        below = rows["current"][test] < 100
        by_zone = {}
        for zone in ZONES:
            selected = rows["zone"][test] == zone
            by_zone[zone] = {
                "mae_cm": round(float(mean_absolute_error(y_test[selected], predicted[selected])), 3),
                "baseline_mae_cm": round(float(mean_absolute_error(y_test[selected], rows["baseline"][test][selected])), 3),
                "p80_absolute_error_cm": round(float(np.quantile(np.abs(y_test[selected] - predicted[selected]), 0.8)), 3),
                "threshold_prevalence": round(float(np.mean(event_test[selected])), 4),
            }
        metrics[str(horizon)] = {
            "test_rows": int(test.sum()),
            "mae_cm": round(float(mean_absolute_error(y_test, predicted)), 3),
            "baseline_mae_cm": round(float(mean_absolute_error(y_test, rows["baseline"][test])), 3),
            "threshold_prevalence": round(float(np.mean(event_test)), 4),
            "threshold_precision": round(float(precision_score(event_test, classified, zero_division=0)), 4),
            "threshold_recall": round(float(recall_score(event_test, classified, zero_division=0)), 4),
            "threshold_brier": round(float(brier_score_loss(event_test, probabilities)), 4),
            "below_threshold_rows": int(below.sum()),
            "new_crossing_prevalence": round(float(np.mean(event_test[below])), 4),
            "new_crossing_precision": round(float(precision_score(event_test[below], classified[below], zero_division=0)), 4),
            "new_crossing_recall": round(float(recall_score(event_test[below], classified[below], zero_division=0)), 4),
            "zones": by_zone,
        }
        sample = np.random.default_rng(SEED + horizon).choice(len(x_test), min(400, len(x_test)), replace=False)
        result = permutation_importance(regressor, x_test[sample], y_test[sample],
                                        scoring="neg_mean_absolute_error", n_repeats=2,
                                        random_state=SEED, n_jobs=1)
        importance[str(horizon)] = sorted(
            ({"feature": name, "mae_increase_cm": round(float(max(0, score)), 3)}
             for name, score in zip(FEATURE_NAMES, result.importances_mean)),
            key=lambda item: item["mae_increase_cm"], reverse=True,
        )[:8]
        if horizon == 10:
            for zone in ZONES:
                zone_rows = np.flatnonzero(rows["zone"][test] == zone)
                chosen = np.random.default_rng(SEED + ZONES.index(zone)).choice(
                    zone_rows, min(250, len(zone_rows)), replace=False)
                local = permutation_importance(regressor, x_test[chosen], y_test[chosen],
                                               scoring="neg_mean_absolute_error", n_repeats=2,
                                               random_state=SEED, n_jobs=1)
                zone_importance[zone] = sorted(
                    ({"feature": name, "mae_increase_cm": round(float(max(0, score)), 3)}
                     for name, score in zip(FEATURE_NAMES, local.importances_mean)),
                    key=lambda item: item["mae_increase_cm"], reverse=True,
                )[:8]
        models[str(horizon)] = {"level": regressor, "threshold": classifier}
    report = {
        "model_version": MODEL_VERSION, "seed": SEED, "scenario_count": scenario_count,
        "train_scenarios": sorted(train_ids), "test_scenarios": sorted(test_ids),
        "split": "complete scenario episodes", "sample_stride_minutes": 2,
        "episode_minutes": minutes, "sklearn_version": sklearn.__version__,
        "threshold_cm": 100, "features": list(FEATURE_NAMES),
        "classification_target": "100 cm reached at the current or any future minute through the horizon; new-crossing metrics restrict evaluation to below-threshold inputs",
        "baseline": "current rainfall and pump state held constant through the existing water balance",
        "metrics": metrics, "permutation_importance": importance,
        "zone_10m_permutation_importance": zone_importance,
        "limitations": "Synthetic scenarios only; future rainfall and later pump choices are unknown to the predictor. Importance is global association, not causal attribution.",
    }
    output_dir.mkdir(parents=True, exist_ok=True)
    joblib.dump({"version": MODEL_VERSION, "features": FEATURE_NAMES,
                 "models": models, "report": report}, output_dir / "flood_ai_v1.joblib")
    (output_dir / "evaluation.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf8")
    return report


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--scenarios", type=int, default=120)
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()
    print(json.dumps(train_model(args.output_dir, args.scenarios)["metrics"], indent=2))
