"use client";

import { useState } from "react";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ChartNoAxesCombined } from "lucide-react";
import { useSimulation } from "./simulation-provider";
import { PanelHeading } from "./ui";
import type { SensorId } from "@/lib/simulation/types";

const series = [
  { id: "D1" as const, color: "#55b9cf" },
  { id: "D2" as const, color: "#e9bf64" },
  { id: "D3" as const, color: "#7d8de3" },
];
export function WaterHistory() {
  const { state } = useSimulation();
  const [range, setRange] = useState(30);
  const [hidden, setHidden] = useState<SensorId[]>([]);
  const history = state.history.filter((p) => p.minute >= state.minute - range);
  return (
    <section className="panel chart-panel">
      <PanelHeading icon={ChartNoAxesCombined} title="Water level history">
        <div className="segmented-control" aria-label="Chart time range">
          {[15, 30, 60].map((minutes) => (
            <button
              key={minutes}
              aria-pressed={range === minutes}
              onClick={() => setRange(minutes)}
            >
              {minutes}m
            </button>
          ))}
        </div>
      </PanelHeading>
      <div className="chart-summary">
        <div className="flex items-center gap-4">
          {series.map((s) => (
            <button
              className={`series-toggle ${hidden.includes(s.id) ? "series-hidden" : ""}`}
              key={s.id}
              aria-pressed={!hidden.includes(s.id)}
              aria-label={`Toggle ${s.id} chart series`}
              onClick={() =>
                setHidden((h) =>
                  h.includes(s.id)
                    ? h.filter((id) => id !== s.id)
                    : [...h, s.id],
                )
              }
            >
              <i style={{ background: s.color }} />
              Drain {s.id}
            </button>
          ))}
        </div>
        <span>SIMULATED · METRES</span>
      </div>
      <div
        className="history-chart"
        role="group"
        aria-label="Interactive water level history in metres. Dotted critical depth thresholds: D1 and D2 at 2.4 metres; D3 at 2.1 metres."
      >
        <ComposedChart
          responsive
          style={{ width: "100%", height: "100%", minWidth: 0 }}
          data={history}
          margin={{ top: 17, right: 18, left: -26, bottom: 0 }}
          accessibilityLayer
        >
          <defs>
            <linearGradient id="level-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#e9bf64" stopOpacity={0.12} />
              <stop offset="100%" stopColor="#e9bf64" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid
            stroke="#26323f"
            strokeDasharray="3 5"
            vertical={false}
          />
          <XAxis
            dataKey="time"
            tick={{ fill: "#91a0b1", fontSize: 10 }}
            axisLine={false}
            tickLine={false}
            minTickGap={38}
            dy={8}
          />
          <YAxis
            domain={[0, 3.2]}
            ticks={[0, 0.8, 1.6, 2.4, 3.2]}
            tick={{ fill: "#91a0b1", fontSize: 10 }}
            tickFormatter={(n) => Number(n).toFixed(1)}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip
            contentStyle={{
              background: "#152232",
              border: "1px solid #34485b",
              borderRadius: 8,
              color: "#dbe6ef",
              fontSize: 12,
            }}
            labelFormatter={(label) => `${label} MYT · simulation clock`}
            formatter={(value, name) => [
              `${Number(value).toFixed(2)} m`,
              `Drain ${name}`,
            ]}
          />
          <ReferenceLine
            y={2.4}
            stroke="#bb6871"
            strokeDasharray="4 4"
          />
          <ReferenceLine
            y={2.1}
            stroke="#8b6477"
            strokeDasharray="2 6"
          />
          {!hidden.includes("D2") && (
            <Area
              type="monotone"
              dataKey="D2"
              stroke="none"
              fill="url(#level-fill)"
              isAnimationActive={false}
              tooltipType="none"
            />
          )}
          {series
            .filter((s) => !hidden.includes(s.id))
            .map((s) => (
              <Line
                key={s.id}
                type="monotone"
                dataKey={s.id}
                stroke={s.color}
                strokeWidth={s.id === "D2" ? 2.2 : 1.7}
                dot={false}
                activeDot={{ r: 4, strokeWidth: 2, stroke: "#101a27" }}
                isAnimationActive={false}
              />
            ))}
        </ComposedChart>
      </div>
      <p className="chart-footnote">
        Critical depths · D1/D2 2.40 m · D3 2.10 m
      </p>
    </section>
  );
}
