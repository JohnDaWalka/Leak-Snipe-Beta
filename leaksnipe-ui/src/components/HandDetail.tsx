import { useEffect, useMemo, useRef, useState } from "react";
import {
  api,
  copyToClipboard,
  formatAiProviderFromStatus,
  formatHandForClipboard,
  isOllamaProviderRef,
  type AiAnalysis,
  type AiStatus,
  type HandDetail,
  type MRatioResult,
} from "../lib/api";
import { HandAnalysisView } from "./HandAnalysisView";
import { HandReplayer } from "./HandReplayer";
import { OpponentHudPanel } from "./OpponentHud";
import { AiVisualGenerator, type VisualPreset } from "./AiVisualGenerator";
import { parseCardList, PlayingCard } from "./PlayingCard";
import { parseShownCards } from "../lib/replayerSteps";

export type PositionContext = {
  vpip: number;
  pfr: number;
  total: number;
};

type HandDetailPanelProps = {
  hand?: HandDetail | null;
  onClose: () => void;
  onOpenReplayer: () => void;
  positionStats?: PositionContext | null;
  sessionVpip?: number;
  sessionPfr?: number;
  loading?: boolean;
  autoAnalyze?: boolean;
  onAutoAnalyzeComplete?: () => void;
};

function formatWon(amount: number | null | undefined, isTournament: boolean) {
  if (amount === undefined || amount === null || isNaN(amount)) return "—";
  return `${amount >= 0 ? "+" : ""}${isTournament ? `${amount.toLocaleString()} chips` : `$${amount.toFixed(2)}`}`;
}

export function HandDetailPanel({
  hand,
  onClose,
  onOpenReplayer,
  positionStats,
  sessionVpip,
  sessionPfr,
  loading,
  autoAnalyze,
  onAutoAnalyzeComplete,
}: HandDetailPanelProps) {
  const [analyzing, setAnalyzing] = useState(false);
  const [analysis, setAnalysis] = useState<AiAnalysis | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiStatus, setAiStatus] = useState<AiStatus | null>(null);
  const [datasetHands, setDatasetHands] = useState<number | null>(null);
  const [webContextUsed, setWebContextUsed] = useState(false);
  const [handMRatio, setHandMRatio] = useState<MRatioResult | null>(null);
  const [copyMessage, setCopyMessage] = useState<string | null>(null);
  const [copyError, setCopyError] = useState<string | null>(null);
  const autoTriggeredRef = useRef(false);

  const shownCards = useMemo(() => parseShownCards(hand?.raw_text ?? ""), [hand?.raw_text]);

  // runAi defined at top level (before any early returns or effects) so auto-trigger can always call it
  const runAi = async () => {
    if (!hand) return;
    setAnalyzing(true);
    setAiError(null);
    try {
      const res = await api.analyzeHand(hand.hand_id);
      if (res.dataset_context_hands != null) setDatasetHands(res.dataset_context_hands);
      setWebContextUsed(Boolean(res.web_context_included ?? res.analysis.web_context_included));
      setAnalysis({
        ...res.analysis,
        provider: res.analysis.provider ?? res.provider,
        model: res.analysis.model ?? res.model,
      });
    } catch (err) {
      setAiError(err instanceof Error ? err.message : "AI analysis failed");
    } finally {
      setAnalyzing(false);
    }
  };

  useEffect(() => {
    api.aiStatus().then((s) => {
      setAiStatus(s);
      if (s.dataset_context_hands != null) setDatasetHands(s.dataset_context_hands);
    }).catch(() => setAiStatus(null));
  }, []);

  useEffect(() => {
    setHandMRatio(null);
    setAnalysis(null);
    setAiError(null);
    setAnalyzing(false);
    autoTriggeredRef.current = false;
    setCopyMessage(null);
    setCopyError(null);
    if (!hand?.is_tournament) return;
    api.handMRatio(hand.hand_id).then(setHandMRatio).catch(() => setHandMRatio(null));
  }, [hand?.hand_id, hand?.is_tournament]);

  // Auto-run AI analysis when right-click "export to AI" opens the hand
  useEffect(() => {
    if (autoAnalyze) {
      // allow re-trigger if user right-clicks export again on the open hand
      autoTriggeredRef.current = false;
    }
    if (autoAnalyze && hand && !autoTriggeredRef.current) {
      autoTriggeredRef.current = true;
      runAi().finally(() => {
        onAutoAnalyzeComplete?.();
      });
    }
  }, [autoAnalyze, hand?.hand_id]);

  if (loading || !hand) {
    return (
      <div className="detail-panel detail-panel-loading">
        <div className="detail-skeleton" />
        <p className="muted">Loading hand…</p>
      </div>
    );
  }

  const activeProviderLabel = formatAiProviderFromStatus(aiStatus);
  const analyzingWithOllama = isOllamaProviderRef(aiStatus?.llm_provider);
  const datasetContextActive =
    Boolean(aiStatus?.ai_include_dataset_context ?? true) &&
    (datasetHands ?? aiStatus?.dataset_context_hands ?? 0) > 0;
  const webSearchMode = aiStatus?.ai_web_search_mode ?? (aiStatus?.ai_include_web_context === false ? "off" : "on_demand");
  const webContextEnabled = webSearchMode !== "off";

  const heroCards = parseCardList(hand.hero_cards ?? "");
  const opponentNames = Object.values(hand.players ?? {})
    .filter((p) => p && !p.is_hero && p.name && p.name !== hand.hero_name)
    .map((p) => p.name);

  const formatStack = (amount: number | null | undefined) => {
    if (amount === undefined || amount === null || isNaN(amount)) return "—";
    if (hand.is_tournament) return `${amount.toLocaleString()} chips`;
    return `$${amount.toFixed(2)}`;
  };

  const board = (hand.board_cards ?? []).join(" ");
  const flop = (hand.board_cards ?? []).slice(0, 3).join(" ");
  const visualPresets: VisualPreset[] = [];
  if (flop) {
    visualPresets.push({
      label: "Board texture",
      prompt: `A poker board texture diagram for the flop ${flop}, labeling draws, made hands, and how wet or dry the texture is`,
    });
  }
  if (board) {
    visualPresets.push({
      label: "Full board",
      prompt: `A poker board diagram showing the runout ${board}, highlighting completed draws and the strongest possible hands`,
    });
  }
  if (hand.hero_position) {
    visualPresets.push({
      label: `${hand.hero_position} range`,
      prompt: `A 13x13 preflop poker hand range grid chart for an opening range from the ${hand.hero_position} position`,
    });
  }

  return (
    <div className="detail-panel">
      <div className="detail-header">
        <div>
          <h2 className="detail-title">Hand Stats</h2>
          <p className="detail-sub mono">{hand.hand_id}</p>
        </div>
        <button type="button" className="ghost-btn" onClick={onClose} aria-label="Close panel">
          ✕
        </button>
      </div>

      <button type="button" className="replay-hero-btn" onClick={onOpenReplayer}>
        <span className="replay-hero-icon" aria-hidden>▶</span>
        Replay Hand
      </button>

      <OpponentHudPanel names={opponentNames} title="Opponent Profiles" />

      {/* Players at Table Section */}
      <div className="table-players-section">
        <h3 className="section-title">Players at Table</h3>
        <div className="table-players-list">
          {Object.entries(hand.players ?? {})
            .filter(([, p]) => p != null)
            .map(([seat, p]) => ({ seat: Number(seat), ...p }))
            .sort((a, b) => a.seat - b.seat)
            .map((p) => {
              const pName = p.name ?? "";
              const cards = p.is_hero ? heroCards : parseCardList(shownCards[pName] ?? "");
              return (
                <div key={p.seat} className={`table-player-row ${p.is_hero ? "hero" : ""}`}>
                  <span className="player-seat">Seat {p.seat}</span>
                  <span className="player-position-badge" data-pos={p.position}>
                    {p.position || "—"}
                  </span>
                  <span className="player-name" title={pName}>
                    {pName}
                  </span>
                  <span className="player-stack">{formatStack(p.stack)}</span>
                  <span className="player-cards-show">
                    {cards.length > 0 ? (
                      <div className="card-row mini">
                        {cards.map((c, i) => (
                          <PlayingCard key={i} card={c} small />
                        ))}
                      </div>
                    ) : (
                      <span className="muted small">—</span>
                    )}
                  </span>
                </div>
              );
            })}
        </div>
      </div>

      <div className="detail-grid">
        <div className="detail-card">
          <div className="detail-label">Site / Table</div>
          <div>
            {hand.site} · {hand.table_name || "—"}
          </div>
        </div>
        <div className="detail-card">
          <div className="detail-label">Position</div>
          <div className="detail-value-emphasis">{hand.hero_position || "—"}</div>
          {positionStats ? (
            <div className="detail-context muted">
              {hand.hero_position} stats: VPIP {positionStats.vpip}% · PFR {positionStats.pfr}%
              <span className="detail-context-sub"> ({positionStats.total} hands)</span>
            </div>
          ) : null}
        </div>
        <div className="detail-card">
          <div className="detail-label">Result</div>
          <div className={hand.hero_won >= 0 ? "positive detail-value-emphasis" : "negative detail-value-emphasis"}>
            {formatWon(hand.hero_won, hand.is_tournament)}
          </div>
        </div>
         <div className="detail-card">
          <div className="detail-label">Pot</div>
          <div>
            {hand.is_tournament
              ? `${(hand.pot ?? 0).toLocaleString()} chips`
              : `$${(hand.pot ?? 0).toFixed(2)}`}
          </div>
        </div>
        {handMRatio ? (
          <div className="detail-card" style={{ borderColor: handMRatio.zone_color }}>
            <div className="detail-label">My M-ratio</div>
            <div className="detail-value-emphasis" style={{ color: handMRatio.zone_color }}>
              M {handMRatio.m_ratio.toFixed(2)} · {handMRatio.zone.toUpperCase()}
            </div>
            <div className="detail-context muted">
              Effective M {handMRatio.effective_m.toFixed(2)} · {handMRatio.stack_bb.toFixed(1)}BB
            </div>
          </div>
        ) : null}
      </div>

      {sessionVpip != null ? (
        <div className="session-context-bar">
          Session: VPIP <strong>{sessionVpip}%</strong>
          {sessionPfr != null ? (
            <>
              {" "}
              · PFR <strong>{sessionPfr}%</strong>
            </>
          ) : null}
        </div>
      ) : null}

      <div className="detail-cards-row">
        <span className="detail-label">Hero</span>
        <div className="card-row">
          {heroCards.length > 0
            ? heroCards.map((c, i) => <PlayingCard key={i} card={c} />)
            : <span className="muted">—</span>}
        </div>
      </div>

      {hand.board_cards?.length > 0 ? (
        <div className="detail-cards-row">
          <span className="detail-label">Board</span>
          <div className="card-row">
            {hand.board_cards.map((c, i) => (
              <PlayingCard key={i} card={c} />
            ))}
          </div>
        </div>
      ) : null}

      <div className="detail-actions">
        <button type="button" className="secondary-btn" onClick={runAi} disabled={analyzing}>
          {analyzing ? `Analyzing with ${activeProviderLabel}…` : "AI Coach"}
        </button>
        <button
          type="button"
          className="ghost-btn"
          onClick={async () => {
            if (!hand) return;
            setCopyMessage(null);
            setCopyError(null);
            const text = formatHandForClipboard(hand);
            const ok = await copyToClipboard(text);
            if (ok) setCopyMessage("Hand copied to clipboard.");
            else setCopyError("Clipboard copy failed. Reopen the app after updating, then try again.");
          }}
          title="Copy hand (hole cards, board, actions, outcome) to clipboard — pasteable for AI"
        >
          Copy for AI
        </button>
        {datasetContextActive ? (
          <span className="muted small">
            Grounded in your full database ({datasetHands ?? aiStatus?.dataset_context_hands} hands)
          </span>
        ) : null}
        {webContextUsed ? (
          <span className="muted small">Live web context used</span>
        ) : webContextEnabled && !analyzing ? (
          <span className="muted small">
            Web search {webSearchMode === "always" ? "always on" : "on-demand (not used for hand grading)"}
          </span>
        ) : null}
      </div>

      {analyzing && analyzingWithOllama ? (
        <p className="muted ai-analyzing-hint">Local Ollama analysis can take 1–2 minutes on large models.</p>
      ) : analyzing ? (
        <p className="muted ai-analyzing-hint">Cloud analysis usually finishes in a few seconds.</p>
      ) : null}

      {aiError ? <div className="error-banner">{aiError}</div> : null}
      {copyError ? <div className="error-banner">{copyError}</div> : null}
      {copyMessage ? <div className="success-banner">{copyMessage}</div> : null}
      {analysis ? (
        <div className="ai-result">
          <div className="detail-label">AI Coach</div>
          <HandAnalysisView analysis={analysis} />
        </div>
      ) : null}

      {aiStatus?.asi1_image_ready ? (
        <div className="ai-result">
          <AiVisualGenerator
            available
            model={aiStatus?.asi1_image_model}
            presets={visualPresets}
            placeholder="Describe a visual for this hand…"
            title="Generate Visual"
          />
        </div>
      ) : null}

      <div className="streets-log">
        <div className="detail-label">Action Log</div>
        {hand.streets?.map((street) => (
          <div key={street.name} className="street-block">
            <div className="street-name">
              {street.name}
              {street.cards?.length ? ` · ${street.cards.join(" ")}` : ""}
            </div>
            {street.actions?.map((act, i) => (
              <div key={i} className="action-line mono">
                {act.player}: {act.action}
                {act.amount > 0 ? ` $${act.amount.toFixed(2)}` : ""}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

type HandReplayerModalProps = {
  hand: HandDetail;
  onClose: () => void;
};

export function HandReplayerModal({ hand, onClose }: HandReplayerModalProps) {
  return (
    <div className="modal-overlay" onClick={onClose} role="presentation">
      <div
        className="modal-content replayer-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label={`Replay hand ${hand.hand_id}`}
      >
        <HandReplayer hand={hand} onClose={onClose} />
      </div>
    </div>
  );
}
