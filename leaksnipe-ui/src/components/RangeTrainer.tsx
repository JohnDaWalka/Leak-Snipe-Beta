import { useState, useEffect, useMemo } from "react";
import { RangeGrid, getHandNotation } from "./RangeGrid";
import { api, type RangeCell, type RangeAction } from "../lib/api";

const DEPTHS = [5, 10, 25, 35, 50, 75, 100];
const POSITIONS = ["UTG", "MP", "CO", "BTN", "SB", "BB"];

type DrillConfig = {
  type: "cfr" | "override";
  stackBb: number;
  position: string;
  chartId?: string;
  chartTitle?: string;
  mode: "classic" | "drawing";
};

type DealtHand = {
  notation: string;
  cards: string;
  cell: RangeCell;
};

// Helper to generate a visual card representation from hand notation
// e.g., "AKs" -> "A♠K♠", "AKo" -> "A♠K♥", "AA" -> "A♠A♦"
function formatVisualCards(notation: string): string {
  const suits = ["♠", "♥", "♦", "♣"];
  if (notation.length === 2) {
    // pocket pair
    return `${notation[0]}${suits[0]}${notation[1]}${suits[1]}`;
  } else if (notation.endsWith("s")) {
    // suited
    return `${notation[0]}${suits[0]}${notation[1]}${suits[0]}`;
  } else {
    // offsuit
    return `${notation[0]}${suits[0]}${notation[1]}${suits[1]}`;
  }
}

// Generate all 169 hands weighted by combo counts for random dealing
const COMBOS_POOL: string[] = [];
for (let r = 0; r < 13; r++) {
  for (let c = 0; c < 13; c++) {
    const notation = getHandNotation(r, c);
    let count = 6; // pairs
    if (r < c) count = 4; // suited
    if (r > c) count = 12; // offsuit
    for (let i = 0; i < count; i++) {
      COMBOS_POOL.push(notation);
    }
  }
}

export function RangeTrainer() {
  const [sessionActive, setSessionActive] = useState(false);
  const [config, setConfig] = useState<DrillConfig>({
    type: "cfr",
    stackBb: 25,
    position: "BTN",
    mode: "classic",
  });

  const [overriddenCharts, setOverriddenCharts] = useState<{ id: string; title: string }[]>([]);
  const [targetGrid, setTargetGrid] = useState<RangeCell[][] | null>(null);
  const [targetPalette, setTargetPalette] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Active session state
  const [dealtHand, setDealtHand] = useState<DealtHand | null>(null);
  const [score, setScore] = useState({ correct: 0, total: 0 });
  const [streak, setStreak] = useState(0);
  const [maxStreak, setMaxStreak] = useState(0);
  const [feedback, setFeedback] = useState<{ isCorrect: boolean; text: string } | null>(null);
  const [handHistory, setHandHistory] = useState<{ notation: string; isCorrect: boolean }[]>([]);

  // Range drawing state
  const [drawingGrid, setDrawingGrid] = useState<RangeCell[][]>([]);
  const [drawingBrushes, setDrawingBrushes] = useState<{ name: string; color: string }[]>([]);
  const [activeBrushIdx, setActiveBrushIdx] = useState(0);
  const [drawingResult, setDrawingResult] = useState<{ score: number; checkedGrid: RangeCell[][] } | null>(null);

  // Fetch overrides on mount
  useEffect(() => {
    const fetchOverrides = async () => {
      try {
        // Fetch all strategy charts and check which ones have overrides
        const res = await api.toughCharts({ source: "all" });
        const list: { id: string; title: string }[] = [];
        for (const c of res.charts) {
          try {
            const ov = await api.getChartOverride(c.id);
            if (ov?.override) {
              list.push({ id: c.id, title: c.title });
            }
          } catch {
            // Ignore
          }
        }
        setOverriddenCharts(list);
        if (list.length > 0) {
          setConfig((prev) => ({ ...prev, chartId: list[0].id, chartTitle: list[0].title }));
        }
      } catch (err) {
        console.error("Failed to load overridden charts list", err);
      }
    };
    void fetchOverrides();
  }, []);

  const handleStartDrill = async () => {
    setLoading(true);
    setError(null);
    setTargetGrid(null);
    setDealtHand(null);
    setFeedback(null);
    setDrawingResult(null);
    setScore({ correct: 0, total: 0 });
    setStreak(0);
    setHandHistory([]);

    try {
      let grid: RangeCell[][] = [];
      let palette: Record<string, string> = {};

      if (config.type === "cfr") {
        // Let's call the actual CFR chart endpoint
        const cfrRes = await fetch(`/api/theory/charts?stack_bb=${config.stackBb}&position=${config.position}`);
        const cfrData = await cfrRes.json();
        if (cfrData?.grid) {
          // Map CFR cells to RangeCells
          grid = cfrData.grid.map((row: any[]) =>
            row.map((cell: any) => ({
              notation: cell.notation,
              actions: cell.action ? [{ action: cell.action, color: cell.color || "#ef4444", freq: Math.round(cell.freq * 100) }] : [],
            }))
          );
          palette = cfrData.legend || {};
        } else {
          throw new Error("Failed to load CFR+ chart data");
        }
      } else if (config.type === "override" && config.chartId) {
        const res = await api.getChartOverride(config.chartId);
        if (res?.override) {
          grid = res.override.grid_data;
          palette = res.override.color_palette;
        } else {
          throw new Error("Selected chart has no custom override grid saved");
        }
      }

      if (grid.length !== 13) {
        throw new Error("Invalid grid structure retrieved");
      }

      setTargetGrid(grid);
      setTargetPalette(palette);
      setSessionActive(true);

      if (config.mode === "classic") {
        dealNextHand(grid);
      } else {
        // Init blank drawing grid
        const blank: RangeCell[][] = [];
        for (let r = 0; r < 13; r++) {
          const row: RangeCell[] = [];
          for (let c = 0; c < 13; c++) {
            row.push({ notation: getHandNotation(r, c), actions: [] });
          }
          blank.push(row);
        }
        setDrawingGrid(blank);

        // Populate brushes from target palette
        const brushesList = Object.entries(palette).map(([name, color]) => ({ name, color }));
        if (brushesList.length === 0) {
          brushesList.push({ name: "Play", color: "#ef4444" });
        }
        setDrawingBrushes(brushesList);
        setActiveBrushIdx(0);
      }
    } catch (err: any) {
      setError(err?.message || "Failed to start session");
    } finally {
      setLoading(false);
    }
  };

  const dealNextHand = (grid: RangeCell[][]) => {
    setFeedback(null);
    // Pick random hand from COMBO_POOL
    const idx = Math.floor(Math.random() * COMBOS_POOL.length);
    const notation = COMBOS_POOL[idx];

    // Find in grid
    let cell: RangeCell | null = null;
    for (let r = 0; r < 13; r++) {
      for (let c = 0; c < 13; c++) {
        if (getHandNotation(r, c) === notation) {
          cell = grid[r][c];
          break;
        }
      }
    }

    if (cell) {
      setDealtHand({
        notation,
        cards: formatVisualCards(notation),
        cell,
      });
    }
  };

  const handleActionChoice = (chosenAction: string) => {
    if (!dealtHand) return;

    const cell = dealtHand.cell;
    const actions = cell.actions || [];
    
    // Find correct actions (any action with freq > 0)
    const validActions = actions.filter((a) => a.freq > 0);
    const correctActionNames = validActions.map((a) => a.action.toLowerCase());
    
    let isCorrect = false;
    let feedbackText = "";

    if (correctActionNames.length === 0) {
      // Correct action is Fold
      if (chosenAction.toLowerCase() === "fold") {
        isCorrect = true;
        feedbackText = "Correct! Fold is the only play here.";
      } else {
        feedbackText = "Wrong! Fold is the correct play.";
      }
    } else {
      const match = validActions.find((a) => a.action.toLowerCase() === chosenAction.toLowerCase());
      if (match) {
        isCorrect = true;
        const highest = validActions.reduce((max, a) => (a.freq > max.freq ? a : max), validActions[0]);
        if (match.action === highest.action) {
          feedbackText = `Perfect! ${match.action} is the primary play (${match.freq}%).`;
        } else {
          feedbackText = `Correct! Mixed strategy: ${match.action} is played ${match.freq}% of the time.`;
        }
      } else {
        const primary = validActions.reduce((max, a) => (a.freq > max.freq ? a : max), validActions[0]);
        feedbackText = `Wrong! ${chosenAction} is 0%. Play ${primary.action} (${primary.freq}%).`;
      }
    }

    setFeedback({ isCorrect, text: feedbackText });
    setScore((prev) => ({
      correct: prev.correct + (isCorrect ? 1 : 0),
      total: prev.total + 1,
    }));

    if (isCorrect) {
      setStreak((prev) => {
        const next = prev + 1;
        if (next > maxStreak) setMaxStreak(next);
        return next;
      });
    } else {
      setStreak(0);
    }

    setHandHistory((prev) => [
      { notation: dealtHand.notation, isCorrect },
      ...prev.slice(0, 19), // keep last 20
    ]);
  };

  // Drawing mode grid paint
  const handleDrawingCellPaint = (row: number, col: number, isRightClick: boolean) => {
    const newGrid = JSON.parse(JSON.stringify(drawingGrid));
    const cell: RangeCell = newGrid[row][col];

    if (isRightClick) {
      cell.actions = [];
    } else {
      const brush = drawingBrushes[activeBrushIdx];
      cell.actions = [{ action: brush.name, color: brush.color, freq: 100 }];
    }
    setDrawingGrid(newGrid);
  };

  const checkDrawingResult = () => {
    if (!targetGrid) return;

    let correctCells = 0;
    const checkedGrid = JSON.parse(JSON.stringify(drawingGrid));

    for (let r = 0; r < 13; r++) {
      for (let c = 0; c < 13; c++) {
        const drawnActions = drawingGrid[r][c].actions || [];
        const targetActions = targetGrid[r][c].actions || [];

        const drawnPlay = drawnActions.length > 0 ? drawnActions[0].action : "";
        
        // Find primary play in target cell (highest frequency)
        let targetPlay = "";
        if (targetActions.length > 0) {
          const primary = targetActions.reduce((max, a) => (a.freq > max.freq ? a : max), targetActions[0]);
          targetPlay = primary.action;
        }

        const cell: RangeCell = checkedGrid[r][c];

        if (drawnPlay.toLowerCase() === targetPlay.toLowerCase()) {
          correctCells++;
          if (drawnPlay) {
            cell.actions[0].color = "#22c55e"; // Highlight correct painted in green
          }
        } else {
          // Highlight errors:
          if (drawnPlay) {
            cell.actions[0].color = "#ef4444"; // Painted wrong action -> Red
          } else {
            // Missed cell -> Show outline or light red
            cell.actions = [{ action: "Missed", color: "rgba(239, 68, 68, 0.25)", freq: 100 }];
          }
        }
      }
    }

    const accuracy = Math.round((correctCells / 169) * 100);
    setDrawingResult({ score: accuracy, checkedGrid });
  };

  const handleStopSession = () => {
    setSessionActive(false);
    setTargetGrid(null);
  };

  // Buttons to show in Hand Mode
  const activeButtons = useMemo(() => {
    if (config.mode !== "classic") return [];
    const defaults = ["Raise", "Call", "Limp", "3-Bet", "Fold"];
    // Include all actions from target palette, plus Fold
    const paletteActions = Object.keys(targetPalette);
    const list = new Set(paletteActions.length > 0 ? paletteActions : defaults);
    list.add("Fold");
    return Array.from(list);
  }, [targetPalette, config.mode]);

  // Compute stats heatmap from hand history
  const heatmapGrid = useMemo(() => {
    const accuracyMap: Record<string, { correct: number; total: number }> = {};
    handHistory.forEach((h) => {
      if (!accuracyMap[h.notation]) {
        accuracyMap[h.notation] = { correct: 0, total: 0 };
      }
      accuracyMap[h.notation].total++;
      if (h.isCorrect) accuracyMap[h.notation].correct++;
    });

    const grid: RangeCell[][] = [];
    for (let r = 0; r < 13; r++) {
      const row: RangeCell[] = [];
      for (let c = 0; c < 13; c++) {
        const notation = getHandNotation(r, c);
        const stats = accuracyMap[notation];
        const actions: RangeAction[] = [];
        if (stats) {
          const pct = Math.round((stats.correct / stats.total) * 100);
          const color = pct >= 80 ? "#22c55e" : pct >= 50 ? "#eab308" : "#ef4444";
          actions.push({ action: `${pct}%`, color, freq: 100 });
        }
        row.push({ notation, actions });
      }
      grid.push(row);
    }
    return grid;
  }, [handHistory]);

  return (
    <div className="range-trainer-container" style={{ display: "flex", flexDirection: "column", gap: "1.25rem", background: "#0f172a", border: "1px solid rgba(148, 163, 184, 0.12)", padding: "1.25rem", borderRadius: "1rem", marginTop: "1rem" }}>
      <div className="range-trainer-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid rgba(148, 163, 184, 0.12)", paddingBottom: "0.75rem" }}>
        <div>
          <h3 style={{ margin: 0, fontSize: "1.25rem", color: "#f8fafc" }}>Range Trainer & Sim</h3>
          <p className="muted small" style={{ margin: "0.25rem 0 0 0" }}>Practice preflop spots against CFR+ GTO ranges or your custom Tough Chart overrides.</p>
        </div>
        {sessionActive && (
          <button type="button" className="ghost-btn danger small" onClick={handleStopSession}>
            Stop Drill
          </button>
        )}
      </div>

      {error && <div className="error-banner">{error}</div>}

      {!sessionActive ? (
        /* Configuration Pane */
        <div className="trainer-setup-pane" style={{ background: "rgba(30, 41, 59, 0.5)", border: "1px solid rgba(148, 163, 184, 0.08)", borderRadius: "0.75rem", padding: "1.5rem", maxWidth: "600px", margin: "1rem auto" }}>
          <h4 style={{ marginTop: 0, color: "#f1f5f9" }}>New Drill Session</h4>
          
          <div className="form-grid" style={{ display: "flex", flexDirection: "column", gap: "1rem", marginTop: "1rem" }}>
            <label style={{ display: "flex", flexDirection: "column", gap: "0.35rem", fontSize: "0.85rem", color: "#94a3b8" }}>
              Spot Source
              <select
                value={config.type}
                onChange={(e) => setConfig({ ...config, type: e.target.value as any })}
                style={{ background: "#1e293b", border: "1px solid rgba(148, 163, 184, 0.15)", borderRadius: "0.5rem", padding: "0.5rem", color: "#f1f5f9" }}
              >
                <option value="cfr">CFR+ GTO Stack Charts</option>
                <option value="override">Strategy Chart Overrides (Tough/Secrets)</option>
              </select>
            </label>

            {config.type === "cfr" ? (
              <div className="cfr-filters-row" style={{ display: "flex", gap: "1rem" }}>
                <label style={{ flex: 1, display: "flex", flexDirection: "column", gap: "0.35rem", fontSize: "0.85rem", color: "#94a3b8" }}>
                  Stack Depth
                  <select
                    value={config.stackBb}
                    onChange={(e) => setConfig({ ...config, stackBb: Number(e.target.value) })}
                    style={{ background: "#1e293b", border: "1px solid rgba(148, 163, 184, 0.15)", borderRadius: "0.5rem", padding: "0.5rem", color: "#f1f5f9" }}
                  >
                    {DEPTHS.map((d) => (
                      <option key={d} value={d}>{d}BB</option>
                    ))}
                  </select>
                </label>
                <label style={{ flex: 1, display: "flex", flexDirection: "column", gap: "0.35rem", fontSize: "0.85rem", color: "#94a3b8" }}>
                  Hero Position
                  <select
                    value={config.position}
                    onChange={(e) => setConfig({ ...config, position: e.target.value })}
                    style={{ background: "#1e293b", border: "1px solid rgba(148, 163, 184, 0.15)", borderRadius: "0.5rem", padding: "0.5rem", color: "#f1f5f9" }}
                  >
                    {POSITIONS.map((p) => (
                      <option key={p} value={p}>{p}</option>
                    ))}
                  </select>
                </label>
              </div>
            ) : (
              <label style={{ display: "flex", flexDirection: "column", gap: "0.35rem", fontSize: "0.85rem", color: "#94a3b8" }}>
                Select Chart Override
                {overriddenCharts.length > 0 ? (
                  <select
                    value={config.chartId}
                    onChange={(e) => {
                      const opt = overriddenCharts.find((c) => c.id === e.target.value);
                      setConfig({ ...config, chartId: e.target.value, chartTitle: opt?.title });
                    }}
                    style={{ background: "#1e293b", border: "1px solid rgba(148, 163, 184, 0.15)", borderRadius: "0.5rem", padding: "0.5rem", color: "#f1f5f9" }}
                  >
                    {overriddenCharts.map((c) => (
                      <option key={c.id} value={c.id}>{c.title}</option>
                    ))}
                  </select>
                ) : (
                  <div className="info-banner" style={{ background: "rgba(59, 130, 246, 0.08)", border: "1px solid rgba(59, 130, 246, 0.25)", padding: "0.75rem", borderRadius: "0.5rem", fontSize: "0.85rem", color: "#93c5fd" }}>
                    No overrides saved. Go edit some ranges on Strategy Charts (Tough tab) to drill them here!
                  </div>
                )}
              </label>
            )}

            <label style={{ display: "flex", flexDirection: "column", gap: "0.35rem", fontSize: "0.85rem", color: "#94a3b8" }}>
              Training Mode
              <select
                value={config.mode}
                onChange={(e) => setConfig({ ...config, mode: e.target.value as any })}
                style={{ background: "#1e293b", border: "1px solid rgba(148, 163, 184, 0.15)", borderRadius: "0.5rem", padding: "0.5rem", color: "#f1f5f9" }}
              >
                <option value="classic">Classic Hand Drill (Interactive flashcard)</option>
                <option value="drawing">Range Drawing Test (Paint from memory)</option>
              </select>
            </label>
          </div>

          <button
            type="button"
            className="solid-btn"
            style={{ width: "100%", marginTop: "1.5rem" }}
            onClick={handleStartDrill}
            disabled={loading || (config.type === "override" && overriddenCharts.length === 0)}
          >
            {loading ? "Loading range data..." : "Start Drilling"}
          </button>
        </div>
      ) : (
        /* Active Game Session */
        <div className="trainer-active-session" style={{ display: "flex", gap: "2rem" }}>
          {config.mode === "classic" ? (
            /* CLASSIC FLASHCARD DRILL */
            <div className="flashcard-column" style={{ flex: "1", display: "flex", flexDirection: "column", gap: "1.5rem", alignItems: "center" }}>
              <div className="stats-row-strip" style={{ display: "flex", gap: "2rem", background: "rgba(30, 41, 59, 0.4)", padding: "0.75rem 1.5rem", borderRadius: "0.5rem", border: "1px solid rgba(148, 163, 184, 0.08)", width: "100%", justifyContent: "space-around" }}>
                <div>Score: <strong style={{ color: "#22c55e" }}>{score.correct}</strong> / {score.total}</div>
                <div>Streak: <strong style={{ color: "#fbbf24" }}>{streak}</strong> (Max: {maxStreak})</div>
              </div>

              {dealtHand && (
                <div className="dealt-hand-card" style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "1rem", padding: "2.5rem 3rem", background: "#1e293b", border: "1px solid rgba(148, 163, 184, 0.12)", borderRadius: "1rem", boxShadow: "0 10px 25px -5px rgba(0, 0, 0, 0.3)", width: "100%", maxWidth: "340px" }}>
                  <span style={{ fontSize: "0.85rem", textTransform: "uppercase", letterSpacing: "0.08em", color: "#94a3b8" }}>You are dealt</span>
                  <span style={{ fontSize: "3.5rem", fontWeight: "800", letterSpacing: "-0.05em", color: "#f8fafc", fontFamily: "ui-monospace, monospace" }}>
                    {dealtHand.cards}
                  </span>
                  <span className="tag-pill" style={{ background: "rgba(59, 130, 246, 0.15)", color: "#60a5fa", padding: "0.25rem 0.75rem", borderRadius: "999px", fontSize: "0.8rem", fontWeight: "600" }}>
                    {config.type === "cfr" ? `${config.position} · ${config.stackBb}BB` : config.chartTitle}
                  </span>
                </div>
              )}

              {/* Action Choices */}
              {!feedback ? (
                <div className="action-choices-strip" style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", justifyContent: "center" }}>
                  {activeButtons.map((btnName) => (
                    <button
                      key={btnName}
                      type="button"
                      className="solid-btn medium"
                      style={{ minWidth: "90px" }}
                      onClick={() => handleActionChoice(btnName)}
                    >
                      {btnName}
                    </button>
                  ))}
                </div>
              ) : (
                <div className="feedback-banner" style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "1rem", padding: "1.25rem", width: "100%", maxWidth: "380px", borderRadius: "0.75rem", border: "1px solid", background: feedback.isCorrect ? "rgba(34, 197, 94, 0.08)" : "rgba(239, 68, 68, 0.08)", borderColor: feedback.isCorrect ? "rgba(34, 197, 94, 0.25)" : "rgba(239, 68, 68, 0.25)" }}>
                  <strong style={{ color: feedback.isCorrect ? "#4ade80" : "#f87171", fontSize: "1.1rem" }}>
                    {feedback.isCorrect ? "Correct!" : "Incorrect"}
                  </strong>
                  <p style={{ margin: 0, textAlign: "center", fontSize: "0.9rem", color: "#cbd5e1" }}>{feedback.text}</p>
                  <button
                    type="button"
                    className="solid-btn small"
                    onClick={() => dealNextHand(targetGrid!)}
                  >
                    Next Hand
                  </button>
                </div>
              )}
            </div>
          ) : (
            /* RANGE DRAWING TEST */
            <div className="drawing-column" style={{ flex: "1", display: "flex", flexDirection: "column", gap: "1.5rem", alignItems: "center" }}>
              <div className="drawing-toolbar" style={{ display: "flex", gap: "2rem", width: "100%", justifyContent: "space-between", alignItems: "center" }}>
                <div className="brush-selectors" style={{ display: "flex", gap: "0.5rem" }}>
                  {drawingBrushes.map((b, idx) => (
                    <button
                      key={b.name}
                      type="button"
                      className={`ghost-btn small${activeBrushIdx === idx ? " active" : ""}`}
                      style={{ borderColor: activeBrushIdx === idx ? b.color : "transparent", color: b.color }}
                      onClick={() => setActiveBrushIdx(idx)}
                    >
                      Paint {b.name}
                    </button>
                  ))}
                </div>
                {!drawingResult ? (
                  <button type="button" className="solid-btn small" onClick={checkDrawingResult}>
                    Submit Range
                  </button>
                ) : (
                  <div style={{ display: "flex", gap: "1rem", alignItems: "center" }}>
                    <span>Score: <strong style={{ color: drawingResult.score >= 80 ? "#22c55e" : "#ef4444" }}>{drawingResult.score}%</strong></span>
                    <button type="button" className="solid-btn small" onClick={handleStartDrill}>
                      Try Again
                    </button>
                  </div>
                )}
              </div>

              <div className="drawing-grid-wrap">
                <RangeGrid
                  gridData={drawingResult ? drawingResult.checkedGrid : drawingGrid}
                  onCellPaint={!drawingResult ? handleDrawingCellPaint : undefined}
                />
              </div>

              {drawingResult && (
                <div className="legend-notice muted small" style={{ display: "flex", gap: "1.5rem" }}>
                  <span style={{ color: "#22c55e" }}>● Correctly Painted</span>
                  <span style={{ color: "#ef4444" }}>● Incorrect / Missed</span>
                </div>
              )}
            </div>
          )}

          {/* Right Sidebar: Dealt Hands History & Accuracy Heatmap */}
          {config.mode === "classic" && (
            <div className="trainer-history-sidebar" style={{ flex: "0 0 340px", display: "flex", flexDirection: "column", gap: "1.25rem" }}>
              <div className="sidebar-section">
                <h4>Accuracy Heatmap</h4>
                <p className="sidebar-hint" style={{ marginBottom: "0.75rem" }}>Accuracy map based on current session drills (Green = right, Red = wrong).</p>
                <div style={{ transform: "scale(0.62)", transformOrigin: "top left", width: "100%", height: "230px" }}>
                  <RangeGrid gridData={heatmapGrid} readOnly={true} />
                </div>
              </div>

              <div className="sidebar-section" style={{ flex: 1, display: "flex", flexDirection: "column" }}>
                <h4>Drill Log (Recent)</h4>
                <div className="drill-history-list" style={{ marginTop: "0.5rem", overflowY: "auto", flex: 1, maxHeight: "200px" }}>
                  {handHistory.length > 0 ? (
                    handHistory.map((h, i) => (
                      <div
                        key={i}
                        style={{ display: "flex", justifyContent: "space-between", padding: "0.35rem 0.5rem", background: i % 2 === 0 ? "rgba(255,255,255,0.02)" : "transparent", fontSize: "0.85rem" }}
                      >
                        <span style={{ fontFamily: "ui-monospace, monospace", fontWeight: "600" }}>{h.notation}</span>
                        <span style={{ color: h.isCorrect ? "#4ade80" : "#f87171", fontWeight: "700" }}>
                          {h.isCorrect ? "✓ RIGHT" : "✗ WRONG"}
                        </span>
                      </div>
                    ))
                  ) : (
                    <span className="text-dim small">No hands played yet. Click options on the left to start.</span>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
