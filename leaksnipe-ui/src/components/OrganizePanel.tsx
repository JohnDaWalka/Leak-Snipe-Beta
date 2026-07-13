import { useState } from "react";
import { api, type HandSummary } from "../lib/api";

type OrganizePanelProps = {
  hands: HandSummary[];
  onSelectHandId: (id: string) => void;
  selectedHandId: string | null;
  onTagsUpdated?: () => void;
};

export function OrganizePanel({
  hands,
  onSelectHandId,
  selectedHandId,
  onTagsUpdated,
}: OrganizePanelProps) {
  // Tag editor state
  const [editingHandId, setEditingHandId] = useState<string | null>(null);
  const [newTagInput, setNewTagInput] = useState("");

  const handleAddTag = async (handId: string, tagText: string) => {
    if (!tagText.trim()) return;
    try {
      const res = await api.addTag(handId, tagText.trim());
      if (res.ok) {
        setNewTagInput("");
        setEditingHandId(null);
        if (onTagsUpdated) onTagsUpdated();
      }
    } catch (err) {
      alert("Failed to add tag: " + (err instanceof Error ? err.message : String(err)));
    }
  };

  const handleRemoveTag = async (handId: string, tagText: string) => {
    try {
      const res = await api.removeTag(handId, tagText);
      if (res.ok) {
        if (onTagsUpdated) onTagsUpdated();
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
      // Get calendar day (YYYY-MM-DD)
      const day = h.date.substring(0, 10);
      if (!groups[day]) {
        groups[day] = [];
      }
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
    <div className="organize-panel" style={{ padding: "0.5rem 0", display: "flex", flexDirection: "column", gap: "1.5rem" }}>
      {/* Hands Grouped by Date List */}
      <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
        <h3 style={{ fontSize: "1.1rem", fontWeight: "600", color: "#e5e7eb", margin: "0" }}>Hands Grouped By Date</h3>
        
        {sortedDays.length === 0 && (
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
                                      padding: "0.15rem 0.35rem",
                                      borderRadius: "4px",
                                      background: "#1f2937",
                                      border: "1px solid #374151",
                                      color: "#e5e7eb",
                                      fontSize: "0.75rem",
                                      width: "70px"
                                    }}
                                    autoFocus
                                  />
                                  <button
                                    onClick={() => void handleAddTag(h.hand_id, newTagInput)}
                                    style={{
                                      background: "#10b981",
                                      color: "#fff",
                                      border: "none",
                                      borderRadius: "4px",
                                      padding: "0.15rem 0.35rem",
                                      fontSize: "0.75rem",
                                      cursor: "pointer"
                                    }}
                                  >
                                    ✓
                                  </button>
                                  <button
                                    onClick={() => setEditingHandId(null)}
                                    style={{
                                      background: "#374151",
                                      color: "#9ca3af",
                                      border: "none",
                                      borderRadius: "4px",
                                      padding: "0.15rem 0.35rem",
                                      fontSize: "0.75rem",
                                      cursor: "pointer"
                                    }}
                                  >
                                    Esc
                                  </button>
                                </div>
                              ) : (
                                <button
                                  onClick={() => setEditingHandId(h.hand_id)}
                                  style={{
                                    background: "rgba(255, 255, 255, 0.05)",
                                    border: "1px dashed rgba(255, 255, 255, 0.15)",
                                    borderRadius: "4px",
                                    color: "#9ca3af",
                                    padding: "0.1rem 0.35rem",
                                    fontSize: "0.7rem",
                                    cursor: "pointer",
                                    display: "inline-flex",
                                    alignItems: "center"
                                  }}
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
