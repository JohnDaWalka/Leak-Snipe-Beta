"""Continue page-wide styling: cards, tables, sections, detail panels, footer."""
from pathlib import Path

p = Path(__file__).resolve().parents[1] / "mcp-server" / "src" / "mcp-worker.js"
t = p.read_text(encoding="utf-8")

REPLACEMENTS = [
    (
        """.section-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-end;
  gap: 2rem;
  margin-bottom: clamp(2rem, 4vw, 3rem);
  flex-wrap: wrap;
}
.section-head h2 { font-size: clamp(2rem, 4vw, 3rem); margin-top: 0.5rem; }
.section-head .prose { max-width: 30em; }
.section-more {
  font-family: var(--font-mono);
  font-size: 0.76rem;
  letter-spacing: 0.03em;
  text-transform: uppercase;
  color: var(--data);
  background: none;
  border: none;
  cursor: pointer;
  white-space: nowrap;
  padding: 0.3rem 0;
}""",
        """.section-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-end;
  gap: 2rem;
  margin-bottom: clamp(2rem, 4vw, 3rem);
  flex-wrap: wrap;
}
.section-head h2 {
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
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--violet-strong, #c4b5ff);
  background: rgba(155, 135, 255, 0.08);
  border: 1px solid rgba(155, 135, 255, 0.28);
  border-radius: 999px;
  cursor: pointer;
  white-space: nowrap;
  padding: 0.55rem 0.95rem;
  box-shadow: 0 0 18px rgba(155, 135, 255, 0.1);
  transition: border-color 0.15s, color 0.15s, background 0.15s;
}""",
    ),
    (
        """.loop-grid {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 1px;
  background: var(--line);
  border: 1px solid var(--line);
}
@media (max-width: 900px) {
  .loop-grid { grid-template-columns: repeat(2, 1fr); }
}
@media (max-width: 520px) {
  .loop-grid { grid-template-columns: 1fr; }
}
.loop-step {
  background: var(--bg);
  padding: 1.6rem 1.4rem;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}
.loop-step .num {
  font-family: var(--font-mono);
  font-size: 0.75rem;
  color: var(--accent);
}
.loop-step h3 {
  font-family: var(--font-display);
  font-weight: 600;
  font-size: 1.5rem;
  letter-spacing: 0.015em;
}
.loop-step p { color: var(--text-dim); font-size: 0.92rem; line-height: 1.5; }""",
        """.loop-grid {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 0.75rem;
  background: transparent;
  border: none;
}
@media (max-width: 900px) {
  .loop-grid { grid-template-columns: repeat(2, 1fr); }
}
@media (max-width: 520px) {
  .loop-grid { grid-template-columns: 1fr; }
}
.loop-step {
  background:
    linear-gradient(165deg, rgba(155, 135, 255, 0.07), transparent 42%),
    var(--bg-raised);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 14px;
  padding: 1.55rem 1.35rem 1.65rem;
  display: flex;
  flex-direction: column;
  gap: 0.7rem;
  box-shadow: 0 14px 32px rgba(0, 0, 0, 0.35);
  transition: border-color 0.15s, transform 0.15s, box-shadow 0.15s;
}
.loop-step:hover {
  border-color: rgba(0, 255, 163, 0.25);
  transform: translateY(-2px);
  box-shadow: 0 18px 40px rgba(0, 0, 0, 0.4), 0 0 24px rgba(0, 255, 163, 0.06);
}
.loop-step .num {
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
    ),
    (
        """.pill {
  display: inline-flex;
  align-items: center;
  gap: 0.4em;
  font-family: var(--font-mono);
  font-size: 0.68rem;
  padding: 0.18rem 0.5rem;
  border: 1px solid var(--alert);
  color: var(--alert);
  background: var(--alert-soft);
  box-shadow: var(--glow-alert);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}""",
        """.pill {
  display: inline-flex;
  align-items: center;
  gap: 0.4em;
  font-family: var(--font-mono);
  font-size: 0.66rem;
  font-weight: 600;
  padding: 0.22rem 0.55rem;
  border: 1px solid rgba(255, 92, 108, 0.45);
  color: var(--alert-strong);
  background: var(--alert-soft);
  box-shadow: var(--glow-alert);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  border-radius: 999px;
}""",
    ),
    (
        """table {
  width: 100%;
  border-collapse: collapse;
  min-width: 640px;
  font-size: 0.88rem;
}
.leak-table th, .leak-table td {
  padding: 0.75rem 1rem;
  text-align: left;
  border-bottom: 1px solid var(--line);
}
.leak-table thead th {
  font-family: var(--font-mono);
  font-size: 0.68rem;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--text-faint);
  font-weight: 400;
  background: var(--bg-raised);
}
.leak-table td.pos { font-family: var(--font-mono); color: var(--text-dim); }""",
        """table {
  width: 100%;
  border-collapse: separate;
  border-spacing: 0;
  min-width: 640px;
  font-size: 0.9rem;
}
.leak-table {
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 14px;
  overflow: hidden;
  box-shadow: 0 16px 40px rgba(0, 0, 0, 0.35);
}
.leak-table th, .leak-table td {
  padding: 0.85rem 1.05rem;
  text-align: left;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}
.leak-table tbody tr:last-child td { border-bottom: none; }
.leak-table tbody tr:hover td {
  background: rgba(155, 135, 255, 0.05);
}
.leak-table thead th {
  font-family: var(--font-mono);
  font-size: 0.66rem;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--text-faint);
  font-weight: 500;
  background: linear-gradient(180deg, rgba(255,255,255,0.04), rgba(255,255,255,0.01));
}
.leak-table td.pos {
  font-family: var(--font-mono);
  color: var(--violet-strong, #c4b5ff);
  font-weight: 500;
}""",
    ),
    (
        """.detail-panel { padding-top: clamp(2.5rem, 5vw, 3.5rem); }
.back-link {
  display: inline-flex;
  align-items: center;
  gap: 0.5em;
  font-family: var(--font-mono);
  font-size: 0.76rem;
  letter-spacing: 0.03em;
  text-transform: uppercase;
  color: var(--text-faint);
  background: none;
  border: none;
  cursor: pointer;
  margin-bottom: 2rem;
  padding: 0.2rem 0;
}
.back-link:hover { color: var(--accent); }
.back-link:focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; }
.detail-head { margin-bottom: clamp(2.5rem, 5vw, 3.5rem); }
.detail-head h2 { font-size: clamp(2.4rem, 5.5vw, 3.75rem); margin: 0.6rem 0 1.1rem; }
.detail-head .prose { font-size: 1.05rem; max-width: 46em; }""",
        """.detail-panel { padding-top: clamp(2.5rem, 5vw, 3.5rem); padding-bottom: 3rem; }
.back-link {
  display: inline-flex;
  align-items: center;
  gap: 0.5em;
  font-family: var(--font-mono);
  font-size: 0.72rem;
  font-weight: 500;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--text-faint);
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 999px;
  cursor: pointer;
  margin-bottom: 2rem;
  padding: 0.45rem 0.85rem;
  transition: color 0.15s, border-color 0.15s, background 0.15s;
}
.back-link:hover {
  color: var(--accent);
  border-color: rgba(0, 255, 163, 0.3);
  background: rgba(0, 255, 163, 0.06);
}
.back-link:focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; }
.detail-head { margin-bottom: clamp(2.5rem, 5vw, 3.5rem); }
.detail-head h2 {
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
    ),
    (
        """.field-entry {
  padding: clamp(1.75rem, 3vw, 2.25rem) 0;
  border-top: 1px solid var(--line);
}
.field-entry:first-child { border-top: none; padding-top: 0; }
.field-entry-head {
  display: flex;
  align-items: baseline;
  gap: 1rem;
  margin-bottom: 0.9rem;
}
.field-entry-head .num { font-family: var(--font-mono); font-size: 0.85rem; color: var(--accent); flex: none; }
.field-entry-head h3 { font-family: var(--font-body); font-weight: 700; text-transform: none; letter-spacing: 0; font-size: 1.3rem; }
.field-entry .prose { font-size: 0.98rem; }""",
        """.field-entry {
  padding: clamp(1.35rem, 2.5vw, 1.75rem) 1.35rem;
  margin-top: 0.85rem;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 14px;
  background:
    linear-gradient(165deg, rgba(155, 135, 255, 0.06), transparent 45%),
    var(--bg-raised);
  box-shadow: 0 14px 34px rgba(0, 0, 0, 0.32);
}
.field-entry:first-child { margin-top: 0; }
.field-entry-head {
  display: flex;
  align-items: baseline;
  gap: 1rem;
  margin-bottom: 0.85rem;
}
.field-entry-head .num {
  font-family: var(--font-mono);
  font-size: 0.78rem;
  font-weight: 600;
  letter-spacing: 0.1em;
  color: var(--accent);
  flex: none;
  text-shadow: var(--glow-text-accent);
}
.field-entry-head h3 {
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
}
.field-entry .prose b {
  color: var(--accent-strong);
  font-weight: 600;
}""",
    ),
    (
        """.spec-rail {
  align-self: start;
  position: sticky;
  top: 5.5rem;
  border: 1px solid var(--line);
  background: var(--bg-raised);
  padding: 1.4rem;
}
.spec-rail .rail-title {
  font-family: var(--font-mono);
  font-size: 0.66rem;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--text-faint);
  margin-bottom: 1rem;
}
.spec-row {
  display: flex;
  justify-content: space-between;
  gap: 0.75rem;
  font-family: var(--font-mono);
  font-size: 0.76rem;
  padding: 0.55rem 0;
  border-top: 1px solid var(--line);
}""",
        """.spec-rail {
  align-self: start;
  position: sticky;
  top: 5.5rem;
  border: 1px solid rgba(255, 255, 255, 0.09);
  background: linear-gradient(180deg, rgba(255,255,255,0.03), transparent), var(--bg-raised);
  padding: 1.4rem;
  border-radius: 14px;
  box-shadow: 0 16px 36px rgba(0, 0, 0, 0.35);
}
.spec-rail .rail-title {
  font-family: var(--font-mono);
  font-size: 0.66rem;
  font-weight: 600;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--violet-strong, #c4b5ff);
  margin-bottom: 1rem;
}
.spec-row {
  display: flex;
  justify-content: space-between;
  gap: 0.75rem;
  font-family: var(--font-mono);
  font-size: 0.76rem;
  padding: 0.6rem 0;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
}""",
    ),
    (
        """.gloss-entry .term {
  font-family: var(--font-mono);
  font-size: 0.95rem;
  color: var(--data);
  font-weight: 500;
}
.gloss-entry .def p + p { margin-top: 0.5rem; }
.gloss-entry .def .why { color: var(--text-faint); font-size: 0.86rem; }""",
        """.gloss-entry .term {
  font-family: var(--font-mono);
  font-size: 0.92rem;
  color: var(--data-strong);
  font-weight: 600;
  letter-spacing: 0.02em;
}
.gloss-entry .def p {
  color: var(--text-dim);
  line-height: 1.6;
}
.gloss-entry .def p + p { margin-top: 0.5rem; }
.gloss-entry .def .why {
  color: var(--text-faint);
  font-size: 0.86rem;
  font-family: var(--font-mono);
  letter-spacing: 0.02em;
}""",
    ),
    (
        """footer {
  border-top: 1px solid var(--line);
  padding: 2.5rem 0 3rem;
}
footer .wrap {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 1rem;
}
footer .foot-line {
  font-family: var(--font-mono);
  font-size: 0.72rem;
  color: var(--text-faint);
  letter-spacing: 0.03em;
}
footer .foot-loop {
  font-family: var(--font-mono);
  font-size: 0.72rem;
  color: var(--text-dim);
}
footer .foot-loop b { color: var(--accent); font-weight: 500; }""",
        """footer {
  border-top: 1px solid rgba(255, 255, 255, 0.07);
  padding: 2.75rem 0 3.25rem;
  margin-top: 1rem;
  background: linear-gradient(180deg, transparent, rgba(0, 0, 0, 0.25));
}
footer .wrap {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 1rem;
}
footer .foot-line {
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
}
footer .foot-loop b {
  color: var(--accent);
  font-weight: 600;
  text-shadow: var(--glow-text-accent);
}""",
    ),
]

ok = 0
for old, new in REPLACEMENTS:
    if old not in t:
        print("SKIP missing block starting:", old[:60].replace("\n", " "))
        continue
    t = t.replace(old, new, 1)
    ok += 1
    print("OK", old.split("{")[0].strip())

# AI feature cards if present
old_feat = """.feature-card {
  background: var(--bg-raised);
  border: 1px solid var(--line);
  padding: 1.4rem;
}"""
# try freer search
if ".feature-card" in t:
    i = t.find(".feature-card")
    print("feature-card at", i, repr(t[i : i + 200]))

# seats / hud text
for old, new in [
    (
        ".seat .name {",
        None,
    )
]:
    pass

# Soften any remaining uppercase display headings that feel shouty
# Already set h1-h4 text-transform none in previous patch

# Bump build stamp
for a, b in [("build 0720e", "build 0720f"), ("build 0720c", "build 0720f"), ("build 0720d", "build 0720f")]:
    if a in t:
        t = t.replace(a, b)
        print("stamp", b)

p.write_text(t, encoding="utf-8")
print(f"done {ok}/{len(REPLACEMENTS)}")
