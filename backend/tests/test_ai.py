"""Trained-model pipeline and read-only inference checks."""

from copy import deepcopy
from pathlib import Path
import sys
from tempfile import TemporaryDirectory
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from ai_api import AiPredictionResponse  # noqa: E402
from ai_features import FEATURE_NAMES, feature_vector  # noqa: E402
from ai_service import AiService, compare_p2  # noqa: E402
from demo import DemoEngine  # noqa: E402
from train_ai import generate_episode, train_model  # noqa: E402


class AiTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temporary = TemporaryDirectory()
        cls.output = Path(cls.temporary.name)
        cls.report = train_model(cls.output, scenario_count=24, minutes=55)

    @classmethod
    def tearDownClass(cls):
        cls.temporary.cleanup()

    def service(self):
        service = AiService(self.output / "flood_ai_v1.joblib")
        service.load()
        return service

    def test_training_is_reproducible_and_splits_complete_scenarios(self):
        self.assertEqual(generate_episode(123, 30), generate_episode(123, 30))
        self.assertFalse(set(self.report["train_scenarios"]) & set(self.report["test_scenarios"]))
        self.assertEqual(len(self.report["features"]), len(FEATURE_NAMES))
        self.assertIn("10", self.report["metrics"])
        self.assertGreater(self.report["metrics"]["10"]["test_rows"], 0)
        self.assertIn("baseline_mae_cm", self.report["metrics"]["10"])
        self.assertIn("new_crossing_recall", self.report["metrics"]["10"])

    def test_feature_validation_rejects_missing_or_invalid_inputs(self):
        with self.assertRaises(ValueError):
            feature_vector([], "D2", 20, 40, {"P1": False, "P2": False})
        history = [{"minute": 0, "depths_cm": {"D1": 20, "D2": 30, "POND": 40}}]
        with self.assertRaises(ValueError):
            feature_vector(history, "D2", 20, 40, {"P1": 0, "P2": False})
        with self.assertRaises(ValueError):
            feature_vector(history, "D2", float("nan"), 40, {"P1": False, "P2": False})

    def test_missing_model_is_explicit(self):
        service = AiService(self.output / "missing.joblib")
        service.load()
        response = service.predict(DemoEngine(clock=lambda: 0).snapshot())
        self.assertEqual(response["status"], "unavailable")
        self.assertEqual(response["zones"], [])
        self.assertIn("missing", response["reason"])
        AiPredictionResponse.model_validate(response)

    def test_loading_inference_and_intervention_do_not_mutate_engine(self):
        engine = DemoEngine(clock=lambda: 0)
        state = engine.snapshot()
        before = deepcopy((engine.minute, engine.depths, engine.pumps,
                           list(engine.history), list(engine.events)))
        service = self.service()
        response = service.predict(state)
        self.assertEqual(response["status"], "ready")
        self.assertEqual(response["scenario"], state["scenario"])
        self.assertEqual(response["run_id"], state["run_id"])
        self.assertEqual(len(response["zones"]), 3)
        self.assertEqual([item["horizon_min"] for item in response["zones"][0]["forecasts"]], [5, 10, 20])
        self.assertLess(response["intervention"]["p2_on"]["D2_depth_cm"],
                        response["intervention"]["p2_off"]["D2_depth_cm"])
        self.assertEqual(before, (engine.minute, engine.depths, engine.pumps,
                                  list(engine.history), list(engine.events)))
        AiPredictionResponse.model_validate(response)

    def test_predictions_update_and_prior_prediction_is_verified(self):
        engine = DemoEngine(clock=lambda: 0)
        service = self.service()
        first = service.predict(engine.snapshot())
        engine.command("set_scenario", scenario="EXTREME")
        with engine.lock:
            for _ in range(10):
                engine._tick()
        later = service.predict(engine.snapshot())
        self.assertNotEqual(first["zones"][1]["forecasts"][1]["predicted_cm"],
                            later["zones"][1]["forecasts"][1]["predicted_cm"])
        checked = [item for item in later["prediction_history"] if item["minute"] == 0 and
                   item["zone_id"] == "D2"]
        self.assertEqual(len(checked), 1)
        self.assertIsNotNone(checked[0]["observed_cm"])

    def test_reset_creates_a_new_forecast_run_id(self):
        engine = DemoEngine(clock=lambda: 0)
        service = self.service()
        first = service.predict(engine.snapshot())
        engine.reset()
        later = service.predict(engine.snapshot())
        self.assertNotEqual(first["run_id"], later["run_id"])
        self.assertEqual(later["simulation_minute"], 0)

    def test_unsupported_inputs_and_branch_dry_run_are_explicit(self):
        service = self.service()
        self.assertEqual(service.predict({"minute": 0})["status"], "unsupported")
        state = DemoEngine(clock=lambda: 0).snapshot()
        mismatched = deepcopy(state)
        mismatched["zones"][1]["capacity_cm"] = 90
        self.assertEqual(service.predict(mismatched)["status"], "unsupported")
        state["zones"][1]["depth_cm"] = 10
        comparison = compare_p2(state)
        self.assertFalse(comparison["p2_on"]["available"])
        self.assertIsNone(comparison["D2_reduction_cm"])


if __name__ == "__main__":
    unittest.main()
