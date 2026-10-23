"""Deterministic synthetic digital-twin checks; run manually with unittest."""

from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
import sys
import unittest

from pydantic import ValidationError

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from demo import (  # noqa: E402
    DemoEngine, HOUSES, NODES, PUMP_CONFIG, ROAD_DEFINITIONS, SHELTER,
    WALK_SPEED_M_MIN, ZONE_CONFIG,
    JUNCTION_DELAY_MIN, MODE_SPEED_M_MIN, PEDESTRIAN_ROADS,
    _balance, _enrich_roads, _find_route, _projection, _roads, _route, _route_options,
    _threshold_eta, _trend,
)
from demo_api import DemoCommandInput, DemoStateResponse  # noqa: E402


class DemoTests(unittest.TestCase):
    def setUp(self):
        self.wall_time = 0.0
        self.engine = DemoEngine(clock=lambda: self.wall_time)

    def tick(self, count):
        with self.engine.lock:
            for _ in range(count):
                self.engine._tick()

    def test_rainfall_increases_levels(self):
        depths = {zone: item["initial_cm"] for zone, item in ZONE_CONFIG.items()}
        next_depths, _ = _balance(depths, 180, {"P1": False, "P2": False})
        self.assertTrue(all(next_depths[zone] > depths[zone] for zone in depths))

    def test_drainage_decreases_levels(self):
        depths = {zone: item["initial_cm"] for zone, item in ZONE_CONFIG.items()}
        next_depths, _ = _balance(depths, 0, {"P1": False, "P2": False})
        self.assertTrue(all(next_depths[zone] < depths[zone] for zone in depths))

    def test_pump_on_off_changes_same_balance(self):
        depths = {"D1": 50, "D2": 50, "POND": 50}
        off, _ = _balance(depths, 100, {"P1": False, "P2": False})
        on, _ = _balance(depths, 100, {"P1": False, "P2": True})
        self.assertLess(on["D2"], off["D2"])
        self.assertAlmostEqual(on["D1"], off["D1"])
        self.assertAlmostEqual(on["POND"], off["POND"])

    def test_volume_balance_and_bounds(self):
        depths = {"D1": 50, "D2": 50, "POND": 50}
        next_depths, spill = _balance(depths, 0, {"P1": False, "P2": False})
        volume_before = sum(depths[z] * ZONE_CONFIG[z]["area_m2"] / 100 for z in depths)
        volume_after = sum(next_depths[z] * ZONE_CONFIG[z]["area_m2"] / 100 for z in depths)
        expected_outflow = sum(item["drain_m3_min"] for item in ZONE_CONFIG.values())
        self.assertAlmostEqual(volume_before - volume_after, expected_outflow)
        self.assertEqual(spill, 0)
        for _ in range(300):
            depths, _ = _balance(depths, 180, {"P1": False, "P2": False})
        self.assertTrue(all(0 <= depths[z] <= ZONE_CONFIG[z]["capacity_cm"] * 1.35 for z in depths))

    def test_robust_trend(self):
        history = [{"minute": minute, "depths_cm": {"D1": depth}}
                   for minute, depth in enumerate((20, 21, 22, 23, 24))]
        trend, rate = _trend(history, "D1")
        self.assertEqual(trend, "RISING")
        self.assertEqual(rate, 1)
        self.assertEqual(_trend(list(reversed(history)), "D1")[0], "INSUFFICIENT")

    def test_threshold_eta_requires_a_rise(self):
        with self.engine.lock:
            self.engine.minute = 4
            self.engine.rainfall = 100
            self.engine.depths["D2"] = 80
            self.engine.history.clear()
            for minute, depth in enumerate((72, 74, 76, 78, 80)):
                self.engine.history.append({"minute": minute, "rainfall_mm_h": 100,
                                            "depths_cm": {"D1": 25, "D2": depth, "POND": 45}})
            zone = next(z for z in self.engine._snapshot_locked("H2")["zones"] if z["id"] == "D2")
            self.assertAlmostEqual(zone["projected_threshold_minutes"], 10)
            self.engine.rainfall = 0
            zone = next(z for z in self.engine._snapshot_locked("H2")["zones"] if z["id"] == "D2")
            self.assertIsNone(zone["projected_threshold_minutes"])

    def test_risk_hysteresis_and_notification_deduplication(self):
        with self.engine.lock:
            self.engine.depths["D2"] = 80
            self.engine._update_risk("D2")
            self.assertEqual(self.engine.risk["D2"], "NORMAL")
            self.engine._update_risk("D2")
            self.assertEqual(self.engine.risk["D2"], "WARNING")
            count = len(self.engine.events)
            for _ in range(8):
                self.engine._update_risk("D2")
            self.assertEqual(len(self.engine.events), count)
            self.engine.depths["D2"] = 65
            for _ in range(3):
                self.engine._update_risk("D2")
            self.assertEqual(self.engine.risk["D2"], "WATCH")

    def test_acknowledgement_is_shared_and_role_specific(self):
        self.engine.command("set_scenario", scenario="HEAVY")
        event_id = self.engine.snapshot()["notifications"][0]["id"]
        updated = self.engine.acknowledge(event_id, "resident")
        event = next(item for item in updated["events"] if item["id"] == event_id)
        self.assertTrue(event["acknowledged_by"]["resident"])
        self.assertFalse(event["acknowledged_by"]["management"])
        self.engine.command("set_pump", pump_id="P1", on=True)
        management_event_id = self.engine.snapshot()["notifications"][0]["id"]
        with self.assertRaisesRegex(ValueError, "not available"):
            self.engine.acknowledge(management_event_id, "resident")

    def test_road_closure_and_route_recalculation(self):
        dry = {"D1": 30, "D2": 30, "POND": 45}
        wet = {"D1": 30, "D2": 71, "POND": 45}
        initial = _route("H2", _roads(dry))
        roads = _roads(wet)
        changed = _route("H2", roads)
        self.assertTrue(initial["available"] and changed["available"])
        self.assertNotEqual(initial["road_ids"], changed["road_ids"])
        self.assertTrue(any(not road["accessible"] for road in roads))
        blocked = {road["id"] for road in roads if not road["accessible"]}
        self.assertTrue(blocked.isdisjoint(changed["road_ids"]))
        self.assertIn("R18", changed["road_ids"])

    def test_no_route_fallback(self):
        roads = [{**road, "accessible": False} for road in _roads(self.engine.depths)]
        route = _route("H2", roads)
        self.assertFalse(route["available"])
        self.assertEqual(route["message"], "No route available in this simulated road network.")
        self.assertEqual(route["road_ids"], [])

    def test_reset_reproduces_starting_state(self):
        self.engine.command("set_scenario", scenario="EXTREME")
        self.tick(30)
        self.engine.command("set_pump", pump_id="P2", on=True)
        reset = self.engine.reset()
        self.assertEqual(reset["minute"], 0)
        self.assertEqual(reset["scenario"], "CLEAR")
        self.assertEqual(reset["rainfall_mm_h"], 0)
        self.assertTrue(all(not pump["on"] for pump in reset["pumps"]))
        self.assertEqual({z["id"]: z["depth_cm"] for z in reset["zones"]},
                         {z: item["initial_cm"] for z, item in ZONE_CONFIG.items()})

    def test_pause_resume_and_single_clock_for_multiple_clients(self):
        self.engine.command("set_scenario", scenario="MODERATE")
        self.engine.command("set_paused", paused=True)
        self.wall_time += 8
        first = self.engine.snapshot("H1")
        second = self.engine.snapshot("H2")
        self.assertEqual(first["minute"], second["minute"])
        self.engine.command("set_paused", paused=False)
        self.wall_time += 1.1
        third = self.engine.snapshot("H1")
        fourth = self.engine.snapshot("H2")
        self.assertEqual(third["minute"], first["minute"] + 1)
        self.assertEqual(third["minute"], fourth["minute"])
        self.assertEqual(third["zones"], fourth["zones"])

    def test_simultaneous_readers_do_not_create_duplicate_ticks(self):
        self.engine.command("set_scenario", scenario="HEAVY")
        self.wall_time += 1.2
        with ThreadPoolExecutor(max_workers=8) as pool:
            minutes = list(pool.map(lambda _: self.engine.snapshot("H2")["minute"], range(16)))
        self.assertEqual(set(minutes), {1})
        self.assertEqual(len(self.engine.history), 2)

    def test_action_validation_and_dry_run_rejection(self):
        with self.assertRaises(ValidationError):
            DemoCommandInput.model_validate({"action": "set_pump", "pump_id": "P2"})
        with self.assertRaises(ValidationError):
            DemoCommandInput.model_validate({"action": "set_speed", "speed": 99})
        with self.assertRaises(ValidationError):
            DemoCommandInput.model_validate({"action": "run_demo", "on": True})
        self.engine.depths[PUMP_CONFIG["P1"]["zone_id"]] = 10
        with self.assertRaisesRegex(ValueError, "Dry-run"):
            self.engine.command("set_pump", pump_id="P1", on=True)

    def test_management_and_resident_views_share_authoritative_state(self):
        management = DemoStateResponse.model_validate(self.engine.snapshot("H2"))
        resident = DemoStateResponse.model_validate(self.engine.snapshot("H4"))
        self.assertEqual(management.zones, resident.zones)
        self.assertEqual(management.pumps, resident.pumps)
        self.assertEqual(management.events, resident.events)
        self.assertNotEqual(management.route.home_id, resident.route.home_id)

    def test_complete_guided_demo_vertical_slice(self):
        initial = self.engine.command("run_demo")
        initial_route = initial["route"]["road_ids"]
        self.tick(55)
        middle = self.engine.snapshot()
        self.assertGreater(middle["rainfall_mm_h"], 0)
        self.assertGreater(middle["zones"][1]["depth_cm"], initial["zones"][1]["depth_cm"])
        self.assertTrue(any(not road["accessible"] for road in middle["roads"]))
        self.assertNotEqual(middle["route"]["road_ids"], initial_route)
        self.assertIn("P2", middle["recommendation"])
        before_pump = middle["zones"][1]["depth_cm"]
        self.engine.command("set_pump", pump_id="P2", on=True)
        self.tick(1)
        after_pump = self.engine.snapshot()
        self.assertTrue(next(p for p in after_pump["pumps"] if p["id"] == "P2")["on"])
        self.assertLess(after_pump["zones"][1]["depth_cm"] - before_pump, 2.0)
        no_pump = DemoEngine(clock=lambda: 0.0)
        no_pump.command("run_demo")
        with no_pump.lock:
            for _ in range(56):
                no_pump._tick()
        self.assertLess(after_pump["zones"][1]["depth_cm"],
                        no_pump.snapshot()["zones"][1]["depth_cm"])
        self.tick(75)
        final = self.engine.snapshot()
        kinds = {event["kind"] for event in final["events"]}
        self.assertTrue({"risk", "road", "route", "pump", "recovery"}.issubset(kinds))
        self.assertEqual(final["rainfall_mm_h"], 0)

    def test_expanded_graph_and_route_distances(self):
        state = self.engine.snapshot("H2")
        self.assertGreater(len(ROAD_DEFINITIONS), 18)
        self.assertTrue(all(start in NODES and end in NODES
                            for _, start, end, *_ in ROAD_DEFINITIONS))
        self.assertIn("SCH1", state["school"]["id"])
        self.assertGreaterEqual(len(state["route_options"]), 2)
        self.assertTrue(all(len(self.engine.snapshot(home_id)["route_options"]) >= 2
                            for home_id in ("H1", "H2", "H3", "H4")))
        paths = [tuple(option["road_ids"]) for option in state["route_options"]]
        self.assertEqual(len(paths), len(set(paths)))
        for option in state["route_options"]:
            self.assertAlmostEqual(option["distance_m"], sum(
                segment["distance_m"] for segment in option["segments"]), places=1)
            self.assertAlmostEqual(option["walk_minutes"], sum(
                segment["walk_minutes"] for segment in option["segments"]), places=1)
            self.assertGreater(option["walk_minutes"], option["distance_m"] / (WALK_SPEED_M_MIN * 1.08) - 0.2)

    def test_roads_do_not_cut_through_pond_or_school(self):
        for _road_id, start, end, _weight, _zone, via in ROAD_DEFINITIONS:
            points = [NODES[start], *via, NODES[end]]
            for a, b in zip(points, points[1:]):
                for step in range(51):
                    x = a[0] + (b[0] - a[0]) * step / 50
                    y = a[1] + (b[1] - a[1]) * step / 50
                    self.assertGreater(((x - .751) / .076) ** 2 + ((y - .722) / .084) ** 2, 1)
                    self.assertFalse(.467 <= x <= .533 and .744 <= y <= .788)

    def test_visible_streets_are_orthogonal_connected_graph_edges(self):
        self.assertEqual(len({road[0] for road in ROAD_DEFINITIONS}), len(ROAD_DEFINITIONS))
        for road_id, start, end, _weight, _zone, via in ROAD_DEFINITIONS:
            points = [NODES[start], *via, NODES[end]]
            self.assertTrue(all(abs(a[0] - b[0]) < 1e-9 or abs(a[1] - b[1]) < 1e-9
                                for a, b in zip(points, points[1:])), road_id)
        self.assertEqual(PEDESTRIAN_ROADS, {"R18"})
        for home_id in ("H1", "H2", "H3", "H4"):
            for mode in MODE_SPEED_M_MIN:
                self.assertTrue(self.engine.snapshot(home_id, mode)["route"]["available"])

    def test_streets_do_not_pass_through_home_or_shelter_footprints(self):
        footprints = [
            (home["position"]["x"] - .022, home["position"]["x"] + .022,
             home["position"]["y"] - .025, home["position"]["y"] + .025)
            for home in HOUSES
        ] + [(SHELTER["position"]["x"] - .048, SHELTER["position"]["x"] + .048,
              SHELTER["position"]["y"] - .031, SHELTER["position"]["y"] + .031),
             (.396, .590, .609, .775)]
        for road_id, start, end, _weight, _zone, via in ROAD_DEFINITIONS:
            points = [NODES[start], *via, NODES[end]]
            for a, b in zip(points, points[1:]):
                for left, right, top, bottom in footprints:
                    intersects = (min(a[0], b[0]) <= right and max(a[0], b[0]) >= left and
                                  min(a[1], b[1]) <= bottom and max(a[1], b[1]) >= top)
                    self.assertFalse(intersects, road_id)

    def test_mode_routes_use_restrictions_and_documented_travel_time(self):
        for home_id in ("H1", "H2", "H3", "H4"):
            for mode in MODE_SPEED_M_MIN:
                state = DemoStateResponse.model_validate(self.engine.snapshot(home_id, mode))
                self.assertEqual(state.route.mode, mode)
                for option in state.route_options:
                    self.assertEqual(len(option.road_ids), len(set(option.road_ids)))
                    self.assertAlmostEqual(option.travel_minutes, round(sum(
                        segment.travel_minutes for segment in option.segments), 2), delta=.02)
                    self.assertTrue(all(mode in next(road for road in state.roads
                        if road.id == road_id).allowed_modes for road_id in option.road_ids))
                    for segment in option.segments:
                        road = next(item for item in state.roads if item.id == segment.road_id)
                        expected = (road.walk_minutes if mode == "WALK" else
                                    road.distance_m / MODE_SPEED_M_MIN[mode] + JUNCTION_DELAY_MIN[mode])
                        self.assertAlmostEqual(segment.travel_minutes, expected, delta=.002)
                if mode != "WALK":
                    self.assertTrue(all("R18" not in option.road_ids for option in state.route_options))
        walking = self.engine.snapshot("H2", "WALK")["route"]
        car = self.engine.snapshot("H2", "CAR")["route"]
        motorcycle = self.engine.snapshot("H2", "MOTORCYCLE")["route"]
        self.assertLess(car["travel_minutes"], walking["travel_minutes"])
        self.assertLess(motorcycle["travel_minutes"], walking["travel_minutes"])

    def test_vehicle_no_route_explains_pedestrian_only_shortcut(self):
        depths = self.engine.depths.copy()
        roads = _enrich_roads(_roads(depths), depths,
                              _projection(depths, 0, self.engine.pumps, "CLEAR", 0))
        restricted = [{**road, "accessible": road["id"] in {"R12", "R18"}}
                      for road in roads]
        self.assertTrue(_route_options("H2", restricted, depths, mode="WALK")[0]["available"])
        car = _route_options("H2", restricted, depths, mode="CAR")[0]
        self.assertFalse(car["available"])
        self.assertIn("car-permitted", car["reason"])

    def test_all_modes_avoid_closed_roads_and_reroute_after_storm(self):
        initial = {mode: tuple(self.engine.snapshot("H2", mode)["route"]["road_ids"])
                   for mode in MODE_SPEED_M_MIN}
        self.engine.command("run_demo")
        self.tick(55)
        for mode in MODE_SPEED_M_MIN:
            state = self.engine.snapshot("H2", mode)
            closed = {road["id"] for road in state["roads"] if road["status"] == "CLOSED"}
            self.assertTrue(closed)
            for option in state["route_options"]:
                self.assertFalse(set(option["road_ids"]) & closed)
                self.assertTrue(all(segment["closure_eta_min"] is None or
                    segment["arrival_min"] < segment["closure_eta_min"]
                    for segment in option["segments"]))
            if state["route"]["available"]:
                self.assertNotEqual(tuple(state["route"]["road_ids"]), initial[mode])

    def test_warning_eta_states_and_guided_countdown(self):
        self.assertEqual(_threshold_eta([], "D2", 75)["status"], "UNAVAILABLE")
        self.assertEqual(_threshold_eta([{"D2": 76}], "D2", 75)["status"], "FLOODED_NOW")
        self.assertEqual(_threshold_eta([{"D2": 50}, {"D2": 75}], "D2", 75)["minutes"], 1)
        self.assertEqual(_threshold_eta([{"D2": 50}, {"D2": 60}], "D2", 75)["status"], "NOT_PREDICTED")
        self.engine.command("run_demo")
        self.tick(35)
        eta = next(zone for zone in self.engine.snapshot()["zones"] if zone["id"] == "D2")["flood_eta"]
        self.assertEqual(eta["status"], "ESTIMATED")
        self.tick(10)
        later = next(zone for zone in self.engine.snapshot()["zones"] if zone["id"] == "D2")["flood_eta"]
        self.assertLess(later["minutes"], eta["minutes"])

    def test_road_eta_uses_linked_zone_hazard_rule(self):
        depths = {"D1": 30, "D2": 68, "POND": 45}
        series = _projection(depths, 180, {"P1": False, "P2": False}, "EXTREME", 0)
        roads = _enrich_roads(_roads(depths), depths, series)
        d2 = next(road for road in roads if road["id"] == "R2")
        self.assertEqual(d2["status"], "AT_RISK")
        self.assertEqual(d2["closure_eta"]["status"], "ESTIMATED")
        self.assertEqual(d2["zone_id"], "D2")
        self.assertEqual(ZONE_CONFIG["D2"]["road_hazard_cm"], 70)

    def test_scenario_and_pump_commands_recompute_projections(self):
        self.engine.depths["D2"] = 66
        clear = self.engine.snapshot()
        storm = self.engine.command("set_scenario", scenario="EXTREME")
        self.assertEqual(next(zone for zone in clear["zones"] if zone["id"] == "D2")
                         ["flood_eta"]["status"], "NOT_PREDICTED")
        self.assertEqual(next(zone for zone in storm["zones"] if zone["id"] == "D2")
                         ["flood_eta"]["status"], "ESTIMATED")
        pumped = self.engine.command("set_pump", pump_id="P2", on=True)
        d2_storm = next(zone for zone in storm["zones"] if zone["id"] == "D2")
        d2_pumped = next(zone for zone in pumped["zones"] if zone["id"] == "D2")
        self.assertTrue(d2_pumped["flood_eta"]["status"] == "NOT_PREDICTED" or
                        d2_pumped["flood_eta"]["minutes"] > d2_storm["flood_eta"]["minutes"])

    def test_safest_fastest_and_shortest_use_distinct_scores(self):
        self.engine.command("run_demo")
        self.tick(40)
        options = self.engine.snapshot("H2")["route_options"]
        safest = options[0]
        self.assertEqual(safest["kind"], "recommended")
        fastest = next(option for option in options if option["kind"] == "fastest")
        self.assertLess(fastest["walk_minutes"], safest["walk_minutes"])
        self.assertLessEqual(safest["exposure_score"], fastest["exposure_score"])
        depths = self.engine.depths.copy()
        roads = _enrich_roads(self.engine._current_roads(), depths,
                              _projection(depths, self.engine.rainfall, self.engine.pumps,
                                          self.engine.scenario, self.engine.minute))
        shortest = _find_route("H2", roads, depths, "shortest")
        self.assertIsNotNone(shortest)
        self.assertLessEqual(shortest["distance_m"], safest["distance_m"])
        self.assertLessEqual(shortest["distance_m"], fastest["distance_m"])
        self.assertTrue(all(segment["closure_eta_min"] is None or
                            segment["arrival_min"] < segment["closure_eta_min"]
                            for option in options for segment in option["segments"]))

    def test_predicted_closure_during_walk_rejects_currently_open_paths(self):
        depths = self.engine.depths.copy()
        roads = _enrich_roads(_roads(depths), depths,
                              _projection(depths, 0, self.engine.pumps, "CLEAR", 0))
        for road in roads:
            if "F" in (road["start_node"], road["end_node"]):
                road["closure_eta"] = {"status": "ESTIMATED", "minutes": 0.1}
        route, options = _route_options("H2", roads, depths)
        self.assertFalse(route["available"])
        self.assertEqual(options, [])
        self.assertTrue(_route("H2", roads)["available"])

    def test_no_route_when_all_edges_currently_closed(self):
        depths = self.engine.depths.copy()
        roads = _enrich_roads(_roads(depths), depths,
                              _projection(depths, 0, self.engine.pumps, "CLEAR", 0))
        route, options = _route_options("H2", [{**road, "accessible": False} for road in roads], depths)
        self.assertFalse(route["available"])
        self.assertEqual(route["road_ids"], [])
        self.assertEqual(options, [])

    def test_pump_outlooks_are_non_mutating_and_respect_dry_run(self):
        before = (self.engine.minute, self.engine.depths.copy(), self.engine.pumps.copy())
        state = self.engine.snapshot()
        self.assertEqual(before, (self.engine.minute, self.engine.depths, self.engine.pumps))
        self.assertEqual({item["pump_id"] for item in state["pump_outlooks"]}, {"P1", "P2"})
        self.assertTrue(all(item["off"]["depth_cm"] >= item["on"]["depth_cm"]
                            for item in state["pump_outlooks"]))
        self.engine.depths["D1"] = 10
        p1 = next(item for item in self.engine.snapshot()["pump_outlooks"] if item["pump_id"] == "P1")
        self.assertFalse(p1["on"]["available"])

    def test_playback_speed_does_not_change_walking_time(self):
        initial = self.engine.snapshot("H2")["route"]["walk_minutes"]
        faster = self.engine.command("set_speed", speed=4)["route"]["walk_minutes"]
        self.assertEqual(initial, faster)


if __name__ == "__main__":
    unittest.main()
