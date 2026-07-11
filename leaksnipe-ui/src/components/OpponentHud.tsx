import { useEffect, useMemo, useState } from "react";
import { api, type PlayerHudStats } from "../lib/api";
import { formatStat, statTone, typeClass } from "../lib/hudStats";

type OpponentHudPanelProps = {
  names: string[];
  compact?: boolean;
  title?: string;
};

function PlayerHudBadge({
  stats,
  compact,
}: {
  stats: PlayerHudStats;
  compact?: boolean;
}) {
  const playerType = stats.effective_type || stats.auto_type || "Unknown";
  const [hovered, setHovered] = useState(false);
  const [pinned, setPinned] = useState(false);
  const showTooltip = hovered || pinned;
  const positions = useMemo(() => {
    const rows = Object.entries(stats.by_position ?? {})
      .filter(([, d]) => (d.hands ?? 0) > 0)
      .sort((a, b) => (b[1].hands ?? 0) - (a[1].hands ?? 0));
    return rows.slice(0, compact ? 4 : 9);
  }, [stats.by_position, compact]);

  return (
    <div
      className={`hud-badge ${compact ? "compact" : ""}`}
      role="button"
      tabIndex={0}
      aria-expanded={showTooltip}
      aria-label={`${stats.name} opponent statistics`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={() => setPinned((current) => !current)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          setPinned((current) => !current);
        }
      }}
    >
      <div className="hud-badge-name" title={stats.name}>
        {stats.name}
      </div>
      <div className="hud-badge-card">
        <div className="hud-badge-header">
          <span className={`hud-type-pill ${typeClass(playerType)}`}>{playerType}</span>
          <span className="hud-hands-count">H:{stats.hands || "–"}</span>
        </div>
        <div className="hud-stat-grid">
          <div className="hud-stat">
            <span className="hud-stat-label">VPIP</span>
            <span className={`hud-stat-value tone-${statTone("vpip", stats.vpip)}`}>
              {formatStat(stats.vpip, "%")}
            </span>
          </div>
          <div className="hud-stat">
            <span className="hud-stat-label">PFR</span>
            <span className={`hud-stat-value tone-${statTone("pfr", stats.pfr)}`}>
              {formatStat(stats.pfr, "%")}
            </span>
          </div>
          <div className="hud-stat">
            <span className="hud-stat-label">AF</span>
            <span className={`hud-stat-value tone-${statTone("af", stats.af)}`}>
              {formatStat(stats.af)}
            </span>
          </div>
          {!compact ? (
            <div className="hud-stat">
              <span className="hud-stat-label">WTSD</span>
              <span className={`hud-stat-value tone-${statTone("wtsd", stats.wtsd)}`}>
                {formatStat(stats.wtsd, "%")}
              </span>
            </div>
          ) : null}
        </div>
        {!compact ? (
          <div className="hud-stat-grid secondary">
            <div className="hud-stat">
              <span className="hud-stat-label">FCBet</span>
              <span className={`hud-stat-value tone-${statTone("fold_cbet", stats.fold_cbet)}`}>
                {formatStat(stats.fold_cbet, "%")}
              </span>
            </div>
          </div>
        ) : null}
      </div>

      {showTooltip && positions.length > 0 ? (
        <div className="hud-tooltip" role="tooltip">
          <div className="hud-tooltip-title">Position stats</div>
          <table>
            <thead>
              <tr>
                <th>Pos</th>
                <th>H</th>
                <th>VPIP</th>
                <th>PFR</th>
              </tr>
            </thead>
            <tbody>
              {positions.map(([pos, d]) => (
                <tr key={pos}>
                  <td>{pos}</td>
                  <td>{d.hands}</td>
                  <td>{d.vpip}%</td>
                  <td>{d.pfr}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}

export function OpponentHudPanel({ names, compact, title = "Opponent HUD" }: OpponentHudPanelProps) {
  const [statsMap, setStatsMap] = useState<Record<string, PlayerHudStats>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const uniqueNames = useMemo(
    () => [...new Set(names.map((n) => n.trim()).filter(Boolean))],
    [names],
  );
  const uniqueNamesKey = uniqueNames.join("\u0000");

  useEffect(() => {
    const requestedNames = uniqueNamesKey ? uniqueNamesKey.split("\u0000") : [];
    if (requestedNames.length === 0) {
      setStatsMap({});
      return;
    }
    let cancelled = false;
    const loadStats = (showSpinner: boolean) => {
      if (showSpinner) setLoading(true);
      setError(null);
      void api
        .playerStatsBatch(requestedNames)
        .then((res) => {
          if (!cancelled) setStatsMap(res.players);
        })
        .catch((err) => {
          if (!cancelled) {
            setError(err instanceof Error ? err.message : "Failed to load HUD stats");
          }
        })
        .finally(() => {
          if (!cancelled && showSpinner) setLoading(false);
        });
    };
    loadStats(true);
    const refreshOnFocus = () => loadStats(false);
    const refreshTimer = window.setInterval(() => loadStats(false), 30_000);
    window.addEventListener("focus", refreshOnFocus);
    return () => {
      cancelled = true;
      window.clearInterval(refreshTimer);
      window.removeEventListener("focus", refreshOnFocus);
    };
  }, [uniqueNamesKey]);

  if (uniqueNames.length === 0) return null;

  return (
    <section className="opponent-hud-panel">
      <div className="opponent-hud-header">
        <h3 className="section-title">{title}</h3>
        {loading ? <span className="muted small">Loading stats…</span> : null}
      </div>
      {error ? <div className="error-banner small">{error}</div> : null}
      <div className={`opponent-hud-grid ${compact ? "compact" : ""}`}>
        {uniqueNames.map((name) => {
          const stats = statsMap[name];
          if (!stats) {
            return (
              <div key={name} className="hud-badge skeleton">
                <div className="hud-badge-name">{name}</div>
                <div className="hud-badge-card muted small">No data yet</div>
              </div>
            );
          }
          return <PlayerHudBadge key={name} stats={stats} compact={compact} />;
        })}
      </div>
    </section>
  );
}
