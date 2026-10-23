"""Focused physical-analysis checks. Run with python -m unittest discover -s tests."""

from datetime import datetime, timedelta, timezone
import math
import sys
from pathlib import Path
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from intelligence import (  # noqa: E402
    FloodIntelligenceEngine, PIPE_50_40_PROPOSAL, SENSOR_CALIBRATIONS,
    SensorCalibration, WarningThresholds, MAX_HISTORY_PER_SENSOR,
)


class IntelligenceTests(unittest.TestCase):
    def setUp(self) -> None:
        self.start = datetime(2026, 10, 19, tzinfo=timezone.utc)
        self.verified = SensorCalibration(50, 40, 25, verified=True)
        self.engine = FloodIntelligenceEngine({
            "D1": self.verified,
            "D2": SensorCalibration(),
            "POND": SensorCalibration(),
        })

    def send(self, distance, seconds=0, sensor="D1", simulated=False, engine=None):
        (engine or self.engine).ingest(
            sensor, distance, self.start + timedelta(seconds=seconds), simulated,
        )

    def sensor(self, seconds=0, engine=None, sensor="D1"):
        return (engine or self.engine).snapshot(self.start + timedelta(seconds=seconds))["sensors"][sensor]

    def test_50_cm_sensor_height(self):
        self.send(35)
        self.assertEqual(self.sensor()["water_depth_cm"], 15)

    def test_40_cm_overflow_height(self):
        self.send(35)
        self.assertEqual(self.sensor()["overflow_fill_percent"], 37.5)

    def test_stable_readings(self):
        for second in (0, 5, 10, 15, 20):
            self.send(35, second)
        result = self.sensor(20)
        self.assertEqual(result["trend"], "STABLE")
        self.assertEqual(result["rise_rate_cm_per_min"], 0)
        self.assertIsNone(result["estimated_overflow_minutes"])

    def test_rising_readings(self):
        for second, distance in zip((0, 5, 10, 15, 20), (48, 46, 44, 42, 40)):
            self.send(distance, second)
        result = self.sensor(20)
        self.assertEqual(result["trend"], "RISING")
        self.assertAlmostEqual(result["rise_rate_cm_per_min"], 24)

    def test_falling_readings(self):
        for second, distance in zip((0, 5, 10, 15, 20), (40, 42, 44, 46, 48)):
            self.send(distance, second)
        result = self.sensor(20)
        self.assertEqual(result["trend"], "FALLING")
        self.assertLess(result["rise_rate_cm_per_min"], 0)
        self.assertIsNone(result["estimated_overflow_minutes"])

    def test_missing_reading(self):
        result = self.sensor()
        self.assertEqual(result["measurement_quality"], "MISSING")
        self.assertEqual(result["warning_state"], "UNKNOWN")
        self.assertIsNone(result["water_depth_cm"])

    def test_out_of_range_and_invalid_readings(self):
        self.send(51)
        self.assertEqual(self.sensor()["measurement_quality"], "OUT_OF_RANGE")
        self.send(-1, 1)
        self.assertEqual(self.sensor(1)["measurement_quality"], "INVALID")
        self.send(math.nan, 2)
        self.assertEqual(self.sensor(2)["measurement_quality"], "INVALID")
        self.assertIsNone(self.sensor(2)["water_depth_cm"])

    def test_sensor_blind_zone(self):
        self.send(24.9)
        result = self.sensor()
        self.assertEqual(result["measurement_quality"], "BLIND_ZONE")
        self.assertIsNone(result["overflow_fill_percent"])
        self.assertIsNone(result["estimated_overflow_minutes"])

    def test_sudden_spike(self):
        for second in (0, 1, 2):
            self.send(45, second)
        self.send(30, 3)
        result = self.sensor(3)
        self.assertEqual(result["measurement_quality"], "SPIKE")
        self.assertEqual(result["warning_state"], "UNKNOWN")
        self.assertIsNone(result["water_depth_cm"])

    def test_stale_telemetry(self):
        self.send(35)
        result = self.sensor(11)
        self.assertEqual(result["measurement_quality"], "STALE")
        self.assertEqual(result["warning_state"], "UNKNOWN")
        self.assertIsNone(result["water_depth_cm"])

    def test_missing_calibration(self):
        self.send(35, sensor="D2")
        result = self.sensor(sensor="D2")
        self.assertEqual(result["latest_distance_cm"], 35)
        self.assertEqual(result["calibration_status"], "UNCONFIGURED")
        self.assertIsNone(result["water_depth_cm"])

    def test_unverified_calibration(self):
        engine = FloodIntelligenceEngine({
            "D1": PIPE_50_40_PROPOSAL,
            "D2": SensorCalibration(), "POND": SensorCalibration(),
        })
        self.send(35, engine=engine)
        result = self.sensor(engine=engine)
        self.assertEqual(result["calibration_status"], "UNVERIFIED")
        self.assertEqual(result["warning_state"], "UNKNOWN")
        self.assertIsNone(result["water_depth_cm"])

    def test_estimated_time_to_overflow(self):
        for second, distance in zip((0, 5, 10, 15, 20), (48, 46, 44, 42, 40)):
            self.send(distance, second)
        result = self.sensor(20)
        self.assertAlmostEqual(result["estimated_overflow_minutes"], 1.25)
        self.assertEqual(result["warning_state"], "UNKNOWN")
        self.send(38, 25)
        confirmed = self.sensor(25)
        self.assertEqual(confirmed["warning_state"], "CRITICAL")
        self.assertIn("Linear trend", confirmed["explanation"])

    def test_alert_persistence_and_transitions(self):
        self.send(45, 0)
        self.assertEqual(self.sensor(0)["warning_state"], "NORMAL")
        self.send(45, 2)
        self.send(29, 10)
        self.assertEqual(self.sensor(10)["warning_state"], "UNKNOWN")
        self.send(29, 12)
        self.assertEqual(self.sensor(12)["warning_state"], "WATCH")
        for second in (20, 22):
            self.send(45, second)
        self.assertEqual(self.sensor(22)["warning_state"], "WATCH")
        self.send(45, 24)
        self.assertEqual(self.sensor(24)["warning_state"], "NORMAL")
        transitions = self.engine.snapshot(self.start + timedelta(seconds=24))["transitions"]
        self.assertEqual([item["to_state"] for item in transitions], ["NORMAL", "WATCH", "NORMAL"])

    def test_simulated_packets_do_not_enter_physical_history(self):
        self.send(35, simulated=True)
        self.assertEqual(self.sensor()["measurement_quality"], "MISSING")
        self.assertEqual(len(self.engine.sensors["D1"].history), 0)

    def test_history_is_bounded_and_channels_independent(self):
        for second in range(150):
            self.send(45, second * 2)
        self.assertEqual(len(self.engine.sensors["D1"].history), MAX_HISTORY_PER_SENSOR)
        self.assertEqual(len(self.engine.sensors["D2"].history), 0)
        self.assertEqual(SENSOR_CALIBRATIONS["POND"].status, "UNCONFIGURED")

    def test_warning_thresholds_are_configurable(self):
        engine = FloodIntelligenceEngine({
            "D1": self.verified,
            "D2": SensorCalibration(), "POND": SensorCalibration(),
        }, WarningThresholds(watch_fill_percent=30))
        self.send(35, 0, engine=engine)
        self.send(35, 2, engine=engine)
        self.assertEqual(self.sensor(2, engine=engine)["warning_state"], "WATCH")
        with self.assertRaises(ValueError):
            WarningThresholds(watch_fill_percent=80)


if __name__ == "__main__":
    unittest.main()
