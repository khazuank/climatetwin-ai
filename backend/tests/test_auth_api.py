"""Authorization and shared-state checks through the actual ASGI routes."""

import os
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient

import auth
import main
from demo import DemoEngine


class AuthApiTests(unittest.TestCase):
    def setUp(self):
        self.credentials = patch.dict(os.environ, {
            "CLIMATETWIN_MANAGEMENT_USERNAME": "demo-manager",
            "CLIMATETWIN_MANAGEMENT_PASSWORD_HASH": auth.make_hash("test-password"),
        })
        self.credentials.start()
        self.addCleanup(self.credentials.stop)
        auth._sessions.clear()
        auth._attempts.clear()
        main._demo = DemoEngine()
        self.manager = TestClient(main.app)
        self.resident = TestClient(main.app)

    def sign_in(self):
        response = self.manager.post("/api/auth/login", json={
            "username": "demo-manager", "password": "test-password"})
        self.assertEqual(response.status_code, 200)
        self.assertIn("httponly", response.headers["set-cookie"].lower())
        return response.json()["csrf_token"]

    def test_invalid_login_missing_and_expired_session(self):
        self.assertEqual(self.resident.get("/api/demo/state").status_code, 401)
        self.assertEqual(self.resident.post("/api/demo/reset").status_code, 401)
        bad = self.manager.post("/api/auth/login", json={"username": "demo-manager", "password": "wrong"})
        self.assertEqual(bad.status_code, 401)
        csrf = self.sign_in()
        self.assertEqual(self.manager.get("/api/auth/session").status_code, 200)
        key = next(iter(auth._sessions))
        auth._sessions[key] = (0, csrf)
        self.assertEqual(self.manager.get("/api/auth/session").status_code, 401)

    def test_csrf_authorized_commands_logout_and_public_read(self):
        csrf = self.sign_in()
        self.assertEqual(self.manager.post("/api/demo/command", json={
            "action": "set_scenario", "scenario": "HEAVY"}).status_code, 403)
        self.assertEqual(self.manager.post("/api/demo/reset").status_code, 403)
        self.assertEqual(self.manager.post("/api/demo/acknowledge", json={
            "event_id": 1, "role": "resident"}).status_code, 403)
        self.assertEqual(self.resident.post("/api/demo/command", json={
            "action": "set_scenario", "scenario": "HEAVY"}, headers={"X-CSRF-Token": csrf}).status_code, 401)
        headers = {"X-CSRF-Token": csrf}
        before = self.resident.get("/api/resident/state?home_id=H1&mode=CAR")
        self.assertEqual(before.status_code, 200)
        self.assertNotIn("pumps", before.json())
        self.assertNotIn("events", before.json())
        self.assertEqual(before.json()["route"]["mode"], "CAR")
        changed = self.manager.post("/api/demo/command", json={
            "action": "set_scenario", "scenario": "HEAVY"}, headers=headers)
        self.assertEqual(changed.status_code, 200)
        after = self.resident.get("/api/resident/state?home_id=H1&mode=CAR").json()
        self.assertEqual(after["run_id"], changed.json()["run_id"])
        self.assertEqual(after["minute"], changed.json()["minute"])
        self.assertEqual(after["zones"], changed.json()["zones"])
        self.assertEqual(after["roads"], changed.json()["roads"])
        self.assertEqual(self.manager.post("/api/demo/reset", headers=headers).status_code, 200)
        reset = self.resident.get("/api/resident/state").json()
        self.assertNotEqual(reset["run_id"], after["run_id"])
        self.assertEqual(reset["minute"], 0)
        self.assertEqual(self.manager.post("/api/auth/logout", headers=headers).status_code, 200)
        self.assertEqual(self.manager.get("/api/demo/state").status_code, 401)
        self.assertEqual(self.resident.get("/api/resident/state").status_code, 200)

    def test_telemetry_mutation_is_also_protected(self):
        self.assertEqual(self.resident.post("/api/telemetry", json={
            "sensor_id": "D1", "distance_cm": 10, "simulated": True}).status_code, 401)

    def test_public_resident_forecast_is_narrow_and_matches_trained_output(self):
        main._demo = DemoEngine(clock=lambda: 0.0)
        public = self.resident.get("/api/resident/state?home_id=H3")
        self.assertEqual(public.status_code, 200)
        state = public.json()
        forecast = state["forecast"]
        self.assertEqual(forecast["source"], "TRAINED_ML")
        self.assertEqual(forecast["status"], "ready")
        self.assertEqual(forecast["run_id"], state["run_id"])
        self.assertEqual(forecast["simulation_minute"], state["minute"])
        self.assertEqual(set(forecast), {"source", "status", "run_id", "simulation_minute",
                                         "predicted_at_utc", "zones"})
        self.assertEqual({zone["id"] for zone in forecast["zones"]}, {"D1", "D2", "POND"})
        self.assertEqual(self.resident.get("/api/demo/ai/v1/predictions").status_code, 401)
        csrf = self.sign_in()
        self.assertTrue(csrf)
        management = self.manager.get("/api/demo/ai/v1/predictions?home_id=H3").json()
        for zone in forecast["zones"]:
            expected = next(item for item in management["zones"] if item["id"] == zone["id"])
            self.assertEqual(zone["forecasts"], [
                {"horizon_min": item["horizon_min"], "predicted_cm": item["predicted_cm"]}
                for item in expected["forecasts"] if item["horizon_min"] in (10, 20)])
            self.assertEqual(len(zone["forecasts"]), 2)
        self.assertNotIn("model", forecast)
        self.assertNotIn("intervention", forecast)

    def test_public_resident_levels_survive_unavailable_ai(self):
        with patch.object(main._ai, "predict", return_value={
            "status": "unavailable", "run_id": "run", "simulation_minute": 0,
            "predicted_at_utc": "2026-10-21T00:00:00Z", "zones": [], "reason": "private model path"}):
            response = self.resident.get("/api/resident/state")
        self.assertEqual(response.status_code, 200)
        state = response.json()
        self.assertEqual(len(state["zones"]), 3)
        self.assertEqual(state["forecast"]["status"], "unavailable")
        self.assertEqual(state["forecast"]["zones"], [])
        self.assertNotIn("private model path", str(state))

    def test_pump_intervention_reaches_public_view_without_duplicate_ticks(self):
        clock = [0.0]
        main._demo = DemoEngine(clock=lambda: clock[0])
        main._demo.depths["D2"] = 40.0
        csrf = self.sign_in()
        response = self.manager.post("/api/demo/command", json={
            "action": "set_pump", "pump_id": "P2", "on": True},
            headers={"X-CSRF-Token": csrf})
        self.assertEqual(response.status_code, 200)
        clock[0] += 2.1
        management = self.manager.get("/api/demo/state").json()
        resident = self.resident.get("/api/resident/state?home_id=H4").json()
        self.assertEqual(management["minute"], resident["minute"])
        self.assertEqual(management["zones"], resident["zones"])
        self.assertEqual(management["roads"], resident["roads"])
        self.assertEqual(management["minute"], 2)
        self.assertTrue(management["pumps"][1]["on"])
        self.assertLess(next(zone["depth_cm"] for zone in resident["zones"] if zone["id"] == "D2"), 40)


if __name__ == "__main__":
    unittest.main()
