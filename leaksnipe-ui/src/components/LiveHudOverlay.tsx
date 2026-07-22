import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { api, waitForBackend, type LiveCurrentHand, type PlayerHudStats, type Settings } from "../lib/api";
import { resolveLayoutKey, SEAT_POSITIONS, buildHeroAnchoredSeatSlots, clampSeatXPct, HUD_BADGE_SCALE_DEFAULT, HUD_EDGE_MARGIN_PCT_DEFAULT } from "../lib/seatPositions";
import { SeatHudBadge } from "./SeatHudBadge";

type TableBounds = {
  hwnd: number;
  x: number;
  y: number;
  width: number;
  height: number;
  title: string;
};

type SeatEntry = {
  seat: number;
  name: string;
  xPct: number;
  yPct: number;
  offsetKey: string;
};

const POLL_MS = 2000;
// Pointer movement below this (px) between down/up on a seat badge counts as a
// click (toggle the pinned position-stats panel) rather than a drag.
const CLICK_MOVE_THRESHOLD_PX = 4;

const clampPct = (v: number) => Math.max(0.03, Math.min(0.97, v));

export function LiveHudOverlay() {
  const [bounds, setBounds] = useState<TableBounds | null>(null);
  const [hand, setHand] = useState<LiveCurrentHand | null>(null);
  const [statsMap, setStatsMap] = useState<Record<string, PlayerHudStats>>({});
  const [settings, setSettings] = useState<Settings | null>(null);
  const [layoutMode, setLayoutMode] = useState(false);
  const [status, setStatus] = useState("Starting…");
  const containerRef = useRef<HTMLDivElement>(null);
  const lastHandId = useRef<string | null>(null);

  const opacity = useMemo(() => {
    const raw = Number(settings?.hud_opacity ?? 0.85);
    return Math.min(1, Math.max(0.3, raw));
  }, [settings?.hud_opacity]);

  const badgeScale = useMemo(() => {
    const raw = Number(settings?.hud_badge_scale ?? HUD_BADGE_SCALE_DEFAULT);
    return Math.min(2.5, Math.max(0.8, raw));
  }, [settings?.hud_badge_scale]);

  const edgeMarginPct = useMemo(() => {
    const raw = Number(settings?.hud_edge_margin_pct ?? HUD_EDGE_MARGIN_PCT_DEFAULT);
    return Math.min(0.25, Math.max(0.05, raw));
  }, [settings?.hud_edge_margin_pct]);

  const applyClickthrough = useCallback(async (ignore: boolean) => {
    try {
      const win = getCurrentWebviewWindow();
      await win.setIgnoreCursorEvents(ignore);
    } catch {
      // browser dev fallback
    }
  }, []);

  useEffect(() => {
    void applyClickthrough(!layoutMode);
  }, [layoutMode, applyClickthrough]);

  useEffect(() => {
    let cancelled = false;

    const boot = async () => {
      try {
        await waitForBackend();
        if (!cancelled) {
          setSettings(await api.settings());
        }
      } catch {
        if (!cancelled) setStatus("Waiting for sidecar…");
      }
    };
    void boot();

    const unlistenBounds = listen<TableBounds>("hud-table-bounds", (event) => {
      setBounds(event.payload);
      setStatus(event.payload.title || "Table detected");
    });

    const unlistenStatus = listen<string>("hud-status", (event) => {
      if (event.payload) setStatus(event.payload);
    });

    // Fired by a global OS-level hotkey (Ctrl+Shift+H, registered in Rust)
    // rather than a click, since the overlay is click-through until layout
    // mode is already on — a click target inside it can't be what turns
    // layout mode on in the first place.
    const unlistenToggle = listen("hud-toggle-layout", () => {
      setLayoutMode((v) => !v);
    });

    return () => {
      cancelled = true;
      void unlistenToggle.then((fn) => fn());
      void unlistenBounds.then((fn) => fn());
      void unlistenStatus.then((fn) => fn());
    };
  }, []);

  const resolveHudSite = useCallback((cfg: Settings | null, tableTitle?: string) => {
    const preset = (cfg?.hud_site_preset as string | undefined) ?? "auto";
    if (preset && preset !== "auto" && preset !== "off") {
      return preset;
    }
    const tl = (tableTitle ?? "").toLowerCase();
    if (tl.includes("coinpoker") || tl.includes("₮") || tl.includes("chp")) return "CoinPoker";
    if (tl.includes("acr") || tl.includes("winning")) return "BetACR";
    if (tl.includes("ggpoker") || tl.includes("gg poker")) return "GGPoker";
    return undefined;
  }, []);

  const refreshHand = useCallback(async () => {
    try {
      await waitForBackend();
      const cfg = await api.settings();
      const site = resolveHudSite(cfg, bounds?.title);
      const live = await api.liveCurrentHand(site, bounds?.title || undefined);
      setSettings(cfg);
      setHand(live);

      const opponents = live.opponents.filter(Boolean);
      if (opponents.length === 0) {
        setStatsMap({});
        setStatus(live.hand_id ? "No opponents in latest hand" : "No hands imported yet");
        return;
      }

      if (live.hand_id !== lastHandId.current) {
        lastHandId.current = live.hand_id;
        setStatus(`Hand ${live.hand_id?.slice(0, 12) ?? ""}…`);
      }

      const res = await api.playerStatsBatch(opponents);
      setStatsMap(res.players);
      setStatus(
        bounds
          ? `${bounds.title} · ${opponents.length} players`
          : `${opponents.length} players (latest hand)`,
      );
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "HUD refresh failed");
    }
  }, [bounds, resolveHudSite]);

  useEffect(() => {
    void refreshHand();
    const id = window.setInterval(() => void refreshHand(), POLL_MS);
    return () => window.clearInterval(id);
  }, [refreshHand]);

  const seatOffsets = (settings?.hud_seat_offsets as Record<string, { x: number; y: number }> | undefined) ?? {};

  const seats: SeatEntry[] = useMemo(() => {
    if (!hand?.seat_map) return [];
    const layoutKey = resolveLayoutKey(
      hand.max_seats || 6,
      (settings?.hud_seat_layout as string) ?? "auto",
    );
    const layout = SEAT_POSITIONS[layoutKey];
    const seatToSlot = buildHeroAnchoredSeatSlots(hand.seat_map, layoutKey, hand.site);
    const entries: SeatEntry[] = [];
    const seenNames = new Set<string>();

    for (const [seatStr, info] of Object.entries(hand.seat_map)) {
      if (!info?.name || info.is_hero) continue;
      const name = info.name.trim();
      if (!name || seenNames.has(name)) continue;
      seenNames.add(name);
      const seat = Number(seatStr);
      const slot = seatToSlot[seat];
      const pos = slot != null ? layout[slot] : undefined;
      if (!pos) continue;
      const offsetKey = `${layoutKey}:${slot}`;
      const override = seatOffsets[offsetKey];
      entries.push({
        seat,
        name,
        xPct: clampSeatXPct(override ? override.x : pos[0], edgeMarginPct),
        yPct: override ? override.y : pos[1],
        offsetKey,
      });
    }
    return entries;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hand, settings?.hud_seat_layout, edgeMarginPct, seatOffsets]);

  const dragRef = useRef<{
    offsetKey: string;
    startClientX: number;
    startClientY: number;
    startXPct: number;
    startYPct: number;
  } | null>(null);
  const [dragPreview, setDragPreview] = useState<Record<string, { x: number; y: number }>>({});
  const [pinnedSeats, setPinnedSeats] = useState<Set<string>>(new Set());

  const persistSeatOffset = useCallback(
    async (offsetKey: string, x: number, y: number) => {
      const next = { ...seatOffsets, [offsetKey]: { x, y } };
      try {
        const updated = await api.updateSettings({ hud_seat_offsets: next });
        setSettings(updated);
      } catch {
        // best-effort — badge keeps the dragged position locally via dragPreview
        // even if the save failed; next full settings refresh may revert it.
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [seatOffsets],
  );

  const handleSeatPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>, seat: SeatEntry) => {
      if (!layoutMode || e.button !== 0) return;
      e.stopPropagation();
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      dragRef.current = {
        offsetKey: seat.offsetKey,
        startClientX: e.clientX,
        startClientY: e.clientY,
        startXPct: seat.xPct,
        startYPct: seat.yPct,
      };
    },
    [layoutMode],
  );

  const handleSeatPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    const rect = containerRef.current?.getBoundingClientRect();
    if (!drag || !rect || rect.width === 0 || rect.height === 0) return;
    const dxPct = (e.clientX - drag.startClientX) / rect.width;
    const dyPct = (e.clientY - drag.startClientY) / rect.height;
    setDragPreview((prev) => ({
      ...prev,
      [drag.offsetKey]: {
        x: clampPct(drag.startXPct + dxPct),
        y: clampPct(drag.startYPct + dyPct),
      },
    }));
  }, []);

  const toggleSeatPin = useCallback((offsetKey: string) => {
    setPinnedSeats((prev) => {
      const next = new Set(prev);
      if (next.has(offsetKey)) {
        next.delete(offsetKey);
      } else {
        next.add(offsetKey);
      }
      return next;
    });
  }, []);

  const handleSeatPointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      dragRef.current = null;
      if (!drag) return;
      (e.target as HTMLElement).releasePointerCapture(e.pointerId);
      const movedPx = Math.hypot(e.clientX - drag.startClientX, e.clientY - drag.startClientY);
      if (movedPx < CLICK_MOVE_THRESHOLD_PX) {
        // Treated as a click, not a drag — toggle the pinned position-stats panel.
        setDragPreview((prev) => {
          const { [drag.offsetKey]: _dropped, ...rest } = prev;
          return rest;
        });
        toggleSeatPin(drag.offsetKey);
        return;
      }
      const preview = dragPreview[drag.offsetKey];
      if (preview) {
        void persistSeatOffset(drag.offsetKey, preview.x, preview.y);
      }
    },
    [dragPreview, persistSeatOffset, toggleSeatPin],
  );

  return (
    <div
      ref={containerRef}
      className="live-hud-root"
      style={{ opacity, ["--hud-badge-scale" as string]: badgeScale }}
    >
      <div className="live-hud-toolbar">
        <span
          className="live-hud-status"
          onPointerDown={(e) => {
            if (layoutMode && e.button === 0) {
              void getCurrentWebviewWindow().startDragging().catch(() => undefined);
            }
          }}
        >
          {status}
        </span>
        <button
          type="button"
          className={`live-hud-layout-btn ${layoutMode ? "active" : ""}`}
          onClick={() => setLayoutMode((v) => !v)}
          onMouseDown={() => void applyClickthrough(false)}
          title="This button only works while layout mode is already on (the overlay is click-through otherwise). Use Ctrl+Shift+H to toggle from anywhere."
        >
          {layoutMode ? "Layout: ON — drag badges/status bar (Ctrl+Shift+H)" : "Layout: OFF (Ctrl+Shift+H)"}
        </button>
      </div>

      {seats.length === 0 ? (
        <div className="live-hud-empty">
          {hand?.hand_id
            ? "No opponent seats in current hand"
            : "Play a hand — stats appear when ACR imports it"}
        </div>
      ) : (
        seats.map((seat) => {
          const preview = dragPreview[seat.offsetKey];
          const xPct = preview?.x ?? seat.xPct;
          const yPct = preview?.y ?? seat.yPct;
          return (
            <div
              key={`${seat.seat}-${seat.name}`}
              className={`live-seat-anchor ${layoutMode ? "draggable" : ""}`}
              style={{
                left: `${xPct * 100}%`,
                top: `${yPct * 100}%`,
              }}
              onPointerDown={(e) => handleSeatPointerDown(e, seat)}
              onPointerMove={handleSeatPointerMove}
              onPointerUp={handleSeatPointerUp}
            >
              <SeatHudBadge
                name={seat.name}
                seat={seat.seat}
                stats={statsMap[seat.name] ?? null}
                layoutMode={layoutMode}
                pinned={pinnedSeats.has(seat.offsetKey)}
              />
            </div>
          );
        })
      )}
    </div>
  );
}
