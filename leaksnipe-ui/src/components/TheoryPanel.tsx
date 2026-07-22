import { useCallback, useEffect, useState } from "react";
import {
  api,
  waitForBackend,
  type CfrResult,
  type TheoryChartResult,
  type TheoryGame,
  type ValueNetResult,
} from "../lib/api";
import { RangeStudio } from "./RangeStudio";
import { ToughChartsPanel } from "./ToughChartsPanel";
import { RangeEditor } from "./RangeEditor";
import { RangeTrainer } from "./RangeTrainer";

const DEPTHS = [5, 10, 25, 35, 50, 75, 100] as const;
/** Full 9-max chart seats — keep in sync with theory.charts.CHART_POSITIONS */
const DEFAULT_POSITIONS = [
  "UTG",
  "UTG+1",
  "UTG+2",
  "MP",
  "LJ",
  "HJ",
  "CO",
  "BTN",
  "SB",
  "BB",
] as const;

export function TheoryPanel() {
  const [theoryTab, setTheoryTab] = useState<"cfr" | "tough" | "editor" | "trainer">("cfr");
  const [editChartId, setEditChartId] = useState<string | null>(null);
  const [editChartTitle, setEditChartTitle] = useState("");
  const [editChartActions, setEditChartActions] = useState<{ name: string; freq: number }[]>([]);
  const [refreshToggle, setRefreshToggle] = useState(false);
  const [games, setGames] = useState<TheoryGame[]>([]);
  const [depths, setDepths] = useState<number[]>([...DEPTHS]);
  const [positions, setPositions] = useState<string[]>([...DEFAULT_POSITIONS]);
  const [stackBb, setStackBb] = useState<number>(25);
  const [position, setPosition] = useState<string>("BTN");
  const [antePerPlayer, setAntePerPlayer] = useState(500);
  const [numPlayers, setNumPlayers] = useState(9);

  const [chart, setChart] = useState<TheoryChartResult | null>(null);
  const [chartLoading, setChartLoading] = useState(false);

  const [gameId, setGameId] = useState("tournament_push_fold");
  const [iterations, setIterations] = useState(10000);
  const [cfrLoading, setCfrLoading] = useState(false);
  const [cfrResult, setCfrResult] = useState<CfrResult | null>(null);

  const [hero, setHero] = useState("AsKh");
  const [board, setBoard] = useState("");
  const [potOdds, setPotOdds] = useState(0.33);
  const [valueLoading, setValueLoading] = useState(false);
  const [valueResult, setValueResult] = useState<ValueNetResult | null>(null);
  const [trainLoading, setTrainLoading] = useState(false);
  const [trainMsg, setTrainMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const deadMoney = antePerPlayer * numPlayers;

  const loadChart = useCallback(async () => {
    setChartLoading(true);
    setError(null);
    try {
      await waitForBackend();
      const res = await api.theoryChart({
        stack_bb: stackBb,
        position,
        ante_per_player: antePerPlayer,
        num_players: numPlayers,
        // Loading neural estimates for all 169 cells is prohibitively slow; the
        // selected-hand value tool below remains available on demand.
        include_nn: false,
      });
      setChart(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setChartLoading(false);
    }
  }, [stackBb, position, antePerPlayer, numPlayers]);

  useEffect(() => {
    void (async () => {
      try {
        await waitForBackend();
        const [g, d, overview] = await Promise.all([
          api.theoryGames(),
          api.theoryDepths(),
          api.theoryOverview().catch(() => null),
        ]);
        setGames(g.games);
        if (d.depths.length) setDepths(d.depths);
        const apiPositions = overview?.chart_positions?.filter(Boolean);
        if (apiPositions?.length) {
          setPositions(apiPositions);
          if (!apiPositions.includes(position)) {
            setPosition(apiPositions.includes("BTN") ? "BTN" : apiPositions[0]);
          }
        }
      } catch {
        // optional
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- boot once; position default only if API lacks it
  }, []);

  useEffect(() => {
    void loadChart();
  }, [loadChart]);

  const runCfr = async () => {
    setCfrLoading(true);
    setError(null);
    try {
      await waitForBackend();
      setCfrResult(
        await api.theoryCfr({
          game: gameId,
          iterations,
          ante_per_player: gameId === "tournament_push_fold" ? antePerPlayer : 0,
          num_players: gameId === "tournament_push_fold" ? numPlayers : 2,
          stack_bb: stackBb,
        }),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setCfrLoading(false);
    }
  };

  const runValue = async () => {
    setValueLoading(true);
    setError(null);
    try {
      await waitForBackend();
      const posIdx =
        Math.max(0, positions.indexOf(position)) / Math.max(1, positions.length - 1);
      setValueResult(
        await api.theoryValue({
          hero,
          board,
          pot_odds: potOdds,
          position: posIdx,
          ante_per_player: antePerPlayer,
          dead_money: deadMoney,
          stack_bb: stackBb,
        }),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setValueLoading(false);
    }
  };

  const trainNet = async () => {
    setTrainLoading(true);
    setTrainMsg(null);
    setError(null);
    try {
      await waitForBackend();
      const res = await api.theoryValueTrain({ n_samples: 200, epochs: 50 });
      setTrainMsg(
        `Trained (${res.backend}): val MAE ${res.val_mae?.toFixed(3) ?? "—"} — saved to ${res.path}`,
      );
      void loadChart();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setTrainLoading(false);
    }
  };

  const onHandSelect = (notation: string) => {
    if (notation.length === 2) {
      setHero(`${notation[0]}s${notation[1]}h`);
    } else if (notation.endsWith("s")) {
      setHero(`${notation[0]}s${notation[1]}s`);
    } else {
      setHero(`${notation[0]}s${notation[1]}h`);
    }
  };

  const selected = games.find((g) => g.id === gameId);

  return (
    <div className="theory-panel">
      <div className="theory-disclaimer panel-card">
        <h3>Unified theory engine</h3>
        <p>
          CFR+ calibrates push/fold at each stack depth; charts map those frequencies to a 13×13 grid.
          The neural value net estimates equity/EV with stack + ante features. Educational tooling —
          not a full NLHE solver.
        </p>
      </div>

      {error && <div className="error-banner">{error}</div>}

      <div className="theory-subtabs">
        <button
          type="button"
          className={`depth-tab${theoryTab === "cfr" ? " active" : ""}`}
          onClick={() => setTheoryTab("cfr")}
        >
          CFR+ charts
        </button>
        <button
          type="button"
          className={`depth-tab${theoryTab === "tough" ? " active" : ""}`}
          onClick={() => setTheoryTab("tough")}
        >
          Strategy Charts
        </button>
        <button
          type="button"
          className={`depth-tab${theoryTab === "trainer" ? " active" : ""}`}
          onClick={() => setTheoryTab("trainer")}
        >
          Range Trainer
        </button>
        {theoryTab === "editor" && (
          <button type="button" className="depth-tab active" disabled>
            Range Editor
          </button>
        )}
      </div>

      {theoryTab === "editor" ? (
        <RangeEditor
          chartId={editChartId}
          rangeName={editChartTitle}
          initialActions={editChartActions}
          onClose={() => setTheoryTab("tough")}
          onSaveSuccess={() => setRefreshToggle((prev) => !prev)}
        />
      ) : theoryTab === "trainer" ? (
        <RangeTrainer />
      ) : theoryTab === "tough" ? (
        <ToughChartsPanel
          refreshToggle={refreshToggle}
          onOpenCfr={(nextStackBb, nextPosition) => {
            setTheoryTab("cfr");
            setStackBb(nextStackBb);
            setPosition(nextPosition);
          }}
          onEditRange={(chartId, title, actions) => {
            setEditChartId(chartId);
            setEditChartTitle(title);
            setEditChartActions(actions);
            setTheoryTab("editor");
          }}
        />
      ) : (
        <>
      <section className="panel-card theory-config">
        <h3>MTT config</h3>
        <div className="theory-config-row">
          <label>
            Ante / player
            <input
              type="number"
              min={0}
              step={50}
              value={antePerPlayer}
              onChange={(e) => setAntePerPlayer(Number(e.target.value))}
            />
          </label>
          <label>
            Table size
            <input
              type="number"
              min={2}
              max={10}
              value={numPlayers}
              onChange={(e) => setNumPlayers(Number(e.target.value))}
            />
          </label>
          <div className="theory-meta">
            Dead money: <strong>{deadMoney}</strong> chips · pot base ≈{" "}
            <strong>{chart?.pot_base_bb?.toFixed(1) ?? "—"}</strong> bb
          </div>
        </div>
      </section>

      <section className="panel-card theory-charts">
        <div className="theory-chart-header">
          <div>
            <h3>Range Studio</h3>
            <p className="muted small">Predefined CFR+ charts with manual range construction and custom themes.</p>
          </div>
          <div className="depth-tabs">
            {depths.map((d) => (
              <button
                key={d}
                type="button"
                className={`depth-tab${stackBb === d ? " active" : ""}`}
                onClick={() => setStackBb(d)}
              >
                {d}BB
              </button>
            ))}
          </div>
        </div>
        <RangeStudio
          chart={chart}
          loading={chartLoading}
          depths={depths}
          stackBb={stackBb}
          position={position}
          positions={positions}
          onStackChange={setStackBb}
          onPositionChange={setPosition}
          onHandSelect={onHandSelect}
        />
        {chart?.note ? <p className="muted small">{chart.note}</p> : null}
      </section>

      <div className="theory-grid">
        <section className="panel-card theory-cfr">
          <h3>CFR+ solver</h3>
          <p className="muted">{selected?.description ?? "Tournament push/fold with antes"}</p>
          <label>
            Subgame
            <select value={gameId} onChange={(e) => setGameId(e.target.value)}>
              {games.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
              {!games.length && <option value="tournament_push_fold">MTT Push/Fold</option>}
            </select>
          </label>
          <label>
            Iterations
            <input
              type="number"
              min={100}
              max={500000}
              value={iterations}
              onChange={(e) => setIterations(Number(e.target.value))}
            />
          </label>
          <p className="muted small">
            Uses chart depth <strong>{stackBb}BB</strong> and ante config above.
          </p>
          <button type="button" className="primary-btn" disabled={cfrLoading} onClick={() => void runCfr()}>
            {cfrLoading ? "Running CFR+…" : "Run CFR+"}
          </button>
          {cfrResult && (
            <div className="theory-results">
              <div className="stat-row">
                <span>Exploitability</span>
                <strong>{cfrResult.exploitability?.toFixed(4) ?? "—"}</strong>
              </div>
              <div className="stat-row">
                <span>EV (P0 / P1)</span>
                <strong>
                  {cfrResult.ev?.player_0?.toFixed(3)} / {cfrResult.ev?.player_1?.toFixed(3)}
                </strong>
              </div>
              {cfrResult.config && (
                <div className="stat-row">
                  <span>Pot base / dead</span>
                  <strong>
                    {cfrResult.config.pot_base_bb?.toFixed(1)}bb · {cfrResult.config.dead_money?.toFixed(0)} chips
                  </strong>
                </div>
              )}
              <h4>Strategy (avg)</h4>
              <div className="strategy-table-wrap">
                <table className="strategy-table">
                  <thead>
                    <tr>
                      <th>Info set</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(cfrResult.strategy ?? {}).map(([iset, acts]) => (
                      <tr key={iset}>
                        <td>{iset}</td>
                        <td>
                          {Object.entries(acts)
                            .map(([a, p]) => `${a} ${(p * 100).toFixed(1)}%`)
                            .join(" · ")}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </section>

        <section className="panel-card theory-value">
          <h3>Neural value @ depth</h3>
          <p className="muted">
            MLP trained on MC equity with stack_bb + ante features. Click a chart cell or enter cards.
          </p>
          <label>
            Hero
            <input value={hero} onChange={(e) => setHero(e.target.value)} placeholder="AsKh" />
          </label>
          <label>
            Board
            <input value={board} onChange={(e) => setBoard(e.target.value)} placeholder="optional" />
          </label>
          <label>
            Pot odds (0–1)
            <input
              type="number"
              min={0}
              max={1}
              step={0.01}
              value={potOdds}
              onChange={(e) => setPotOdds(Number(e.target.value))}
            />
          </label>
          <p className="muted small">
            Depth <strong>{stackBb}BB</strong> · {position} · ante {antePerPlayer}
          </p>
          <div className="btn-row">
            <button type="button" className="primary-btn" disabled={valueLoading} onClick={() => void runValue()}>
              {valueLoading ? "Predicting…" : "Predict value"}
            </button>
            <button type="button" className="ghost-btn" disabled={trainLoading} onClick={() => void trainNet()}>
              {trainLoading ? "Training…" : "Train model"}
            </button>
          </div>
          {valueResult && (
            <div className="theory-results">
              <div className="stat-row big">
                <span>Value @ {stackBb}BB</span>
                <strong className="equity-highlight">{valueResult.value_pct?.toFixed(1)}%</strong>
              </div>
              <p className="muted small">
                Source: {valueResult.source} — {valueResult.note}
              </p>
            </div>
          )}
          {trainMsg && <p className="success-text">{trainMsg}</p>}
        </section>
      </div>
        </>
      )}
    </div>
  );
}
