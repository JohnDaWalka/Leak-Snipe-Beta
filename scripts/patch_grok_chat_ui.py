"""Juice up Live with Grok chat prompts + xAI-themed chat bubbles."""
from pathlib import Path

p = Path(__file__).resolve().parents[1] / "mcp-server" / "src" / "mcp-worker.js"
text = p.read_text(encoding="utf-8")

OLD_CSS_START = "/* ---------- live with grok ---------- */"
OLD_CSS_END = "/* ---------- footer ---------- */"

css_i = text.find(OLD_CSS_START)
css_j = text.find(OLD_CSS_END)
if css_i < 0 or css_j < 0:
    raise SystemExit("CSS anchors missing")

NEW_CSS = r"""/* ---------- live with grok (xAI chat) ---------- */
.grok-strip { margin-top: 0.5rem; }
.grok-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 1.15rem;
}
@media (max-width: 960px) {
  .grok-grid { grid-template-columns: 1fr; }
}
.grok-card {
  border: 1px solid rgba(255, 255, 255, 0.08);
  background:
    radial-gradient(120% 80% at 0% 0%, rgba(120, 90, 255, 0.12), transparent 55%),
    radial-gradient(100% 70% at 100% 100%, rgba(0, 255, 163, 0.06), transparent 50%),
    linear-gradient(165deg, #12141a 0%, #0a0b0f 100%);
  padding: 1.3rem 1.2rem 1.4rem;
  position: relative;
  overflow: hidden;
  border-radius: 14px;
  box-shadow:
    0 0 0 1px rgba(255, 255, 255, 0.03) inset,
    0 18px 40px rgba(0, 0, 0, 0.45),
    0 4px 12px rgba(0, 0, 0, 0.35);
}
.grok-card::before {
  content: "";
  position: absolute;
  inset: 0 auto 0 0;
  width: 2px;
  background: linear-gradient(180deg, #9b87ff, #00ffa3);
  opacity: 0.9;
}
.grok-card.discipline::before {
  background: linear-gradient(180deg, #6ec8ff, #9b87ff);
}
.grok-card.pressure::before {
  background: linear-gradient(180deg, #ff6b6b, #9b87ff);
}
.grok-card .ord {
  font-family: var(--font-mono);
  font-size: 0.66rem;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: rgba(255, 255, 255, 0.4);
  margin-bottom: 0.55rem;
}
.grok-card h3 {
  font-family: var(--font-body);
  font-size: 1.15rem;
  font-weight: 700;
  margin: 0 0 0.55rem;
  letter-spacing: -0.01em;
  color: #f4f4f5;
}
.grok-meta {
  font-family: var(--font-mono);
  font-size: 0.72rem;
  color: #9b87ff;
  margin-bottom: 0.9rem;
  letter-spacing: 0.02em;
}

/* chat transcript box */
.grok-dialogue {
  display: flex;
  flex-direction: column;
  gap: 0.7rem;
  font-family: var(--font-mono);
  font-size: 0.78rem;
  line-height: 1.55;
  color: rgba(255, 255, 255, 0.72);
  border: 1px solid rgba(255, 255, 255, 0.07);
  border-radius: 12px;
  padding: 0.85rem 0.8rem;
  margin: 0 0 1rem;
  background:
    linear-gradient(180deg, rgba(22, 24, 32, 0.95), rgba(12, 13, 18, 0.98));
  box-shadow:
    0 0 0 1px rgba(155, 135, 255, 0.08) inset,
    0 12px 28px rgba(0, 0, 0, 0.5),
    0 0 40px rgba(155, 135, 255, 0.06);
}

.grok-dialogue .msg {
  display: flex;
  flex-direction: column;
  gap: 0.28rem;
  max-width: 100%;
}
.grok-dialogue .msg.you { align-items: flex-end; }
.grok-dialogue .msg.grok { align-items: flex-start; }

.grok-dialogue .who {
  font-size: 0.62rem;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: rgba(255, 255, 255, 0.35);
  padding: 0 0.15rem;
}
.grok-dialogue .msg.you .who { color: #6ec8ff; }
.grok-dialogue .msg.grok .who { color: #00ffa3; }

.grok-dialogue .bubble {
  margin: 0;
  padding: 0.7rem 0.85rem;
  border-radius: 12px;
  line-height: 1.5;
  font-size: 0.8rem;
  white-space: pre-wrap;
  word-break: break-word;
  box-shadow:
    0 8px 20px rgba(0, 0, 0, 0.4),
    0 2px 6px rgba(0, 0, 0, 0.3);
}

.grok-dialogue .msg.you .bubble {
  background: linear-gradient(145deg, #2a2d3a 0%, #1a1c26 100%);
  border: 1px solid rgba(110, 200, 255, 0.22);
  color: #e8eef5;
  border-bottom-right-radius: 4px;
  box-shadow:
    0 8px 22px rgba(0, 0, 0, 0.45),
    0 0 18px rgba(110, 200, 255, 0.08);
}

.grok-dialogue .msg.grok .bubble {
  background: linear-gradient(145deg, rgba(20, 40, 32, 0.95) 0%, rgba(12, 18, 16, 0.98) 100%);
  border: 1px solid rgba(0, 255, 163, 0.22);
  color: #d8f5e8;
  border-bottom-left-radius: 4px;
  box-shadow:
    0 8px 22px rgba(0, 0, 0, 0.45),
    0 0 22px rgba(0, 255, 163, 0.08);
}

.grok-result {
  font-family: var(--font-mono);
  font-size: 0.95rem;
  font-weight: 600;
  margin-bottom: 0.55rem;
}
.grok-result.neg { color: rgba(255, 255, 255, 0.55); }
.grok-result.pos { color: #00ffa3; text-shadow: 0 0 18px rgba(0, 255, 163, 0.25); }
.grok-take {
  font-size: 0.92rem;
  line-height: 1.45;
  color: rgba(255, 255, 255, 0.82);
  margin: 0;
}
.grok-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
  margin-top: 0.9rem;
}
.grok-tags span {
  font-family: var(--font-mono);
  font-size: 0.62rem;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  border: 1px solid rgba(255, 255, 255, 0.1);
  color: rgba(255, 255, 255, 0.45);
  padding: 0.2rem 0.45rem;
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.03);
}
.grok-hero-banner {
  border: 1px solid rgba(255, 255, 255, 0.08);
  background: linear-gradient(120deg, rgba(155, 135, 255, 0.08), rgba(0, 255, 163, 0.04));
  padding: 1.1rem 1.25rem;
  margin-bottom: 1.25rem;
  display: flex;
  flex-wrap: wrap;
  gap: 1rem 2rem;
  align-items: center;
  justify-content: space-between;
  border-radius: 12px;
  box-shadow: 0 10px 28px rgba(0, 0, 0, 0.35);
}
.grok-hero-banner .story {
  font-family: var(--font-mono);
  font-size: 0.78rem;
  color: rgba(255, 255, 255, 0.55);
  letter-spacing: 0.04em;
}
.grok-hero-banner .story b { color: #00ffa3; font-weight: 500; }
.grok-mcp {
  font-family: var(--font-mono);
  font-size: 0.72rem;
  color: #9b87ff;
  word-break: break-all;
}
.grok-mcp code {
  background: #0a0b0f;
  border: 1px solid rgba(155, 135, 255, 0.25);
  padding: 0.35rem 0.55rem;
  color: #c4b5ff;
  border-radius: 6px;
}

"""

text = text[:css_i] + NEW_CSS + text[css_j:]

# --- Replace the three overview dialogue blocks ---
replacements = [
    (
        """          <div class="grok-dialogue">
            <p class="you"><span class="who">YOU</span> Hand before the tens?</p>
            <p class="grok"><span class="who">GROK</span> CO 99 — raised PF, fired the dry A-flop. Villain folds.</p>
          </div>""",
        """          <div class="grok-dialogue" role="log" aria-label="Chat excerpt">
            <div class="msg you">
              <span class="who">You</span>
              <p class="bubble">Pull the hand right before my pocket tens — full streets, not a one-liner. Was I too passive or did I print?</p>
            </div>
            <div class="msg grok">
              <span class="who">Grok</span>
              <p class="bubble">Got it — CO 9♣9♦. You open, one caller, dry A♠7♦5♥. You fire again… villain folds. +2,528 chips, no showdown. Clean value aggression.</p>
            </div>
          </div>""",
    ),
    (
        """          <div class="grok-dialogue">
            <p class="you"><span class="who">YOU</span> Most recent hand?</p>
            <p class="grok"><span class="who">GROK</span> Raise and 3-bet in front. 32s hits the muck. Correct.</p>
          </div>""",
        """          <div class="grok-dialogue" role="log" aria-label="Chat excerpt">
            <div class="msg you">
              <span class="who">You</span>
              <p class="bubble">What was my most recent hand live from the DB? Don’t sugarcoat it — fold or hero call?</p>
            </div>
            <div class="msg grok">
              <span class="who">Grok</span>
              <p class="bubble">MP 3♥2♠. Raise, then 3-bet in front. You muck. −63 chips. Correct — 32s does not continue multiway heat. Stack-preserving discipline.</p>
            </div>
          </div>""",
    ),
    (
        """          <div class="grok-dialogue">
            <p class="you"><span class="who">YOU</span> Walk me through my tens hand.</p>
            <p class="grok"><span class="who">GROK</span> Fired flop, turned up on blank, river fold. Took it down.</p>
          </div>""",
        """          <div class="grok-dialogue" role="log" aria-label="Chat excerpt">
            <div class="msg you">
              <span class="who">You</span>
              <p class="bubble">Walk me through my pocket tens hand street-by-street — was the barrel on A-K too thin or was I supposed to charge?</p>
            </div>
            <div class="msg grok">
              <span class="who">Grok</span>
              <p class="bubble">MP T♠T♥. Open, call. Flop A♥8♥K♠ — you keep firing. Turn blank, more heat. River: villain folds. +4,226. Overpair on a scare board; pressure paid.</p>
            </div>
          </div>""",
    ),
]

for old, new in replacements:
    if old not in text:
        raise SystemExit(f"dialogue block missing:\n{old[:80]}")
    text = text.replace(old, new, 1)
    print("replaced dialogue ok")

# Detail panel asks - juicier
detail_reps = [
    (
        """      <p class="prose"><b>Ask:</b> “Show me the hand right before that.”</p>
      <p class="prose"><b>Grok:</b> Cutoff 9♣9♦. Raised preflop, one caller. Flop 7♦ A♠ 5♥ (dry). You raised again; villain folded. <b>+2,528 chips</b> without showdown.</p>""",
        """      <p class="prose"><b>Ask:</b> “Pull the hand right before my pocket tens — full streets, not a one-liner. Was I too passive or did I print?”</p>
      <p class="prose"><b>Grok:</b> Cutoff 9♣9♦. Raised preflop, one caller. Flop 7♦ A♠ 5♥ (dry). You raised again; villain folded. <b>+2,528 chips</b> without showdown.</p>""",
    ),
    (
        """      <p class="prose"><b>Ask:</b> “Most recent hand?”</p>
      <p class="prose"><b>Grok:</b> Middle position 3♥2♠. Raise and 3-bet in front. You fold. <b>−63 chips</b> (antes/blinds only). No board.</p>""",
        """      <p class="prose"><b>Ask:</b> “What was my most recent hand live from the DB? Don’t sugarcoat it — fold or hero call?”</p>
      <p class="prose"><b>Grok:</b> Middle position 3♥2♠. Raise and 3-bet in front. You fold. <b>−63 chips</b> (antes/blinds only). No board.</p>""",
    ),
    (
        """      <p class="prose"><b>Ask:</b> “Walk me through my pocket tens hand.”</p>
      <p class="prose"><b>Grok:</b> Middle position T♠T♥. Raised preflop, got called. Flop A♥ 8♥ K♠ — you kept firing. Turn blank, more pressure. River: villain folds. <b>+4,226 chips</b>.</p>""",
        """      <p class="prose"><b>Ask:</b> “Walk me through my pocket tens street-by-street — was the barrel on A-K too thin or was I supposed to charge?”</p>
      <p class="prose"><b>Grok:</b> Middle position T♠T♥. Raised preflop, got called. Flop A♥ 8♥ K♠ — you kept firing. Turn blank, more pressure. River: villain folds. <b>+4,226 chips</b>.</p>""",
    ),
]

for old, new in detail_reps:
    if old not in text:
        print("WARN detail block missing, skip")
        continue
    text = text.replace(old, new, 1)
    print("replaced detail ok")

p.write_text(text, encoding="utf-8")
print("OK", p)
print("bubble class count", text.count('class="bubble"'))
print("msg you count", text.count('msg you'))
