import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ResidentSafety } from "../src/components/resident-safety";
import type { TravelMode } from "../src/lib/demo";

vi.mock("next/link", () => ({ default: ({ children, href }: { children: React.ReactNode; href: string }) =>
  <a href={href}>{children}</a> }));

const position = (x: number, y: number) => ({ x, y });
const houses = (["H1", "H2", "H3", "H4"] as const).map((id, index) => ({
  id, name: `${id} homes`, node_id: `N${index + 1}`, zone_id: "D1", position: position(.1 + index * .18, .3),
}));
const nodes = [...houses.map((home) => ({ id: home.node_id, position: home.position })),
  { id: "S", position: position(.8, .8) }];
const eta = { status: "NOT_PREDICTED", minutes: null };
const roads = houses.map((home, index) => ({ id: `R${index + 1}`, start_node: home.node_id, end_node: "S",
  via: [], distance_m: 400 + index * 50, walk_minutes: 6, road_class: "MAIN",
  allowed_modes: ["WALK", "CAR", "MOTORCYCLE"], status: "OPEN", accessible: true,
  closure_eta: eta, zone_id: "D1", reason: "Open" }));
roads.push({ ...roads[0], id: "R5", distance_m: 550 });

function snapshot(homeId = "H2", mode: TravelMode = "WALK", minute = 1, blocked = false) {
  const roadId = `R${Number(homeId.slice(1))}`;
  const recommended = { home_id: homeId, shelter_id: "S1", available: !blocked,
    road_ids: blocked ? [] : [roadId], node_ids: [], total_weight: 1, message: "Modelled route available.",
    reason: "Open modelled roads", kind: "recommended", distance_m: 450,
    walk_minutes: 6, travel_minutes: mode === "WALK" ? 6 : mode === "CAR" ? 2 : 1.5,
    mode, safety_margin_min: null, earliest_closure_min: null, exposure_score: 0,
    segments: [], forecast_assessment: "WINDOW_CLEAR" };
  return { source: "SYNTHETIC_DEMO", version: 1, run_id: "run-one",
    server_timestamp_utc: new Date().toISOString(), minute, simulated_time: `14:${String(minute).padStart(2, "0")}`,
    overall_risk: blocked ? "WARNING" : "NORMAL",
    zones: [{ id: "D1", name: "North drain", position: position(.3, .3), depth_cm: blocked ? 95 : 15,
      capacity_cm: 100, capacity_percent: blocked ? 95 : 15, risk: blocked ? "WARNING" : "NORMAL",
      flood_threshold_cm: 100, flood_eta: eta },
      { id: "D2", name: "South drain", position: position(.6, .3), depth_cm: 40,
        capacity_cm: 100, capacity_percent: 40, risk: "NORMAL", flood_threshold_cm: 80, flood_eta: eta },
      { id: "POND", name: "Retention pond", position: position(.7, .7), depth_cm: 20,
        capacity_cm: 100, capacity_percent: 20, risk: "NORMAL", flood_threshold_cm: 50, flood_eta: eta }],
    roads: blocked ? roads.map((road) => road.id === roadId ? { ...road, status: "CLOSED", accessible: false } : road) : roads,
    nodes, houses, shelter: { id: "S1", name: "Community shelter", node_id: "S", position: position(.8, .8) },
    school: { id: "SCH", name: "School", position: position(.5, .5) },
    time_model: { forecast_horizon_min: 20, walk_speed_m_min: 72, note: "Illustrative travel times." }, route: recommended,
    route_options: blocked ? [] : [recommended, { ...recommended, kind: "alternative", road_ids: ["R5"], distance_m: 550, travel_minutes: 8 }],
    forecast: { source: "TRAINED_ML", status: "ready", run_id: "run-one", simulation_minute: minute,
      predicted_at_utc: new Date().toISOString(), zones: [
        { id: "D1", forecasts: [{ horizon_min: 10, predicted_cm: 30 }, { horizon_min: 20, predicted_cm: 120 }] },
        { id: "D2", forecasts: [{ horizon_min: 10, predicted_cm: 48 }, { horizon_min: 20, predicted_cm: 64 }] },
        { id: "POND", forecasts: [{ horizon_min: 10, predicted_cm: 25 }, { horizon_min: 20, predicted_cm: 30 }] },
      ] },
    notifications: [],
  };
}

function response(value: object) { return { ok: true, json: async () => value }; }
function homeSelect() { return screen.getByLabelText("Select your home") as HTMLSelectElement; }
function mapSvg() {
  const svg = document.querySelector(".resident-map .demo-map-svg") as SVGSVGElement;
  vi.spyOn(svg, "getBoundingClientRect").mockReturnValue({ left: 0, top: 0, width: 1000, height: 640,
    right: 1000, bottom: 640, x: 0, y: 0, toJSON: () => ({}) });
  return svg;
}
function pointer(target: Element, type: string, pointerId: number, clientX: number, clientY: number) {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX, clientY, button: 0 });
  Object.defineProperties(event, { pointerId: { value: pointerId }, pointerType: { value: "touch" } });
  fireEvent(target, event);
}
function drag(svg: SVGSVGElement, fromX: number, toX: number) {
  pointer(svg, "pointerdown", 1, fromX, 320);
  pointer(svg, "pointermove", 1, toX, 320);
  pointer(svg, "pointerup", 1, toX, 320);
}

beforeEach(() => {
  sessionStorage.clear();
  vi.spyOn(document, "hidden", "get").mockReturnValue(false);
  Object.defineProperty(window, "scrollY", { value: 640, writable: true, configurable: true });
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("Resident Safety interactions", () => {
  it("switches all homes using one walking journey without replacing the page", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: string) => {
      const url = new URL(input, "http://localhost");
      return response(snapshot(url.searchParams.get("home_id") ?? "H2",
        (url.searchParams.get("mode") ?? "WALK") as TravelMode));
    }));
    render(<ResidentSafety />);
    await screen.findByLabelText("Select your home");
    const page = document.querySelector(".resident-page");
    const map = document.querySelector(".resident-map");
    const navigation = document.querySelector(".resident-navigation");
    expect(navigation?.children[0].classList.contains("resident-home")).toBe(true);
    expect(navigation?.children[1].classList.contains("resident-map")).toBe(true);
    expect(navigation?.children[2].classList.contains("resident-navigation-summary")).toBe(true);
    expect(document.querySelector(".resident-journey")).toBeNull();
    expect(document.querySelector(".resident-route-details")?.hasAttribute("open")).toBe(false);
    expect(document.querySelector(".demo-home.is-home")).toBeTruthy();
    expect(document.querySelector(".demo-shelter-label")?.textContent).toContain("SHELTER S1");
    expect(document.querySelector(".demo-route-line")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Fit home and shelter on map" })).toBeTruthy();
    expect(document.querySelectorAll(".resident-map .demo-map-zoom button")).toHaveLength(0);
    for (const id of ["H1", "H2", "H3", "H4"]) {
      fireEvent.change(homeSelect(), { target: { value: id } });
      await waitFor(() => expect(document.querySelector(".resident-navigation-summary")?.getAttribute("aria-busy")).toBe("false"));
      expect(homeSelect().value).toBe(id);
      expect(document.querySelector(".resident-page")).toBe(page);
      expect(document.querySelector(".resident-map")).toBe(map);
    }
    expect(sessionStorage.getItem("climatetwin_home")).toBe("H4");
    expect(document.querySelector(".resident-modes")).toBeNull();
    expect(screen.getByText("Estimated on foot")).toBeTruthy();
    expect(within(document.querySelector(".resident-journey-line") as HTMLElement).getByText("450 m")).toBeTruthy();
    expect((fetch as ReturnType<typeof vi.fn>).mock.calls.every(([input]) => new URL(input, "http://localhost").searchParams.get("mode") === "WALK")).toBe(true);
  });

  it("keeps the page and zoomed map mounted while a home request is pending", async () => {
    const pending: { url: string; resolve: (value: ReturnType<typeof response>) => void }[] = [];
    // First request resolves immediately; later requests are held to inspect the intermediate UI.
    let calls = 0;
    vi.stubGlobal("fetch", vi.fn((input: string) => {
      const url = new URL(input, "http://localhost");
      if (calls++ === 0) return Promise.resolve(response(snapshot()));
      return new Promise((resolve) => pending.push({ url: url.search, resolve }));
    }));
    render(<ResidentSafety />);
    await screen.findByLabelText("Select your home");
    const page = document.querySelector(".resident-page");
    const map = document.querySelector(".resident-map");
    const svg = mapSvg();
    fireEvent.wheel(svg, { deltaY: -400, clientX: 500, clientY: 320 });
    drag(svg, 500, 560);
    const zoomedView = svg.getAttribute("viewBox");
    expect(zoomedView).toBeTruthy();
    fireEvent.change(homeSelect(), { target: { value: "H3" } });
    await waitFor(() => expect(pending).toHaveLength(1));
    expect(document.querySelector(".resident-page")).toBe(page);
    expect(document.querySelector(".resident-map")).toBe(map);
    expect(document.querySelector(".demo-map-svg")).toBe(svg);
    expect(svg.getAttribute("viewBox")).not.toBe(zoomedView);
    expect(window.scrollY).toBe(640);
    expect(location.pathname).toBe("/");
    expect(screen.queryByText(/Loading current township conditions/)).toBeNull();
    expect(screen.getByText(/Updating the shelter route for H3/)).toBeTruthy();
    pending.shift()!.resolve(response(snapshot("H3")));
    await waitFor(() => expect(screen.getByText(/NEARBY FLOOD CONDITIONS · H3 homes/)).toBeTruthy());
    expect(within(document.querySelector(".resident-navigation-summary") as HTMLElement).getByText("6.0 min")).toBeTruthy();
    expect(svg.getAttribute("viewBox")).not.toBe(zoomedView);
    expect(window.scrollY).toBe(640);
  });

  it("preserves route choice and map position during a Management-driven update", async () => {
    let latest = snapshot();
    vi.stubGlobal("fetch", vi.fn(async () => response(latest)));
    render(<ResidentSafety />);
    await screen.findByLabelText("Select your home");
    const map = document.querySelector(".resident-map");
    const svg = mapSvg();
    fireEvent.wheel(svg, { deltaY: -400, clientX: 500, clientY: 320 });
    const view = svg.getAttribute("viewBox");
    fireEvent.click(screen.getByText("Route details & warnings"));
    expect(document.querySelector(".resident-route-details")?.hasAttribute("open")).toBe(true);
    fireEvent.click(within(document.querySelector(".resident-alternatives") as HTMLElement).getByRole("button", { name: /Alternative 1/ }));
    expect(document.querySelector(".demo-map-key")?.textContent).toContain("Selected alternative");
    latest = snapshot("H2", "WALK", 2);
    latest.route_options[1].distance_m = 560;
    fireEvent(document, new Event("visibilitychange"));
    await waitFor(() => expect(within(document.querySelector(".resident-journey-line") as HTMLElement).getByText("560 m")).toBeTruthy());
    expect(document.querySelector(".demo-map-key")?.textContent).toContain("Selected alternative");
    expect(document.querySelector(".resident-map")).toBe(map);
    expect(document.querySelector(".demo-map-svg")?.getAttribute("viewBox")).toBe(view);
    expect(window.scrollY).toBe(640);
    expect(screen.queryByText(/Loading current township conditions/)).toBeNull();
  });

  it("pans, pinches and selects markers without confusing a drag for a tap", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => response(snapshot())));
    render(<ResidentSafety />);
    await screen.findByLabelText("Select your home");
    const svg = mapSvg();
    const fitted = svg.getAttribute("viewBox");
    pointer(svg, "pointerdown", 1, 400, 320);
    pointer(svg, "pointerdown", 2, 600, 320);
    pointer(svg, "pointermove", 2, 700, 320);
    pointer(svg, "pointerup", 2, 700, 320);
    pointer(svg, "pointerup", 1, 400, 320);
    const pinched = svg.getAttribute("viewBox")!;
    expect(Number(pinched.split(" ")[2])).toBeLessThan(Number(fitted?.split(" ")[2]));
    drag(svg, 500, 550);
    expect(svg.getAttribute("viewBox")).not.toBe(pinched);
    const marker = document.querySelector('[aria-label="Select H1, H1 homes"]') as SVGGElement;
    pointer(marker, "pointerdown", 3, 150, 190);
    pointer(marker, "pointermove", 3, 210, 190);
    pointer(marker, "pointerup", 3, 210, 190);
    fireEvent.click(marker);
    expect(homeSelect().value).toBe("H2");
    pointer(marker, "pointerdown", 4, 150, 190);
    pointer(marker, "pointerup", 4, 150, 190);
    fireEvent.click(marker);
    expect(homeSelect().value).toBe("H1");
    const zone = document.querySelector('[data-map-zone="D1"]') as SVGGElement;
    pointer(zone, "pointerdown", 5, 300, 200);
    pointer(zone, "pointerup", 5, 300, 200);
    fireEvent.click(zone);
    expect(screen.getByText("Selected drainage area: North drain")).toBeTruthy();
    const road = document.querySelector('[aria-label^="R2,"]') as SVGGElement;
    pointer(road, "pointerdown", 6, 350, 250);
    pointer(road, "pointerup", 6, 350, 250);
    fireEvent.click(road);
    expect(screen.getByText("Selected road: open")).toBeTruthy();
    const shelter = document.querySelector('[aria-label="Select community shelter"]') as SVGGElement;
    pointer(shelter, "pointerdown", 7, 800, 500);
    pointer(shelter, "pointerup", 7, 800, 500);
    fireEvent.click(shelter);
    expect(screen.getByText("Community Shelter S1", { selector: ".resident-selection" })).toBeTruthy();
    svg.focus();
    const beforeKeyboard = svg.getAttribute("viewBox");
    fireEvent.keyDown(svg, { key: "+" });
    expect(svg.getAttribute("viewBox")).not.toBe(beforeKeyboard);
    fireEvent.click(screen.getByRole("button", { name: "Fit home and shelter on map" }));
    expect(svg.getAttribute("viewBox")).toBeTruthy();
  });

  it("updates nearby condition colours and route access after simulation changes", async () => {
    let latest = snapshot();
    vi.stubGlobal("fetch", vi.fn(async () => response(latest)));
    render(<ResidentSafety />);
    await screen.findByText("Nearby roads are open");
    expect(document.querySelector(".resident-status")?.classList.contains("status-normal")).toBe(true);
    latest = snapshot("H2", "WALK", 2);
    latest.roads = latest.roads.map((road) => road.id === "R2" ? { ...road, status: "AT_RISK" } : road);
    latest.zones[0].risk = "WATCH";
    fireEvent(document, new Event("visibilitychange"));
    await screen.findByText("Flood risk is increasing nearby");
    expect(document.querySelector(".resident-status")?.classList.contains("status-caution")).toBe(true);
    latest = snapshot("H2", "WALK", 3, true);
    fireEvent(document, new Event("visibilitychange"));
    await screen.findByText("Flooding is affecting nearby roads");
    expect(document.querySelector(".resident-status")?.classList.contains("status-danger")).toBe(true);
    expect(screen.getByText("No available shelter route in this simulation.")).toBeTruthy();
    expect(screen.getByText("Route updated — road conditions have changed.")).toBeTruthy();
    expect(document.querySelector(".demo-route-line")).toBeNull();
  });

  it("shows all water levels from the warning threshold and keeps current readings when AI is unavailable", async () => {
    let latest = snapshot();
    vi.stubGlobal("fetch", vi.fn(async () => response(latest)));
    render(<ResidentSafety />);
    await screen.findByRole("heading", { name: "Water Levels & AI Forecast" });
    expect(screen.queryByRole("heading", { name: "Nearby alerts" })).toBeNull();
    const cards = document.querySelectorAll(".resident-water-card");
    expect(cards).toHaveLength(3);
    for (const [id, current, ten, twenty] of [["D1", "15%", "30%", "120%"],
      ["D2", "50%", "60%", "80%"], ["POND", "40%", "50%", "60%"]]) {
      const card = document.querySelector(`.resident-water-card[data-zone="${id}"]`) as HTMLElement;
      expect(within(card).getByText(current)).toBeTruthy();
      expect(within(card).getByText(ten)).toBeTruthy();
      expect(within(card).getByText(twenty)).toBeTruthy();
      expect(card.querySelector('[data-period="+20 MIN"] .resident-level-track i')?.getAttribute("style")).toContain(id === "D1" ? "100%" : id === "D2" ? "80%" : "60%");
      expect(document.querySelector(`.resident-map .zone-${id.toLowerCase()} .demo-zone-percent`)).toBeTruthy();
    }
    expect(document.querySelector('[data-period="+5 MIN"]')).toBeNull();
    latest = snapshot("H2", "WALK", 2);
    latest.zones[0].depth_cm = 55;
    latest.forecast = { ...latest.forecast, status: "unavailable", simulation_minute: 2, zones: [] };
    fireEvent(document, new Event("visibilitychange"));
    await within(document.querySelector('.resident-water-card[data-zone="D1"]') as HTMLElement).findByText("55%");
    expect(screen.getByText(/AI forecast unavailable; current levels remain visible/)).toBeTruthy();
    expect(document.querySelectorAll('.resident-water-card[data-zone="D1"] .resident-level small')[1].textContent).toBe("Unavailable");
    expect(document.querySelector('.resident-map .zone-d1 .demo-zone-percent')?.textContent).toBe("55%");
  });

  it("ignores an old response after rapid selection and shows a blocked route", async () => {
    const pending: { home: string; resolve: (value: ReturnType<typeof response>) => void }[] = [];
    let calls = 0;
    vi.stubGlobal("fetch", vi.fn((input: string) => {
      const home = new URL(input, "http://localhost").searchParams.get("home_id") ?? "H2";
      if (calls++ === 0) return Promise.resolve(response(snapshot()));
      return new Promise((resolve) => pending.push({ home, resolve }));
    }));
    render(<ResidentSafety />);
    await screen.findByLabelText("Select your home");
    fireEvent.change(homeSelect(), { target: { value: "H1" } });
    await waitFor(() => expect(pending.some((item) => item.home === "H1")).toBe(true));
    fireEvent.change(homeSelect(), { target: { value: "H4" } });
    await waitFor(() => expect(pending.some((item) => item.home === "H4")).toBe(true));
    pending.find((item) => item.home === "H4")!.resolve(response(snapshot("H4", "WALK", 3, true)));
    await within(document.querySelector(".resident-navigation-summary") as HTMLElement).findByText("No available shelter route in this simulation.");
    pending.find((item) => item.home === "H1")!.resolve(response(snapshot("H1")));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(homeSelect().value).toBe("H4");
    expect(within(document.querySelector(".resident-navigation-summary") as HTMLElement).getByText("No available shelter route in this simulation.")).toBeTruthy();
  });
});
