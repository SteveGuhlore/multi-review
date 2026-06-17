# Ecosystem deep dive — build vs. borrow, and what else to add

> Companion to `ROADMAP.md`. Five-angle deep-research pass (2026) on the Claude Code /
> agentic-coding ecosystem, scoped to our goal: an interactive planner + autonomous
> plan→build→review loop on top of the existing `multi-review` multi-model reviewer.
> Verdicts are **FORK** (copy code, license-permitting), **COMPOSE** (use as an external
> dependency/skill), or **LEARN-FROM** (lift the pattern, don't depend on it).

## TL;DR — the decisions

**Fork (permissive, mature, directly on-target):**
- **`obra/superpowers`** (MIT, 230k★, v6.0.2 — verified) → skeleton for the planner
  (brainstorming + writing-plans) *and* the loop (subagent-driven-development: writer≠approver,
  fresh-context-per-task, durable `progress.md` ledger, two-tier review).
- **`pbakaus/impeccable`** (Apache-2.0, 39.1k★ — verified) → the design-slop engine; 44
  deterministic detector rules + Puppeteer live-URL auditing (source *and* rendered).

**Compose (external deps / skills):**
- `Nutlope/hallmark` (MIT) screenshot "study" + `Leonxlnx/taste-skill` (MIT) tunable dials →
  around impeccable. Anthropic `frontend-design` banlist as ground truth.
- Security stack: `gitleaks` (MIT) → `TruffleHog` (AGPL, run as external binary) → `Semgrep CE`
  CLI (LGPL) → CODEOWNERS+branch protection → `anthropics/claude-code-security-review` (MIT,
  isolated/hardened) as the model leg.
- Verify-by-running: Playwright accessibility-snapshots, packaged like `lackeyjb/playwright-skill`
  (MIT, artifacts to `/tmp/`).
- Native Claude Code `/loop` + `Task` subagents as the runtime substrate.

**Learn-from (pattern only — immature, copyleft, or wrong shape):**
- `github/spec-kit` (MIT) `constitution.md` guardrail + typed artifact-chain; `alfredoperez/sdd`
  (MIT) typed hook schema + `.spec-context.json` resumable state; `context-forge` (MIT) PRP
  executable-spec + validation-gate ladder; `prd-generator-plugin` (MIT) fresh-context
  adversarial validator; `coleam00/claude-memory-compiler` capture→distill→reinject hooks;
  SLSA/in-toto predicate shape for run provenance.
- **Avoid forking (license):** `context-engineering-kit` (GPL-3.0), `basic-memory` (AGPL-3.0),
  `Auto-Claude` (AGPL-3.0), CodeQL (proprietary; **free only for OSS on github.com** — a hard
  blocker for private/commercial repos). `DataWhisker/anti-slop-skill` license unverified
  (repo blocked fetch) — **confirm LICENSE before forking that layer.**

## Build-vs-borrow table

| Tool | Area | License | Maturity (2026) | Verdict |
|---|---|---|---|---|
| obra/superpowers | planner + loop | MIT | 230k★, v6.0.2 ✓ | **FORK** |
| pbakaus/impeccable | design-slop | Apache-2.0 | 39.1k★, 3.0.3 ✓ | **FORK** |
| Nutlope/hallmark | design-slop (screenshots) | MIT | ~3.1k★ | COMPOSE |
| Leonxlnx/taste-skill | design dials | MIT | ~45.7k★ | COMPOSE |
| anthropics/frontend-design | design banlist | repo terms | official | LEARN/COMPOSE |
| DataWhisker/anti-slop-skill | code-slop | **unverified** | active | FORK *if license ok* |
| github/spec-kit | spec chain | MIT | 111k★, v0.11.0 | LEARN-FROM |
| alfredoperez/sdd | hooks/state | MIT | active, solo | LEARN-FROM |
| context-forge | PRP/scaffold | MIT | ~142★ | LEARN-FROM |
| prd-generator-plugin | validator pattern | MIT | prototype | LEARN-FROM |
| context-engineering-kit | SDD/review | **GPL-3.0** | ~1.1k★ | LEARN-FROM (clean-room) |
| claude-flow | swarm | MIT | ~60k★ | LEARN-FROM |
| Auto-Claude | parallel sessions | **AGPL-3.0** | ~1★ | LEARN-FROM |
| Claude Code `/loop` + `Task` | runtime | first-party | current | COMPOSE (substrate) |
| mem0 | semantic memory | Apache-2.0 | ~58.8k★ | COMPOSE (optional) |
| basic-memory | living docs | **AGPL-3.0** | ~3.3k★ | LEARN-FROM (convention) |
| claude-memory-compiler | memory hooks | unspecified | ~1.2k★ | FORK *if license ok* |
| MCP server-memory | memory schema | MIT | current | LEARN-FROM |
| ADR Architecture Kit | ADRs as YAML | Apache-2.0 | ~1★ | LEARN-FROM |
| SLSA / in-toto / attest | provenance | open | standard | LEARN/COMPOSE |
| gitleaks | secrets | MIT | ~26k★ | COMPOSE |
| TruffleHog | secret verify | AGPL-3.0 | ~25.7k★ | COMPOSE (ext binary) |
| Semgrep CE | SAST | LGPL-2.1 | ~11k★ | COMPOSE (CLI not MCP) |
| CodeQL | taint | **proprietary** | current | LEARN-FROM unless GHAS |
| CODEOWNERS + branch protection | policy | native | current | COMPOSE |
| claude-code-security-review | AI review | MIT | ~5.3k★, official | COMPOSE (isolate) |
| microsoft/playwright-mcp | verify-by-running | Apache-2.0 | ~33k★ | COMPOSE |
| lackeyjb/playwright-skill | verify-by-running | MIT | ~2.8k★ | COMPOSE/LEARN |

## Per-area highlights

**Planning.** Every surveyed planner stops at artifact generation with no verification gate.
superpowers is the best blueprint (one-question-at-a-time interview → 2-3 approaches + a
recommendation → design-doc-as-gate → self-contained interface-typed task plan with a
*placeholder ban* and cross-task consistency check). spec-kit's `constitution.md` (invariants
injected into every phase) and context-forge's **PRP = executable spec with embedded validation
+ success criteria** are the two ideas to graft onto our `PLAN.md` so tasks have machine-checkable
exit conditions. sdd contributes the integration seam: typed hooks (`subagent`/`shell`/`skill` +
`blocking`) at lifecycle points (e.g. `pre:commit`) + `.spec-context.json` resumable state.

**Anti-slop.** Three silos, no unifier. Fork impeccable as the design engine; compose hallmark's
screenshot `study` + taste-skill's dials; adopt Anthropic's banlist. For code-slop, DataWhisker's
**hybrid deterministic `scan.py` + fresh-subagent "cold reviewer"** (reviews as if a stranger
wrote it, no design rationale) is the blueprint — and that cold-review pattern is the same
writer≠approver primitive the loop needs.

**Loop & subagents.** Fork superpowers' subagent-driven-development; run it under native `/loop`
+ `Task`. Anthropic's "Building Effective Agents" (orchestrator-workers + evaluator-optimizer)
and "multi-agent research system" (lead + parallel workers + separate verification pass) are the
north-star contracts. The detailed subagent contract (objective / output format / tools allowed /
boundaries) and effort-scaling (don't spawn for trivial work) are explicit Anthropic findings.

**Memory & provenance.** Compose CLAUDE.md as the substrate; fork claude-memory-compiler's
capture→distill→reinject hook loop for multi-session coherence (steal basic-memory's
Markdown+frontmatter+relations *convention*, not its AGPL code). Provenance: emulate the
SLSA/in-toto predicate shape; in CI, `actions/attest-build-provenance` (MIT) + signed commits
give cryptographic run records nearly free.

**Security & verify-by-running.** Layered deterministic CLIs (gitleaks → trufflehog → semgrep,
+CodeQL only with GHAS) feeding a fail-closed boolean, with CODEOWNERS+branch protection as the
owner-signoff signal and claude-code-security-review as an *isolated* model leg. Use Semgrep's
**CLI, not its MCP** (deterministic exit code; MCP is model-mediated + context-costly). Verify
with Playwright **accessibility snapshots** (assertable, reproducible) over screenshot-diffing.

## Pitfalls to engineer against (with mitigations)

| Pitfall | Mitigation to build in |
|---|---|
| **Reward hacking / editing tests to pass** (SpecBench: 97% on validation, 0% held-out via a hash-table "compiler") | Writer **denied write access to test/eval files**; gate convergence on a **held-out suite the writer never sees**; reviewer reads diff, never re-runs/edits tests; restrict which dirs a change may touch. |
| **Cost runaway** (multi-agent ≈ 15× tokens; usage explains ~80% of perf variance) | Hard iteration/token/cost caps; effort-scaling in the orchestrator prompt; cheaper worker models; structured summaries, not raw log dumps. |
| **Oscillation / fixes that break each other** | Stagnation/cycle detection (repeated-error fingerprint → halt/escalate); spec as a stable anchor; batch all findings to one fix pass. |
| **Context rot over long runs** | Fresh context per task; artifacts as files not pasted summaries; durable ledger surviving compaction. |
| **Prompt injection from untrusted repo content** (real 2026 incidents leaked secrets) | Dual-LLM/quarantine (reader has no tools; tool-holder reads no untrusted content); read-only review agents; sanitize inputs; **protect the CODEOWNERS file** so the agent can't edit its gatekeeper. OWASP Agentic Top 10 (Dec 2025) names these as the core agent risks. |
| **Compounding errors** | Checkpoints + retry; surface tool failures to the agent to adapt; human checkpoint at high-stakes/blocked points. |

## Genuine gaps — what we can OWN

These recurred across angles as *unfilled*, and align with multi-review's strengths:

1. **Closed plan→build→review loop with a multi-model, confidence-scored reviewer.** Everyone
   else stops at plan/tasks or single-model review. This is the core differentiator.
2. **Fail-closed test-write gate + held-out-test convergence.** SpecBench *measures* reward
   hacking; nobody productizes the mitigation. Convergence detection elsewhere is hand-wavy.
3. **Signed run-manifest bridging living-docs and provenance** — each commit linked to its
   prompt hash, model id, validation exit codes, and the spec/ADR version it advanced. Memory
   tools capture *what was learned* but emit no audit trail; provenance tools sign *artifacts*
   but are blind to spec/decision state. Nobody bridges them.
4. **Unified code+design slop taxonomy + one scoring scheme.** Every slop tool is siloed.
5. **Screenshot-graded UI gate** — "screenshot my just-built UI → score against the banlist →
   fail the gate." Existing tools extract DNA from *reference* screenshots; none grade *your own*
   rendered output as a gate.
6. **Cold-review for design** (fresh subagent that never saw the brief) — exists for code only.
7. **AI-author-aware, consensus-gated, fail-closed security gate** combining scanners +
   multi-model consensus + an isolated fresh-context reviewer. The leaf tools exist; the
   orchestrator does not.

## New additions justified by the research (beyond the current roadmap)

Highest-value, all grounded above:

1. **Fail-closed test-write gate + held-out-test convergence signal** (gaps 1–2). Promote into
   the security/convergence design.
2. **Signed run-manifest** as the provenance bridge (gap 3): JSON per loop iteration — model,
   prompt SHA-256, files+git SHA, validation exit codes, spec/ADR refs; signed (gitsign / CI
   attestation) with model id in commit trailers.
3. **Unified slop taxonomy + scoring** owned in Layer 3 (gap 4), importing impeccable's rules +
   DataWhisker's categories + Anthropic's banlist.
4. **Screenshot-graded UI gate** via Playwright snapshots (gap 5) + **cold-review for design**
   (gap 6).
5. **Capture→distill→reinject memory + drift guardian** (prd-evolve version-headers) for
   multi-session coherence.
6. **PRP-style executable PLAN.md** (context-forge) + **constitution.md** project invariants
   (spec-kit) + **typed hook seam & resumable state** (sdd) as the loop's plumbing.
7. **Prompt-injection hardening** as a first-class invariant (dual-LLM/quarantine, read-only
   reviewers, protected gatekeeper files) — extends multi-review's existing untrusted-data stance.

## License watch-list (before any fork)

- **Hard-avoid for forking:** context-engineering-kit (GPL-3.0), basic-memory / TruffleHog /
  Auto-Claude (AGPL-3.0 — invoke as external binaries only, never vendor/modify), CodeQL
  (proprietary; OSS-on-github.com only).
- **Confirm first:** DataWhisker/anti-slop-skill (license not verified this pass),
  claude-memory-compiler (unspecified), buildermethods PRD Creator (non-standard), emilkowalski/skill
  (none stated). 
- **Clear to fork (MIT/Apache-2.0):** superpowers, impeccable, hallmark, taste-skill, spec-kit,
  sdd, context-forge, prd-generator-plugin, claude-code-security-review, playwright-mcp,
  playwright-skill, gitleaks, mem0.

## Verification notes (honesty)

Verified directly: superpowers (MIT, 230k★, v6.0.2) and impeccable (Apache-2.0, 39.1k★, 3.0.3)
— the two repos we'd copy code from. Star counts elsewhere are as-reported by the research pass,
not independently confirmed, and don't change any fork/license decision. Unconfirmed and flagged
above: DataWhisker license (repo blocked fetch). Spec-kit star count reported as 111k–113k across
sources (version v0.11.0 consistent).

## Sources

superpowers github.com/obra/superpowers · impeccable github.com/pbakaus/impeccable ·
hallmark github.com/Nutlope/hallmark · taste-skill github.com/Leonxlnx/taste-skill ·
frontend-design github.com/anthropics/claude-code/tree/main/plugins/frontend-design ·
spec-kit github.com/github/spec-kit · sdd github.com/alfredoperez/sdd ·
context-forge github.com/webdevtodayjason/context-forge ·
context-engineering-kit github.com/NeoLabHQ/context-engineering-kit ·
prd-generator-plugin github.com/rodrigorjsf/prd-generator-plugin ·
claude-flow github.com/ruvnet/claude-flow · Auto-Claude github.com/B1tMaster/Auto-Claude ·
claude-memory-compiler github.com/coleam00/claude-memory-compiler ·
mem0 github.com/mem0ai/mem0 · basic-memory github.com/basicmachines-co/basic-memory ·
MCP memory github.com/modelcontextprotocol/servers/tree/main/src/memory ·
ADR kit github.com/egallmann/adr-architecture-kit ·
attest-build-provenance github.com/actions/attest-build-provenance ·
gitleaks github.com/gitleaks/gitleaks · trufflehog github.com/trufflesecurity/trufflehog ·
semgrep github.com/semgrep/semgrep · codeql codeql.github.com ·
claude-code-security-review github.com/anthropics/claude-code-security-review ·
playwright-mcp github.com/microsoft/playwright-mcp · playwright-skill github.com/lackeyjb/playwright-skill ·
Building Effective Agents anthropic.com/research/building-effective-agents ·
Multi-agent research system anthropic.com/engineering/multi-agent-research-system ·
SpecBench arxiv.org/html/2605.21384 · OWASP Agentic Top 10 genai.owasp.org ·
SLSA slsa.dev
