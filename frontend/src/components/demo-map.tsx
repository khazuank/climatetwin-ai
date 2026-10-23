"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from "react";
import { LocateFixed } from "lucide-react";
import { etaLabel } from "@/lib/demo";
import type { DemoRoad, DemoRoute, DemoState, Point } from "@/lib/demo";

export type MapItem = { kind: "zone" | "road" | "home" | "pump" | "shelter"; id: string };
const WIDTH = 1000;
const HEIGHT = 640;
const MAX_RESIDENT_ZOOM = 3;
type Camera = { zoom: number; centre: { x: number; y: number } };
type PointerPosition = { x: number; y: number; startX: number; startY: number };

function boundedCamera(zoom: number, x: number, y: number): Camera {
  const boundedZoom = Math.max(1, Math.min(MAX_RESIDENT_ZOOM, zoom));
  const halfWidth = WIDTH / boundedZoom / 2;
  const halfHeight = HEIGHT / boundedZoom / 2;
  return { zoom: boundedZoom, centre: {
    x: Math.max(halfWidth, Math.min(WIDTH - halfWidth, x)),
    y: Math.max(halfHeight, Math.min(HEIGHT - halfHeight, y)),
  } };
}

function fittedCamera(state: Pick<DemoState, "nodes" | "roads" | "houses" | "shelter">,
  homeId: string, route?: DemoRoute): Camera {
  const points: Point[] = [];
  const home = state.houses.find((item) => item.id === homeId);
  if (home) points.push(home.position);
  points.push(state.shelter.position);
  if (route?.available && route.home_id === homeId) {
    const nodes = new Map(state.nodes.map((node) => [node.id, node.position]));
    for (const road of state.roads) if (route.road_ids.includes(road.id)) {
      const start = nodes.get(road.start_node);
      const end = nodes.get(road.end_node);
      if (start) points.push(start);
      points.push(...road.via);
      if (end) points.push(end);
    }
  }
  if (points.length < 2) return boundedCamera(1, WIDTH / 2, HEIGHT / 2);
  const xs = points.map((point) => point.x * WIDTH);
  const ys = points.map((point) => point.y * HEIGHT);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const zoom = Math.min(MAX_RESIDENT_ZOOM, WIDTH / (maxX - minX + 190), HEIGHT / (maxY - minY + 150));
  return boundedCamera(zoom, (minX + maxX) / 2, (minY + maxY) / 2);
}
const xy = (point: Point) => `${(point.x * WIDTH).toFixed(1)},${(point.y * HEIGHT).toFixed(1)}`;
const housing = [
  { x: 157, y: 186, cols: 4, rows: 3 }, { x: 396, y: 185, cols: 3, rows: 2 },
  { x: 651, y: 185, cols: 2, rows: 3 }, { x: 156, y: 377, cols: 4, rows: 3 },
  { x: 653, y: 370, cols: 2, rows: 2 }, { x: 158, y: 550, cols: 4, rows: 1 },
  { x: 655, y: 550, cols: 4, rows: 1 },
];
const trees = [[102,184],[104,280],[215,310],[312,314],[419,309],[550,307],[699,307],
  [786,307],[909,202],[906,290],[104,407],[307,477],[688,507],[806,507],[420,569],[549,570]];

function roadPath(road: DemoRoad, nodes: Map<string, Point>) {
  const start = nodes.get(road.start_node);
  const end = nodes.get(road.end_node);
  if (!start || !end) return "";
  return `M ${[start, ...road.via, end].map(xy).join(" L ")}`;
}

function activate(event: KeyboardEvent<SVGGElement>, action: () => void) {
  if (event.key === "Enter" || event.key === " ") { event.preventDefault(); action(); }
}

export function DemoMap({ state, homeId, onHome, selection, onSelect, route, resident = false, routeReady = true }: {
  state: Pick<DemoState, "nodes" | "roads" | "houses" | "zones" | "route" | "shelter" | "school" | "time_model"> & { pumps?: DemoState["pumps"] }; homeId: string; onHome: (id: string) => void;
  selection: MapItem | null; onSelect: (item: MapItem) => void;
  route?: DemoRoute; resident?: boolean; routeReady?: boolean;
}) {
  const [zoom, setZoom] = useState(1);
  const [centre, setCentre] = useState({ x: WIDTH / 2, y: HEIGHT / 2 });
  const cameraRef = useRef<Camera>({ zoom: 1, centre: { x: WIDTH / 2, y: HEIGHT / 2 } });
  const svgRef = useRef<SVGSVGElement | null>(null);
  const gestures = useRef({ pointers: new Map<number, PointerPosition>(), moved: false, suppressClick: false });
  const lastHome = useRef<string | null>(null);
  const fitPending = useRef(true);
  const commitCamera = useCallback((camera: Camera) => {
    cameraRef.current = camera;
    setZoom(camera.zoom);
    setCentre(camera.centre);
  }, []);
  const nodes = new Map(state.nodes.map((node) => [node.id, node.position]));
  const candidateRoute = route ?? state.route;
  const displayedRoute = useMemo(() => candidateRoute.home_id === homeId ? candidateRoute :
    { ...candidateRoute, available: false, road_ids: [] }, [candidateRoute, homeId]);
  const routeRoads = new Set(displayedRoute.available ? displayedRoute.road_ids : []);
  const blocked = state.roads.filter((road) => road.status === "CLOSED").length;
  const atRisk = state.roads.filter((road) => road.status === "AT_RISK").length;
  const routeKey = displayedRoute.available ? displayedRoute.road_ids.join(",") : "";
  useEffect(() => {
    if (!resident) return;
    if (lastHome.current !== homeId) {
      lastHome.current = homeId;
      fitPending.current = true;
      commitCamera(fittedCamera(state, homeId, routeReady ? displayedRoute : undefined));
    }
    if (routeReady && fitPending.current) {
      commitCamera(fittedCamera(state, homeId, displayedRoute));
      fitPending.current = false;
    }
  }, [resident, homeId, routeReady, routeKey, state, displayedRoute, commitCamera]);

  const zoomAt = useCallback((clientX: number, clientY: number, factor: number) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect?.width || !rect.height) return;
    const current = cameraRef.current;
    const nextZoom = Math.max(1, Math.min(MAX_RESIDENT_ZOOM, current.zoom * factor));
    const fractionX = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const fractionY = Math.max(0, Math.min(1, (clientY - rect.top) / rect.height));
    const anchorX = current.centre.x + (fractionX - .5) * WIDTH / current.zoom;
    const anchorY = current.centre.y + (fractionY - .5) * HEIGHT / current.zoom;
    commitCamera(boundedCamera(nextZoom,
      anchorX - (fractionX - .5) * WIDTH / nextZoom,
      anchorY - (fractionY - .5) * HEIGHT / nextZoom));
  }, [commitCamera]);
  const panPixels = useCallback((dx: number, dy: number) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect?.width || !rect.height) return;
    const current = cameraRef.current;
    commitCamera(boundedCamera(current.zoom,
      current.centre.x - dx / rect.width * WIDTH / current.zoom,
      current.centre.y - dy / rect.height * HEIGHT / current.zoom));
  }, [commitCamera]);
  useEffect(() => {
    if (!resident || !svgRef.current) return;
    const svg = svgRef.current;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 200 : 1);
      zoomAt(event.clientX, event.clientY, Math.exp(-delta * .0015));
    };
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  }, [resident, zoomAt]);

  function pointerDown(event: ReactPointerEvent<SVGSVGElement>) {
    if (!resident || (event.pointerType === "mouse" && event.button !== 0)) return;
    const gesture = gestures.current;
    if (gesture.pointers.size === 0) { gesture.moved = false; gesture.suppressClick = false; }
    gesture.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY,
      startX: event.clientX, startY: event.clientY });
    if (gesture.pointers.size > 1) {
      gesture.moved = true;
      gesture.suppressClick = true;
      for (const id of gesture.pointers.keys()) event.currentTarget.setPointerCapture?.(id);
    }
  }
  function pointerMove(event: ReactPointerEvent<SVGSVGElement>) {
    const gesture = gestures.current;
    const prior = gesture.pointers.get(event.pointerId);
    if (!resident || !prior) return;
    const before = [...gesture.pointers.values()];
    const next = { ...prior, x: event.clientX, y: event.clientY };
    gesture.pointers.set(event.pointerId, next);
    if (gesture.pointers.size > 1) {
      const after = [...gesture.pointers.values()];
      const oldCentre = { x: (before[0].x + before[1].x) / 2, y: (before[0].y + before[1].y) / 2 };
      const newCentre = { x: (after[0].x + after[1].x) / 2, y: (after[0].y + after[1].y) / 2 };
      const oldDistance = Math.hypot(before[0].x - before[1].x, before[0].y - before[1].y);
      const newDistance = Math.hypot(after[0].x - after[1].x, after[0].y - after[1].y);
      panPixels(newCentre.x - oldCentre.x, newCentre.y - oldCentre.y);
      if (oldDistance > 0) zoomAt(newCentre.x, newCentre.y, newDistance / oldDistance);
      gesture.moved = true; gesture.suppressClick = true;
    } else if (gesture.moved || Math.hypot(next.x - next.startX, next.y - next.startY) > 5) {
      gesture.moved = true; gesture.suppressClick = true;
      event.currentTarget.setPointerCapture?.(event.pointerId);
      panPixels(next.x - prior.x, next.y - prior.y);
    }
  }
  function pointerEnd(event: ReactPointerEvent<SVGSVGElement>) {
    const gesture = gestures.current;
    if (!gesture.pointers.has(event.pointerId)) return;
    gesture.pointers.delete(event.pointerId);
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (gesture.pointers.size === 0) gesture.moved = false;
  }
  function preventDragClick(event: ReactMouseEvent<SVGSVGElement>) {
    if (!gestures.current.suppressClick) return;
    event.preventDefault(); event.stopPropagation();
    gestures.current.suppressClick = false;
  }
  function mapKeyDown(event: KeyboardEvent<SVGSVGElement>) {
    if (!resident || event.target !== event.currentTarget) return;
    const rect = svgRef.current?.getBoundingClientRect();
    const x = rect ? rect.left + rect.width / 2 : 0;
    const y = rect ? rect.top + rect.height / 2 : 0;
    const step = 90;
    if (event.key === "ArrowLeft") panPixels(step, 0);
    else if (event.key === "ArrowRight") panPixels(-step, 0);
    else if (event.key === "ArrowUp") panPixels(0, step);
    else if (event.key === "ArrowDown") panPixels(0, -step);
    else if (event.key === "+" || event.key === "=") zoomAt(x, y, 1.25);
    else if (event.key === "-" || event.key === "_") zoomAt(x, y, .8);
    else if (event.key === "Home") commitCamera(fittedCamera(state, homeId, displayedRoute));
    else return;
    event.preventDefault();
  }
  const padding = resident ? 0 : 18;
  const visibleWidth = (WIDTH + padding * 2) / zoom;
  const visibleHeight = (HEIGHT + padding * 2) / zoom;
  const left = Math.max(-padding, Math.min(WIDTH + padding - visibleWidth, centre.x - visibleWidth / 2));
  const top = Math.max(-padding, Math.min(HEIGHT + padding - visibleHeight, centre.y - visibleHeight / 2));
  function pan(dx: number, dy: number) {
    setCentre((current) => ({ x: Math.max(0, Math.min(WIDTH, current.x + dx * visibleWidth / 3)),
      y: Math.max(0, Math.min(HEIGHT, current.y + dy * visibleHeight / 3)) }));
  }
  function reset() { setZoom(1); setCentre({ x: WIDTH / 2, y: HEIGHT / 2 }); }
  return <div className="demo-map-frame">
    <div className="demo-map-header"><div><strong>Taman ClimateTwin</strong>
      <span>{resident ? "Illustrative township" : `Illustrative Malaysian township · ${state.roads.length} connected streets and paths`}</span></div>
      <div className="demo-map-tools">{resident ? <><span className="demo-map-key"><i className={displayedRoute.kind === "recommended" ? "route-key" : "alternative-key"} /> {displayedRoute.kind === "recommended" ? "Recommended route" : "Selected alternative"}
        <i className="risk-key" /> At risk {atRisk} <i className="blocked-key" /> Closed {blocked}</span>
        <button type="button" className="resident-map-recenter" aria-label="Fit home and shelter on map"
          onClick={() => commitCamera(fittedCamera(state, homeId, displayedRoute))}><LocateFixed size={18} /></button></> : <span className="demo-map-key"><span><i />Normal</span><span><i className="risk-key" />At risk</span><span><i className="route-key" />Route</span><span><i className="blocked-key" />Closed</span></span>}</div>
      {!resident && <div className="demo-map-home-shortcuts" role="group" aria-label="Select a home on the map">
        {state.houses.map((home) => <button type="button" key={home.id} className={homeId === home.id ? "is-active" : ""}
          onClick={() => { onHome(home.id); onSelect({ kind: "home", id: home.id }); }}>
          {home.id} <span>{home.name}</span>
        </button>)}
      </div>}</div>
    <div className="demo-map-canvas">
    <svg ref={svgRef} viewBox={`${left} ${top} ${visibleWidth} ${visibleHeight}`} preserveAspectRatio="xMidYMid meet" className="demo-map-svg" role="group" tabIndex={resident ? 0 : undefined}
      onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerEnd} onPointerCancel={pointerEnd}
      onClickCapture={preventDragClick} onKeyDown={mapKeyDown}
      aria-label={resident ? "Interactive illustrative township map. Drag to pan, pinch or use the mouse wheel to zoom. Keyboard: arrows pan, plus and minus zoom, Home fits the route." : "Interactive illustrative township map with streets, homes, drains, pond, pumps and shelter"}>
      <defs>
        <linearGradient id="management-grass" x2="1" y2="1"><stop stopColor="#d9e7c9" /><stop offset=".5" stopColor="#e8efd9" /><stop offset="1" stopColor="#c9dfbf" /></linearGradient>
        <linearGradient id="management-roof" x2="0" y2="1"><stop stopColor="#e3a384" /><stop offset="1" stopColor="#c57c5e" /></linearGradient>
        <linearGradient id="management-house" x2="0" y2="1"><stop stopColor="#fffcf0" /><stop offset="1" stopColor="#f1e3c9" /></linearGradient>
        <radialGradient id="management-tree"><stop stopColor="#b8cf87" /><stop offset=".7" stopColor="#8dae67" /><stop offset="1" stopColor="#719b59" /></radialGradient>
      </defs>
      <rect width={WIDTH} height={HEIGHT} fill="#dbe9d7" className="demo-map-grass" />
      <path d={resident ? "M35 45H965V608H35Z" : "M95 38H905Q970 38 970 100V610H30V100Q30 38 95 38Z"} fill="#eaf0df" stroke="#b8d1b8" strokeWidth="2" className="demo-map-boundary" />
      <g className="demo-map-parcels">{[[141,155,216,165],[383,155,223,165],[634,155,212,165],
        [141,347,216,162],[383,347,223,162],[634,347,212,162]].map(([x,y,w,h],i) =>
        <rect key={i} x={x} y={y} width={w} height={h} rx="8" />)}</g>
      <g className="demo-map-housing">{housing.flatMap((block, index) =>
        Array.from({ length: block.cols * block.rows }, (_, item) => {
          const x = block.x + item % block.cols * 43;
          const y = block.y + Math.floor(item / block.cols) * 39;
          return <g key={`${index}-${item}`}><rect x={x} y={y} width="30" height="24" rx="2" className="demo-house-plot" />
            <path d={`M ${x - 2} ${y + 7} L ${x + 15} ${y - 3} L ${x + 32} ${y + 7} Z`} className="demo-house-roof" /></g>;
        }))}</g>
      <g className="demo-map-landscape">{trees.map(([x,y],i) =>
        <g key={i}><circle cx={x} cy={y} r="10" /><circle cx={x - 3} cy={y - 3} r="4" /></g>)}</g>
      <g className="demo-pond-shape"><ellipse cx="750" cy="454" rx="75" ry="49" />
        <ellipse cx="750" cy="454" rx="62" ry="37" /><text x="750" y="429" textAnchor="middle">KOLAM TADAHAN</text></g>
      <g className="demo-school-grounds"><rect x="396" y="390" width="194" height="106" rx="8" />
        <rect x="407" y="402" width="66" height="52" rx="3" /><rect x="484" y="402" width="94" height="78" rx="6" />
        <path d="M531 403V479 M485 440H578" /><text x="440" y="433" textAnchor="middle">SEKOLAH</text></g>
      <g className="demo-map-area-labels"><text x="158" y="169">TAMAN UTARA</text>
        <text x="651" y="169">TAMAN TIMUR</text><text x="158" y="362">TAMAN SELATAN</text></g>
      {state.zones.map((zone) => <g key={zone.id} role="button" tabIndex={0} className={`demo-map-target zone-${zone.id.toLowerCase()}`} data-map-zone={zone.id}
        aria-label={`${zone.name}, ${(zone.depth_cm / zone.flood_threshold_cm * 100).toFixed(0)} percent of warning level, ${zone.risk.toLowerCase()} risk, ${etaLabel(zone.flood_eta, state.time_model.forecast_horizon_min)}`}
        onClick={() => onSelect({ kind: "zone", id: zone.id })}
        onKeyDown={(event) => activate(event, () => onSelect({ kind: "zone", id: zone.id }))}>
        <circle cx={zone.position.x * WIDTH} cy={zone.position.y * HEIGHT} r={resident ? 30 : 36}
          className={`demo-flood-zone risk-${zone.risk.toLowerCase()}`} />
        <circle cx={zone.position.x * WIDTH} cy={zone.position.y * HEIGHT} r={resident ? 24 : 29}
          className={`demo-zone-centre ${selection?.id === zone.id ? "selected" : ""}`} />
        <circle cx={zone.position.x * WIDTH} cy={zone.position.y * HEIGHT} r={resident ? 26 : 32}
          className={`demo-zone-progress risk-${zone.risk.toLowerCase()}`}
          transform={`rotate(-90 ${zone.position.x * WIDTH} ${zone.position.y * HEIGHT})`}
          strokeDasharray={`${Math.min(100, Math.max(0, zone.depth_cm / zone.flood_threshold_cm * 100)) * (resident ? 1.634 : 2.011)} ${resident ? 164 : 202}`} />
        <text x={zone.position.x * WIDTH} y={zone.position.y * HEIGHT - 2} textAnchor="middle" className="demo-zone-id">{zone.id}</text>
        <text x={zone.position.x * WIDTH} y={zone.position.y * HEIGHT + 13} textAnchor="middle" className="demo-zone-percent">{(zone.depth_cm / zone.flood_threshold_cm * 100).toFixed(0)}%</text>
        <text x={zone.position.x * WIDTH} y={zone.position.y * HEIGHT - (resident ? 37 : 44)} textAnchor="middle" className="demo-zone-name">{zone.id === "POND" ? "Retention Pond" : zone.name}</text>
        {!resident && zone.risk !== "NORMAL" && <text x={zone.position.x * WIDTH} y={zone.position.y * HEIGHT + 49} textAnchor="middle" className={`demo-zone-risk risk-${zone.risk.toLowerCase()}`}>{zone.risk}</text>}
        {zone.depth_cm > zone.flood_threshold_cm && <text x={zone.position.x * WIDTH} y={zone.position.y * HEIGHT + (resident ? 43 : 62)} textAnchor="middle" className="demo-zone-overflow">ABOVE WARNING</text>}
      </g>)}
      <g fill="none" strokeLinecap="round" strokeLinejoin="round">
        {state.roads.map((road) => <g key={road.id} role="button" tabIndex={0} className="demo-map-target"
          aria-label={`${road.id}, ${road.road_class.toLowerCase()} ${road.status.toLowerCase()}, ${etaLabel(road.closure_eta, state.time_model.forecast_horizon_min)}`}
          onClick={() => onSelect({ kind: "road", id: road.id })}
          onKeyDown={(event) => activate(event, () => onSelect({ kind: "road", id: road.id }))}>
          <path d={roadPath(road, nodes)} className="demo-road-base" strokeWidth={road.road_class === "MAIN" ? 24 : road.road_class === "PEDESTRIAN" ? 9 : 18} />
          <path d={roadPath(road, nodes)} className={`demo-road is-${road.status.toLowerCase()} ${selection?.id === road.id ? "is-selected" : ""}`}
            strokeWidth={road.road_class === "MAIN" ? 18 : road.road_class === "PEDESTRIAN" ? 5 : 12} />
          {road.road_class === "MAIN" && road.status === "OPEN" &&
            <path d={roadPath(road, nodes)} className="demo-road-centreline" strokeWidth="1.5" strokeDasharray="11 10" pointerEvents="none" />}
          <path d={roadPath(road, nodes)} stroke="transparent" strokeWidth="25" />
        </g>)}
        {displayedRoute.available && state.roads.filter((road) => routeRoads.has(road.id)).map((road) =>
          <path key={`route-${road.id}`} d={roadPath(road, nodes)} className={`demo-route-line ${displayedRoute.kind === "recommended" ? "" : "is-alternative"}`}
            strokeWidth="6" pointerEvents="none" />)}
      </g>
      {!resident && state.nodes.filter((node) => ["B", "F", "G"].includes(node.id)).map((node) =>
        <g key={node.id}><circle cx={node.position.x * WIDTH} cy={node.position.y * HEIGHT} r="12" className="demo-junction" />
          <text x={node.position.x * WIDTH} y={node.position.y * HEIGHT + 4} textAnchor="middle" className="demo-junction-label">J</text></g>)}
      {state.houses.map((home) => <g key={home.id} role="button" tabIndex={0} className="demo-map-target"
        aria-label={`Select ${home.id}, ${home.name}`}
        onClick={() => { onHome(home.id); onSelect({ kind: "home", id: home.id }); }}
        onKeyDown={(event) => activate(event, () => { onHome(home.id); onSelect({ kind: "home", id: home.id }); })}>
        <rect x={home.position.x * WIDTH - 22} y={home.position.y * HEIGHT - 16} width="44" height="32" rx="5"
          className={`demo-home ${homeId === home.id ? "is-home" : ""}`} />
        <text x={home.position.x * WIDTH} y={home.position.y * HEIGHT + 5} textAnchor="middle" className="demo-home-label">{home.id}</text>
      </g>)}
      {!resident && state.pumps?.map((pump) => <g key={pump.id} role="button" tabIndex={0} className="demo-map-target"
        aria-label={`${pump.id} virtual pump ${pump.on ? "on" : state.zones.find((zone) => zone.id === pump.zone_id)!.depth_cm <= pump.minimum_depth_cm ? "unavailable" : "off"}`}
        onClick={() => onSelect({ kind: "pump", id: pump.id })}
        onKeyDown={(event) => activate(event, () => onSelect({ kind: "pump", id: pump.id }))}>
        <circle cx={pump.position.x * WIDTH} cy={pump.position.y * HEIGHT} r="18" className={`demo-pump-marker ${pump.on ? "is-on" : state.zones.find((zone) => zone.id === pump.zone_id)!.depth_cm <= pump.minimum_depth_cm ? "is-unavailable" : ""}`} />
        <text x={pump.position.x * WIDTH} y={pump.position.y * HEIGHT + 4} textAnchor="middle" className="demo-pump-label">{pump.id}</text>
        <text x={pump.position.x * WIDTH} y={pump.position.y * HEIGHT + 31} textAnchor="middle" className="demo-pump-status">{pump.on ? "ON" : state.zones.find((zone) => zone.id === pump.zone_id)!.depth_cm <= pump.minimum_depth_cm ? "UNAVAILABLE" : "OFF"}</text>
      </g>)}
      <g role="button" tabIndex={0} className="demo-map-target" aria-label="Select community shelter"
        onClick={() => onSelect({ kind: "shelter", id: state.shelter.id })}
        onKeyDown={(event) => activate(event, () => onSelect({ kind: "shelter", id: state.shelter.id }))}>
        <rect x={state.shelter.position.x * WIDTH - 48} y={state.shelter.position.y * HEIGHT - 20}
          width="96" height="40" rx="6" className="demo-shelter" />
        <text x={state.shelter.position.x * WIDTH} y={state.shelter.position.y * HEIGHT + 5}
          textAnchor="middle" className="demo-shelter-label">SHELTER S1</text>
      </g>
      <text x="25" y="628" className="demo-map-disclaimer">ILLUSTRATIVE TOWNSHIP · NOT A REAL EVACUATION MAP</text>
    </svg>
    {!resident && <div className="management-map-navigation" role="group" aria-label="Map view controls"><div>
      <button type="button" aria-label="Zoom map in" onClick={() => setZoom((value) => Math.min(2.2, value + 0.4))}>+</button>
      <button type="button" aria-label="Zoom map out" onClick={() => setZoom((value) => Math.max(1, value - 0.4))}>−</button></div>
      <button type="button" aria-label="Reset map view" onClick={reset}><LocateFixed size={20} /></button>
      <div className="demo-map-pan"><button aria-label="Pan map left" onClick={() => pan(-1, 0)}>←</button><button aria-label="Pan map right" onClick={() => pan(1, 0)}>→</button><button aria-label="Pan map up" onClick={() => pan(0, -1)}>↑</button><button aria-label="Pan map down" onClick={() => pan(0, 1)}>↓</button></div>
    </div>}
    </div>
    <div className="demo-map-resident-caption">{resident ? "Drag to pan · pinch to zoom · tap a place to inspect. Blue: route · amber: at risk · red: closed. Keyboard: arrows, +/−, Home." : "Select a home, drain, road or pump for details. Coloured streets show modelled road risk; the blue line is the selected route."}</div>
  </div>;
}
