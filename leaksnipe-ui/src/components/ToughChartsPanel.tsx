import { useCallback, useEffect, useMemo, useState } from "react";
import {
  api,
  waitForBackend,
  type ToughChartDetail,
  type ToughChartSummary,
  type ToughEvaluateResult,
  type ChartOverride,
} from "../lib/api";
import { RangeGrid } from "./RangeGrid";

const SOURCE_OPTIONS = [
  { id: "tough", label: "TOUGH Charts" },
  { id: "secrets", label: "Secrets" },
  { id: "ultimate_preflop", label: "Ultimate Preflop" },
  { id: "all", label: "All sources" },
] as const;

const CATEGORIES = [
  { id: "push_fold", label: "Push/Fold" },
  { id: "limp", label: "Limping" },
  { id: "stack_scenario", label: "Stack scenarios" },
  { id: "confrontation", label: "Confrontation" },
  { id: "exploitative_flop", label: "Exploitative flop" },
  { id: "bb_defense", label: "BB defense" },
  { id: "open_strategy", label: "Open / exploit" },
] as const;

const SEAT_ORDER = ["UTG", "UTG+1", "MP", "LJ", "HJ", "CO", "BTN", "SB", "BB"] as const;

const ACTION_COLORS: Record<string, string> = {
  call: "#3b82f6",
  fold: "#334155",
  check: "#64748b",
  raise: "#22c55e",
  raise_value: "#16a34a",
  raise_bluff: "#a855f7",
  raise_lesser_value: "#84cc16",
  raise_3x: "#eab308",
  raise_4x: "#f59e0b",
  raise_2_5x: "#fbbf24",
  raise_3_5x: "#fcd34d",
  raise_2bb: "#4ade80",
  bet_0_33_pot: "#0ea5e9",
  bet_0_67_pot: "#0284c7",
  all_in: "#ef4444",
  defend: "#14b8a6",
  "3bet_3x": "#d946ef",
  "3bet_4x": "#c026d3",
  "3bet_2_5x": "#e879f9",
  "3bet_3_5x": "#c084fc",
  "bet_0_5_pot": "#0369a1",
  "bet_0_75_pot": "#075985",
  "bet_0_7_pot": "#0891b2",
  "bet_0_23_pot": "#06b6d4",
  "bet_0_3_pot": "#22d3ee",
  "bet_0_15_pot": "#67e8f9",
  "bet_0_4_pot": "#155e75",
  "bet_0_1_pot": "#164e63",
  "bet_1_25_pot": "#7c3aed",
  "bet_1_5_pot": "#6d28d9",
  "bet_0_76_pot": "#5b21b6",
  "bet_40_pot": "#2563eb",
  "limp_25_18": "#86efac",
  "limp_50_43": "#4ade80",
  "played_differently": "#94a3b8",
};

function actionColor(name: string): string {
  const key = name.toLowerCase().replace(/[\s.-]+/g, "_");
  return ACTION_COLORS[key] ?? "#38bdf8";
}

function formatAction(name: string): string {
  return name.replace(/_/g, " ");
}

function FreqBars({ actions }: { actions: { name: string; freq: number }[] }) {
  if (!actions.length) {
    return <p className="muted small">No action frequencies for this chart.</p>;
  }
  return (
    <div className="tough-freq-bars">
      {actions.map((a) => (
        <div key={a.name} className="tough-freq-row">
          <span className="tough-freq-label">{formatAction(a.name)}</span>
          <div className="tough-freq-track">
            <div
              className="tough-freq-fill"
              style={{ width: `${Math.round(a.freq * 100)}%`, background: actionColor(a.name) }}
            />
          </div>
          <span className="tough-freq-pct">{(a.freq * 100).toFixed(1)}%</span>
        </div>
      ))}
    </div>
  );
}

function StackTable({ scenario }: { scenario: NonNullable<ToughChartDetail["stack_scenario"]> }) {
  const bb = scenario.bb_size || 1000;
  const heroSeat = scenario.hero_seat;

  return (
    <div className="tough-stack-table-wrap">
      <div className="tough-poker-table">
        {SEAT_ORDER.map((seat) => {
          const chips = scenario.seats[seat];
          if (chips == null) return null;
          const stackBb = (chips / bb).toFixed(1);
          const isHero = seat === heroSeat;
          return (
            <div
              key={seat}
              className={`tough-seat tough-seat-${seat.replace("+", "p")}${isHero ? " hero" : ""}`}
            >
              <span className="tough-seat-pos">{seat}</span>
              <span className="tough-seat-chips">{chips.toLocaleString()}</span>
              <span className="tough-seat-bb">{stackBb}bb</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function verdictClass(verdict?: string): string {
  switch (verdict) {
    case "optimal":
      return "tough-verdict optimal";
    case "mixed":
    case "approximate":
      return "tough-verdict mixed";
    case "low_freq":
      return "tough-verdict low";
    default:
      return "tough-verdict miss";
  }
}

const STACK_DEPTHS = [5, 10, 12, 20, 25, 30, 35, 50, 75, 80, 100] as const;

function formatScenarioType(raw?: string): string {
  if (!raw) return "";
  return raw.replace(/_/g, " ").toUpperCase();
}

function formatSpotAction(raw?: string): string {
  if (!raw) return "";
  return raw.replace(/_/g, " ");
}

function isGtoGridChart(detail: ToughChartDetail): boolean {
  return detail.chart_type === "169_combo_gto_grid" || detail.source_key === "ultimate_preflop";
}

function GtoGridNotice({
  detail,
  onOpenCfr,
}: {
  detail: ToughChartDetail;
  onOpenCfr?: (stackBb: number, position: string) => void;
}) {
  const note = detail.browse_note;
  const pdfPath = detail.pdf_path;
  const cfrLink = detail.cfr_link;

  return (
    <div className="tough-gto-grid-notice">
      <h5>169-combo GTO range chart</h5>
      <p className="muted small">
        {note ??
          "This spot is an image-based 169-combo grid. Combo frequencies are not stored as text — open the PDF or use CFR+ stack charts for combo-level study."}
      </p>
      {pdfPath && (
        <p className="muted small tough-pdf-path">
          PDF: <code>{pdfPath}</code>
          {detail.pdf_page != null && <> · page {detail.pdf_page}</>}
          {detail.diagram != null && <> · diagram #{detail.diagram}</>}
        </p>
      )}
      {(cfrLink || detail.cfr_hint) && (
        <div className="tough-cfr-bridge">
          {detail.cfr_hint && <p className="muted small">{detail.cfr_hint}</p>}
          {cfrLink && onOpenCfr && (
            <button
              type="button"
              className="secondary-btn"
              onClick={() => onOpenCfr(cfrLink.stack_bb, cfrLink.position)}
            >
              Open CFR+ {cfrLink.stack_bb}BB {cfrLink.position}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export function ToughChartsPanel({
  onOpenCfr,
  onEditRange,
  refreshToggle,
}: {
  onOpenCfr?: (stackBb: number, position: string) => void;
  onEditRange?: (chartId: string, title: string, actions: { name: string; freq: number }[]) => void;
  refreshToggle?: boolean;
}) {
  const [sourceFilter, setSourceFilter] = useState<string>("tough");
  const [category, setCategory] = useState<string>("push_fold");
  const [stackFilter, setStackFilter] = useState<number | "">("");
  const [charts, setCharts] = useState<ToughChartSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ToughChartDetail | null>(null);
  const [override, setOverride] = useState<ChartOverride | null>(null);
  const [drillAction, setDrillAction] = useState("");
  const [evalResult, setEvalResult] = useState<ToughEvaluateResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [countsByCategory, setCountsByCategory] = useState<Record<string, number>>({});
  const [totalForSource, setTotalForSource] = useState(0);

  const drillOptions = useMemo(() => {
    if (!detail?.actions?.length) return [];
    return detail.actions.map((a) => a.name);
  }, [detail]);

  const loadList = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      await waitForBackend();
      let res = await api.toughCharts({
        category,
        source: sourceFilter,
        stack_bb: stackFilter === "" ? undefined : Number(stackFilter),
      });
      setCountsByCategory(res.counts_by_category ?? {});
      setTotalForSource(res.chart_count ?? 0);

      if (
        res.charts.length === 0 &&
        res.counts_by_category &&
        sourceFilter !== "all"
      ) {
        const fallback = CATEGORIES.find((c) => (res.counts_by_category[c.id] ?? 0) > 0);
        if (fallback && fallback.id !== category) {
          setCategory(fallback.id);
          return;
        }
      }

      setCharts(res.charts);
      setSelectedId((prev) => {
        if (prev && res.charts.some((c) => c.id === prev)) return prev;
        return res.charts[0]?.id ?? null;
      });
      if (!res.charts.length) {
        setDetail(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [category, stackFilter, sourceFilter]);

  const loadDetail = useCallback(async (id: string) => {
    setError(null);
    setOverride(null);
    try {
      await waitForBackend();
      const res = await api.toughChart(id);
      setDetail(res);
      setDrillAction(res.actions?.[0]?.name ?? "");
      setEvalResult(null);

      // Try fetching custom override
      try {
        const ovRes = await api.getChartOverride(id);
        if (ovRes && ovRes.override) {
          setOverride(ovRes.override);
        }
      } catch (err) {
        // No override exists, ignore
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  // Reload detail when refreshToggle changes (e.g. after saving from editor)
  useEffect(() => {
    if (selectedId) {
      void loadDetail(selectedId);
    }
  }, [refreshToggle]);

  useEffect(() => {
    setCountsByCategory({});
    setTotalForSource(0);
    setCharts([]);
    setSelectedId(null);
    setDetail(null);
    setEvalResult(null);
  }, [sourceFilter]);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      return;
    }
    void loadDetail(selectedId);
  }, [selectedId, loadDetail]);

  const runDrill = async () => {
    if (!selectedId || !drillAction) return;
    setError(null);
    try {
      await waitForBackend();
      setEvalResult(await api.toughEvaluate({ chart_id: selectedId, action: drillAction }));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <section className="panel-card tough-charts-panel">
      <div className="theory-chart-header">
        <div>
          <h3>Strategy Charts</h3>
          <p className="muted small">
            Reference mixed-strategy frequencies from TOUGH Charts, Secrets of Professional Tournament Poker, and Jonathan Little&apos;s Ultimate Tournament Preflop Guide — browse spots, study stack layouts, drill actions.
          </p>
        </div>
      </div>

      {error && <div className="error-banner">{error}</div>}

      <div className="tough-source-tabs">
        {SOURCE_OPTIONS.map((s) => (
          <button
            key={s.id}
            type="button"
            className={`depth-tab${sourceFilter === s.id ? " active" : ""}`}
            onClick={() => setSourceFilter(s.id)}
          >
            {s.label}
          </button>
        ))}
      </div>

      <div className="tough-category-tabs">
        {CATEGORIES.map((c) => {
          const count = countsByCategory[c.id] ?? 0;
          const disabled = sourceFilter !== "all" && totalForSource > 0 && count === 0;
          return (
            <button
              key={c.id}
              type="button"
              className={`depth-tab${category === c.id ? " active" : ""}${disabled ? " disabled" : ""}`}
              disabled={disabled}
              title={disabled ? "No charts in this category for the selected source" : undefined}
              onClick={() => setCategory(c.id)}
            >
              {c.label}
              {sourceFilter !== "all" && count > 0 && (
                <span className="tough-tab-count">{count}</span>
              )}
            </button>
          );
        })}
      </div>

      <div className="tough-filters">
        <label>
          Stack depth filter (BB)
          <select
            value={stackFilter === "" ? "" : String(stackFilter)}
            onChange={(e) => setStackFilter(e.target.value === "" ? "" : Number(e.target.value))}
          >
            <option value="">Any</option>
            {STACK_DEPTHS.map((d) => (
              <option key={d} value={d}>{d}BB</option>
            ))}
          </select>
        </label>
      </div>

      <div className="tough-layout">
        <div className="tough-chart-list">
          {loading && <p className="muted">Loading charts…</p>}
          {!loading && charts.length === 0 && (
            <p className="muted small">
              No charts match these filters.
              {sourceFilter === "ultimate_preflop" && totalForSource > 0
                ? " Pick another category — Ultimate Preflop has spots in Push/Fold, Confrontation, Open, BB defense, and Limp."
                : " Try another category or stack depth."}
            </p>
          )}
          {!loading && charts.map((c) => (
            <button
              key={c.id}
              type="button"
              className={`tough-chart-item${selectedId === c.id ? " active" : ""}`}
              onClick={() => setSelectedId(c.id)}
            >
              <span className="tough-chart-diagram">#{c.diagram ?? "—"}</span>
              <span className="tough-chart-title">{c.title}</span>
              {(c.source_key === "secrets" || c.source_key === "ultimate_preflop") &&
                sourceFilter === "all" && (
                <span className="muted small">
                  {c.source_key === "secrets" ? "Secrets" : "Ultimate"}
                </span>
              )}
              {c.stack_bb != null && <span className="muted small">{c.stack_bb}BB</span>}
            </button>
          ))}
        </div>

        {detail && (
          <div className="tough-detail">
            <div className="tough-detail-header-row" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
              <h4 style={{ margin: 0 }}>{detail.title}</h4>
              {onEditRange && (
                <button
                  type="button"
                  className="solid-btn small"
                  onClick={() => onEditRange(detail.id, detail.title, detail.actions ?? [])}
                >
                  {override ? "Edit Override" : "Edit Range"}
                </button>
              )}
            </div>
            <p className="muted small">{detail.spot_description}</p>
            <div className="tough-meta">
              {detail.street && <span>Street: <strong>{detail.street}</strong></span>}
              {detail.scenario_type && <span>Scenario: <strong>{formatScenarioType(detail.scenario_type)}</strong></span>}
              {detail.spot_action && <span>Action: <strong>{formatSpotAction(detail.spot_action)}</strong></span>}
              {detail.board && <span>Board: <strong>{detail.board}</strong></span>}
              {detail.hero_position && <span>Hero: <strong>{detail.hero_position}</strong></span>}
              {detail.villain_position && <span>vs <strong>{detail.villain_position}</strong></span>}
              {(detail.villain_profile ?? detail.villain_type) && (
                <span>Profile: <strong>{(detail.villain_profile ?? detail.villain_type)!.replace(/_/g, " ")}</strong></span>
              )}
              {detail.pot_type && <span>Pot type: <strong>{detail.pot_type}</strong></span>}
              {detail.stack_bb != null && <span>Stack: <strong>{detail.stack_bb}BB</strong></span>}
              {detail.pot_bb != null && <span>Pot: <strong>{detail.pot_bb}BB</strong></span>}
              {detail.raise_size_bb != null && <span>Raise: <strong>{detail.raise_size_bb}bb</strong></span>}
              {detail.page != null && <span>PDF page: <strong>{detail.page}</strong></span>}
              {detail.diagram != null && <span>Diagram: <strong>#{detail.diagram}</strong></span>}
            </div>

            {detail.stack_scenario && <StackTable scenario={detail.stack_scenario} />}

            {override ? (
              <div className="custom-override-grid-wrap" style={{ margin: "16px 0" }}>
                <h5 style={{ marginBottom: "8px" }}>Custom Range Override</h5>
                <RangeGrid gridData={override.grid_data} readOnly={true} />
              </div>
            ) : isGtoGridChart(detail) ? (
              <GtoGridNotice detail={detail} onOpenCfr={onOpenCfr} />
            ) : (
              <FreqBars actions={detail.actions ?? []} />
            )}

            {!isGtoGridChart(detail) && detail.cfr_hint && (
              <p className="muted small tough-cfr-hint">{detail.cfr_hint}</p>
            )}

            {drillOptions.length > 0 && (
              <div className="tough-drill">
                <h5>Action drill</h5>
                <div className="tough-drill-row">
                  <select value={drillAction} onChange={(e) => setDrillAction(e.target.value)}>
                    {drillOptions.map((name) => (
                      <option key={name} value={name}>{formatAction(name)}</option>
                    ))}
                  </select>
                  <button type="button" className="primary-btn" onClick={() => void runDrill()}>
                    Check vs chart
                  </button>
                </div>
                {evalResult && (
                  <div className={verdictClass(evalResult.verdict)}>
                    <strong>{evalResult.verdict?.replace(/_/g, " ") ?? "Result"}</strong>
                    <p>{evalResult.note ?? evalResult.message}</p>
                    {evalResult.primary_action && (
                      <p className="muted small">
                        Primary line: {formatAction(evalResult.primary_action)} ({((evalResult.primary_freq ?? 0) * 100).toFixed(1)}%)
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}

            <p className="muted small">
              Source: {detail.source ?? "TOUGH Charts reference"}
            </p>
          </div>
        )}
      </div>
    </section>
  );
}
