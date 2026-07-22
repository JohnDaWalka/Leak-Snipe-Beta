"""Fix multi-turn prompts + force no-cache homepage + redeploy helper checks."""
from pathlib import Path

p = Path(__file__).resolve().parents[1] / "mcp-server" / "src" / "mcp-worker.js"
t = p.read_text(encoding="utf-8")

# Full multi-turn blocks (replace any existing dialogue containers before grok-result)
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
        res = s.find('class="grok-result', a)
        if res < 0:
            break
        div_start = s.rfind("<div", a, res + 1)
        end = div_start
        while end > a and s[end - 1] in " \t\n\r":
            end -= 1
        spans.append((a, end))
        pos = res + 1
    return spans


spans = find_spans(t)
print("spans", len(spans), [(a, b - a) for a, b in spans])
if len(spans) != 3:
    raise SystemExit("expected 3 dialogue spans")

for (a, b), new in zip(reversed(spans), reversed(NEW_BLOCKS)):
    t = t[:a] + new + t[b:]
    print("rewrote dialogue", a)

# Cache-Control on homepage
old_resp = "return new Response(LANDING_HTML, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } });"
new_resp = (
    "return new Response(LANDING_HTML, { status: 200, headers: { "
    "'Content-Type': 'text/html; charset=utf-8', "
    "'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0', "
    "'CDN-Cache-Control': 'no-store', "
    "'Cloudflare-CDN-Cache-Control': 'no-store' "
    "} });"
)
if old_resp in t:
    t = t.replace(old_resp, new_resp, 1)
    print("cache headers added")
elif "CDN-Cache-Control" in t and "LANDING_HTML" in t:
    print("cache headers already present")
else:
    i = t.find("return new Response(LANDING_HTML")
    print("response snippet:", repr(t[i : i + 220]) if i >= 0 else "NOT FOUND")

p.write_text(t, encoding="utf-8")
print("bubbles", t.count('class="bubble"'))
print("spewy", "spewy" in t)
print("die slowly", "die slowly" in t)
print("multiway", "multiway" in t)
print("OK wrote", p)
