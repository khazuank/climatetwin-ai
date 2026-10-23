"use client";

import { useRef, useState, type KeyboardEvent } from "react";
import {
  Expand,
  Layers3,
  LocateFixed,
  Map,
  Minus,
  Plus,
  Radio,
  Waves,
  X,
} from "lucide-react";
import { useSimulation } from "./simulation-provider";
import { Badge, Dialog, IconButton, PanelHeading } from "./ui";
import {
  RISK_COLORS,
  RISK_LABELS,
  riskLevel,
  ZONE_NAMES,
} from "@/lib/simulation/model";
import type { MapSelection, SensorId, ZoneId } from "@/lib/simulation/types";

const positions: Record<SensorId, [number, number]> = {
  D1: [248, 183],
  D2: [526, 271],
  D3: [732, 176],
};
const zones: {
  id: ZoneId;
  path: string;
  x: number;
  y: number;
  sensor: SensorId;
}[] = [
  {
    id: "zone-a",
    path: "M105 112L267 54 365 156 205 224 100 180Z",
    x: 215,
    y: 106,
    sensor: "D1",
  },
  {
    id: "zone-b",
    path: "M367 201L538 139 652 251 469 331 367 271Z",
    x: 463,
    y: 204,
    sensor: "D2",
  },
  {
    id: "zone-c",
    path: "M604 89L728 49 833 146 704 209 631 164Z",
    x: 707,
    y: 102,
    sensor: "D3",
  },
];
const houses = [
  [142, 130],
  [170, 119],
  [198, 108],
  [226, 97],
  [254, 86],
  [164, 157],
  [192, 146],
  [220, 135],
  [248, 124],
  [276, 113],
  [188, 185],
  [216, 174],
  [244, 163],
  [272, 152],
  [300, 141],
  [393, 222],
  [422, 211],
  [451, 200],
  [480, 189],
  [509, 178],
  [418, 249],
  [447, 238],
  [476, 227],
  [505, 216],
  [534, 205],
  [444, 277],
  [473, 266],
  [502, 255],
  [531, 244],
  [560, 233],
  [642, 108],
  [670, 97],
  [698, 86],
  [726, 75],
  [667, 135],
  [695, 124],
  [723, 113],
  [751, 102],
  [692, 162],
  [720, 151],
  [748, 140],
  [776, 129],
  [328, 351],
  [355, 340],
  [354, 378],
  [382, 366],
  [595, 358],
  [622, 347],
  [648, 336],
  [621, 386],
  [649, 375],
  [676, 364],
];
const trees = [
  [90, 95],
  [106, 81],
  [310, 66],
  [324, 81],
  [360, 109],
  [374, 123],
  [406, 84],
  [421, 78],
  [465, 95],
  [483, 91],
  [565, 107],
  [582, 100],
  [832, 207],
  [844, 224],
  [805, 301],
  [819, 290],
  [733, 403],
  [754, 395],
  [776, 389],
  [541, 391],
  [558, 405],
  [451, 393],
  [466, 411],
  [285, 321],
  [277, 340],
  [79, 268],
  [84, 287],
  [86, 304],
  [211, 400],
  [230, 411],
  [248, 400],
  [135, 233],
  [151, 240],
];

function accessibleSelect(e: KeyboardEvent<SVGGElement>, callback: () => void) {
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    callback();
  }
}

export function TownshipMap({
  selection,
  onSelect,
}: {
  selection: MapSelection;
  onSelect: (selection: MapSelection) => void;
}) {
  const { state } = useSimulation();
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [layersOpen, setLayersOpen] = useState(false);
  const [riskVisible, setRiskVisible] = useState(true);
  const [drainsVisible, setDrainsVisible] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(
    null,
  );
  const selectedSensor = state.sensors.find((s) => s.id === selection);
  const zoneSensor = state.sensors.find((s) => s.zone === selection);
  const contextTitle = selectedSensor
    ? `${selectedSensor.id} · ${selectedSensor.name}`
    : zoneSensor
      ? ZONE_NAMES[zoneSensor.zone]
      : (
          {
            pond: "Retention pond",
            pump: "Pump P2",
            school: "Township school",
            shelter: "Community shelter",
          } as Record<string, string>
        )[selection];
  const contextDetail = selectedSensor
    ? `${selectedSensor.level.toFixed(2)} m / ${selectedSensor.criticalLevel.toFixed(2)} m critical · ${RISK_LABELS[riskLevel(selectedSensor)]} risk`
    : zoneSensor
      ? `Linked to ${zoneSensor.id} · ${RISK_LABELS[riskLevel(zoneSensor)]} modelled risk`
      : selection === "pump"
        ? state.phase === "pumping"
          ? "Simulated drawdown active · no hardware control"
          : "Simulation only · hardware not connected"
        : selection === "pond"
          ? "Modelled drainage outlet · capacity not surveyed"
          : selection === "school"
            ? "Illustrative facility · near Zone B catchment"
            : "Illustrative facility · availability not verified";

  const renderMap = (mapId: string) => (
    <>
      <div className="map-canvas">
        <div className="map-overlay-top">
          <span className="map-view-label">
            <span className="status-dot" /> DIGITAL TWIN{" "}
            <span className="map-version">v0.1</span>
          </span>
          <Badge tone="cyan">SCHEMATIC</Badge>
        </div>
        <svg
          className="township-svg"
          viewBox="0 0 900 465"
          aria-label="Interactive illustrative township schematic. Select drain sensors, residential zones, or infrastructure."
          onPointerDown={(e) => {
            if (
              e.target instanceof Element &&
              e.target.closest('[role="button"]')
            )
              return;
            drag.current = {
              x: e.clientX,
              y: e.clientY,
              ox: offset.x,
              oy: offset.y,
            };
            e.currentTarget.setPointerCapture(e.pointerId);
          }}
          onPointerMove={(e) => {
            if (!drag.current) return;
            const scale = 900 / e.currentTarget.getBoundingClientRect().width;
            setOffset({
              x: Math.min(
                300,
                Math.max(
                  -300,
                  drag.current.ox + (e.clientX - drag.current.x) * scale,
                ),
              ),
              y: Math.min(
                180,
                Math.max(
                  -180,
                  drag.current.oy + (e.clientY - drag.current.y) * scale,
                ),
              ),
            });
          }}
          onPointerUp={() => {
            drag.current = null;
          }}
          onPointerCancel={() => {
            drag.current = null;
          }}
        >
          <defs>
            <pattern
              id={`grid-${mapId}`}
              width="25"
              height="25"
              patternUnits="userSpaceOnUse"
            >
              <path
                d="M25 0H0V25"
                fill="none"
                stroke="#20313d"
                strokeWidth="0.55"
              />
            </pattern>
            <pattern
              id={`water-${mapId}`}
              width="13"
              height="13"
              patternUnits="userSpaceOnUse"
            >
              <path
                d="M0 6Q3 3 6 6T13 6"
                fill="none"
                stroke="#3e8a9b"
                strokeWidth="0.7"
                opacity="0.5"
              />
            </pattern>
          </defs>
          <rect width="900" height="465" fill="#101e28" />
          <rect
            width="900"
            height="465"
            fill={`url(#grid-${mapId})`}
            opacity="0.52"
          />
          <g
            transform={`translate(${offset.x} ${offset.y}) translate(450 232) scale(${zoom}) translate(-450 -232)`}
          >
            <g stroke="#223c3f" strokeWidth="1" fill="none" opacity="0.6">
              <path d="M-40 172Q32 56 199 16T566 -5T957 99" />
              <path d="M-40 153Q28 37 193 -3T574 -24T957 80" />
              <path d="M-40 134Q20 18 190 -22" />
              <path d="M431 475Q560 425 741 444T952 306" />
              <path d="M453 490Q571 446 752 461T974 320" />
            </g>
            <path
              d="M63 117L259 31 389 70 550 49 722 25 865 148 841 339 717 422 521 437 336 412 163 432 54 337Z"
              stroke="#40515c"
              strokeDasharray="5 5"
              fill="#152730"
              fillOpacity="0.55"
            />
            <g fill="#1b3532" stroke="#2a4840" strokeWidth="1">
              <path d="M79 237L136 219 214 270 195 305 80 323Z" />
              <path d="M300 62L344 48 401 96 377 122Z" />
              <path d="M766 279L829 255 831 338 756 383 717 377Z" />
            </g>
            {zones.map((zone) => {
              const sensor = state.sensors.find((s) => s.id === zone.sensor)!;
              const color = RISK_COLORS[riskLevel(sensor)];
              return (
                <g
                  key={zone.id}
                  role="button"
                  tabIndex={0}
                  className="map-interactive"
                  aria-label={`Select ${ZONE_NAMES[zone.id]}, ${RISK_LABELS[riskLevel(sensor)]} risk`}
                  aria-pressed={selection === zone.id}
                  onClick={() => onSelect(zone.id)}
                  onKeyDown={(e) =>
                    accessibleSelect(e, () => onSelect(zone.id))
                  }
                >
                  <path
                    d={zone.path}
                    fill={riskVisible ? color : "#25343d"}
                    fillOpacity={riskVisible ? 0.12 : 0.25}
                    stroke={
                      selection === zone.id
                        ? "#65d3de"
                        : riskVisible
                          ? color
                          : "#344a59"
                    }
                    strokeOpacity="0.5"
                    strokeWidth={selection === zone.id ? 2 : 1}
                    strokeDasharray="4 3"
                  />
                </g>
              );
            })}
            <g fill="none" strokeLinejoin="round" strokeLinecap="round">
              <g stroke="#111d26" strokeWidth="28">
                <path d="M28 269L403 117 573 94 878 291" />
                <path d="M253 32L403 193 602 415" />
                <path d="M79 366L424 222 855 58" />
                <path d="M406 63L777 410" />
                <path d="M84 399L252 332 457 403 804 252" />
              </g>
              <g stroke="#3a4852" strokeWidth="19">
                <path d="M28 269L403 117 573 94 878 291" />
                <path d="M253 32L403 193 602 415" />
                <path d="M79 366L424 222 855 58" />
                <path d="M406 63L777 410" />
                <path d="M84 399L252 332 457 403 804 252" />
              </g>
              <g
                stroke="#64717a"
                strokeWidth="0.8"
                strokeDasharray="8 8"
                opacity="0.75"
              >
                <path d="M28 269L403 117 573 94 878 291" />
                <path d="M253 32L403 193 602 415" />
                <path d="M79 366L424 222 855 58" />
                <path d="M406 63L777 410" />
                <path d="M84 399L252 332 457 403 804 252" />
              </g>
            </g>
            <g fill="#32444f" stroke="#51616c" strokeWidth="0.6">
              {houses.map(([x, y], i) => (
                <g key={i}>
                  <path d={`M${x} ${y}l17 -6 12 13 -17 7Z`} />
                  <path d={`M${x} ${y}v6l12 14v-7Z`} fill="#243641" />
                  <path
                    d={`M${x + 12} ${y + 13}l17 -7v6l-17 8Z`}
                    fill="#2b3a45"
                  />
                  <path
                    d={`M${x + 4} ${y + 1}l11 -4 7 8 -11 5Z`}
                    stroke="#77858b"
                    strokeOpacity="0.3"
                    fill="none"
                  />
                </g>
              ))}
            </g>
            <g>
              {trees.map(([x, y], i) => (
                <g key={i}>
                  <circle
                    cx={x}
                    cy={y}
                    r={i % 3 === 0 ? 7 : 5}
                    fill="#29463c"
                    stroke="#38574b"
                    strokeWidth="0.65"
                  />
                  <circle cx={x - 1} cy={y - 1.5} r="2.5" fill="#365647" />
                </g>
              ))}
            </g>
            <g
              role="button"
              tabIndex={0}
              className="map-interactive"
              aria-label="Select retention pond"
              aria-pressed={selection === "pond"}
              onClick={() => onSelect("pond")}
              onKeyDown={(e) => accessibleSelect(e, () => onSelect("pond"))}
            >
              <path
                d="M109 306Q125 288 158 296L231 326Q247 337 224 359L174 385Q154 394 129 372L96 341Q88 323 109 306Z"
                fill="#173f4d"
                stroke={selection === "pond" ? "#65d3de" : "#397381"}
                strokeWidth="2"
              />
              <path
                d="M109 306Q125 288 158 296L231 326Q247 337 224 359L174 385Q154 394 129 372L96 341Q88 323 109 306Z"
                fill={`url(#water-${mapId})`}
              />
              <text
                x="166"
                y="334"
                textAnchor="middle"
                fill="#9cc7d0"
                fontSize="11"
              >
                RETENTION
              </text>
              <text
                x="166"
                y="350"
                textAnchor="middle"
                fill="#9cc7d0"
                fontSize="11"
              >
                POND
              </text>
            </g>
            {drainsVisible && (
              <g fill="none" strokeLinecap="round" strokeLinejoin="round">
                <g stroke="#123746" strokeWidth="10">
                  <path d="M248 183L315 252 369 297 236 350" />
                  <path d="M732 176L620 222 526 271 369 337 236 350" />
                </g>
                <g stroke="#55b9c8" strokeWidth="2.5">
                  <path d="M248 183L315 252 369 297 236 350" />
                  <path d="M732 176L620 222 526 271 369 337 236 350" />
                </g>
                <g
                  stroke="#9bdee3"
                  strokeWidth="1"
                  strokeDasharray="4 12"
                  className={
                    state.phase === "storm" || state.phase === "pumping"
                      ? "flow-line"
                      : ""
                  }
                >
                  <path d="M732 176L620 222 526 271 369 337 236 350" />
                </g>
                <path
                  d="M405 310l-10 12 16 1M296 332l-10 9 14 4"
                  stroke="#8cdce1"
                  strokeWidth="1.5"
                />
              </g>
            )}
            <text
              x="334"
              y="192"
              fill="#8c9aa4"
              fontSize="9"
              letterSpacing="1"
              transform="rotate(47 334 192)"
            >
              TOWNSHIP AVENUE
            </text>
            <text
              x="554"
              y="174"
              fill="#8c9aa4"
              fontSize="9"
              letterSpacing="1"
              transform="rotate(-22 554 174)"
            >
              CENTRAL LINK
            </text>
            {zones.map((zone) => (
              <text
                key={zone.id}
                x={zone.x}
                y={zone.y - 13}
                textAnchor="middle"
                className="map-zone-name"
                pointerEvents="none"
              >
                ZONE {zone.id.slice(-1).toUpperCase()}
              </text>
            ))}
            <g
              role="button"
              tabIndex={0}
              className="map-interactive"
              aria-label="Select township school"
              aria-pressed={selection === "school"}
              onClick={() => onSelect("school")}
              onKeyDown={(e) => accessibleSelect(e, () => onSelect("school"))}
            >
              <path
                d="M434 107l43 -16 35 35 -44 18Z"
                fill="#475257"
                stroke={selection === "school" ? "#65d3de" : "#7c8587"}
              />
              <path d="M434 107v9l34 37v-9Z" fill="#303e48" />
              <path d="M468 144l44 -18v9l-44 18Z" fill="#394852" />
              <path d="M444 108l28 -10 20 20 -29 12Z" fill="#576261" />
              <text
                x="474"
                y="169"
                textAnchor="middle"
                className="map-facility-label"
              >
                School
              </text>
            </g>
            <g
              role="button"
              tabIndex={0}
              className="map-interactive"
              aria-label="Select community shelter"
              aria-pressed={selection === "shelter"}
              onClick={() => onSelect("shelter")}
              onKeyDown={(e) => accessibleSelect(e, () => onSelect("shelter"))}
            >
              <path
                d="M688 303l39 -16 32 33 -39 16Z"
                fill="#365e55"
                stroke={selection === "shelter" ? "#65d3de" : "#5b9380"}
              />
              <path d="M688 303v9l32 33v-9Z" fill="#2b4542" />
              <path d="M720 336l39 -16v9l-39 16Z" fill="#315147" />
              <path d="M720 305v12m-6 -6h12" stroke="#88d4b9" strokeWidth="2" />
              <text
                x="729"
                y="363"
                textAnchor="middle"
                className="map-facility-label"
              >
                Community shelter
              </text>
            </g>
            <g
              role="button"
              tabIndex={0}
              className="map-interactive"
              aria-label="Select simulated pump P2"
              aria-pressed={selection === "pump"}
              onClick={() => onSelect("pump")}
              onKeyDown={(e) => accessibleSelect(e, () => onSelect("pump"))}
            >
              <rect
                x="357"
                y="316"
                width="28"
                height="28"
                rx="6"
                fill="#143c43"
                stroke="#54bbc1"
              />
              <path
                d="M365 326h12v9h-12zm6 -5v5m-9 6h3m12 0h4"
                stroke="#80d5da"
                strokeWidth="1.5"
                fill="none"
              />
              <text
                x="371"
                y="361"
                textAnchor="middle"
                fill="#9dbfc6"
                fontSize="11"
              >
                Pump P2
              </text>
              {state.phase === "pumping" && (
                <circle cx="383" cy="317" r="4" fill="#42c9a0" />
              )}
            </g>
            {state.sensors.map((sensor) => {
              const [x, y] = positions[sensor.id];
              const color = RISK_COLORS[riskLevel(sensor)];
              const selected = selection === sensor.id;
              return (
                <g
                  key={sensor.id}
                  role="button"
                  tabIndex={0}
                  className="map-interactive sensor-marker"
                  aria-label={`Select sensor ${sensor.id}, ${sensor.level.toFixed(2)} metres, ${RISK_LABELS[riskLevel(sensor)]} risk`}
                  aria-pressed={selected}
                  onClick={() => onSelect(sensor.id)}
                  onKeyDown={(e) =>
                    accessibleSelect(e, () => onSelect(sensor.id))
                  }
                >
                  <circle
                    cx={x}
                    cy={y}
                    r="23"
                    fill={color}
                    opacity={selected ? "0.12" : "0.06"}
                  />
                  <circle
                    cx={x}
                    cy={y}
                    r="15"
                    fill="#122530"
                    stroke={color}
                    strokeWidth={selected ? 2 : 1}
                    strokeOpacity={selected ? 1 : 0.65}
                  />
                  <circle cx={x} cy={y} r="5" fill={color} />
                  <circle
                    cx={x}
                    cy={y}
                    r="9"
                    fill="none"
                    stroke={color}
                    strokeOpacity="0.35"
                  />
                  <rect
                    x={x + 22}
                    y={y - 17}
                    width="107"
                    height="35"
                    rx="5"
                    fill="#12202c"
                    stroke={color}
                    strokeOpacity={selected ? 0.75 : 0.3}
                  />
                  <text
                    x={x + 32}
                    y={y + 5}
                    fill="#e2eaf0"
                    fontSize="12"
                    fontWeight="600"
                  >
                    {sensor.id}
                  </text>
                  <text
                    x={x + 60}
                    y={y + 5}
                    fill={color}
                    fontSize="12"
                    fontFamily="var(--font-geist-mono), monospace"
                  >
                    {sensor.level.toFixed(2)} m
                  </text>
                </g>
              );
            })}
          </g>
        </svg>
        <div
          className="map-north"
          aria-label="North indicator, illustrative orientation"
        >
          <span>N</span>
          <svg width="20" height="29" viewBox="0 0 20 29" aria-hidden="true">
            <path d="M10 2L17 24 10 19 3 24Z" fill="#8095a4" />
            <path d="M10 2V19L3 24Z" fill="#d3e2e9" />
          </svg>
        </div>
        <div className="map-tools">
          <IconButton
            icon={Plus}
            label="Zoom in"
            onClick={() => setZoom((z) => Math.min(2, +(z + 0.2).toFixed(1)))}
            disabled={zoom >= 2}
          />
          <IconButton
            icon={Minus}
            label="Zoom out"
            onClick={() => setZoom((z) => Math.max(0.8, +(z - 0.2).toFixed(1)))}
            disabled={zoom <= 0.8}
          />
          <span className="tool-divider" />
          <IconButton
            icon={LocateFixed}
            label="Reset map view"
            onClick={() => {
              setZoom(1);
              setOffset({ x: 0, y: 0 });
            }}
          />
          <IconButton
            icon={Layers3}
            label="Toggle map layers"
            onClick={() => setLayersOpen((v) => !v)}
          />
        </div>
        {layersOpen && (
          <div className="map-layer-menu">
            <div className="flex justify-between items-center mb-2">
              <strong>Map layers</strong>
              <button
                aria-label="Close layers"
                onClick={() => setLayersOpen(false)}
              >
                <X size={14} />
              </button>
            </div>
            <label>
              <input
                type="checkbox"
                checked={riskVisible}
                onChange={(e) => setRiskVisible(e.target.checked)}
              />{" "}
              Risk zones
            </label>
            <label>
              <input
                type="checkbox"
                checked={drainsVisible}
                onChange={(e) => setDrainsVisible(e.target.checked)}
              />{" "}
              Drainage network
            </label>
          </div>
        )}
        <div className="map-context" aria-live="polite">
          <div className="flex items-center gap-2">
            <Radio size={13} className="text-cyan" />
            <strong>{contextTitle}</strong>
          </div>
          <p>{contextDetail}</p>
        </div>
        <span className="map-zoom">
          {Math.round(zoom * 100)}% <span>· drag to pan</span>
        </span>
      </div>
      <div className="map-legend">
        <div className="flex items-center flex-wrap gap-x-4 gap-y-2">
          <span className="legend-title">RISK LEVEL</span>
          {(["low", "watch", "high", "critical"] as const).map((risk) => (
            <span className="legend-item" key={risk}>
              <i style={{ background: RISK_COLORS[risk] }} />
              {RISK_LABELS[risk]}
            </span>
          ))}
        </div>
        <span className="legend-item">
          <Waves size={14} className="text-cyan" /> Drain network
        </span>
      </div>
    </>
  );

  return (
    <section className="panel map-panel" aria-label="Township digital twin">
      <PanelHeading icon={Map} title="Township digital twin">
        <div className="flex items-center gap-3">
          <span className="map-hint">Select a sensor to inspect</span>
          <IconButton
            icon={Expand}
            label="Expand township map"
            onClick={() => setExpanded(true)}
          />
        </div>
      </PanelHeading>
      {renderMap("inline")}
      <p className="schematic-disclaimer">
        Illustrative township schematic — not verified Bandar Bukit Raja GIS
        data
      </p>
      <Dialog
        open={expanded}
        onClose={() => setExpanded(false)}
        title="Township digital twin · simulated data"
      >
        {expanded && renderMap("expanded")}
        <p className="text-muted text-xs mt-3">
          Illustrative township schematic — not verified Bandar Bukit Raja GIS
          data
        </p>
      </Dialog>
    </section>
  );
}
