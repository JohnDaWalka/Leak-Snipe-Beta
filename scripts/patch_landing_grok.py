"""Inject Live with Grok homepage section into mcp-worker LANDING_HTML."""
from pathlib import Path

p = Path(__file__).resolve().parents[1] / "mcp-server" / "src" / "mcp-worker.js"
text = p.read_text(encoding="utf-8")
marker = "const LANDING_HTML = `"
start = text.find(marker)
if start < 0:
    raise SystemExit("LANDING_HTML not found")
hs = start + len(marker)
he = text.find("`;", start + 10)
html = text[hs:he]

if "Live with Grok" in html and "grok-card" in html:
    print("Already patched")
    raise SystemExit(0)

CSS = r"""
/* ---------- live with grok ---------- */
.grok-strip { margin-top: 0.5rem; }
.grok-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 1rem;
}
@media (max-width: 960px) {
  .grok-grid { grid-template-columns: 1fr; }
}
.grok-card {
  border: 1px solid var(--line);
  background: linear-gradient(165deg, var(--bg-raised) 0%, var(--scope-ink, var(--bg-raised)) 100%);
  padding: 1.25rem 1.2rem 1.35rem;
  position: relative;
  overflow: hidden;
}
.grok-card::before {
  content: "";
  position: absolute;
  inset: 0 auto 0 0;
  width: 2px;
  background: var(--accent);
  opacity: 0.85;
}
.grok-card.discipline::before { background: var(--data, #5eb1e0); }
.grok-card.pressure::before { background: var(--target, #c43c3c); }
.grok-card .ord {
  font-family: var(--font-mono);
  font-size: 0.66rem;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--text-faint);
  margin-bottom: 0.55rem;
}
.grok-card h3 {
  font-family: var(--font-body);
  font-size: 1.15rem;
  font-weight: 700;
  margin: 0 0 0.65rem;
  letter-spacing: -0.01em;
}
.grok-meta {
  font-family: var(--font-mono);
  font-size: 0.72rem;
  color: var(--data, #5eb1e0);
  margin-bottom: 0.75rem;
  letter-spacing: 0.02em;
}
.grok-dialogue {
  font-family: var(--font-mono);
  font-size: 0.78rem;
  line-height: 1.55;
  color: var(--text-dim);
  border-top: 1px solid var(--line);
  border-bottom: 1px solid var(--line);
  padding: 0.75rem 0;
  margin: 0 0 0.85rem;
}
.grok-dialogue .who {
  color: var(--text-faint);
  display: inline-block;
  min-width: 2.6rem;
}
.grok-dialogue .you .who { color: var(--data, #5eb1e0); }
.grok-dialogue .grok .who { color: var(--accent); }
.grok-dialogue p { margin: 0.2rem 0; }
.grok-result {
  font-family: var(--font-mono);
  font-size: 0.95rem;
  font-weight: 600;
  margin-bottom: 0.55rem;
}
.grok-result.neg { color: var(--text-dim); }
.grok-result.pos { color: var(--accent); }
.grok-take {
  font-size: 0.92rem;
  line-height: 1.45;
  color: var(--text);
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
  border: 1px solid var(--line);
  color: var(--text-faint);
  padding: 0.2rem 0.45rem;
}
.grok-hero-banner {
  border: 1px solid var(--line);
  background: var(--bg-raised);
  padding: 1.1rem 1.25rem;
  margin-bottom: 1.25rem;
  display: flex;
  flex-wrap: wrap;
  gap: 1rem 2rem;
  align-items: center;
  justify-content: space-between;
}
.grok-hero-banner .story {
  font-family: var(--font-mono);
  font-size: 0.78rem;
  color: var(--text-dim);
  letter-spacing: 0.04em;
}
.grok-hero-banner .story b { color: var(--accent); font-weight: 500; }
.grok-mcp {
  font-family: var(--font-mono);
  font-size: 0.72rem;
  color: var(--data, #5eb1e0);
  word-break: break-all;
}
.grok-mcp code {
  background: var(--scope-void, #070b08);
  border: 1px solid var(--line);
  padding: 0.35rem 0.55rem;
  color: var(--accent);
}
"""

OVERVIEW_SECTION = r"""
  <section id="grok" class="grok-strip">
    <div class="wrap">
      <div class="section-head">
        <div>
          <span class="eyebrow">Live with Grok</span>
          <h2>Aggressive when strong.<br>Gone when weak.</h2>
          <p class="prose">Real mid-session coaching against the LeakSnipe database — not vibes. Three consecutive hands from one MTT orbit: value, discipline, pressure.</p>
        </div>
        <button class="section-more" data-nav="grok">Full session →</button>
      </div>

      <div class="grok-hero-banner">
        <div class="story"><b>99</b> charge dry A-high → <b>32s</b> fold vs 3-bet → <b>TT</b> barrel wet A-K</div>
      </div>

      <div class="grok-grid">
        <article class="grok-card">
          <div class="ord">01 · Value</div>
          <h3>Pocket nines, one-and-done</h3>
          <div class="grok-meta">CO · 9♣ 9♦ · dry A♠ 7♦ 5♥</div>
          <div class="grok-dialogue">
            <p class="you"><span class="who">YOU</span> Hand before the tens?</p>
            <p class="grok"><span class="who">GROK</span> CO 99 — raised PF, fired the dry A-flop. Villain folds.</p>
          </div>
          <div class="grok-result pos">+2,528 chips · no showdown</div>
          <p class="grok-take">Overpair on a dry board: charge it. Clean aggression, not a free check-down.</p>
          <div class="grok-tags"><span>MTT</span><span>99</span><span>CO</span><span>c-bet</span></div>
        </article>

        <article class="grok-card discipline">
          <div class="ord">02 · Discipline</div>
          <h3>32s vs raise + 3-bet</h3>
          <div class="grok-meta">MP · 3♥ 2♠ · preflop fold</div>
          <div class="grok-dialogue">
            <p class="you"><span class="who">YOU</span> Most recent hand?</p>
            <p class="grok"><span class="who">GROK</span> Raise and 3-bet in front. 32s hits the muck. Correct.</p>
          </div>
          <div class="grok-result neg">−63 chips · stack preserved</div>
          <p class="grok-take">Weak suited connector doesn’t continue here. That’s mid-stack discipline, not scared money.</p>
          <div class="grok-tags"><span>MTT</span><span>32s</span><span>fold</span><span>3-bet pot</span></div>
        </article>

        <article class="grok-card pressure">
          <div class="ord">03 · Pressure</div>
          <h3>Pocket tens that didn’t freeze</h3>
          <div class="grok-meta">MP · T♠ T♥ · wet A♥ 8♥ K♠</div>
          <div class="grok-dialogue">
            <p class="you"><span class="who">YOU</span> Walk me through my tens hand.</p>
            <p class="grok"><span class="who">GROK</span> Fired flop, turned up on blank, river fold. Took it down.</p>
          </div>
          <div class="grok-result pos">+4,226 chips · no showdown</div>
          <p class="grok-take">Overpair on a scary A-K board — protection plus pressure. The better side of the game.</p>
          <div class="grok-tags"><span>MTT</span><span>TT</span><span>barrel</span><span>no SD</span></div>
        </article>
      </div>
    </div>
  </section>

"""

DETAIL_PANEL = r"""
<!-- ================= DETAIL: LIVE WITH GROK ================= -->
<section class="view detail-panel" id="view-grok" role="tabpanel" aria-labelledby="tab-grok" tabindex="-1" hidden>
  <div class="wrap">
    <button class="back-link" data-nav="overview">← Overview</button>
    <div class="detail-head">
      <span class="eyebrow">Field manual · Session tape</span>
      <h2>Three hands.<br>One coaching arc.</h2>
      <p class="prose">Pulled live from the LeakSnipe hand database during an MTT session. Grok reads streets, stacks, and results — then coaches like someone sitting next to you, not a generic chatbot.</p>
    </div>

    <div class="grok-hero-banner">
      <div class="story">Mid-session coaching against your own hand database — value, discipline, pressure.</div>
    </div>

    <div class="field-entry">
      <div class="field-entry-head"><h3>01 — Pocket nines (value)</h3></div>
      <p class="prose"><b>Ask:</b> “Show me the hand right before that.”</p>
      <p class="prose"><b>Grok:</b> Cutoff 9♣9♦. Raised preflop, one caller. Flop 7♦ A♠ 5♥ (dry). You raised again; villain folded. <b>+2,528 chips</b> without showdown.</p>
      <p class="prose"><b>Coach:</b> Standard open, well-timed barrel on a dry A-high board. Selective preflop + aggression with a real hand.</p>
    </div>

    <div class="field-entry">
      <div class="field-entry-head"><h3>02 — 32s (discipline)</h3></div>
      <p class="prose"><b>Ask:</b> “Most recent hand?”</p>
      <p class="prose"><b>Grok:</b> Middle position 3♥2♠. Raise and 3-bet in front. You fold. <b>−63 chips</b> (antes/blinds only). No board.</p>
      <p class="prose"><b>Coach:</b> Correct. Suited connectors that weak don’t continue vs raise + 3-bet. Exactly the fold that keeps a playable stack alive.</p>
    </div>

    <div class="field-entry">
      <div class="field-entry-head"><h3>03 — Pocket tens (pressure)</h3></div>
      <p class="prose"><b>Ask:</b> “Walk me through my pocket tens hand.”</p>
      <p class="prose"><b>Grok:</b> Middle position T♠T♥. Raised preflop, got called. Flop A♥ 8♥ K♠ — you kept firing. Turn blank, more pressure. River: villain folds. <b>+4,226 chips</b>.</p>
      <p class="prose"><b>Coach:</b> Solid aggressive line with an overpair on a dangerous board. Semi-bluff / protection, not free cards for draws.</p>
    </div>

    <div class="field-entry">
      <div class="field-entry-head"><h3>Why this matters</h3></div>
      <p class="prose">Same orbit: print value when ahead, dump trash without drama, apply pressure when the board gets scary. The coach isn’t guessing — it’s querying <em>your</em> hands, times, and results through the LeakSnipe MCP.</p>
      <p class="prose">Units stay honest: these are <b>tournament chips</b>, not dollars. Cash and MTT never get mixed in the instrument.</p>
    </div>
  </div>
</section>

"""

# 1) CSS
needle_css = "/* ---------- footer ---------- */"
if needle_css not in html:
    raise SystemExit("css anchor missing")
html = html.replace(needle_css, CSS + "\n" + needle_css, 1)

# 2) Tab
old_tabs = """      <button class="tab-btn" role="tab" id="tab-leaks" aria-controls="view-leaks" aria-selected="false" data-nav="leaks">Leak Detection</button>
    </div>"""
new_tabs = """      <button class="tab-btn" role="tab" id="tab-leaks" aria-controls="view-leaks" aria-selected="false" data-nav="leaks">Leak Detection</button>
      <button class="tab-btn" role="tab" id="tab-grok" aria-controls="view-grok" aria-selected="false" data-nav="grok">Live with Grok</button>
    </div>"""
if old_tabs not in html:
    raise SystemExit("tabs anchor missing")
html = html.replace(old_tabs, new_tabs, 1)

# 3) Hero CTA
old_cta = """          <button class="btn" data-nav="loop">See how it works →</button>
          <button class="btn ghost" data-nav="architecture">Read the architecture</button>"""
new_cta = """          <button class="btn" data-nav="grok">Live with Grok →</button>
          <button class="btn ghost" data-nav="loop">See how it works</button>"""
if old_cta not in html:
    raise SystemExit("cta anchor missing")
html = html.replace(old_cta, new_cta, 1)

# 4) Overview + detail panel
old_foot = """  <footer>
    <div class="wrap">
      <span class="foot-line">LEAKSNIPE.WIN — a local-first poker study workstation</span>
      <span class="foot-loop"><b>Track</b> → <b>Find</b> → <b>Review</b> → <b>Study</b> → <b>Improve</b></span>
    </div>
  </footer>
</div>

<!-- ================= DETAIL: THE LOOP ================= -->"""
new_foot = (
    OVERVIEW_SECTION
    + """  <footer>
    <div class="wrap">
      <span class="foot-line">LEAKSNIPE.WIN — a local-first poker study workstation</span>
      <span class="foot-loop"><b>Track</b> → <b>Find</b> → <b>Review</b> → <b>Study</b> → <b>Improve</b> · <b>Ask Grok</b></span>
    </div>
  </footer>
</div>

"""
    + DETAIL_PANEL
    + """<!-- ================= DETAIL: THE LOOP ================= -->"""
)
if old_foot not in html:
    raise SystemExit("footer anchor missing")
html = html.replace(old_foot, new_foot, 1)

# 5) navTargets
old_nav = "var navTargets = ['overview', 'loop', 'intelligence', 'architecture', 'leaks'];"
new_nav = "var navTargets = ['overview', 'loop', 'intelligence', 'architecture', 'leaks', 'grok'];"
if old_nav not in html:
    raise SystemExit("navTargets missing")
html = html.replace(old_nav, new_nav, 1)

text = text[:hs] + html + text[he:]
p.write_text(text, encoding="utf-8")
print("OK patched", p)
print("Live with Grok present:", "Live with Grok" in html)
print("tab-grok present:", "tab-grok" in html)
print("nav has grok:", new_nav in text)
