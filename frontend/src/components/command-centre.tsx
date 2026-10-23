"use client";

import { useState } from "react";
import Link from "next/link";
import {
  Activity,
  ArrowLeft,
  Bell,
  BookOpen,
  ChartNoAxesCombined,
  Check,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  CloudRain,
  Download,
  FlaskConical,
  House,
  LayoutDashboard,
  MapPin,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  Radio,
  Route,
  ShieldCheck,
  Siren,
  Sparkles,
  Waves,
  type LucideIcon,
} from "lucide-react";
import { useSimulation } from "./simulation-provider";
import { Badge, Dialog, IconButton } from "./ui";
import { TownshipMap } from "./township-map";
import { WaterHistory } from "./water-history";
import { TelemetryPanel } from "./telemetry-panel";
import {
  EventList,
  IntelligencePanel,
  Metrics,
  RecentAlerts,
  SensorDetail,
  SimulationControls,
  Timeline,
} from "./operations-panels";
import { formatTime } from "@/lib/simulation/model";
import type { MapSelection } from "@/lib/simulation/types";

const managementNav: { name: string; icon: LucideIcon; description: string }[] =
  [
    { name: "Command Centre", icon: LayoutDashboard, description: "" },
    {
      name: "Sensors",
      icon: Radio,
      description:
        "A future workspace for device health and calibration. ESP32 test telemetry is available in the Command Centre source selector.",
    },
    {
      name: "AI Prediction",
      icon: ChartNoAxesCombined,
      description:
        "A future workspace for forecast comparisons and validated prediction models. This demo uses a deterministic simulation.",
    },
    {
      name: "Incident & Response",
      icon: Siren,
      description:
        "A future workspace for incident ownership, response playbooks and verification.",
    },
  ];
const residentNav = [
  {
    name: "Flood Alerts & Home Status",
    icon: House,
    description:
      "A future resident view of household flood alerts and home status.",
  },
  {
    name: "Safe Route & Shelter",
    icon: Route,
    description:
      "A future resident view of validated safe routes and verified shelter availability.",
  },
];

type ModalState =
  null | "alerts" | "timeline" | "help" | "sensor" | "placeholder";

export function CommandCentre() {
  const { state } = useSimulation();
  const [monitoringMode, setMonitoringMode] = useState<"simulation" | "esp32">("simulation");
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [selection, setSelection] = useState<MapSelection>("D2");
  const [modal, setModal] = useState<ModalState>(null);
  const [placeholder, setPlaceholder] = useState({ name: "", description: "" });
  const [alertFilter, setAlertFilter] = useState<"all" | "unreviewed">("all");
  const unread = state.events.filter(
    (e) => !e.acknowledged && e.kind !== "system",
  ).length;
  const simulationMode = monitoringMode === "simulation";
  const selectedSensor = state.sensors.find((s) => s.id === selection);
  const openPlaceholder = (item: { name: string; description: string }) => {
    setPlaceholder(item);
    setModal("placeholder");
    setMobileOpen(false);
  };
  const onSelect = (next: MapSelection) => {
    setSelection(next);
    if (state.sensors.some((s) => s.id === next)) setModal("sensor");
  };

  function exportLog() {
    const blob = new Blob(
      [
        JSON.stringify(
          {
            product: "ClimateTwin AI",
            source: "simulation",
            location: "Illustrative Bandar Bukit Raja demo; not verified GIS",
            modelTimeMYT: formatTime(state.minute),
            riskDisclaimer:
              "Simulation indices are not calibrated flood probabilities.",
            ...state,
          },
          null,
          2,
        ),
      ],
      { type: "application/json" },
    );
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `climatetwin-simulation-${state.minute}.json`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  const navItem = (item: {
    name: string;
    icon: LucideIcon;
    description: string;
  }) => {
    const active = item.name === "Command Centre";
    const Icon = item.icon;
    return (
      <button
        key={item.name}
        className={`nav-item ${active ? "active" : ""}`}
        aria-current={active ? "page" : undefined}
        title={
          collapsed ? `${item.name}${active ? "" : " · planned"}` : undefined
        }
        onClick={() => (active ? setMobileOpen(false) : openPlaceholder(item))}
      >
        <Icon size={18} />
        <span>{item.name}</span>
        {!active && <span className="nav-planned">SOON</span>}
        {active && <span className="nav-active-dot" />}
      </button>
    );
  };

  return (
    <div className={`app-shell ${collapsed ? "sidebar-collapsed" : ""} ${simulationMode ? "" : "intelligence-workspace"}`}>
      <a className="skip-link" href="#main-content">
        Skip to Command Centre
      </a>
      {mobileOpen && (
        <button
          className="sidebar-backdrop"
          aria-label="Close navigation"
          onClick={() => setMobileOpen(false)}
        />
      )}
      <aside
        className={`sidebar ${mobileOpen ? "mobile-open" : ""}`}
        aria-label="Main navigation"
      >
        <Link
          className="brand"
          href="/"
          aria-label="ClimateTwin AI Command Centre"
        >
          <span className="brand-mark">
            <Waves size={24} strokeWidth={1.8} />
          </span>
          <span className="brand-copy">
            ClimateTwin<span className="brand-ai">AI</span>
            <small>TOWNSHIP INTELLIGENCE</small>
          </span>
        </Link>
        <button
          className="workspace-switch"
          onClick={() => setModal("help")}
          title="About this demonstration"
        >
          <span className="workspace-icon">
            <ShieldCheck size={16} />
          </span>
          <span>
            <strong>Operations workspace</strong>
            <small>Bandar Bukit Raja</small>
          </span>
          <ChevronDown size={14} />
        </button>
        <div className="nav-section-label">MANAGEMENT</div>
        <nav className="nav-list" aria-label="Management">
          {managementNav.map(navItem)}
        </nav>
        <div className="nav-section-label resident-label">RESIDENT</div>
        <nav className="nav-list resident-nav" aria-label="Resident">
          {residentNav.map(navItem)}
        </nav>
        <div className="sidebar-bottom">
          <div className="environment-card">
            <div className="flex items-center gap-2">
              <span className="status-dot" />
              <strong>{simulationMode ? "Simulation environment" : "ESP32 test telemetry"}</strong>
            </div>
            <p>{simulationMode ? "Demo data · no hardware connected" : "Physical analysis · calibration gated"}</p>
            <div>
              <span>{simulationMode ? "MODEL STATUS" : "DATA SOURCE"}</span>
              <span className={simulationMode ? "text-green" : ""}>
                {!simulationMode ? "ESP32 TEST" : state.paused
                  ? "Paused"
                  : state.phase === "standby"
                    ? "Standby"
                    : state.phase === "recovered"
                      ? "Recovered"
                      : "Running"}
                {simulationMode && <Activity size={12} />}
              </span>
            </div>
          </div>
          <button
            className="nav-item help-nav"
            onClick={() => setModal("help")}
          >
            <CircleHelp size={18} />
            <span>Demo guide</span>
            <BookOpen size={14} className="nav-end-icon" />
          </button>
          <div className="sidebar-partner">
            <span>BUILT FOR THE</span>
            <strong>Sime Darby Property</strong>
            <span>HACKATHON 2026</span>
          </div>
          <button
            className="collapse-button"
            onClick={() => setCollapsed((v) => !v)}
            aria-label={collapsed ? "Expand navigation" : "Collapse navigation"}
          >
            {collapsed ? (
              <PanelLeftOpen size={17} />
            ) : (
              <>
                <PanelLeftClose size={17} />
                <span>Collapse sidebar</span>
              </>
            )}
          </button>
        </div>
      </aside>
      <div className="workspace-main">
        <header className="topbar">
          <div className="flex items-center gap-3">
            <button
              className="mobile-menu icon-button"
              aria-label="Open navigation"
              onClick={() => setMobileOpen(true)}
            >
              <Menu size={19} />
            </button>
            <div className="breadcrumb">
              <span>Management</span>
              <ChevronRight size={13} />
              <strong>Command Centre</strong>
            </div>
          </div>
          <div className="topbar-right">
            <span className="location-label">
              <MapPin size={14} />
              Bandar Bukit Raja <span className="demo-tag">DEMO</span>
            </span>
            <span className="topbar-divider" />
            <span className="data-status">
              <span className="status-dot" />
              {simulationMode ? "Simulated data" : "ESP32 test data"}
            </span>
            {simulationMode && <>
              <span className="topbar-divider" />
              <IconButton
                icon={Bell}
                label={`Open notifications, ${unread} unreviewed alerts`}
                onClick={() => setModal("alerts")}
              >
                {unread > 0 && <span className="notification-dot" />}
              </IconButton>
            </>}
            <label className="role-control">
              <span className="user-avatar">OP</span>
              <select
                aria-label="User role"
                value="management"
                onChange={(e) => {
                  if (e.target.value === "resident")
                    openPlaceholder({
                      name: "Resident experience",
                      description:
                        "Resident role switching, household alerts, safe routes and shelter information are planned. The Management Command Centre is the implemented demo.",
                    });
                }}
              >
                <option value="management">Management</option>
                <option value="resident">Resident · planned</option>
              </select>
              <ChevronDown size={13} />
            </label>
          </div>
        </header>
        <main id="main-content" className="dashboard-content">
          <div className="page-heading">
            <div>
              <div className="flex items-center gap-3">
                <h1>Command centre</h1>
                <Badge tone="cyan" dot>{simulationMode ? "SIMULATION" : "ESP32 TEST"}</Badge>
              </div>
              <p>{simulationMode ? "Your township. In view. Under control." : "Physical sensor analysis · verified calibration required for depth and risk"}</p>
            </div>
            <div className="page-heading-right">
              {simulationMode && <div className="demo-clock">
                <ClockIcon />
                <span>
                  {formatTime(state.minute)}
                  <small> MYT</small>
                </span>
                <span className="clock-caption">DEMO CLOCK</span>
              </div>}
              {simulationMode && <button
                className="button button-secondary export-button"
                onClick={exportLog}
              >
                <Download size={14} />
                Export snapshot
              </button>}
            </div>
          </div>
          <div className="monitoring-mode" aria-label="Monitoring data source">
            <div>
              <strong>Monitoring source</strong>
              <span>{simulationMode ? "Interactive township scenario" : "ESP32-transmitted test readings"}</span>
            </div>
            <div className="segmented-control" role="group" aria-label="Monitoring mode">
              <button aria-pressed={simulationMode} onClick={() => { setMonitoringMode("simulation"); setModal(null); }}>Simulation</button>
              <button aria-pressed={!simulationMode} onClick={() => { setMonitoringMode("esp32"); setModal(null); }}>ESP32 Test</button>
            </div>
          </div>
          {simulationMode ? <>
          <div className="workflow-bar">
            <div className="workflow-label">
              <span className="status-dot" />
              OPERATIONS WORKFLOW
            </div>
            <div className="workflow-steps">
              {[
                { name: "Monitor", icon: Radio },
                { name: "Predict", icon: Sparkles },
                { name: "Alert", icon: Bell },
                { name: "Respond", icon: ShieldCheck },
                { name: "Verify", icon: Check },
              ].map((step, i) => {
                const Icon = step.icon;
                const active =
                  state.phase === "recovered"
                    ? i === 4
                    : state.phase === "pumping"
                      ? i === 3
                      : state.phase === "storm"
                        ? i === 2
                        : i === 0;
                return (
                  <div
                    className={`workflow-step ${active ? "current" : ""}`}
                    key={step.name}
                  >
                    <Icon size={13} />
                    <span>{step.name}</span>
                    {i < 4 && (
                      <ChevronRight size={12} className="workflow-chevron" />
                    )}
                  </div>
                );
              })}
            </div>
            <span className="workflow-caption">Anticipate. Act. Protect.</span>
          </div>
          <Metrics />
          <div className="primary-grid">
            <TownshipMap selection={selection} onSelect={onSelect} />
            <IntelligencePanel
              onSelect={(id) => {
                setSelection(id);
                setModal("sensor");
              }}
            />
          </div>
          <div className="secondary-grid">
            <WaterHistory />
            <RecentAlerts onViewAll={() => setModal("alerts")} />
          </div>
          <Timeline onViewAll={() => setModal("timeline")} />
          <SimulationControls />
          </> : <TelemetryPanel />}
          <footer className="dashboard-footer">
            <span>
              <span className="footer-brand">ClimateTwin AI</span>
              <span className="footer-dot">·</span>Township Flood Operations
              Intelligence
            </span>
            <span>
              <FlaskConical size={11} />
              {simulationMode ? "Simulation estimates, not calibrated flood probabilities" : "Rule-based physical analysis · prototype thresholds"}
              <span className="footer-dot">·</span>v0.1.0
            </span>
          </footer>
        </main>
      </div>
      <Dialog
        open={modal === "placeholder"}
        onClose={() => setModal(null)}
        title={placeholder.name}
      >
        <Badge tone="cyan">PLANNED MODULE</Badge>
        <p className="dialog-description">{placeholder.description}</p>
        <div className="model-note">
          This module is a clearly marked placeholder. The Command Centre is the
          working screen in this demonstration.
        </div>
        <button
          className="button button-primary mt-5"
          onClick={() => setModal(null)}
        >
          <ArrowLeft size={14} />
          Return to Command Centre
        </button>
      </Dialog>
      <Dialog
        open={modal === "alerts"}
        onClose={() => setModal(null)}
        title="Simulated alerts"
      >
        <div className="dialog-toolbar">
          <p className="text-muted text-xs">
            Review modelled weather and risk events.
          </p>
          <div className="segmented-control">
            <button
              aria-pressed={alertFilter === "all"}
              onClick={() => setAlertFilter("all")}
            >
              All
            </button>
            <button
              aria-pressed={alertFilter === "unreviewed"}
              onClick={() => setAlertFilter("unreviewed")}
            >
              Unreviewed
            </button>
          </div>
        </div>
        <EventList
          events={state.events.filter(
            (e) =>
              e.kind !== "system" && (alertFilter === "all" || !e.acknowledged),
          )}
        />
      </Dialog>
      <Dialog
        open={modal === "timeline"}
        onClose={() => setModal(null)}
        title="Operational event log"
      >
        <div className="dialog-toolbar">
          <Badge tone="cyan">SIMULATED EVENTS</Badge>
          <button className="button button-secondary" onClick={exportLog}>
            <Download size={14} />
            Export snapshot
          </button>
        </div>
        <EventList events={state.events} />
      </Dialog>
      <Dialog
        open={modal === "sensor"}
        onClose={() => setModal(null)}
        title={`Sensor ${selectedSensor?.id ?? ""} details`}
      >
        {selectedSensor && <SensorDetail sensor={selectedSensor} />}
      </Dialog>
      <Dialog
        open={modal === "help"}
        onClose={() => setModal(null)}
        title="A clearer view. A faster response."
      >
        <Badge tone="cyan">CLIMATETWIN AI · DEMONSTRATION</Badge>
        <p className="dialog-description">
          Explore a township flood scenario through the full operations
          workflow.
        </p>
        <ol className="demo-guide">
          <li>
            <CloudRain size={18} />
            <div>
              <strong>Start a storm</strong>
              <p>
                Each 1.2 seconds advances one modelled minute. Rainfall and
                drain inflow increase, especially at D2.
              </p>
            </div>
          </li>
          <li>
            <MapPin size={18} />
            <div>
              <strong>Inspect the township</strong>
              <p>
                Select sensors, zones and infrastructure. Zoom, pan or toggle
                map layers. Use Tab and Enter to select map features.
              </p>
            </div>
          </li>
          <li>
            <ShieldCheck size={18} />
            <div>
              <strong>Model the response</strong>
              <p>
                Simulate P2 intervention and watch depths fall. Recovery is
                verified when all drains reach 0.80 m or below.
              </p>
            </div>
          </li>
        </ol>
        <div className="model-note">
          Risk bands use depth / critical depth: low &lt; 55%, elevated ≥ 55%,
          high ≥ 78%, critical ≥ 95%. The operational index = relative depth ×
          78 + positive trend (m/min) × 120 + rainfall (mm/h) × 0.18, clamped to
          0–100. Overflow time extrapolates the latest trend. These are
          deterministic simulation estimates, not calibrated flood probabilities
          or operational advice. Rainfall easing during pump intervention is a
          scenario assumption. The schematic uses no verified GIS data. The
          ESP32 Test mode can receive physical ultrasonic distances. Water depth
          and risk remain unavailable until each sensor is verified. Physical pumps, routing and real
          emergency services are not connected.
        </div>
      </Dialog>
    </div>
  );
}

function ClockIcon() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
    >
      <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.2" />
      <path
        d="M8 4v4l2.5 1.5"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
    </svg>
  );
}
