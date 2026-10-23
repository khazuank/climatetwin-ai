"""Explainable, in-memory analysis of physical ultrasonic telemetry.

Thresholds are prototype operating rules, not validated flood thresholds.
No reading from a simulated publisher contributes to physical risk analysis.
"""

from collections import deque
from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum
from statistics import median
from typing import Literal
import math


SensorId = Literal["D1", "D2", "POND"]
SENSOR_IDS: tuple[SensorId, ...] = ("D1", "D2", "POND")
STALE_AFTER_SECONDS = 10
TREND_WINDOW_SECONDS = 45
MIN_TREND_SAMPLES = 5
MIN_TREND_SPAN_SECONDS = 20
MAX_HISTORY_PER_SENSOR = 120
MAX_TRANSITIONS = 50
SPIKE_CM = 8
SPIKE_WITHIN_SECONDS = 5


class WarningState(str, Enum):
    NORMAL = "NORMAL"
    WATCH = "WATCH"
    WARNING = "WARNING"
    CRITICAL = "CRITICAL"
    UNKNOWN = "UNKNOWN"


@dataclass(frozen=True)
class WarningThresholds:
    watch_fill_percent: float = 50
    warning_fill_percent: float = 75
    critical_fill_percent: float = 90
    watch_eta_minutes: float = 10
    warning_eta_minutes: float = 5
    critical_eta_minutes: float = 2

    def __post_init__(self) -> None:
        fill = (self.watch_fill_percent, self.warning_fill_percent,
                self.critical_fill_percent)
        eta = (self.watch_eta_minutes, self.warning_eta_minutes,
               self.critical_eta_minutes)
        if not all(math.isfinite(value) for value in (*fill, *eta)) or not (
            0 < fill[0] < fill[1] < fill[2] <= 100
            and eta[0] > eta[1] > eta[2] > 0
        ):
            raise ValueError("Warning thresholds must increase with severity")


@dataclass(frozen=True)
class SensorCalibration:
    sensor_height_cm: float | None = None
    overflow_height_cm: float | None = None
    minimum_reliable_distance_cm: float | None = None
    verified: bool = False

    def __post_init__(self) -> None:
        values = (
            self.sensor_height_cm,
            self.overflow_height_cm,
            self.minimum_reliable_distance_cm,
        )
        if all(value is None for value in values):
            if self.verified:
                raise ValueError("An unconfigured sensor cannot be verified")
            return
        if any(value is None or not math.isfinite(value) for value in values):
            raise ValueError("All calibration dimensions must be finite and supplied")
        height, overflow, minimum = values
        if not (height > 0 and 0 < overflow <= height and 0 <= minimum < height):
            raise ValueError("Inconsistent sensor mounting geometry")

    @property
    def status(self) -> str:
        if self.sensor_height_cm is None:
            return "UNCONFIGURED"
        return "VERIFIED" if self.verified else "UNVERIFIED"


# Physical prototype proposal. Assign it to a specific channel only after its
# mounting geometry is identified. Verification also requires ruler checks.
PIPE_50_40_PROPOSAL = SensorCalibration(50, 40, 25, verified=False)

# Edit each channel independently after checking its actual mounting. No channel
# is assumed to use the 50 cm pipe merely because that pipe exists in the rig.
SENSOR_CALIBRATIONS: dict[SensorId, SensorCalibration] = {
    "D1": SensorCalibration(),
    "D2": SensorCalibration(),
    "POND": SensorCalibration(),
}


@dataclass(frozen=True)
class PhysicalSample:
    distance_cm: float
    received_at_utc: datetime
    quality: str


@dataclass
class SensorRuntime:
    history: deque[PhysicalSample] = field(
        default_factory=lambda: deque(maxlen=MAX_HISTORY_PER_SENSOR)
    )
    state: WarningState = WarningState.UNKNOWN
    pending_state: WarningState | None = None
    pending_count: int = 0


class FloodIntelligenceEngine:
    def __init__(
        self,
        calibrations: dict[SensorId, SensorCalibration],
        thresholds: WarningThresholds = WarningThresholds(),
    ) -> None:
        self.calibrations = {sensor: calibrations[sensor] for sensor in SENSOR_IDS}
        self.thresholds = thresholds
        self.sensors = {sensor: SensorRuntime() for sensor in SENSOR_IDS}
        self.transitions: deque[dict[str, str]] = deque(maxlen=MAX_TRANSITIONS)

    def ingest(
        self,
        sensor_id: SensorId,
        distance_cm: float,
        received_at_utc: datetime,
        simulated: bool,
    ) -> None:
        if simulated:
            return
        runtime = self.sensors[sensor_id]
        calibration = self.calibrations[sensor_id]
        quality = self._range_quality(distance_cm, calibration)
        if quality == "VALID" and self._is_spike(runtime, distance_cm, received_at_utc):
            quality = "SPIKE"
        runtime.history.append(PhysicalSample(distance_cm, received_at_utc, quality))
        analysis = self._analyze(sensor_id, received_at_utc)
        self._advance_state(sensor_id, WarningState(analysis["candidate_state"]), received_at_utc)

    @staticmethod
    def _range_quality(distance: float, calibration: SensorCalibration) -> str:
        if not math.isfinite(distance) or distance < 0:
            return "INVALID"
        if calibration.sensor_height_cm is None:
            return "UNCALIBRATED"
        if distance < calibration.minimum_reliable_distance_cm:
            return "BLIND_ZONE"
        if distance > calibration.sensor_height_cm:
            return "OUT_OF_RANGE"
        return "VALID"

    @staticmethod
    def _is_spike(runtime: SensorRuntime, distance: float, at: datetime) -> bool:
        previous = [
            sample.distance_cm for sample in reversed(runtime.history)
            if sample.quality == "VALID"
            and 0 <= (at - sample.received_at_utc).total_seconds() <= SPIKE_WITHIN_SECONDS
        ][:3]
        return len(previous) >= 3 and abs(distance - median(previous)) >= SPIKE_CM

    @staticmethod
    def _trend(samples: list[PhysicalSample]) -> tuple[str, float | None]:
        if len(samples) < MIN_TREND_SAMPLES:
            return "INSUFFICIENT", None
        span = (samples[-1].received_at_utc - samples[0].received_at_utc).total_seconds()
        if span < MIN_TREND_SPAN_SECONDS:
            return "INSUFFICIENT", None
        # Median of all pairwise slopes (Theil-Sen) resists a noisy sample.
        slopes = []
        for index, first in enumerate(samples):
            for second in samples[index + 1:]:
                seconds = (second.received_at_utc - first.received_at_utc).total_seconds()
                if seconds > 0:
                    slopes.append((first.distance_cm - second.distance_cm) * 60 / seconds)
        if not slopes:
            return "INSUFFICIENT", None
        rate = median(slopes)
        if abs(rate) < 0.5:
            return "STABLE", 0.0
        return ("RISING" if rate > 0 else "FALLING"), rate

    def _analyze(self, sensor_id: SensorId, now: datetime) -> dict:
        calibration = self.calibrations[sensor_id]
        history = self.sensors[sensor_id].history
        latest = history[-1] if history else None
        result = {
            "sensor_id": sensor_id,
            "source": "physical",
            "latest_distance_cm": latest.distance_cm if latest else None,
            "received_at_utc": latest.received_at_utc if latest else None,
            "age_seconds": (now - latest.received_at_utc).total_seconds() if latest else None,
            "water_depth_cm": None,
            "overflow_fill_percent": None,
            "rise_rate_cm_per_min": None,
            "trend": "UNKNOWN",
            "estimated_overflow_minutes": None,
            "measurement_quality": "MISSING",
            "calibration_status": calibration.status,
            "calibration": {
                "sensor_height_cm": calibration.sensor_height_cm,
                "overflow_height_cm": calibration.overflow_height_cm,
                "minimum_reliable_distance_cm": calibration.minimum_reliable_distance_cm,
            },
            "candidate_state": "UNKNOWN",
            "explanation": "No physical reading received.",
            "recommendation": "Check the sensor connection.",
            "recent_depths": [],
        }
        if latest is None:
            return result
        if result["age_seconds"] > STALE_AFTER_SECONDS or result["age_seconds"] < -5:
            result.update(measurement_quality="STALE", explanation="Physical reading is stale.",
                          recommendation="Check sensor transmission before making a flood-risk decision.")
            return result
        if latest.quality != "VALID":
            messages = {
                "UNCALIBRATED": ("Calibration required before flood-risk analysis.", "Measure the mounting geometry and verify it with a ruler."),
                "BLIND_ZONE": ("Sensor is too close to the water surface for reliable measurement.", "Inspect the sensor and water level manually."),
                "OUT_OF_RANGE": ("Distance exceeds the configured sensor height.", "Check the mounting geometry and sensor reading."),
                "INVALID": ("Sensor returned an invalid distance.", "Check the sensor reading."),
                "SPIKE": ("Sudden distance change is inconsistent with recent readings.", "Inspect the sensor for echoes or obstruction."),
            }
            explanation, recommendation = messages[latest.quality]
            result.update(measurement_quality=latest.quality, explanation=explanation,
                          recommendation=recommendation)
            return result
        result["measurement_quality"] = "RANGE_VALID"
        if not calibration.verified:
            result.update(explanation="Calibration requires ruler verification before flood-risk analysis.",
                          recommendation="Verify this sensor's mounting and water-level measurements.")
            return result

        height = calibration.sensor_height_cm
        overflow = calibration.overflow_height_cm
        depth = height - latest.distance_cm
        fill = depth / overflow * 100
        result.update(water_depth_cm=depth, overflow_fill_percent=fill,
                      measurement_quality="VALID")
        valid = [sample for sample in history
                 if sample.quality == "VALID"
                 and 0 <= (now - sample.received_at_utc).total_seconds() <= TREND_WINDOW_SECONDS]
        trend, rate = self._trend(valid)
        result["trend"] = trend
        result["rise_rate_cm_per_min"] = rate
        result["recent_depths"] = [
            {"received_at_utc": sample.received_at_utc,
             "water_depth_cm": height - sample.distance_cm}
            for sample in valid
        ]
        eta = None
        if trend == "RISING" and rate is not None and rate >= 1 and depth < overflow:
            midpoint = len(valid) // 2
            movement = median(sample.distance_cm for sample in valid[:midpoint]) - median(
                sample.distance_cm for sample in valid[midpoint:]
            )
            positive_steps = sum(
                valid[i].distance_cm - valid[i + 1].distance_cm > 0
                for i in range(len(valid) - 1)
            )
            if movement >= 0.8 and positive_steps >= (len(valid) - 1) * 0.6:
                eta = (overflow - depth) / rate
        result["estimated_overflow_minutes"] = eta

        rules = self.thresholds
        if fill >= rules.critical_fill_percent or (eta is not None and eta <= rules.critical_eta_minutes):
            candidate = WarningState.CRITICAL
        elif fill >= rules.warning_fill_percent or (eta is not None and eta <= rules.warning_eta_minutes):
            candidate = WarningState.WARNING
        elif fill >= rules.watch_fill_percent or (eta is not None and eta <= rules.watch_eta_minutes):
            candidate = WarningState.WATCH
        else:
            candidate = WarningState.NORMAL
        result["candidate_state"] = candidate.value
        if eta is not None:
            result["explanation"] = (
                f"Water is rising near {sensor_id}. Linear trend estimates overflow in "
                f"approximately {eta:.1f} minutes."
            )
        elif trend == "RISING":
            result["explanation"] = f"Water is rising near {sensor_id}; no credible overflow time is available."
        elif trend == "FALLING":
            result["explanation"] = f"Water level is falling near {sensor_id}."
        elif trend == "STABLE":
            result["explanation"] = f"Water level is stable near {sensor_id}."
        else:
            result["explanation"] = "Collecting enough readings to establish a trend."
        result["recommendation"] = {
            WarningState.NORMAL: "Continue monitoring.",
            WarningState.WATCH: "Check the sensor and nearby drainage conditions.",
            WarningState.WARNING: "Prepare a site inspection and response team.",
            WarningState.CRITICAL: "Arrange immediate manual inspection and response readiness.",
        }[candidate]
        return result

    def _set_state(self, sensor_id: SensorId, new: WarningState, at: datetime, reason: str) -> None:
        runtime = self.sensors[sensor_id]
        old = runtime.state
        if old != new:
            runtime.state = new
            self.transitions.append({
                "sensor_id": sensor_id, "from_state": old.value,
                "to_state": new.value, "at_utc": at.isoformat(), "reason": reason,
            })

    def _advance_state(self, sensor_id: SensorId, candidate: WarningState, at: datetime) -> None:
        runtime = self.sensors[sensor_id]
        if candidate == WarningState.UNKNOWN:
            runtime.pending_state = None
            runtime.pending_count = 0
            self._set_state(sensor_id, candidate, at, "Reading or calibration unavailable")
            return
        if candidate == runtime.state:
            runtime.pending_state = None
            runtime.pending_count = 0
            return
        if runtime.pending_state != candidate:
            runtime.pending_state = candidate
            runtime.pending_count = 0
        runtime.pending_count += 1
        current_rank = list(WarningState).index(runtime.state) if runtime.state != WarningState.UNKNOWN else -1
        candidate_rank = list(WarningState).index(candidate)
        required = 3 if candidate_rank < current_rank else 2
        if candidate == WarningState.NORMAL and runtime.state == WarningState.UNKNOWN:
            required = 1
        if runtime.pending_count >= required:
            self._set_state(sensor_id, candidate, at, "Persisted threshold assessment")
            runtime.pending_state = None
            runtime.pending_count = 0

    def snapshot(self, now: datetime | None = None) -> dict:
        now = now or datetime.now(timezone.utc)
        sensors = {}
        for sensor_id in SENSOR_IDS:
            analysis = self._analyze(sensor_id, now)
            runtime = self.sensors[sensor_id]
            if analysis["candidate_state"] == "UNKNOWN":
                runtime.pending_state = None
                runtime.pending_count = 0
                self._set_state(sensor_id, WarningState.UNKNOWN, now, analysis["explanation"])
            pending_higher = (
                runtime.pending_state is not None
                and (runtime.state == WarningState.UNKNOWN
                     or list(WarningState).index(runtime.pending_state)
                     > list(WarningState).index(runtime.state))
            )
            analysis["warning_state"] = (
                WarningState.UNKNOWN.value if pending_higher else runtime.state.value
            )
            analysis.pop("candidate_state")
            if pending_higher and analysis["measurement_quality"] == "VALID":
                analysis["explanation"] = "Elevated reading awaits a second physical measurement for confirmation."
                analysis["recommendation"] = "Inspect this sensor while the warning is confirmed."
            sensors[sensor_id] = analysis
        states = [sensor["warning_state"] for sensor in sensors.values()]
        overall = "UNKNOWN" if "UNKNOWN" in states else max(
            states, key=lambda state: list(WarningState).index(WarningState(state))
        )
        return {
            "method": "RULE_BASED_LINEAR_TREND",
            "server_timestamp_utc": now,
            "overall_warning_state": overall,
            "coverage_complete": "UNKNOWN" not in states,
            "sensors": sensors,
            "transitions": list(self.transitions),
        }
