"""Expand Live with Grok dialogues to multi-turn (4 bubbles each)."""
from pathlib import Path

p = Path(__file__).resolve().parents[1] / "mcp-server" / "src" / "mcp-worker.js"
text = p.read_text(encoding="utf-8")

NEW_BLOCKS = [
    """<div class="grok-dialogue" role="log" aria-label="Chat excerpt">
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
          </div>""",
    """<div class="grok-dialogue" role="log" aria-label="Chat excerpt">
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
          </div>""",
    """<div class="grok-dialogue" role="log" aria-label="Chat excerpt">
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
          </div>""",
]


def find_spans(s: str) -> list[tuple[int, int]]:
    spans = []
    pos = 0
    start_token = '<div class="grok-dialogue"'
    while len(spans) < 3:
        a = s.find(start_token, pos)
        if a < 0:
            break
        # result marker may have extra classes: class="grok-result pos"
        res = s.find('class="grok-result', a)
        if res < 0:
            break
        # walk back to start of that div
        div_start = s.rfind("<div", a, res + 1)
        end = div_start
        while end > a and s[end - 1] in " \t\n\r":
            end -= 1
        spans.append((a, end))
        pos = res + 1
    return spans


spans = find_spans(text)
print("spans", [(a, b, b - a) for a, b in spans])
if len(spans) != 3:
    raise SystemExit(f"need 3 spans, got {len(spans)}")

for (a, b), new in zip(reversed(spans), reversed(NEW_BLOCKS)):
    text = text[:a] + new + text[b:]
    print("replaced", a)

# Detail panel follow-up lines
subs = [
    (
        "Pull the hand right before my pocket tens — full streets, not a one-liner. Was I too passive or did I print?",
        "Pull the hand before my tens — full streets. Print? → Is charging A-high with 99 spewy?",
    ),
    (
        "What was my most recent hand live from the DB? Don't sugarcoat it — fold or hero call?",
        "Most recent hand — fold or hero call? → Even suited?",
    ),
    (
        "What was my most recent hand live from the DB? Don’t sugarcoat it — fold or hero call?",
        "Most recent hand — fold or hero call? → Even suited?",
    ),
    (
        "Walk me through my pocket tens street-by-street — was the barrel on A-K too thin or was I supposed to charge?",
        "Tens street-by-street — barrel thin? → Why good if dead to aces?",
    ),
]
for old, new in subs:
    if old in text:
        text = text.replace(old, new, 1)
        print("detail sub ok")

p.write_text(text, encoding="utf-8")
print("bubble count", text.count('class="bubble"'))
print("spewy", "spewy" in text)
print("die slowly", "die slowly" in text)
print("OK")
