"""Bump fonts + styling intensity page-wide (reticle amber/green preserved)."""
from pathlib import Path

p = Path(__file__).resolve().parents[1] / "mcp-server" / "src" / "mcp-worker.js"
t = p.read_text(encoding="utf-8")

swaps = [
    # body base
    (
        """  font-family: var(--font-body);
  font-weight: 400;
  font-size: 17px;
  line-height: 1.65;
  letter-spacing: 0.01em;""",
        """  font-family: var(--font-body);
  font-weight: 400;
  font-size: 18.5px;
  line-height: 1.68;
  letter-spacing: 0.005em;""",
    ),
    # headings weight/letter
    (
        """h1, h2, h3, h4 {
  font-family: var(--font-display);
  font-weight: 600;
  text-transform: none;
  letter-spacing: -0.03em;
  text-wrap: balance;
  margin: 0;
  color: var(--text);
  text-shadow: var(--heading-shadow);
}
h1 {
  font-weight: 700;
  letter-spacing: -0.04em;
}
h2 {
  font-weight: 650;
  letter-spacing: -0.035em;
  text-shadow: var(--h2-glow);
}
h3 {
  font-weight: 600;
  letter-spacing: -0.02em;
  font-size: 1.15rem;
}""",
        """h1, h2, h3, h4 {
  font-family: var(--font-display);
  font-weight: 650;
  text-transform: none;
  letter-spacing: -0.035em;
  text-wrap: balance;
  margin: 0;
  color: var(--text);
  text-shadow: var(--heading-shadow);
}
h1 {
  font-weight: 700;
  letter-spacing: -0.045em;
}
h2 {
  font-weight: 700;
  letter-spacing: -0.04em;
  text-shadow: var(--h2-glow);
}
h3 {
  font-weight: 650;
  letter-spacing: -0.025em;
  font-size: 1.28rem;
}""",
    ),
    # eyebrow bigger
    (
        """.eyebrow {
  font-family: var(--font-mono);
  font-size: 0.7rem;
  font-weight: 500;
  letter-spacing: 0.18em;""",
        """.eyebrow {
  font-family: var(--font-mono);
  font-size: 0.78rem;
  font-weight: 600;
  letter-spacing: 0.16em;""",
    ),
    # prose bigger
    (
        """.prose {
  max-width: 40em;
  color: var(--text-dim);
  font-size: 1.02rem;
  line-height: 1.7;
  font-weight: 400;
}""",
        """.prose {
  max-width: 42em;
  color: var(--text-dim);
  font-size: 1.12rem;
  line-height: 1.72;
  font-weight: 400;
}""",
    ),
    # tabs
    (
        """.tabs {
  display: flex;
  gap: clamp(1.1rem, 2.4vw, 1.9rem);
  font-family: var(--font-mono);
  font-size: 0.78rem;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  height: 100%;
}
.tab-btn {
  background: none;
  border: none;
  cursor: pointer;
  color: var(--text-dim);
  position: relative;
  padding: 0 0.1rem;
  transition: color 0.15s;
  white-space: nowrap;
}""",
        """.tabs {
  display: flex;
  gap: clamp(1.15rem, 2.5vw, 2rem);
  font-family: var(--font-mono);
  font-size: 0.86rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  height: 100%;
}
.tab-btn {
  background: none;
  border: none;
  cursor: pointer;
  color: var(--text-dim);
  position: relative;
  padding: 0 0.15rem;
  transition: color 0.15s, text-shadow 0.15s;
  white-space: nowrap;
  font-weight: 500;
}""",
    ),
    # brand
    (
        """.brand {
  font-family: var(--font-mono);
  font-weight: 500;
  font-size: 0.95rem;
  letter-spacing: 0.02em;""",
        """.brand {
  font-family: var(--font-mono);
  font-weight: 600;
  font-size: 1.05rem;
  letter-spacing: 0.12em;""",
    ),
    # hero h1
    (
        """.hero h1 {
  font-size: clamp(2.7rem, 6.4vw, 4.85rem);
  line-height: 0.96;
  margin: 0.6rem 0 1.35rem;
}""",
        """.hero h1 {
  font-size: clamp(3.1rem, 7.2vw, 5.6rem);
  line-height: 0.94;
  margin: 0.75rem 0 1.5rem;
}""",
    ),
    # hero prose if any - section heads
    (
        """.section-head h2 {
  font-size: clamp(2rem, 4.2vw, 3.1rem);
  margin-top: 0.65rem;
  line-height: 1.05;
  letter-spacing: -0.035em;
  max-width: 14ch;
}
.section-head .prose {
  max-width: 32em;
  font-size: 1.05rem;
  color: var(--text-dim);
}
.section-more {
  font-family: var(--font-mono);
  font-size: 0.72rem;
  font-weight: 500;
  letter-spacing: 0.12em;""",
        """.section-head h2 {
  font-size: clamp(2.35rem, 4.8vw, 3.55rem);
  margin-top: 0.75rem;
  line-height: 1.04;
  letter-spacing: -0.04em;
  max-width: 15ch;
}
.section-head .prose {
  max-width: 34em;
  font-size: 1.14rem;
  color: var(--text-dim);
  line-height: 1.7;
}
.section-more {
  font-family: var(--font-mono);
  font-size: 0.8rem;
  font-weight: 600;
  letter-spacing: 0.12em;""",
    ),
    # buttons larger
    (
        """  font-size: 0.78rem;
  font-weight: 600;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  text-decoration: none;
  padding: 0.9rem 1.45rem;""",
        """  font-size: 0.86rem;
  font-weight: 600;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  text-decoration: none;
  padding: 1.05rem 1.65rem;""",
    ),
    # loop step
    (
        """.loop-step .num {
  font-family: var(--font-mono);
  font-size: 0.7rem;
  font-weight: 600;
  letter-spacing: 0.14em;
  color: var(--accent);
  text-shadow: var(--glow-text-accent);
}
.loop-step h3 {
  font-family: var(--font-display);
  font-weight: 650;
  font-size: 1.35rem;
  letter-spacing: -0.025em;
  text-transform: none;
  color: var(--text);
}
.loop-step p {
  color: var(--text-dim);
  font-size: 0.94rem;
  line-height: 1.55;
  font-weight: 400;
}""",
        """.loop-step .num {
  font-family: var(--font-mono);
  font-size: 0.78rem;
  font-weight: 600;
  letter-spacing: 0.14em;
  color: var(--accent);
  text-shadow: var(--glow-text-accent);
}
.loop-step h3 {
  font-family: var(--font-display);
  font-weight: 700;
  font-size: 1.55rem;
  letter-spacing: -0.03em;
  text-transform: none;
  color: var(--text);
}
.loop-step p {
  color: var(--text-dim);
  font-size: 1.02rem;
  line-height: 1.6;
  font-weight: 400;
}""",
    ),
    # detail head
    (
        """.detail-head h2 {
  font-size: clamp(2.4rem, 5.5vw, 3.75rem);
  margin: 0.75rem 0 1.15rem;
  letter-spacing: -0.04em;
  line-height: 1.02;
}
.detail-head .prose {
  font-size: 1.08rem;
  max-width: 44em;
  line-height: 1.7;
  color: var(--text-dim);
}""",
        """.detail-head h2 {
  font-size: clamp(2.75rem, 6vw, 4.25rem);
  margin: 0.85rem 0 1.25rem;
  letter-spacing: -0.045em;
  line-height: 1.0;
}
.detail-head .prose {
  font-size: 1.18rem;
  max-width: 44em;
  line-height: 1.72;
  color: var(--text-dim);
}""",
    ),
    # field entries
    (
        """.field-entry-head h3 {
  font-family: var(--font-display);
  font-weight: 650;
  text-transform: none;
  letter-spacing: -0.02em;
  font-size: 1.28rem;
  color: var(--text);
}
.field-entry .prose {
  font-size: 1rem;
  line-height: 1.65;
  color: var(--text-dim);
}""",
        """.field-entry-head h3 {
  font-family: var(--font-display);
  font-weight: 700;
  text-transform: none;
  letter-spacing: -0.025em;
  font-size: 1.42rem;
  color: var(--text);
}
.field-entry .prose {
  font-size: 1.08rem;
  line-height: 1.7;
  color: var(--text-dim);
}""",
    ),
    # grok card type
    (
        """.grok-card h3 {
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
  color: #f5aa52;
  margin-bottom: 0.9rem;
  letter-spacing: 0.02em;
}""",
        """.grok-card h3 {
  font-family: var(--font-display);
  font-size: 1.35rem;
  font-weight: 700;
  margin: 0 0 0.6rem;
  letter-spacing: -0.025em;
  color: #f4efe4;
  text-shadow: 0 2px 10px rgba(0,0,0,0.4);
}
.grok-meta {
  font-family: var(--font-mono);
  font-size: 0.82rem;
  font-weight: 500;
  color: #f5aa52;
  margin-bottom: 1rem;
  letter-spacing: 0.04em;
  text-shadow: 0 0 14px rgba(232, 145, 47, 0.35);
}""",
    ),
    (
        """.grok-dialogue {
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
  margin: 0 0 1rem;""",
        """.grok-dialogue {
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
  font-family: var(--font-mono);
  font-size: 0.88rem;
  line-height: 1.6;
  color: rgba(236, 229, 212, 0.78);
  border: 1px solid rgba(232, 145, 47, 0.14);
  border-radius: 14px;
  padding: 1rem 0.95rem;
  margin: 0 0 1.1rem;""",
    ),
    (
        """.bubble {
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
}""",
        """.bubble {
  margin: 0;
  padding: 0.9rem 1.05rem;
  border-radius: 14px;
  line-height: 1.58;
  font-size: 0.92rem;
  font-weight: 450;
  white-space: pre-wrap;
  word-break: break-word;
  box-shadow:
    0 12px 28px rgba(0, 0, 0, 0.5),
    0 3px 8px rgba(0, 0, 0, 0.35),
    0 0 20px rgba(232, 145, 47, 0.06);
}""",
    ),
    (
        """.grok-result {
  font-family: var(--font-mono);
  font-size: 0.95rem;
  font-weight: 600;
  margin-bottom: 0.55rem;
}""",
        """.grok-result {
  font-family: var(--font-mono);
  font-size: 1.08rem;
  font-weight: 600;
  margin-bottom: 0.65rem;
  letter-spacing: 0.02em;
}""",
    ),
    (
        """.grok-take {
  font-size: 0.92rem;
  line-height: 1.45;
  color: rgba(255, 255, 255, 0.82);
  margin: 0;
}""",
        """.grok-take {
  font-size: 1.05rem;
  line-height: 1.55;
  color: rgba(236, 229, 212, 0.88);
  margin: 0;
  font-weight: 450;
}""",
    ),
    (
        """.grok-card .ord {
  font-family: var(--font-mono);
  font-size: 0.66rem;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: rgba(255, 255, 255, 0.4);
  margin-bottom: 0.55rem;
}""",
        """.grok-card .ord {
  font-family: var(--font-mono);
  font-size: 0.74rem;
  font-weight: 600;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: rgba(232, 145, 47, 0.75);
  margin-bottom: 0.6rem;
  text-shadow: 0 0 12px rgba(232, 145, 47, 0.25);
}""",
    ),
    # topbar taller for bigger brand/tabs
    (
        """  height: 3.6rem;
}
.brand {""",
        """  height: 4rem;
}
.brand {""",
    ),
    # table text
    (
        """  min-width: 640px;
  font-size: 0.9rem;
}""",
        """  min-width: 640px;
  font-size: 0.98rem;
}""",
    ),
    (
        """.leak-table thead th {
  font-family: var(--font-mono);
  font-size: 0.66rem;
  letter-spacing: 0.12em;""",
        """.leak-table thead th {
  font-family: var(--font-mono);
  font-size: 0.74rem;
  letter-spacing: 0.12em;""",
    ),
    # terminal
    (
        """  font-size: 0.84rem;
  line-height: 1.7;
  color: rgba(242, 240, 245, 0.78);""",
        """  font-size: 0.94rem;
  line-height: 1.75;
  color: rgba(236, 229, 212, 0.82);""",
    ),
    # feature items
    (
        """.feature-item h3, .feature-item h4 {
  font-family: var(--font-display);
  font-weight: 650;
  text-transform: none;
  font-size: 1.08rem;
  letter-spacing: -0.02em;
  margin-bottom: 0.3rem;
  color: var(--text);
}
.feature-item p { color: var(--text-dim); font-size: 0.95rem; line-height: 1.55; }""",
        """.feature-item h3, .feature-item h4 {
  font-family: var(--font-display);
  font-weight: 700;
  text-transform: none;
  font-size: 1.2rem;
  letter-spacing: -0.025em;
  margin-bottom: 0.35rem;
  color: var(--text);
}
.feature-item p { color: var(--text-dim); font-size: 1.04rem; line-height: 1.6; }""",
    ),
    # footer
    (
        """footer .foot-line {
  font-family: var(--font-mono);
  font-size: 0.7rem;
  font-weight: 500;
  color: var(--text-faint);
  letter-spacing: 0.1em;
  text-transform: uppercase;
}
footer .foot-loop {
  font-family: var(--font-mono);
  font-size: 0.72rem;
  color: var(--text-dim);
  letter-spacing: 0.04em;
}""",
        """footer .foot-line {
  font-family: var(--font-mono);
  font-size: 0.78rem;
  font-weight: 600;
  color: var(--text-faint);
  letter-spacing: 0.12em;
  text-transform: uppercase;
}
footer .foot-loop {
  font-family: var(--font-mono);
  font-size: 0.8rem;
  color: var(--text-dim);
  letter-spacing: 0.05em;
}""",
    ),
]

ok = 0
for a, b in swaps:
    if a not in t:
        print("SKIP", a[:50].replace("\n", " "))
        continue
    t = t.replace(a, b, 1)
    ok += 1
    print("OK", ok)

# intensify glows slightly in :root
t = t.replace(
    "--glow-accent: 0 0 16px rgba(232, 145, 47, 0.4), 0 0 32px rgba(232, 145, 47, 0.15);",
    "--glow-accent: 0 0 20px rgba(232, 145, 47, 0.5), 0 0 42px rgba(232, 145, 47, 0.2), 0 0 28px rgba(69, 222, 133, 0.1);",
)
t = t.replace(
    "--h2-glow: 0 0 22px rgba(232, 145, 47, 0.45), 0 0 40px rgba(69, 222, 133, 0.12), 0 2px 6px rgba(0, 0, 0, 0.4);",
    "--h2-glow: 0 0 28px rgba(232, 145, 47, 0.55), 0 0 48px rgba(69, 222, 133, 0.16), 0 2px 8px rgba(0, 0, 0, 0.45);",
)

# wrap max width a bit roomier for bigger type
t = t.replace(
    """.wrap {
  max-width: 74rem;
  margin: 0 auto;
  padding: 0 clamp(1.25rem, 4vw, 3rem);
}""",
    """.wrap {
  max-width: 78rem;
  margin: 0 auto;
  padding: 0 clamp(1.35rem, 4.2vw, 3.25rem);
}""",
)

for a in ["build 0720r", "build 0720g", "build 0720f", "build 0720e"]:
    if a in t:
        t = t.replace(a, "build 0720t")
print("stamp 0720t")

p.write_text(t, encoding="utf-8")
print(f"applied {ok}/{len(swaps)}")
