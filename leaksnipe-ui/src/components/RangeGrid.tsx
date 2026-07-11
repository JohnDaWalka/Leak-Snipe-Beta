import React, { useState } from "react";
import type { RangeCell, RangeAction } from "../lib/api";

const RANKS = ["A", "K", "Q", "J", "T", "9", "8", "7", "6", "5", "4", "3", "2"];

export function getHandNotation(row: number, col: number): string {
  if (row === col) {
    return RANKS[row] + RANKS[col];
  } else if (row < col) {
    return RANKS[row] + RANKS[col] + "s";
  } else {
    return RANKS[col] + RANKS[row] + "o";
  }
}

type RangeGridProps = {
  gridData: RangeCell[][] | null;
  onCellPaint?: (row: number, col: number, isRightClick: boolean) => void;
  onCellHover?: (notation: string, actions: RangeAction[] | null) => void;
  readOnly?: boolean;
};

export function RangeGrid({ gridData, onCellPaint, onCellHover, readOnly = false }: RangeGridProps) {
  const [isMouseDown, setIsMouseDown] = useState(false);
  const [lastPaintCoords, setLastPaintCoords] = useState<{ r: number; c: number } | null>(null);

  const handleMouseDown = (row: number, col: number, e: React.MouseEvent) => {
    if (readOnly || !onCellPaint) return;
    e.preventDefault();
    setIsMouseDown(true);
    const isRightClick = e.button === 2;
    onCellPaint(row, col, isRightClick);
    setLastPaintCoords({ r: row, c: col });
  };

  const handleMouseEnter = (row: number, col: number, e: React.MouseEvent) => {
    if (readOnly || !onCellPaint || !isMouseDown) {
      // Just hover update if any hover handler is present
      if (onCellHover && gridData) {
        const cell = gridData[row]?.[col];
        onCellHover(getHandNotation(row, col), cell ? cell.actions : []);
      }
      return;
    }
    if (lastPaintCoords?.r === row && lastPaintCoords?.c === col) return;
    const isRightClick = e.buttons === 2; // Right mouse button held down
    onCellPaint(row, col, isRightClick);
    setLastPaintCoords({ r: row, c: col });
  };

  const handleMouseUp = () => {
    setIsMouseDown(false);
    setLastPaintCoords(null);
  };

  // Prevent right click menu on the grid while painting
  const handleContextMenu = (e: React.MouseEvent) => {
    if (!readOnly) {
      e.preventDefault();
    }
  };

  const renderCell = (row: number, col: number) => {
    const notation = getHandNotation(row, col);
    const cell = gridData?.[row]?.[col];
    const actions = cell?.actions || [];

    // Build gradient background for mixed strategies (up to 5 actions/colors)
    let background = "rgba(148, 163, 184, 0.05)"; // default empty
    if (actions.length > 0) {
      const sortedActions = [...actions].sort((a, b) => a.action.localeCompare(b.action));
      let cumulative = 0;
      const stops: string[] = [];

      sortedActions.forEach((act) => {
        if (act.freq <= 0) return;
        const start = cumulative;
        const end = cumulative + act.freq;
        stops.push(`${act.color} ${start}%`);
        stops.push(`${act.color} ${end}%`);
        cumulative = end;
      });

      if (cumulative < 100) {
        stops.push(`rgba(148, 163, 184, 0.05) ${cumulative}%`);
        stops.push(`rgba(148, 163, 184, 0.05) 100%`);
      }

      if (stops.length > 0) {
        background = `linear-gradient(135deg, ${stops.join(", ")})`;
      }
    }

    // Determine font color based on row vs col
    const isPair = row === col;
    const isSuited = row < col;
    let textClass = "cell-offsuit";
    if (isPair) textClass = "cell-pair";
    if (isSuited) textClass = "cell-suited";

    return (
      <div
        key={`${row}-${col}`}
        className={`range-grid-cell ${textClass}`}
        style={{ background }}
        onMouseDown={(e) => handleMouseDown(row, col, e)}
        onMouseEnter={(e) => handleMouseEnter(row, col, e)}
        onContextMenu={handleContextMenu}
      >
        <span className="cell-notation">{notation}</span>
        {actions.length > 0 && (
          <div className="cell-freq-indicator">
            {actions.map((a, i) => a.freq > 0 ? (
              <span key={i} style={{ color: a.color }}>
                {a.freq}%
              </span>
            ) : null)}
          </div>
        )}
      </div>
    );
  };

  return (
    <div
      className="range-grid-container"
      onMouseLeave={handleMouseUp}
      onMouseUp={handleMouseUp}
    >
      <div className="range-grid-table">
        {RANKS.map((_, r) => (
          <div key={r} className="range-grid-row">
            {RANKS.map((_, c) => renderCell(r, c))}
          </div>
        ))}
      </div>
    </div>
  );
}
