import { useState, useEffect, useCallback } from "react";
import { api, type HandSummary, type TotalsStats } from "../lib/api";

type OrganizePanelProps = {
  onSelectHandId: (id: string) => void;
  selectedHandId: string | null;
};

type DatePreset = "all" | "today" | "yesterday" | "7days" | "30days" | "custom";

export function OrganizePanel({ onSelectHandId, selectedHandId }: OrganizePanelProps) {
  const [site, setSite] = useState<string>("");
  const [tag, setTag] = useState<string>("");
  const [datePreset, setDatePreset] = useState<DatePreset>("all");
  const [startDate, setStartDate] = useState<string>("");
  const [endDate, setEndDate] = useState<string>("");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [allTags, setAllTags] = useState<string[]>([]);
  const [totals, setTotals] = useState<TotalsStats>({
    total_hands: 0,
    total_collected: 0,
    total_lost: 0,
    net_profit_loss: 0,
    total_rake: 0,
  });
  const [hands, setHands] = useState<HandSummary[]>([]);
  
  // Tag editor state
  const [editingHandId, setEditingHandId] = useState<string | null>(null);
  const [newTagInput, setNewTagInput] = useState("");

  const fetchTags = async () => {
    try {
      const res = await api.allTags();
      if (res.ok) {
        setAllTags(res.tags);
      }
    } catch (err) {
      console.error("Failed to load tags", err);
    }
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

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const dates = getFilterDates();
      const res = await api.searchHands({
        site: site || undefined,
        tag: tag || undefined,
        start_date: dates.start,
        end_date: dates.end,
        limit: 250, // Load a good amount of hands for organization
      });
      if (res.ok) {
        setHands(res.hands || []);
        setTotals(res.totals);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [site, tag, getFilterDates]);

  useEffect(() => {
    void fetchTags();
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const handleAddTag = async (handId: string, tagText: string) => {
    if (!tagText.trim()) return;
    try {
      const res = await api.addTag(handId, tagText.trim());
      if (res.ok) {
        // Update local hands list
        setHands(prev =>
          prev.map(h => (h.hand_id === handId ? { ...h, tags: res.tags } : h))
        );
        setNewTagInput("");
        setEditingHandId(null);
        void fetchTags();
      }
    } catch (err) {
      alert("Failed to add tag: " + (err instanceof Error ? err.message : String(err)));
    }
  };

  const handleRemoveTag = async (handId: string, tagText: string) => {
    try {
      const res = await api.removeTag(handId, tagText);
      if (res.ok) {
        // Update local hands list
        setHands(prev =>
          prev.map(h => (h.hand_id === handId ? { ...h, tags: res.tags } : h))
        );
        void fetchTags();
      }
    } catch (err) {
      alert("Failed to remove tag: " + (err instanceof Error ? err.message : String(err)));
    }
  };

  // Group hands by Day
  const groupHandsByDay = () => {
    const groups: Record<string, HandSummary[]> = {};
    for (const h of hands) {
      if (!h.date) continue;
      const day = h.date.split("T")[0]; // YYYY-MM-DD
      if (!groups[day]) groups[day] = [];
      groups[day].push(h);
    }
    return groups;
  };

  const dayGroups = groupHandsByDay();
  const sortedDays = Object.keys(dayGroups).sort((a, b) => b.localeCompare(a));

  const formatCurrency = (val: number, isTournament = false) => {
    const abs = Math.abs(val);
    const prefix = val > 0 ? "+" : val < 0 ? "-" : "";
    if (isTournament) return `${prefix}${abs.toLocaleString()} chips`;
    return `${prefix}$${abs.toFixed(2)}`;
  };

  const getDayTotals = (dayHands: HandSummary[]) => {
    let collected = 0;
    let lost = 0;
    for (const h of dayHands) {
      if (h.hero_won > 0) collected += h.hero_won;
      else lost += h.hero_won;
    }
    const net = collected + lost;
    return { collected, lost, net };
  };

  return (
    <div className="organize-panel" style={{ padding: "1.5rem", display: "flex", flexDirection: "column", gap: "1.5rem" }}>
      {/* Header and Controls */}
      <div className="card" style={{ padding: "1.25rem", borderRadius: "12px", border: "1px solid rgba(255, 255, 255, 0.08)" }}>
        <h2 style={{ margin: "0 0 1rem 0", fontSize: "1.3rem", fontWeight: "600", color: "#f3f4f6" }}>Filter & Organize</h2>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "1rem" }}>
          {/* Site Selection */}
          <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
            <label style={{ fontSize: "0.8rem", color: "#9ca3af", fontWeight: "500" }}>Site</label>
            <select
              value={site}
              onChange={e => setSite(e.target.value)}
              style={{ padding: "0.5rem", borderRadius: "6px", background: "#1f2937", color: "#e5e7eb", border: "1px solid #374151" }}
            >
              <option value="">All Sites</option>
              <option value="BetACR">Americas Cardroom (ACR)</option>
              <option value="CoinPoker">CoinPoker</option>
            </select>
          </div>

          {/* Tag Selection */}
          <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
            <label style={{ fontSize: "0.8rem", color: "#9ca3af", fontWeight: "500" }}>Filter Tag</label>
            <select
              value={tag}
              onChange={e => setTag(e.target.value)}
              style={{ padding: "0.5rem", borderRadius: "6px", background: "#1f2937", color: "#e5e7eb", border: "1px solid #374151" }}
            >
              <option value="">All Tags</option>
              {allTags.map(t => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>

          {/* Date range presets */}
          <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
            <label style={{ fontSize: "0.8rem", color: "#9ca3af", fontWeight: "500" }}>Date Range</label>
            <select
              value={datePreset}
              onChange={e => setDatePreset(e.target.value as DatePreset)}
              style={{ padding: "0.5rem", borderRadius: "6px", background: "#1f2937", color: "#e5e7eb", border: "1px solid #374151" }}
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
                <label style={{ fontSize: "0.8rem", color: "#9ca3af", fontWeight: "500" }}>Start Date</label>
                <input
                  type="date"
                  value={startDate}
                  onChange={e => setStartDate(e.target.value)}
                  style={{ padding: "0.4rem", borderRadius: "6px", background: "#1f2937", color: "#e5e7eb", border: "1px solid #374151" }}
                />
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
                <label style={{ fontSize: "0.8rem", color: "#9ca3af", fontWeight: "500" }}>End Date</label>
                <input
                  type="date"
                  value={endDate}
                  onChange={e => setEndDate(e.target.value)}
                  style={{ padding: "0.4rem", borderRadius: "6px", background: "#1f2937", color: "#e5e7eb", border: "1px solid #374151" }}
                />
              </div>
            </>
          )}

          <div style={{ display: "flex", alignItems: "flex-end", marginLeft: "auto" }}>
            <button
              onClick={() => void loadData()}
              className="btn btn-primary"
              style={{ padding: "0.5rem 1rem", borderRadius: "6px", fontWeight: "600" }}
            >
              🔄 Refresh
            </button>
          </div>
        </div>
      </div>

      {/* Totals Stats Overview Cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "1rem" }}>
        {/* Total Hands */}
        <div className="card" style={{ padding: "1rem", borderRadius: "10px", border: "1px solid rgba(255, 255, 255, 0.08)", background: "rgba(30, 41, 59, 0.5)" }}>
          <div style={{ color: "#9ca3af", fontSize: "0.8rem", fontWeight: "600", textTransform: "uppercase" }}>Total Hands</div>
          <div style={{ fontSize: "1.8rem", fontWeight: "700", color: "#f3f4f6", marginTop: "0.25rem" }}>
            {totals.total_hands.toLocaleString()}
          </div>
        </div>

        {/* Collected / Won */}
        <div className="card" style={{ padding: "1rem", borderRadius: "10px", border: "1px solid rgba(255, 255, 255, 0.08)", background: "rgba(30, 41, 59, 0.5)" }}>
          <div style={{ color: "#10b981", fontSize: "0.8rem", fontWeight: "600", textTransform: "uppercase" }}>Collected (Won)</div>
          <div style={{ fontSize: "1.8rem", fontWeight: "700", color: "#10b981", marginTop: "0.25rem" }}>
            {formatCurrency(totals.total_collected)}
          </div>
        </div>

        {/* Pot Lost */}
        <div className="card" style={{ padding: "1rem", borderRadius: "10px", border: "1px solid rgba(255, 255, 255, 0.08)", background: "rgba(30, 41, 59, 0.5)" }}>
          <div style={{ color: "#ef4444", fontSize: "0.8rem", fontWeight: "600", textTransform: "uppercase" }}>Lost (Given/Taken)</div>
          <div style={{ fontSize: "1.8rem", fontWeight: "700", color: "#ef4444", marginTop: "0.25rem" }}>
            {formatCurrency(totals.total_lost)}
          </div>
        </div>

        {/* Net Profit/Loss */}
        <div className="card" style={{ padding: "1rem", borderRadius: "10px", border: "1px solid rgba(255, 255, 255, 0.08)", background: "rgba(30, 41, 59, 0.5)" }}>
          <div style={{ color: "#9ca3af", fontSize: "0.8rem", fontWeight: "600", textTransform: "uppercase" }}>Net Profit/Loss</div>
          <div style={{
            fontSize: "1.8rem",
            fontWeight: "700",
            color: totals.net_profit_loss >= 0 ? "#10b981" : "#ef4444",
            marginTop: "0.25rem"
          }}>
            {formatCurrency(totals.net_profit_loss)}
          </div>
        </div>
      </div>

      {/* Hands Grouped by Date List */}
      <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
        <h3 style={{ fontSize: "1.1rem", fontWeight: "600", color: "#e5e7eb", margin: "0" }}>Hands Grouped By Date</h3>
        
        {loading && <div style={{ textAlign: "center", padding: "2rem", color: "#9ca3af" }}>⏳ Loading filtered hands...</div>}
        {error && <div style={{ padding: "1rem", background: "rgba(239, 68, 68, 0.1)", border: "1px solid #ef4444", borderRadius: "6px", color: "#f87171" }}>⚠️ {error}</div>}
        
        {!loading && sortedDays.length === 0 && (
          <div style={{ textAlign: "center", padding: "3rem", background: "#1f2937", borderRadius: "10px", border: "1px dashed rgba(255,255,255,0.1)", color: "#9ca3af" }}>
            📭 No hands match the selected filters.
          </div>
        )}

        {sortedDays.map(day => {
          const dayHands = dayGroups[day];
          const { net } = getDayTotals(dayHands);
          
          return (
            <div key={day} className="card" style={{ overflow: "hidden", borderRadius: "10px", border: "1px solid rgba(255, 255, 255, 0.08)" }}>
              {/* Collapsible/Group Day Header */}
              <div style={{
                background: "#1f2937",
                padding: "0.85rem 1.25rem",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                borderBottom: "1px solid rgba(255, 255, 255, 0.06)"
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
                  <span style={{ fontSize: "1rem", fontWeight: "600", color: "#f3f4f6" }}>
                    📅 {new Date(day + "T12:00:00").toLocaleDateString(undefined, { weekday: "long", year: "numeric", month: "long", day: "numeric" })}
                  </span>
                  <span className="tag-pill" style={{ background: "rgba(255, 255, 255, 0.08)", padding: "0.2rem 0.5rem", borderRadius: "4px", fontSize: "0.75rem", color: "#d1d5db" }}>
                    {dayHands.length} hand(s)
                  </span>
                </div>
                <div style={{ fontSize: "0.95rem", fontWeight: "700", color: net >= 0 ? "#10b981" : "#ef4444" }}>
                  Day Net: {formatCurrency(net)}
                </div>
              </div>

              {/* Table of Hands */}
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem", textAlign: "left" }}>
                  <thead>
                    <tr style={{ borderBottom: "1px solid rgba(255, 255, 255, 0.06)", background: "rgba(31, 41, 55, 0.4)" }}>
                      <th style={{ padding: "0.75rem 1rem", color: "#9ca3af", fontWeight: "600" }}>Time</th>
                      <th style={{ padding: "0.75rem 1rem", color: "#9ca3af", fontWeight: "600" }}>Site</th>
                      <th style={{ padding: "0.75rem 1rem", color: "#9ca3af", fontWeight: "600" }}>Table Name</th>
                      <th style={{ padding: "0.75rem 1rem", color: "#9ca3af", fontWeight: "600" }}>Hero Cards</th>
                      <th style={{ padding: "0.75rem 1rem", color: "#9ca3af", fontWeight: "600" }}>Board</th>
                      <th style={{ padding: "0.75rem 1rem", color: "#9ca3af", fontWeight: "600" }}>Result</th>
                      <th style={{ padding: "0.75rem 1rem", color: "#9ca3af", fontWeight: "600" }}>Tags</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dayHands.map(h => {
                      const timeStr = h.date
                        ? new Date(h.date).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
                        : "";
                      
                      const isSelected = selectedHandId === h.hand_id;
                      
                      return (
                        <tr
                          key={h.hand_id}
                          onClick={() => onSelectHandId(h.hand_id)}
                          style={{
                            borderBottom: "1px solid rgba(255, 255, 255, 0.04)",
                            cursor: "pointer",
                            background: isSelected ? "rgba(59, 130, 246, 0.08)" : "transparent",
                            transition: "background 0.15s ease"
                          }}
                          className="hover-row"
                        >
                          <td style={{ padding: "0.75rem 1rem", color: "#d1d5db" }}>{timeStr}</td>
                          <td style={{ padding: "0.75rem 1rem" }}>
                            <span style={{
                              padding: "0.15rem 0.4rem",
                              borderRadius: "4px",
                              fontSize: "0.75rem",
                              fontWeight: "600",
                              background: h.site === "CoinPoker" ? "rgba(224, 86, 36, 0.15)" : "rgba(30, 64, 175, 0.15)",
                              color: h.site === "CoinPoker" ? "#f97316" : "#60a5fa"
                            }}>
                              {h.site}
                            </span>
                          </td>
                          <td style={{ padding: "0.75rem 1rem", color: "#e5e7eb", maxWidth: "150px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {h.table_name || "—"}
                          </td>
                          <td style={{ padding: "0.75rem 1rem", fontFamily: "monospace", fontSize: "0.9rem", color: "#f3f4f6", fontWeight: "600" }}>
                            {h.hero_cards || "—"}
                          </td>
                          <td style={{ padding: "0.75rem 1rem", fontFamily: "monospace", fontSize: "0.9rem", color: "#9ca3af" }}>
                            {h.board_cards && h.board_cards.length > 0 ? h.board_cards.join(" ") : "—"}
                          </td>
                          <td style={{
                            padding: "0.75rem 1rem",
                            fontWeight: "700",
                            color: h.hero_won > 0 ? "#10b981" : h.hero_won < 0 ? "#ef4444" : "#9ca3af"
                          }}>
                            {formatCurrency(h.hero_won, h.is_tournament)}
                          </td>
                          <td style={{ padding: "0.5rem 1rem" }} onClick={e => e.stopPropagation()}>
                            <div style={{ display: "flex", flexWrap: "wrap", gap: "0.3rem", alignItems: "center" }}>
                              {/* Tag pills */}
                              {(h.tags || []).map(t => (
                                <span
                                  key={t}
                                  className="tag-pill"
                                  style={{
                                    background: "rgba(59, 130, 246, 0.15)",
                                    color: "#60a5fa",
                                    padding: "0.1rem 0.4rem",
                                    borderRadius: "4px",
                                    fontSize: "0.75rem",
                                    display: "inline-flex",
                                    alignItems: "center",
                                    gap: "0.25rem"
                                  }}
                                >
                                  {t}
                                  <button
                                    onClick={() => void handleRemoveTag(h.hand_id, t)}
                                    style={{
                                      border: "none",
                                      background: "none",
                                      color: "#ef4444",
                                      cursor: "pointer",
                                      padding: "0 0.1rem",
                                      fontSize: "0.75rem",
                                      fontWeight: "bold"
                                    }}
                                    title="Remove tag"
                                  >
                                    ×
                                  </button>
                                </span>
                              ))}

                              {/* Tag Editor Form */}
                              {editingHandId === h.hand_id ? (
                                <div style={{ display: "flex", gap: "0.25rem", alignItems: "center" }}>
                                  <input
                                    type="text"
                                    placeholder="new tag"
                                    value={newTagInput}
                                    onChange={e => setNewTagInput(e.target.value)}
                                    onKeyDown={e => {
                                      if (e.key === "Enter") void handleAddTag(h.hand_id, newTagInput);
                                      if (e.key === "Escape") setEditingHandId(null);
                                    }}
                                    style={{
                                      width: "70px",
                                      padding: "0.1rem 0.3rem",
                                      background: "#111827",
                                      color: "#fff",
                                      border: "1px solid #4b5563",
                                      borderRadius: "4px",
                                      fontSize: "0.75rem"
                                    }}
                                    autoFocus
                                  />
                                  <button
                                    onClick={() => void handleAddTag(h.hand_id, newTagInput)}
                                    style={{
                                      padding: "0.1rem 0.3rem",
                                      background: "#10b981",
                                      border: "none",
                                      borderRadius: "4px",
                                      color: "#fff",
                                      fontSize: "0.75rem",
                                      cursor: "pointer"
                                    }}
                                  >
                                    ✓
                                  </button>
                                  <button
                                    onClick={() => setEditingHandId(null)}
                                    style={{
                                      padding: "0.1rem 0.3rem",
                                      background: "#ef4444",
                                      border: "none",
                                      borderRadius: "4px",
                                      color: "#fff",
                                      fontSize: "0.75rem",
                                      cursor: "pointer"
                                    }}
                                  >
                                    ✕
                                  </button>
                                </div>
                              ) : (
                                <button
                                  onClick={() => {
                                    setEditingHandId(h.hand_id);
                                    setNewTagInput("");
                                  }}
                                  style={{
                                    border: "1px dashed rgba(255,255,255,0.2)",
                                    background: "rgba(255,255,255,0.03)",
                                    color: "#9ca3af",
                                    padding: "0.1rem 0.4rem",
                                    borderRadius: "4px",
                                    fontSize: "0.75rem",
                                    cursor: "pointer"
                                  }}
                                  className="btn-add-tag"
                                >
                                  ➕ Tag
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
