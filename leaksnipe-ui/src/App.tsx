import { useCallback, useEffect, useRef, useState } from "react";
import {
  api,
  checkBackendHealth,
  getApiBase,
  getSidecarStatus,
  handSummaryToDetailPreview,
  HEALTH_POLL_INTERVAL_MS,
  launchSidecarWindow,
  restartSidecar,
  waitForBackend,
  type Dashboard,
  type HandDetail,
  type HandSummary,
  type ImportStatus,
  type ScanDir,
  type Settings,
  type SidecarStatus,
  isDashboardStatsWarming,
  type TotalsStats,
} from "./lib/api";
import type { TabId } from "./types";
import { AiCoachPanel } from "./components/AiCoachPanel";
import { EquityCalculator } from "./components/EquityCalculator";
import { TheoryPanel } from "./components/TheoryPanel";
import { HandDetailPanel, HandReplayerModal } from "./components/HandDetail";
import { SettingsPanel } from "./components/SettingsPanel";
import { StatsPanel } from "./components/StatsPanel";
import { OrganizePanel } from "./components/OrganizePanel";
import { resolveHudBackend, syncLiveHud } from "./lib/hudManager";
import "./App.css";

const TABS: { id: TabId; label: string; hint: string }[] = [
  { id: "hands", label: "Hands", hint: "Click a hand for stats · Replay button opens the table replayer" },
  { id: "organize", label: "Organize", hint: "Group hands by date/tag, add custom tags, and review pot totals" },
  { id: "stats", label: "Stats", hint: "VPIP, PFR, position breakdown, leak alerts" },
  { id: "coach", label: "AI Coach", hint: "Session analysis & chat (OpenAI / Gemini free tier)" },
  { id: "equity", label: "Equity", hint: "Monte Carlo equity — NLHE, Omaha Hi/Lo, 7-Card Stud & Stud Hi/Lo" },
  { id: "theory", label: "Theory", hint: "CFR+ · stack charts · neural value (unified MTT theory)" },
  { id: "settings", label: "Settings", hint: "Hero names, watch folders, AI provider" },
];

function formatResult(hand: HandSummary): string {
  const value = hand.hero_won;
  const prefix = value > 0 ? "+" : value < 0 ? "-" : "";
  const abs = Math.abs(value);
  if (hand.is_tournament) return `${prefix}${abs.toLocaleString()} chips`;
  return `${prefix}$${abs.toFixed(2)}`;
}

function formatDate(iso: string | null) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function App() {
  const [activeTab, setActiveTab] = useState<TabId>("hands");
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [hands, setHands] = useState<HandSummary[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [folders, setFolders] = useState<ScanDir[]>([]);
  const [handsLoading, setHandsLoading] = useState(true);
  const [statsLoading, setStatsLoading] = useState(false);
  const [statsError, setStatsError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [importStatus, setImportStatus] = useState<ImportStatus | null>(null);
  const [totalHands, setTotalHands] = useState(0);
  const [selectedHandId, setSelectedHandId] = useState<string | null>(null);
  const [selectedHand, setSelectedHand] = useState<HandDetail | null>(null);
  const [replayerHand, setReplayerHand] = useState<HandDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [replayerLoadingId, setReplayerLoadingId] = useState<string | null>(null);
  const [hudError, setHudError] = useState<string | null>(null);
  const [sidecarOnline, setSidecarOnline] = useState<boolean | null>(null);
  const [sidecarStarting, setSidecarStarting] = useState(false);
  const [sidecarStatus, setSidecarStatus] = useState<SidecarStatus | null>(null);

  // Filter and Totals state
  const [siteFilter, setSiteFilter] = useState<string>("");
  const [tagFilter, setTagFilter] = useState<string>("");
  const [datePreset, setDatePreset] = useState<string>("all");
  const [startDate, setStartDate] = useState<string>("");
  const [endDate, setEndDate] = useState<string>("");
  const [totals, setTotals] = useState<TotalsStats>({
    total_hands: 0,
    total_collected: 0,
    total_lost: 0,
    net_profit_loss: 0,
    total_rake: 0,
  });
  const [allTags, setAllTags] = useState<string[]>([]);
  const [userFilter, setUserFilter] = useState<string>("");
  const [allHeroes, setAllHeroes] = useState<string[]>([]);

  const tableScrollRef = useRef<HTMLDivElement>(null);
  const handsCountRef = useRef(0);
  const handsAbortRef = useRef<AbortController | null>(null);
  const detailRequestRef = useRef(0);
  const statsPollRef = useRef<number | null>(null);
  const statsWarmStartedRef = useRef<number | null>(null);
  const STATS_WARM_TIMEOUT_MS = 60_000;

  const formatCurrency = (val: number) => {
    const abs = Math.abs(val);
    const prefix = val > 0 ? "+" : val < 0 ? "-" : "";
    return `${prefix}$${abs.toFixed(2)}`;
  };

  const getFilterDates = useCallback(() => {
    if (datePreset === "custom") {
      return {
        start: startDate ? new Date(startDate).toISOString() : undefined,
        end: endDate ? new Date(endDate).toISOString() : undefined,
      };
    }
    const now = new Date();
    let start: Date | null = null;
    let end: Date | null = null;

    if (datePreset === "today") {
      start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
    } else if (datePreset === "yesterday") {
      start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
      end = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 23, 59, 59, 999);
    } else if (datePreset === "7days") {
      start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7);
    } else if (datePreset === "30days") {
      start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 30);
    }

    return {
      start: start ? start.toISOString() : undefined,
      end: end ? end.toISOString() : undefined,
    };
  }, [datePreset, startDate, endDate]);

  const refreshHands = useCallback(async (silent = false) => {
    const controller = new AbortController();
    if (!silent) {
      handsAbortRef.current?.abort();
      handsAbortRef.current = controller;
      setHandsLoading(true);
      setError(null);
    }

    const scrollTop = silent ? (tableScrollRef.current?.scrollTop ?? 0) : 0;
    try {
      const signal = controller.signal;
      const dates = getFilterDates();
      const [searchResult, settingsResult, foldersResult, statusResult, tagsResult, heroesResult] =
        await Promise.allSettled([
          api.searchHands({
            site: siteFilter || undefined,
            tag: tagFilter || undefined,
            start_date: dates.start,
            end_date: dates.end,
            user: userFilter || undefined,
            limit: 250,
          }, signal),
          api.settings(signal),
          api.watchFolders(signal),
          api.importStatus(signal),
          api.allTags(),
          api.allHeroes(),
        ]);
      if (signal.aborted) return;
      if (searchResult.status === "rejected") {
        throw searchResult.reason;
      }
      const search = searchResult.value;
      setSidecarOnline(true);
      setHands(search.hands ?? []);
      setTotals(search.totals);
      handsCountRef.current = search.total ?? search.hands?.length ?? 0;
      setTotalHands(search.total ?? search.hands?.length ?? 0);

      if (tagsResult.status === "fulfilled" && tagsResult.value.ok) {
        setAllTags(tagsResult.value.tags);
      }
      if (heroesResult.status === "fulfilled" && heroesResult.value.ok) {
        setAllHeroes(heroesResult.value.heroes);
      }
      if (settingsResult.status === "fulfilled") setSettings(settingsResult.value);
      if (foldersResult.status === "fulfilled") setFolders(foldersResult.value);
      const status =
        statusResult.status === "fulfilled" ? statusResult.value : null;
      if (status) {
        setImportStatus(status);
        if (status.total_hands) setTotalHands(status.total_hands);
      }
      if (silent && tableScrollRef.current) {
        requestAnimationFrame(() => {
          if (tableScrollRef.current) tableScrollRef.current.scrollTop = scrollTop;
        });
      }
    } catch (err) {
      if (controller.signal.aborted) return;
      const message = err instanceof Error ? err.message : String(err);
      if (!silent || handsCountRef.current === 0) {
        setError(message);
      }
      if (handsCountRef.current === 0) {
        setSidecarOnline(false);
      }
    } finally {
      if (!silent && handsAbortRef.current === controller) {
        setHandsLoading(false);
        handsAbortRef.current = null;
      }
    }
  }, [siteFilter, tagFilter, userFilter, getFilterDates]);

  const refreshDashboard = useCallback(async (silent = false, wait = false) => {
    if (!silent) {
      setStatsLoading(true);
      setStatsError(null);
    }
    try {
      const dash = await api.dashboard(wait);
      setDashboard(dash);
      setTotalHands(dash.total_hands);
      if (dash.import_status) setImportStatus(dash.import_status);
      if (dash.stats_error) {
        setStatsError(dash.stats_error);
      } else if (!silent) {
        setStatsError(null);
      }
      if (isDashboardStatsWarming(dash)) {
        if (statsWarmStartedRef.current == null) {
          statsWarmStartedRef.current = Date.now();
        } else if (
          Date.now() - statsWarmStartedRef.current > STATS_WARM_TIMEOUT_MS
        ) {
          const msg =
            "Leak stats are taking longer than expected. The sidecar may be busy — try Retry or restart the sidecar from Settings.";
          setStatsError(msg);
          if (statsPollRef.current != null) {
            window.clearInterval(statsPollRef.current);
            statsPollRef.current = null;
          }
        }
      } else {
        statsWarmStartedRef.current = null;
        if (!silent) setStatsError(null);
      }
      return dash;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatsError(message);
      if (!silent) setError(message);
      return null;
    } finally {
      if (!silent) setStatsLoading(false);
    }
  }, []);

  const scheduleStatsWarmPoll = useCallback(() => {
    if (statsPollRef.current != null) return;
    statsPollRef.current = window.setInterval(() => {
      void refreshDashboard(true).then((dash) => {
        if (dash && !isDashboardStatsWarming(dash) && statsPollRef.current != null) {
          window.clearInterval(statsPollRef.current);
          statsPollRef.current = null;
        }
      });
    }, 4000);
  }, [refreshDashboard]);

  const refresh = useCallback(
    async (silent = false) => {
      await refreshHands(silent);
      if (activeTab === "stats") {
        const dash = await refreshDashboard(silent);
        if (dash && isDashboardStatsWarming(dash)) {
          scheduleStatsWarmPoll();
        }
      }
    },
    [activeTab, refreshHands, refreshDashboard, scheduleStatsWarmPoll],
  );

  useEffect(() => {
    void refreshHands();
    return () => {
      handsAbortRef.current?.abort();
      if (statsPollRef.current != null) {
        window.clearInterval(statsPollRef.current);
        statsPollRef.current = null;
      }
    };
  }, [refreshHands]);

  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      const status = await getSidecarStatus();
      if (!cancelled && status?.healthy) {
        setSidecarOnline(true);
        if (status) setSidecarStatus(status);
        return;
      }
      const ok = await checkBackendHealth({ includeSidecarStatus: false });
      if (cancelled) return;
      if (ok) {
        setSidecarOnline(true);
        return;
      }
      if (!cancelled) {
        setSidecarOnline(status?.healthy ?? false);
        if (status) setSidecarStatus(status);
      }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), HEALTH_POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [sidecarStarting]);

  const startSidecar = async () => {
    setSidecarStarting(true);
    setError(null);
    try {
      try {
        await launchSidecarWindow();
      } catch {
        await restartSidecar();
      }
      await waitForBackend(40, 250);
      setSidecarOnline(true);
      await refresh(true);
    } catch (err) {
      setSidecarOnline(false);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSidecarStarting(false);
    }
  };

  useEffect(() => {
    if (activeTab !== "stats") return;
    if (dashboard && !isDashboardStatsWarming(dashboard)) return;
    void refreshDashboard(false).then((dash) => {
      if (dash && isDashboardStatsWarming(dash)) {
        scheduleStatsWarmPoll();
      }
    });
  }, [activeTab, dashboard, refreshDashboard, scheduleStatsWarmPoll]);

  useEffect(() => {
    if (!settings?.auto_refresh) return;
    const interval = (settings.refresh_interval ?? 5) * 1000;
    const timer = window.setInterval(() => void refreshHands(true), interval);
    return () => window.clearInterval(timer);
  }, [settings?.auto_refresh, settings?.refresh_interval, refreshHands]);

  useEffect(() => {
    if (!settings) return;
    const backend = resolveHudBackend(settings);
    void syncLiveHud(!!settings.live_hud_enabled, backend)
      .then(() => setHudError(null))
      .catch((err) => {
        setHudError(err instanceof Error ? err.message : String(err));
      });
  }, [settings?.live_hud_enabled, settings?.live_hud_backend]);

  useEffect(() => {
    let cancelled = false;
    let source: EventSource | null = null;

    void (async () => {
      try {
        for (let i = 0; i < 40 && !cancelled; i++) {
          if (await checkBackendHealth({ includeSidecarStatus: false })) break;
          await new Promise((r) => setTimeout(r, 250));
        }
        if (cancelled) return;
        const base = await getApiBase();
        source = new EventSource(`${base}/api/events`);
        source.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data) as { type?: string; count?: number };
            if (data.type === "new_hands" && (data.count ?? 0) > 0) {
              void refreshHands(true);
              if (activeTab === "stats") void refreshDashboard(true);
            }
          } catch {
            // ignore malformed SSE payloads
          }
        };
      } catch {
        // SSE is optional when sidecar is unavailable
      }
    })();

    return () => {
      cancelled = true;
      source?.close();
    };
  }, [activeTab, refreshHands, refreshDashboard]);

  const fetchHand = async (handId: string): Promise<HandDetail> => {
    const res = await api.hand(handId);
    return res.hand;
  };

  const openHand = async (handId: string) => {
    if (selectedHandId === handId && selectedHand && !detailLoading && !detailError) return;

    const preview = hands.find((h) => h.hand_id === handId);
    const reqId = ++detailRequestRef.current;

    setSelectedHandId(handId);
    setDetailError(null);
    setDetailLoading(true);
    setSelectedHand(preview ? handSummaryToDetailPreview(preview) : null);

    try {
      const hand = await fetchHand(handId);
      if (detailRequestRef.current !== reqId) return;
      setSelectedHand(hand);
      setDetailError(null);
    } catch (err) {
      if (detailRequestRef.current !== reqId) return;
      setDetailError(err instanceof Error ? err.message : "Failed to load hand");
    } finally {
      if (detailRequestRef.current === reqId) {
        setDetailLoading(false);
      }
    }
  };

  const openReplayer = async (handId: string) => {
    setReplayerLoadingId(handId);
    try {
      const hand = await fetchHand(handId);
      setReplayerHand(hand);
      setSelectedHandId(handId);
      setSelectedHand(hand);
      setDetailError(null);
      setDetailLoading(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load hand for replayer");
    } finally {
      setReplayerLoadingId(null);
    }
  };

  const closeDetail = () => {
    detailRequestRef.current += 1;
    setSelectedHandId(null);
    setSelectedHand(null);
    setDetailError(null);
    setDetailLoading(false);
  };

  const positionStats =
    selectedHand?.hero_position && dashboard?.by_position
      ? dashboard.by_position[selectedHand.hero_position] ?? null
      : null;

  const active = TABS.find((tab) => tab.id === activeTab)!;

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="brand">
          <span className="brand-kicker">LeakSnipe</span>
          <span className="brand-title">Poker Therapist</span>
        </div>
        <div className="header-actions">
          <button type="button" className="ghost-btn small" onClick={() => void refresh()}>
            Refresh
          </button>
          <div className="status-pill" title={importStatus?.watch_folders?.map((f) => f.path).join("\n")}>
            <span
              className={`status-dot ${sidecarOnline === false ? "offline" : importStatus?.watcher_running ? "" : "offline"}`}
            />
            {handsLoading || sidecarStarting
              ? "Connecting…"
              : sidecarOnline === false
                ? "Sidecar offline"
                : importStatus?.watcher_running
                  ? `Watching ${importStatus.existing_folder_count} folder(s)`
                  : `${totalHands.toLocaleString()} hands`}
          </div>
        </div>
      </header>

      <div className="app-body">
        <nav className="sidebar">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              className={`tab-button ${activeTab === tab.id ? "active" : ""}`}
              onClick={() => setActiveTab(tab.id)}
              type="button"
            >
              {tab.label}
            </button>
          ))}
        </nav>

        <main className="content">
          <h1 className="panel-title">{active.label}</h1>
          <p className="panel-subtitle">{active.hint}</p>

          {(activeTab === "hands" || activeTab === "organize") && (
            <div className="card" style={{ padding: "1rem", borderRadius: "8px", border: "1px solid rgba(255, 255, 255, 0.08)", marginBottom: "1rem" }}>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "1rem", alignItems: "flex-end" }}>
                {/* User Tab Selector */}
                <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
                  <label style={{ fontSize: "0.75rem", color: "#9ca3af", fontWeight: "600" }}>HERO / USER</label>
                  <div style={{ display: "flex", background: "#111827", padding: "2px", borderRadius: "8px", border: "1px solid #374151" }}>
                    <button
                      type="button"
                      onClick={() => setUserFilter("")}
                      style={{
                        padding: "0.35rem 0.75rem",
                        borderRadius: "6px",
                        border: "none",
                        fontSize: "0.8rem",
                        fontWeight: "600",
                        cursor: "pointer",
                        background: userFilter === "" ? "#3b82f6" : "transparent",
                        color: userFilter === "" ? "#ffffff" : "#9ca3af",
                        transition: "all 0.15s ease",
                      }}
                    >
                      All Users
                    </button>
                    {allHeroes.map(h => (
                      <button
                        key={h}
                        type="button"
                        onClick={() => setUserFilter(h)}
                        style={{
                          padding: "0.35rem 0.75rem",
                          borderRadius: "6px",
                          border: "none",
                          fontSize: "0.8rem",
                          fontWeight: "600",
                          cursor: "pointer",
                          background: userFilter === h ? "#3b82f6" : "transparent",
                          color: userFilter === h ? "#ffffff" : "#9ca3af",
                          transition: "all 0.15s ease",
                          textTransform: "capitalize"
                        }}
                      >
                        {h}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Site Selection */}
                <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
                  <label style={{ fontSize: "0.75rem", color: "#9ca3af", fontWeight: "600" }}>SITE</label>
                  <select
                    value={siteFilter}
                    onChange={e => setSiteFilter(e.target.value)}
                    style={{ padding: "0.4rem 0.6rem", borderRadius: "6px", background: "#1f2937", color: "#e5e7eb", border: "1px solid #374151", fontSize: "0.85rem" }}
                  >
                    <option value="">All Sites</option>
                    <option value="BetACR">Americas Cardroom (ACR)</option>
                    <option value="CoinPoker">CoinPoker</option>
                  </select>
                </div>

                {/* Tag Selection */}
                <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
                  <label style={{ fontSize: "0.75rem", color: "#9ca3af", fontWeight: "600" }}>TAG</label>
                  <select
                    value={tagFilter}
                    onChange={e => setTagFilter(e.target.value)}
                    style={{ padding: "0.4rem 0.6rem", borderRadius: "6px", background: "#1f2937", color: "#e5e7eb", border: "1px solid #374151", fontSize: "0.85rem" }}
                  >
                    <option value="">All Tags</option>
                    {allTags.map(t => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                  </select>
                </div>

                {/* Date presets */}
                <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
                  <label style={{ fontSize: "0.75rem", color: "#9ca3af", fontWeight: "600" }}>DATE RANGE</label>
                  <select
                    value={datePreset}
                    onChange={e => setDatePreset(e.target.value)}
                    style={{ padding: "0.4rem 0.6rem", borderRadius: "6px", background: "#1f2937", color: "#e5e7eb", border: "1px solid #374151", fontSize: "0.85rem" }}
                  >
                    <option value="all">All Time</option>
                    <option value="today">Today</option>
                    <option value="yesterday">Yesterday</option>
                    <option value="7days">Last 7 Days</option>
                    <option value="30days">Last 30 Days</option>
                    <option value="custom">Custom Date</option>
                  </select>
                </div>

                {/* Custom Date Pickers */}
                {datePreset === "custom" && (
                  <>
                    <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
                      <label style={{ fontSize: "0.75rem", color: "#9ca3af", fontWeight: "600" }}>START</label>
                      <input
                        type="date"
                        value={startDate}
                        onChange={e => setStartDate(e.target.value)}
                        style={{ padding: "0.35rem 0.5rem", borderRadius: "6px", background: "#1f2937", color: "#e5e7eb", border: "1px solid #374151", fontSize: "0.85rem" }}
                      />
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
                      <label style={{ fontSize: "0.75rem", color: "#9ca3af", fontWeight: "600" }}>END</label>
                      <input
                        type="date"
                        value={endDate}
                        onChange={e => setEndDate(e.target.value)}
                        style={{ padding: "0.35rem 0.5rem", borderRadius: "6px", background: "#1f2937", color: "#e5e7eb", border: "1px solid #374151", fontSize: "0.85rem" }}
                      />
                    </div>
                  </>
                )}

                <button
                  type="button"
                  onClick={() => void refreshHands()}
                  className="ghost-btn small"
                  style={{ height: "34px", padding: "0 0.75rem", borderRadius: "6px" }}
                >
                  🔄 Reset/Refresh
                </button>

                <div style={{ marginLeft: "auto", fontSize: "0.8rem", color: "#9ca3af", alignSelf: "center" }}>
                  📁 {dashboard?.db_path?.split(/[/\\]/).pop() ?? "—"}
                </div>
              </div>
            </div>
          )}

          {sidecarOnline === false ? (
            <div className="sidecar-offline-banner" role="alert">
              <div>
                <strong>Python sidecar not running</strong> — port 8765 is offline; your hand
                database is safe.{" "}
                {sidecarStatus?.deps_installed === false ? (
                  <>
                    Run <code className="mono">Install-Sidecar.bat</code> once from the repo folder,
                    then <code className="mono">Start-Sidecar.bat</code> or click Start Sidecar.
                  </>
                ) : (
                  <>
                    Run <code className="mono">Start-Sidecar.bat</code> or click Start Sidecar below.
                  </>
                )}{" "}
                Log: <code className="mono">%TEMP%\leaksnipe_sidecar.log</code>
                {sidecarStatus?.last_error ? (
                  <>
                    {" "}
                    — <span className="mono">{sidecarStatus.last_error}</span>
                  </>
                ) : null}
              </div>
              <button
                type="button"
                className="primary-btn"
                disabled={sidecarStarting}
                onClick={() => void startSidecar()}
              >
                {sidecarStarting ? "Starting…" : "Start Sidecar"}
              </button>
            </div>
          ) : null}

          {error ? <div className="error-banner">{error}</div> : null}
          {hudError ? (
            <div className="error-banner" role="alert">
              Live HUD: {hudError}
            </div>
          ) : null}
          {settings?.live_hud_enabled && !hudError ? (
            resolveHudBackend(settings) === "tauri" ? (
              <div className="success-banner">Tauri Live HUD overlay is active (experimental)</div>
            ) : (
              <div className="success-banner">
                Live HUD enabled — open Settings and click Launch Python Live HUD
              </div>
            )
          ) : null}

          {activeTab === "hands" ? (
            <div className={`hands-layout ${selectedHandId ? "with-drawer" : ""}`}>
              <div className="hands-main">
                <div className="card-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "1rem" }}>
                  <div className="stat-card">
                    <div className="stat-label">Total Hands</div>
                    <div className="stat-value">{totals.total_hands.toLocaleString()}</div>
                  </div>
                  <div className="stat-card">
                    <div className="stat-label" style={{ color: "#10b981" }}>Collected (Won)</div>
                    <div className="stat-value" style={{ color: "#10b981" }}>
                      {formatCurrency(totals.total_collected)}
                    </div>
                  </div>
                  <div className="stat-card">
                    <div className="stat-label" style={{ color: "#ef4444" }}>Lost (Given/Taken)</div>
                    <div className="stat-value" style={{ color: "#ef4444" }}>
                      {formatCurrency(totals.total_lost)}
                    </div>
                  </div>
                  <div className="stat-card">
                    <div className="stat-label">Net Profit/Loss</div>
                    <div className="stat-value" style={{ color: totals.net_profit_loss >= 0 ? "#10b981" : "#ef4444" }}>
                      {formatCurrency(totals.net_profit_loss)}
                    </div>
                  </div>
                </div>
                <div className="table-wrap table-scroll" ref={tableScrollRef}>
                  <table>
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Site</th>
                        <th>Cards</th>
                        <th>Board</th>
                        <th>Pos</th>
                        <th>Result</th>
                        <th className="col-replay" aria-label="Replay" />
                      </tr>
                    </thead>
                    <tbody>
                      {handsLoading && hands.length === 0 ? (
                        <tr>
                          <td colSpan={7} className="table-loading-hint">
                            Loading hands…
                          </td>
                        </tr>
                      ) : null}
                      {!handsLoading && hands.length === 0 ? (
                        <tr>
                          <td colSpan={7} className="table-loading-hint">
                            {sidecarOnline === false
                              ? "Sidecar offline — start it with the banner above, then click Refresh."
                              : "No hands yet — add watch folders in Settings and run Scan Now."}
                          </td>
                        </tr>
                      ) : null}
                      {hands.map((hand) => (
                        <tr
                          key={hand.hand_id}
                          className={selectedHandId === hand.hand_id ? "selected" : ""}
                          onClick={() => void openHand(hand.hand_id)}
                        >
                          <td>{formatDate(hand.date)}</td>
                          <td>{hand.site}</td>
                          <td className="mono">{hand.hero_cards || "—"}</td>
                          <td className="mono board-cards-cell">
                            {hand.board_cards && hand.board_cards.length > 0 ? (
                              <div className="mini-board-cards">
                                {hand.board_cards.map((card, idx) => {
                                  const rank = card.slice(0, -1);
                                  const suit = card.slice(-1).toLowerCase();
                                  const suitSym = suit === "s" ? "♠" : suit === "h" ? "♥" : suit === "d" ? "♦" : suit === "c" ? "♣" : "?";
                                  const color = (suit === "h" || suit === "d") ? "#f43f5e" : "#cbd5e1";
                                  return (
                                    <span key={idx} className="mini-card" style={{ color }}>
                                      {rank}{suitSym}
                                    </span>
                                  );
                                })}
                              </div>
                            ) : (
                              <span className="muted">—</span>
                            )}
                          </td>
                          <td>{hand.hero_position || "—"}</td>
                          <td
                            className={
                              hand.hero_won > 0
                                ? "positive"
                                : hand.hero_won < 0
                                  ? "negative"
                                  : undefined
                            }
                          >
                            {formatResult(hand)}
                          </td>
                          <td className="col-replay">
                            <button
                              type="button"
                              className="replay-row-btn"
                              title="Replay hand"
                              aria-label={`Replay hand ${hand.hand_id}`}
                              disabled={replayerLoadingId === hand.hand_id}
                              onClick={(e) => {
                                e.stopPropagation();
                                void openReplayer(hand.hand_id);
                              }}
                            >
                              {replayerLoadingId === hand.hand_id ? "…" : "▶"}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <aside
                className={`detail-drawer ${selectedHandId ? "open" : ""}`}
                aria-hidden={!selectedHandId}
              >
                {selectedHandId ? (
                  <HandDetailPanel
                    hand={selectedHand}
                    loading={detailLoading}
                    error={detailError}
                    onRetry={
                      selectedHandId
                        ? () => {
                            if (selectedHandId) void openHand(selectedHandId);
                          }
                        : undefined
                    }
                    onClose={closeDetail}
                    onOpenReplayer={() => {
                      if (selectedHand) setReplayerHand(selectedHand);
                    }}
                    positionStats={positionStats}
                    sessionVpip={dashboard?.vpip}
                    sessionPfr={dashboard?.pfr}
                  />
                ) : null}
              </aside>
            </div>
          ) : null}

          {activeTab === "organize" ? (
            <div className={`hands-layout ${selectedHandId ? "with-drawer" : ""}`}>
              <div className="hands-main" style={{ flex: 1, overflowY: "auto" }}>
                <OrganizePanel
                  hands={hands}
                  onSelectHandId={openHand}
                  selectedHandId={selectedHandId}
                />
              </div>
              <aside
                className={`detail-drawer ${selectedHandId ? "open" : ""}`}
                aria-hidden={!selectedHandId}
              >
                {selectedHandId ? (
                  <HandDetailPanel
                    hand={selectedHand}
                    loading={detailLoading}
                    error={detailError}
                    onRetry={
                      selectedHandId
                        ? () => {
                            if (selectedHandId) void openHand(selectedHandId);
                          }
                        : undefined
                    }
                    onClose={closeDetail}
                    onOpenReplayer={() => {
                      if (selectedHand) setReplayerHand(selectedHand);
                    }}
                    positionStats={positionStats}
                    sessionVpip={dashboard?.vpip}
                    sessionPfr={dashboard?.pfr}
                  />
                ) : null}
              </aside>
            </div>
          ) : null}

          {activeTab === "stats" ? (
            <StatsPanel
              dashboard={dashboard}
              loading={statsLoading}
              warming={Boolean(dashboard && isDashboardStatsWarming(dashboard) && !statsError)}
              error={statsError}
              onRetry={() => {
                statsWarmStartedRef.current = null;
                setStatsError(null);
                void refreshDashboard(false).then((dash) => {
                  if (dash && isDashboardStatsWarming(dash)) scheduleStatsWarmPoll();
                });
              }}
            />
          ) : null}

          {activeTab === "coach" ? (
            <AiCoachPanel
              dashboard={dashboard}
              recentHandIds={hands.map((h) => h.hand_id)}
              sidecarOnline={sidecarOnline}
              handsLoading={handsLoading}
              totalHands={totalHands}
            />
          ) : null}

          {activeTab === "equity" ? <EquityCalculator /> : null}

          {activeTab === "theory" ? <TheoryPanel /> : null}

          {activeTab === "settings" ? (
            <SettingsPanel
              settings={settings}
              folders={folders}
              onSaved={(s) => {
                setSettings(s);
                void syncLiveHud(!!s.live_hud_enabled, resolveHudBackend(s))
                  .then(() => setHudError(null))
                  .catch((err) => {
                    setHudError(err instanceof Error ? err.message : String(err));
                  });
                void refresh(true);
              }}
            />
          ) : null}
        </main>
      </div>

      {replayerHand ? (
        <HandReplayerModal hand={replayerHand} onClose={() => setReplayerHand(null)} />
      ) : null}
    </div>
  );
}

export default App;
