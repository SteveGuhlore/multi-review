# Run Dashboard — Visual Design

Companion to `2026-06-17-run-dashboard-design.md`. The Mermaid diagrams render on GitHub
(or any Markdown preview, e.g. VS Code `Ctrl+Shift+V`).

## Architecture

```mermaid
flowchart TD
    L["loop.mjs"] -->|"end of run (guarded)"| W
    G["goal.mjs"] -->|"end of run (guarded)"| W
    M["dashboard.mjs<br/>(manual regen)"] --> W
    R[("reviews/*/<br/>round-*.json · findings.json · manifest-*.json")] -->|"read"| W["writeDashboard()<br/>I/O shell"]
    W -->|"parse · aggregate · render"| P["lib/dashboard.mjs<br/>PURE · unit-tested"]
    W -->|"write"| H["reviews/dashboard.html<br/>self-contained"]
    P -.->|"tested by"| T["test/dashboard.test.mjs"]
```

## Data flow

```mermaid
flowchart LR
    A[("reviews/ run dirs")] --> B["parseRunDir()<br/>one adapter per format"]
    B --> C["Run objects"]
    C --> D["aggregate()"]
    D --> E["latest + history"]
    E --> F["renderHtml()"]
    F --> H["reviews/dashboard.html"]
```

## Auto-emit sequence

```mermaid
sequenceDiagram
    actor You
    participant E as loop.mjs / goal.mjs
    participant V as writeDashboard()
    participant H as dashboard.html
    You->>E: node loop.mjs --target .
    E->>E: review → debate → gates → verdict
    Note over E: all run artifacts written first
    E->>V: try { writeDashboard("reviews") } catch { }
    V->>V: scan → parse → aggregate → render
    V->>H: write self-contained HTML
    Note over E,H: cosmetic — a failure here never affects the run or its verdict
    You->>H: open when you need it (always current)
```

## Layout options (pick one)

`C X G` = which models agreed (Claude / Codex / Gemini): ● found it · `·` didn't.

### A — history strip on top  (matches your "detail + history strip" pick)
```
┌─ multi-review · dashboard ──────────────────┐
│ history  ▁▂▅▃▂▁   last 10 runs              │
├─────────────────────────────────────────────┤
│ LATEST · loop · 2026-06-17 23:16            │
│ CRIT 1   HIGH 3   MED 5   LOW 2             │
│ file           sev   C X G   status         │
│ sql concat     high  ● ● ●   → PLAN         │
│ missing await  med   ● · ●   fixed ✓        │
│ unbounded loop med   ● ● ·   fixed ✓        │
└─────────────────────────────────────────────┘
```

### B — two-column (latest detail + history sidebar)
```
┌─ multi-review · dashboard ──────────────────────┐
│ LATEST loop 23:16     │ HISTORY                 │
│ CRIT1 HIGH3 MED5 LOW2 │ ▁▂▅▃▂▁  findings/run    │
│ ────────────────────  │ run      crit / high    │
│ sql concat   hi ●●● →P│ 23:16     1 / 3         │
│ missing await md ●·● ✓│ 22:40     0 / 2         │
│ unbounded     md ●●· ✓│ 21:05     2 / 4         │
└───────────────────────┴─────────────────────────┘
```

### C — run cards (newest expanded, older collapsed)
```
┌─ multi-review · dashboard ──────────────────┐
│ ▾ loop · 23:16    C1 H3 M5 L2               │
│    sql concat    high  ●●●  → PLAN          │
│    missing await med   ●·●  fixed ✓         │
│ ▸ loop · 22:40    C0 H2 M3 L1               │
│ ▸ goal · 21:05    gates ✓   C2 H4  (→loop)  │
└─────────────────────────────────────────────┘
```
