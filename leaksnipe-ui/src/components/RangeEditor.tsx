import { useState, useEffect } from "react";
import { RangeGrid, getHandNotation } from "./RangeGrid";
import type { RangeCell, RangeAction } from "../lib/api";
import { api } from "../lib/api";

type RangeEditorProps = {
  initialGrid?: RangeCell[][] | null;
  initialPalette?: Record<string, string> | null;
  initialActions?: { name: string; freq: number }[] | null;
  chartId?: string | null; // Set if we are editing a chart override
  rangeId?: string | null; // Set if we are editing a custom range
  rangeName?: string;
  onClose?: () => void;
  onSaveSuccess?: () => void;
};

type BrushAction = {
  name: string;
  color: string;
  freq: number;
};

const DEFAULT_BRUSHES: BrushAction[] = [
  { name: "Raise", color: "#ef4444", freq: 100 },
  { name: "Call", color: "#3b82f6", freq: 100 },
  { name: "Limp", color: "#10b981", freq: 100 },
  { name: "3-Bet", color: "#a855f7", freq: 100 },
  { name: "Fold", color: "#64748b", freq: 100 },
];

export function RangeEditor({
  initialGrid,
  initialPalette,
  initialActions,
  chartId,
  rangeId,
  rangeName = "Custom Range",
  onClose,
  onSaveSuccess,
}: RangeEditorProps) {
  const [gridData, setGridData] = useState<RangeCell[][]>([]);
  const [brushes, setBrushes] = useState<BrushAction[]>(DEFAULT_BRUSHES);
  const [activeBrushIdx, setActiveBrushIdx] = useState<number>(0);
  const [history, setHistory] = useState<RangeCell[][][]>([]);
  const [historyIdx, setHistoryIdx] = useState<number>(-1);
  const [saveLoading, setSaveLoading] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [hoverHand, setHoverHand] = useState<string | null>(null);
  const [hoverActions, setHoverActions] = useState<RangeAction[] | null>(null);

  // Initialize grid and brushes
  useEffect(() => {
    const initData = async () => {
      let baseGrid: RangeCell[][] = [];
      let loadedPalette: Record<string, string> = { ...initialPalette };

      // If chartId is provided, try to fetch existing override first
      if (chartId) {
        try {
          const res = await api.getChartOverride(chartId);
          if (res?.override) {
            baseGrid = JSON.parse(JSON.stringify(res.override.grid_data));
            loadedPalette = { ...loadedPalette, ...res.override.color_palette };
          }
        } catch {
          // No override exists, start with empty
        }
      }

      if (baseGrid.length !== 13) {
        if (initialGrid && initialGrid.length === 13) {
          baseGrid = JSON.parse(JSON.stringify(initialGrid));
        } else {
          // Create empty grid
          baseGrid = [];
          for (let r = 0; r < 13; r++) {
            const row: RangeCell[] = [];
            for (let c = 0; c < 13; c++) {
              row.push({ notation: getHandNotation(r, c), actions: [] });
            }
            baseGrid.push(row);
          }
        }
      }

      setGridData(baseGrid);
      setHistory([baseGrid]);
      setHistoryIdx(0);

      // Populate brushes from initialActions or initialPalette
      let newBrushes = [...DEFAULT_BRUSHES];
      if (initialActions && initialActions.length > 0) {
        // Map initial actions to brushes
        const actionColors: Record<string, string> = {
          call: "#3b82f6",
          fold: "#64748b",
          raise: "#ef4444",
          raise_value: "#ef4444",
          raise_bluff: "#a855f7",
          all_in: "#f43f5e",
          defend: "#14b8a6",
          limp: "#10b981",
        };
        newBrushes = initialActions.map((act) => {
          const key = act.name.toLowerCase();
          const color = loadedPalette[act.name] || actionColors[key] || "#e2e8f0";
          return { name: act.name, color, freq: 100 };
        });
      } else if (Object.keys(loadedPalette).length > 0) {
        newBrushes = newBrushes.map((brush) => {
          if (loadedPalette[brush.name]) {
            return { ...brush, color: loadedPalette[brush.name] };
          }
          return brush;
        });
      }
      setBrushes(newBrushes);
    };

    void initData();
  }, [initialGrid, initialPalette, initialActions, chartId]);

  const activeBrush = brushes[activeBrushIdx];

  const pushToHistory = (newGrid: RangeCell[][]) => {
    const updatedHistory = history.slice(0, historyIdx + 1);
    updatedHistory.push(JSON.parse(JSON.stringify(newGrid)));
    if (updatedHistory.length > 50) {
      updatedHistory.shift();
    }
    setHistory(updatedHistory);
    setHistoryIdx(updatedHistory.length - 1);
  };

  const handleCellPaint = (row: number, col: number, isRightClick: boolean) => {
    const newGrid = JSON.parse(JSON.stringify(gridData));
    const cell: RangeCell = newGrid[row][col];

    if (isRightClick) {
      cell.actions = [];
    } else {
      // Paint mode
      const brushName = activeBrush.name;
      const brushColor = activeBrush.color;
      const brushFreq = activeBrush.freq;

      if (brushFreq === 100) {
        // Simple overwrite with 100% frequency
        cell.actions = [{ action: brushName, color: brushColor, freq: 100 }];
      } else {
        // Mixed strategy painting
        const existingIdx = cell.actions.findIndex((a) => a.action === brushName);
        if (existingIdx >= 0) {
          cell.actions[existingIdx].freq = brushFreq;
          cell.actions[existingIdx].color = brushColor;
        } else {
          cell.actions.push({ action: brushName, color: brushColor, freq: brushFreq });
        }

        // Sum frequencies
        let total = cell.actions.reduce((sum, a) => sum + a.freq, 0);
        if (total > 100) {
          // Reduce other actions proportionally so the sum is exactly 100%
          const otherTotal = total - brushFreq;
          const excess = total - 100;
          cell.actions = cell.actions.map((a) => {
            if (a.action === brushName) return a;
            const share = a.freq / otherTotal;
            const newFreq = Math.max(0, Math.round(a.freq - excess * share));
            return { ...a, freq: newFreq };
          }).filter((a) => a.freq > 0);
        }
      }
    }

    setGridData(newGrid);
    pushToHistory(newGrid);
  };

  const handleUndo = () => {
    if (historyIdx > 0) {
      const idx = historyIdx - 1;
      setHistoryIdx(idx);
      setGridData(JSON.parse(JSON.stringify(history[idx])));
    }
  };

  const handleRedo = () => {
    if (historyIdx < history.length - 1) {
      const idx = historyIdx + 1;
      setHistoryIdx(idx);
      setGridData(JSON.parse(JSON.stringify(history[idx])));
    }
  };

  const handleClearAll = () => {
    const cleared = gridData.map((row) =>
      row.map((cell) => ({ ...cell, actions: [] }))
    );
    setGridData(cleared);
    pushToHistory(cleared);
  };

  const handleFillAll = () => {
    const filled = gridData.map((row) =>
      row.map((cell) => ({
        ...cell,
        actions: [{ action: activeBrush.name, color: activeBrush.color, freq: activeBrush.freq }],
      }))
    );
    setGridData(filled);
    pushToHistory(filled);
  };

  const handleSave = async () => {
    setSaveLoading(true);
    setSaveError(null);
    try {
      const palette: Record<string, string> = {};
      brushes.forEach((b) => {
        palette[b.name] = b.color;
      });

      if (chartId) {
        // Save as chart override
        await api.saveChartOverride(chartId, gridData, palette);
      } else if (rangeId) {
        // Save existing custom range
        const oldRange = await api.getRange(rangeId);
        if (oldRange?.range) {
          await api.updateRange(rangeId, {
            name: oldRange.range.name,
            folder_id: oldRange.range.folder_id,
            position: oldRange.range.position,
            stack_depth: oldRange.range.stack_depth,
            game_type: oldRange.range.game_type,
            grid_data: gridData,
            color_palette: palette,
          });
        }
      }
      if (onSaveSuccess) onSaveSuccess();
      if (onClose) onClose();
    } catch (e: any) {
      setSaveError(e?.message || "Failed to save range changes");
    } finally {
      setSaveLoading(false);
    }
  };

  const handleResetToDefault = async () => {
    if (!chartId) return;
    setSaveLoading(true);
    try {
      await api.deleteChartOverride(chartId);
      if (onSaveSuccess) onSaveSuccess();
      if (onClose) onClose();
    } catch (e: any) {
      setSaveError(e?.message || "Failed to reset to default");
    } finally {
      setSaveLoading(false);
    }
  };

  const updateBrushColor = (idx: number, color: string) => {
    const updated = [...brushes];
    updated[idx].color = color;
    setBrushes(updated);
  };

  const updateBrushFreq = (idx: number, freq: number) => {
    const updated = [...brushes];
    updated[idx].freq = freq;
    setBrushes(updated);
  };

  // Compute overall combos count
  let totalCombos = 0;
  const actionCombos: Record<string, number> = {};
  brushes.forEach((b) => {
    actionCombos[b.name] = 0;
  });

  gridData.forEach((row, r) => {
    row.forEach((cell, c) => {
      let cellCombos = 6; // pairs
      if (r < c) cellCombos = 4; // suited
      if (r > c) cellCombos = 12; // offsuit

      cell.actions.forEach((act) => {
        if (act.freq > 0) {
          const share = (act.freq / 100) * cellCombos;
          actionCombos[act.action] = (actionCombos[act.action] || 0) + share;
          totalCombos += share;
        }
      });
    });
  });

  const [showExportModal, setShowExportModal] = useState(false);
  const [copiedAction, setCopiedAction] = useState<string | null>(null);

  const rangePct = ((totalCombos / 1326) * 100).toFixed(1);

  // Helper to format PioSolver string
  const getPioFormat = (actionName: string) => {
    const list: string[] = [];
    gridData.forEach((row, r) => {
      row.forEach((cell, c) => {
        const act = cell.actions.find((a) => a.action === actionName);
        if (act && act.freq > 0) {
          list.push(`${getHandNotation(r, c)}:${(act.freq / 100).toFixed(2)}`);
        }
      });
    });
    return list.join(",");
  };

  // Helper to format Equilab string
  const getEquilabFormat = (actionName: string) => {
    const list: string[] = [];
    gridData.forEach((row, r) => {
      row.forEach((cell, c) => {
        const act = cell.actions.find((a) => a.action === actionName);
        if (act && act.freq > 0) {
          list.push(getHandNotation(r, c));
        }
      });
    });
    return list.join(",");
  };

  const handleCopyText = (text: string, actionName: string) => {
    navigator.clipboard.writeText(text);
    setCopiedAction(actionName);
    setTimeout(() => setCopiedAction(null), 1500);
  };

  const handleExportPng = () => {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const cellSize = 36;
    const padding = 30;
    const headerHeight = 50;
    const legendHeight = 40;

    canvas.width = cellSize * 13 + padding * 2;
    canvas.height = cellSize * 13 + padding * 2 + headerHeight + legendHeight;

    // Draw background
    ctx.fillStyle = "#0f172a";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Draw title
    ctx.fillStyle = "#f8fafc";
    ctx.font = "bold 14px sans-serif";
    ctx.fillText(rangeName, padding, padding + 10);

    // Draw grid
    ctx.font = "bold 10px monospace";
    for (let r = 0; r < 13; r++) {
      for (let c = 0; c < 13; c++) {
        const notation = getHandNotation(r, c);
        const cell = gridData[r][c];
        const actions = cell.actions || [];
        const x = padding + c * cellSize;
        const y = padding + headerHeight + r * cellSize;

        if (actions.length > 0) {
          const sorted = [...actions].sort((a, b) => a.action.localeCompare(b.action));
          let cumulative = 0;
          sorted.forEach((act) => {
            if (act.freq <= 0) return;
            ctx.fillStyle = act.color;
            ctx.fillRect(x + (cumulative / 100) * cellSize, y, (act.freq / 100) * cellSize, cellSize);
            cumulative += act.freq;
          });
          if (cumulative < 100) {
            ctx.fillStyle = "rgba(148, 163, 184, 0.05)";
            ctx.fillRect(x + (cumulative / 100) * cellSize, y, ((100 - cumulative) / 100) * cellSize, cellSize);
          }
        } else {
          ctx.fillStyle = "rgba(148, 163, 184, 0.05)";
          ctx.fillRect(x, y, cellSize, cellSize);
        }

        ctx.strokeStyle = "rgba(148, 163, 184, 0.1)";
        ctx.lineWidth = 1;
        ctx.strokeRect(x, y, cellSize, cellSize);

        ctx.fillStyle = r === c ? "#ffffff" : r < c ? "#94a3b8" : "#64748b";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(notation, x + cellSize / 2, y + cellSize / 2);
      }
    }

    // Draw legend
    const legendY = canvas.height - legendHeight;
    let legendX = padding;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.font = "11px sans-serif";

    brushes.forEach((b) => {
      ctx.fillStyle = b.color;
      ctx.fillRect(legendX, legendY, 12, 12);
      ctx.fillStyle = "#94a3b8";
      ctx.fillText(b.name, legendX + 18, legendY + 6);
      legendX += ctx.measureText(b.name).width + 36;
    });

    const url = canvas.toDataURL("image/png");
    const link = document.createElement("a");
    link.download = `${rangeName.replace(/\s+/g, "_")}.png`;
    link.href = url;
    link.click();
  };

  const handleEmailRange = () => {
    let body = `LeakSnipe Range: ${rangeName}\n\n`;
    brushes.forEach((b) => {
      const pio = getPioFormat(b.name);
      if (pio) {
        body += `${b.name} (${actionCombos[b.name]?.toFixed(1)} combos):\n${pio}\n\n`;
      }
    });
    window.open(`mailto:?subject=${encodeURIComponent("LeakSnipe Range: " + rangeName)}&body=${encodeURIComponent(body)}`);
  };

  return (
    <div className="range-editor-container">
      <div className="range-editor-header">
        <div>
          <h3>{rangeName}</h3>
          {chartId && <span className="tag-pill info">Chart Override</span>}
        </div>
        <div className="btn-group">
          {chartId && (
            <button
              type="button"
              className="ghost-btn danger small"
              onClick={handleResetToDefault}
              disabled={saveLoading}
            >
              Reset to Default
            </button>
          )}
          <button
            type="button"
            className="ghost-btn small"
            onClick={() => setShowExportModal(true)}
            disabled={saveLoading}
          >
            Export & Share
          </button>
          <button
            type="button"
            className="ghost-btn small"
            onClick={onClose}
            disabled={saveLoading}
          >
            Cancel
          </button>
          <button
            type="button"
            className="solid-btn small"
            onClick={handleSave}
            disabled={saveLoading}
          >
            {saveLoading ? "Saving..." : "Save Range"}
          </button>
        </div>
      </div>

      {saveError && <div className="error-banner">{saveError}</div>}

      <div className="range-editor-body">
        {/* Left Sidebar: Palette & Painting Tools */}
        <div className="range-editor-sidebar">
          <div className="sidebar-section">
            <h4>Action Palette</h4>
            <p className="sidebar-hint">Select a brush to paint on the grid. Right-click to erase.</p>

            <div className="brush-list">
              {brushes.map((b, idx) => (
                <div
                  key={b.name}
                  className={`brush-item ${activeBrushIdx === idx ? "active" : ""}`}
                  onClick={() => setActiveBrushIdx(idx)}
                >
                  <input
                    type="color"
                    className="brush-color-picker"
                    value={b.color}
                    onChange={(e) => updateBrushColor(idx, e.target.value)}
                  />
                  <div className="brush-details">
                    <span className="brush-name">{b.name}</span>
                    <div className="brush-freq-slider">
                      <input
                        type="range"
                        min="5"
                        max="100"
                        step="5"
                        value={b.freq}
                        onChange={(e) => updateBrushFreq(idx, parseInt(e.target.value))}
                      />
                      <span className="brush-freq-val">{b.freq}%</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="sidebar-section">
            <h4>Grid Tools</h4>
            <div className="btn-group vertical">
              <button type="button" className="ghost-btn small" onClick={handleClearAll}>
                Clear Grid
              </button>
              <button type="button" className="ghost-btn small" onClick={handleFillAll}>
                Fill Grid with Brush
              </button>
            </div>
            <div className="btn-group horizontal" style={{ marginTop: "8px" }}>
              <button
                type="button"
                className="ghost-btn small"
                onClick={handleUndo}
                disabled={historyIdx <= 0}
              >
                Undo
              </button>
              <button
                type="button"
                className="ghost-btn small"
                onClick={handleRedo}
                disabled={historyIdx >= history.length - 1}
              >
                Redo
              </button>
            </div>
          </div>

          <div className="sidebar-section stats">
            <h4>Range Statistics</h4>
            <div className="stat-row font-large">
              <span>Overall Range:</span>
              <strong>{rangePct}%</strong>
            </div>
            <div className="stat-row">
              <span>Total Combos:</span>
              <span>{totalCombos.toFixed(1)} / 1326</span>
            </div>
            <hr className="divider" />
            {brushes.map((b) => (
              <div key={b.name} className="stat-row">
                <span style={{ color: b.color }}>{b.name}:</span>
                <span>{actionCombos[b.name]?.toFixed(1) || 0} combos</span>
              </div>
            ))}
          </div>
        </div>

        {/* Center: Grid */}
        <div className="range-editor-grid-pane">
          <RangeGrid
            gridData={gridData}
            onCellPaint={handleCellPaint}
            onCellHover={(notation, actions) => {
              setHoverHand(notation);
              setHoverActions(actions);
            }}
          />

          {/* Hover Details overlay */}
          <div className="hover-details-overlay">
            {hoverHand ? (
              <>
                <strong>{hoverHand}</strong>
                {hoverActions && hoverActions.length > 0 ? (
                  <div className="hover-actions-list">
                    {hoverActions.map((act, i) => (
                      <span key={i} style={{ color: act.color, marginRight: "8px" }}>
                        {act.action}: {act.freq}%
                      </span>
                    ))}
                  </div>
                ) : (
                  <span className="text-dim">Fold / No Action</span>
                )}
              </>
            ) : (
              <span className="text-dim">Hover over a cell to view details</span>
            )}
          </div>
        </div>
      </div>

      {showExportModal && (
        <div className="modal-backdrop" style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(15, 23, 42, 0.8)", zIndex: 1000, display: "flex", justifyContent: "center", alignItems: "center" }}>
          <div className="modal-card" style={{ background: "#1e293b", border: "1px solid rgba(148, 163, 184, 0.15)", borderRadius: "1rem", padding: "1.5rem", width: "100%", maxWidth: "560px", boxShadow: "0 20px 25px -5px rgba(0,0,0,0.5)", display: "flex", flexDirection: "column", gap: "1.25rem" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid rgba(148, 163, 184, 0.1)", paddingBottom: "0.5rem" }}>
              <h3 style={{ margin: 0, color: "#f8fafc" }}>Export & Share Range</h3>
              <button type="button" className="ghost-btn small" onClick={() => setShowExportModal(false)} style={{ fontSize: "1.2rem", padding: "0 0.5rem" }}>×</button>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
              {/* Media Sharing Actions */}
              <div style={{ display: "flex", gap: "0.75rem" }}>
                <button type="button" className="solid-btn small" style={{ flex: 1 }} onClick={handleExportPng}>
                  Download PNG
                </button>
                <button type="button" className="ghost-btn small" style={{ flex: 1 }} onClick={handleEmailRange}>
                  Share via Email
                </button>
                <button type="button" className="ghost-btn small" style={{ flex: 1 }} onClick={() => window.print()}>
                  Print Range
                </button>
              </div>

              {/* Text Range Formats */}
              <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem", marginTop: "0.5rem" }}>
                <h4 style={{ margin: 0, fontSize: "0.85rem", textTransform: "uppercase", letterSpacing: "0.05em", color: "#94a3b8" }}>PioSolver / Text Formats</h4>
                {brushes.map((b) => {
                  const pioStr = getPioFormat(b.name);
                  const equilabStr = getEquilabFormat(b.name);
                  if (!pioStr) return null;

                  return (
                    <div key={b.name} style={{ background: "rgba(15,23,42,0.4)", borderRadius: "0.5rem", padding: "0.75rem", border: "1px solid rgba(148,163,184,0.06)", display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <span style={{ color: b.color, fontWeight: "700", fontSize: "0.85rem" }}>{b.name} Range</span>
                        <div style={{ display: "flex", gap: "0.5rem" }}>
                          <button
                            type="button"
                            className="ghost-btn small"
                            style={{ fontSize: "0.75rem", padding: "0.2rem 0.5rem" }}
                            onClick={() => handleCopyText(pioStr, b.name + "-pio")}
                          >
                            {copiedAction === b.name + "-pio" ? "Copied!" : "Copy Pio"}
                          </button>
                          <button
                            type="button"
                            className="ghost-btn small"
                            style={{ fontSize: "0.75rem", padding: "0.2rem 0.5rem" }}
                            onClick={() => handleCopyText(equilabStr, b.name + "-equilab")}
                          >
                            {copiedAction === b.name + "-equilab" ? "Copied!" : "Copy Equilab"}
                          </button>
                        </div>
                      </div>
                      <div style={{ fontSize: "0.75rem", color: "#64748b", overflowX: "auto", whiteSpace: "nowrap", fontFamily: "ui-monospace, monospace", padding: "0.25rem 0" }}>
                        {pioStr}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", borderTop: "1px solid rgba(148, 163, 184, 0.1)", paddingTop: "0.75rem" }}>
              <button type="button" className="solid-btn small" onClick={() => setShowExportModal(false)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
