"""Replace view-grok detail panel with multi-turn xAI chat cards (what the tab actually shows)."""
from pathlib import Path

p = Path(__file__).resolve().parents[1] / "mcp-server" / "src" / "mcp-worker.js"
t = p.read_text(encoding="utf-8")

start = t.find('id="view-grok"')
if start < 0:
    raise SystemExit("view-grok not found")
# include from <section ... id="view-grok"
sec = t.rfind("<section", 0, start + 1)
end_marker = "<!-- ================= DETAIL: THE LOOP ================= -->"
end = t.find(end_marker, start)
if sec < 0 or end < 0:
    raise SystemExit(f"bounds bad sec={sec} end={end}")

NEW_PANEL = r'''<!-- ================= DETAIL: LIVE WITH GROK ================= -->
<section class="view detail-panel" id="view-grok" role="tabpanel" aria-labelledby="tab-grok" tabindex="-1" hidden>
  <div class="wrap">
    <button class="back-link" data-nav="overview">← Overview</button>
    <div class="detail-head">
      <span class="eyebrow">Live session · Grok × LeakSnipe</span>
      <h2>Aggressive when strong.<br>Gone when weak.</h2>
      <p class="prose">Real mid-session coaching from the hand database. Four-bubble chats — not marketing lorem. Same MTT orbit: value → discipline → pressure.</p>
    </div>

    <div class="grok-hero-banner">
      <div class="story"><b>99</b> charge dry A-high → <b>32s</b> fold vs 3-bet → <b>TT</b> barrel wet A-K</div>
    </div>

    <div class="grok-grid grok-grid-detail">
      <article class="grok-card">
        <div class="ord">01 · Value</div>
        <h3>Pocket nines, one-and-done</h3>
        <div class="grok-meta">CO · 9♣ 9♦ · dry A♠ 7♦ 5♥</div>
        <div class="grok-dialogue" role="log" aria-label="Chat excerpt">
          <div class="msg you">
            <span class="who">You</span>
            <p class="bubble">Pull the hand right before my pocket tens — full streets, not a one-liner. Was I too passive or did I print?</p>
          </div>
          <div class="msg grok">
            <span class="who">Grok</span>
            <p class="bubble">CO · 9♣9♦. You open to 1,400, one caller. Flop comes dry A♠7♦5♥. You fire 2,634… they fold. +2,528 chips, no showdown.</p>
          </div>
          <div class="msg you">
            <span class="who">You</span>
            <p class="bubble">Is charging A-high with nines spewy or standard there?</p>
          </div>
          <div class="msg grok">
            <span class="who">Grok</span>
            <p class="bubble">Standard when the board is dry and you have an overpair. You're not "bluffing the ace" — you're denying equity and taking it down. Clean value line.</p>
          </div>
        </div>
        <div class="grok-result pos">+2,528 chips · no showdown</div>
        <p class="grok-take">Overpair on a dry board: charge it. Clean aggression, not a free check-down.</p>
        <div class="grok-tags"><span>MTT</span><span>99</span><span>CO</span><span>c-bet</span></div>
      </article>

      <article class="grok-card discipline">
        <div class="ord">02 · Discipline</div>
        <h3>32s vs raise + 3-bet</h3>
        <div class="grok-meta">MP · 3♥ 2♠ · preflop fold</div>
        <div class="grok-dialogue" role="log" aria-label="Chat excerpt">
          <div class="msg you">
            <span class="who">You</span>
            <p class="bubble">What was my most recent hand live from the DB? Don't sugarcoat it — fold or hero call?</p>
          </div>
          <div class="msg grok">
            <span class="who">Grok</span>
            <p class="bubble">MP · 3♥2♠. Raise to 250, then a 3-bet to 500 in front. You muck. −63 chips. No flop. Correct fold.</p>
          </div>
          <div class="msg you">
            <span class="who">You</span>
            <p class="bubble">Even suited? People love defending 32s "for the multiway."</p>
          </div>
          <div class="msg grok">
            <span class="who">Grok</span>
            <p class="bubble">Suited doesn't print when you're squished by open + 3-bet. That's not scared money — that's stack-preserving discipline. Stay ready for the next orbit.</p>
          </div>
        </div>
        <div class="grok-result neg">−63 chips · stack preserved</div>
        <p class="grok-take">Weak suited connector doesn't continue here. Mid-stack discipline between aggressive pots.</p>
        <div class="grok-tags"><span>MTT</span><span>32s</span><span>fold</span><span>3-bet pot</span></div>
      </article>

      <article class="grok-card pressure">
        <div class="ord">03 · Pressure</div>
        <h3>Pocket tens that didn't freeze</h3>
        <div class="grok-meta">MP · T♠ T♥ · wet A♥ 8♥ K♠</div>
        <div class="grok-dialogue" role="log" aria-label="Chat excerpt">
          <div class="msg you">
            <span class="who">You</span>
            <p class="bubble">Walk me through my pocket tens street-by-street — was the barrel on A-K too thin or was I supposed to charge?</p>
          </div>
          <div class="msg grok">
            <span class="who">Grok</span>
            <p class="bubble">MP · T♠T♥. You open 1,680, one call. Flop A♥8♥K♠ — wet and scary. You keep firing. Turn 2♠ blank: more heat. River J♠, they fold. +4,226.</p>
          </div>
          <div class="msg you">
            <span class="who">You</span>
            <p class="bubble">Feels like I could be dead to any ace… why is that good?</p>
          </div>
          <div class="msg grok">
            <span class="who">Grok</span>
            <p class="bubble">Because passive tens die slowly. You charged the draw, applied pressure on the blank, and won without showdown. Overpair on a scare board — protection plus fold equity. The better side of your game.</p>
          </div>
        </div>
        <div class="grok-result pos">+4,226 chips · no showdown</div>
        <p class="grok-take">Overpair on a scare board — protection plus pressure. The better side of the game.</p>
        <div class="grok-tags"><span>MTT</span><span>TT</span><span>barrel</span><span>no SD</span></div>
      </article>
    </div>

    <div class="field-entry" style="margin-top:2rem">
      <div class="field-entry-head"><h3>Why this matters</h3></div>
      <p class="prose">Same orbit: print value when ahead, dump trash without drama, apply pressure when the board gets scary. The coach isn't guessing — it's querying your hands, times, and results.</p>
      <p class="prose">Units stay honest: these are <b>tournament chips</b>, not dollars. Cash and MTT never get mixed in the instrument.</p>
    </div>
  </div>
</section>

'''

t = t[:sec] + NEW_PANEL + t[end:]

# CSS: detail grid stays 3-col but allow taller chats; kill overflow clip on cards
old_card = """.grok-card {
  border: 1px solid rgba(255, 255, 255, 0.08);
  background:
    radial-gradient(120% 80% at 0% 0%, rgba(120, 90, 255, 0.12), transparent 55%),
    radial-gradient(100% 70% at 100% 100%, rgba(0, 255, 163, 0.06), transparent 50%),
    linear-gradient(165deg, #12141a 0%, #0a0b0f 100%);
  padding: 1.3rem 1.2rem 1.4rem;
  position: relative;
  overflow: hidden;
  border-radius: 14px;"""

new_card = """.grok-card {
  border: 1px solid rgba(255, 255, 255, 0.08);
  background:
    radial-gradient(120% 80% at 0% 0%, rgba(120, 90, 255, 0.12), transparent 55%),
    radial-gradient(100% 70% at 100% 100%, rgba(0, 255, 163, 0.06), transparent 50%),
    linear-gradient(165deg, #12141a 0%, #0a0b0f 100%);
  padding: 1.3rem 1.2rem 1.4rem;
  position: relative;
  overflow: visible;
  border-radius: 14px;"""

if old_card in t:
    t = t.replace(old_card, new_card, 1)
    print("overflow visible")
else:
    print("WARN card css not exact match")

# Extra CSS for detail layout
css_anchor = "/* ---------- footer ---------- */"
extra = """
.grok-grid-detail {
  margin-top: 0.5rem;
}
@media (max-width: 1100px) {
  .grok-grid-detail { grid-template-columns: 1fr; }
}
.detail-panel .grok-dialogue {
  min-height: 14rem;
}
.detail-panel .grok-card {
  box-shadow:
    0 0 0 1px rgba(255, 255, 255, 0.04) inset,
    0 24px 50px rgba(0, 0, 0, 0.55),
    0 0 60px rgba(155, 135, 255, 0.08);
}
"""
if css_anchor in t and "grok-grid-detail" not in t:
    t = t.replace(css_anchor, extra + "\n" + css_anchor, 1)
    print("detail css added")

p.write_text(t, encoding="utf-8")
print("bubbles", t.count('class="bubble"'))
print("view-grok has multiway", "multiway" in t[t.find('id="view-grok"') : t.find('id="view-grok"') + 8000])
print("OK", p)
