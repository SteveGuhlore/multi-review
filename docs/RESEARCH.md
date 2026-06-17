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

---

# Round 2 — net-new capabilities (beyond the current roadmap)

A second deep-research pass, scoped *only* to features we had **not** already designed
(planner, multi-review, anti-slop, the loop, subagents, memory, provenance, code security
scanners, basic verify-by-running were excluded). Five angles: testing/quality gates,
supply-chain/dependency intelligence, codebase intelligence/retrieval, delivery/ops, and the
agent meta-layer (economics/evals/self-improvement). Verdicts as before: FORK / COMPOSE /
LEARN-FROM.

## A. Testing & quality gates beyond review

The recurring failure mode — LLM tests that *pass but assert nothing* — finally gets a real
defense here.

- **Mutation testing = the keystone gate.** `StrykerJS` (Apache-2.0, mature, `--incremental`
  diff-scoped + `thresholds.break` → exit 1), `PIT` (Java), `mutmut` (Python). Injects faults;
  if tests still pass, they're theater. Turns "green" into "tests have teeth." **COMPOSE.**
- **Diff-coverage gate** — `diff_cover --fail-under=N` (Apache-2.0, language-agnostic over
  LCOV/Cobertura/JaCoCo). Cheapest high-signal gate; stops "added code, no tests." **COMPOSE.**
- **Property-based / fuzz** — `fast-check` (MIT, dominant JS/TS), `Hypothesis` (MPL-2.0), `jqwik`
  (EPL-2.0). Run with a fixed seed for determinism; the **shrunk counterexample is an ideal
  fix-prompt** for the next iteration. **COMPOSE.**
- **Flaky-test detection** — `pytest-flakefinder`, `pytest-rerunfailures`, Jest retries. New
  tests run N× *before admission*; nondeterministic → reject the *test*, not the code. Protects
  the loop's own signal (a flaky red is a false reject that derails an autonomous run). **COMPOSE.**
- **Visual regression** (distinct from anti-slop aesthetics) — `Playwright toHaveScreenshot()`
  (built-in, free, deterministic, baselines in git) catches *unintended* UI change regardless of
  whether it looks good. Near-zero cost since Playwright is already in the loop. **COMPOSE.**
- **Contract / BDD** — `Pact` (`can-i-deploy` is a literal deploy gate) for multi-service repos;
  Gherkin for spec→acceptance-test. **LEARN-FROM** (high value only for multi-service / cheap-spec).

**Gap to own:** a productized **mutation-guided test-synthesis** primitive (Meta's ACH — 73%
engineer-accept internally, no OSS release). *diff → generate targeted mutants → LLM writes the
killing test → keep only mutant-killing, non-flaky, coverage-raising tests → emit as a
deterministic gate.* Stryker does mutation but writes no tests; Qodo Cover writes tests but is
unmaintained/AGPL and doesn't validate against mutants. Buildable on Stryker's JSON mutant API +
our multi-model reviewer.

## B. Supply-chain & dependency intelligence

**Reframing finding:** in **March 2026 Trivy itself was supply-chain compromised** (malicious
binary + 76/77 `trivy-action` tags force-pushed to credential-stealing malware, self-propagating
via stolen CI tokens — Aqua's own advisory + Microsoft + Wiz + CrowdStrike). **The scanners are
deps too.** First-class design rule: **pin every gate tool by commit SHA (not tag), run with
minimal CI secrets, verify Sigstore/cosign attestations, and diversify** — never consolidate the
gates into one all-in-one binary.

- **The blind spot in our current stack:** semgrep/gitleaks/codeql + review scan *our* code;
  **nothing inspects an incoming third-party package** for install hooks / typosquatting /
  maintainer-takeover before it lands (exactly the attack class above). Add **GuardDog** (Datadog,
  Apache-2.0, CLI-gateable) as a pre-install gate, optionally **Socket.dev**. **COMPOSE.**
- **Autonomous "make deps green" engine** — `OSV-Scanner` Guided Remediation (`osv-scanner fix`,
  Apache-2.0) computes the **minimum-safe** upgrade (vs. Renovate's "newer"); **OWASP
  Dependency-Track** (Apache-2.0) fires when a *new* CVE hits an already-shipped SBOM. Neither
  *validates* a fix — our loop is the missing middle. **COMPOSE.**
- **Defaults to layer:** `OSV-Scanner` + `Grype` (SCA), `Syft` (SBOM), `Checkov` + `hadolint`
  (IaC/Dockerfile — both non-Aqua, reducing concentration risk), `Renovate` (routine upgrades —
  AGPL, invoke as CLI), `ScanCode` + a **GPL/AGPL/SSPL deny-list** (license; AGPL triggers on
  *network use* for SaaS), `OpenSSF Scorecard` (vet a new dep before adding). `cosign`
  verify-attestation as an admission gate.
- **Avoid:** Trivy as the default binary in 2026 (compromise); `tfsec` (merged into Trivy, dead);
  `Terrascan` (archived Nov 2025).

**Gap to own:** an **autonomous "keep deps green + safe" worker** — Dependency-Track triggers,
OSV-fix/Renovate proposes, GuardDog + license deny-list + Scorecard gate, **our plan→build→review
loop validates and merges**. Renovate proposes but doesn't reason; Dependency-Track monitors but
can't act; OSV-fix patches but doesn't validate; nothing screens the package for malice first. We
own the missing correctness+safety bar.

## C. Codebase intelligence & retrieval

Grounding the agent in a large/unfamiliar repo (distinct from cross-session memory). *(License
correction from the research: **Sourcegraph never went BSL** — it went Apache-2.0 → proprietary
→ private; Cody is closed/enterprise-only now. Both LEARN-FROM only.)*

- **Symbol-grounding spine — the top pick (COMPOSE):** `Serena` (MIT, ~23k★, 40+ langs, active)
  — **LSP-over-MCP**: gives the loop compiler-accurate go-to-def / find-references / call-hierarchy
  / symbol-level edits. Exact grounding that beats embedding-fuzzy RAG and feeds *both* "which
  module to target" and "what does this change affect." Single highest-leverage compose in this
  area. `ast-grep` (MIT, ships MCP) for deterministic structural find/rewrite alongside it.
- **Deterministic scoping layer (COMPOSE/LEARN):** Aider's **tree-sitter + PageRank repo map**
  (Apache-2.0; self-contained algorithm, or `RepoMapper` as MCP) — ranked, token-budgeted
  architecture skeleton injected pre-edit. Plus **`dependency-cruiser`** (MIT, native Mermaid) /
  `madge` (JS/TS), `pydeps` (Python), `go-callvis` (Go): import/call graphs for blast radius —
  and dependency-cruiser **doubles as an architecture gate** that fails the loop when a change
  violates layer rules. Trust these deterministic extractors as ground truth; treat LLM-native
  diagrammers (CodeBoarding) as an *intent* layer to verify against them, never as authoritative.
- **Code-RAG stack (COMPOSE):** `CocoIndex` (Apache-2.0, real-time tree-sitter incremental
  indexing — only changed files re-embed) → `LanceDB` (embedded, local) or `Qdrant` (server) —
  **both Apache-2.0; the "Qdrant relicensed to BSL/SSPL" rumor is false** → embeddings:
  `Qwen3-Embedding` (Apache-2.0, quality) / `jina-embeddings-v2-base-code` (Apache-2.0, CPU-only).
  Only `voyage-code-3` is proprietary. `Continue` is the best end-to-end blueprint but is
  **archived in 2026** — learn, don't depend. For onboarding: `DeepWiki-Open` (MIT, repo→wiki+RAG),
  `Repomix`/`Gitingest` (flatten repo to a prompt-ready file for small subtrees).
- **Large-scale refactors / codemods (COMPOSE):** `ast-grep` (MIT, YAML-rule rewrites + MCP),
  `Codemod` (Apache-2.0, Rust, ships an MCP server + fixture-test harness + approval gates),
  `GritQL` (now **MIT**, donated to Biome; `--dry-run` + `--json` + clean-tree guard), `libcst`
  (MIT, format-preserving Python), `jscodeshift` (MIT), `comby` (MPL-2.0, language-agnostic),
  `OpenRewrite` (Apache-2.0 core — **but Moderne recipes are source-available/proprietary**).
  `rope` is LGPL (flag); `bowler` archived/dead — avoid.
- **Impact analysis / blast-radius scoping (COMPOSE):** LSP call-hierarchy via Serena is the
  compiler-accurate path; `SCIP` (Apache-2.0, persistent cross-repo index) + `github/stack-graphs`
  (incremental name resolution, no build needed) for huge repos; `Nx affected` / `Bazel rdeps`
  (zero-cost if already present); `pytest-testmon`/JaCoCo (coverage-based test selection) to run
  only the tests a diff affects. Dead/abandoned: PyCG, code2flow, java-callgraph.
- **Dead-code + tech-debt backlog generator (COMPOSE) — a self-refilling work queue:** `knip`
  (ISC, JS/TS, has auto-fix), `vulture` (MIT, Python, confidence scoring — gate on
  `--min-confidence 100`), Go `cmd/deadcode` + staticcheck `U1000`, `cargo-machete`→`cargo-udeps`
  (Rust), ranked by a homegrown **churn×complexity hotspot score** (`scc`/`lizard`/`radon` +
  `git log`, replicating CodeScene's technique for free; `qlty` as a polyglot aggregator — Fair
  Source/BSL). Each item is a small atomic change gated on build+test — a perfect fit for the loop.

**Gaps to own:** (1) **impact-analysis-scoped autonomous edits** — nobody closes the loop where
the agent *computes* the transitive affected call-sites/tests for a planned edit, *constrains* the
codemod to exactly that set, then *re-derives* impact afterward to prove nothing leaked outside the
predicted blast radius. SCIP + a codemod engine + verify-by-running are the raw ingredients; the
"scope → edit-within-scope → re-verify-scope" orchestration is net-new. (2) A
**ground-truth-vs-LLM-diagram reconciler** that flags when the planner's architecture mental-model
diverges from the real import/call graph — an anti-hallucination grounding check.

## D. Delivery & ops — idea → shipped

- **Event-driven from a real issue (COMPOSE):** `anthropics/claude-code-action` (MIT) on an
  issue-label/`@claude` event → **GitHub Issue Form** (structured) parsed via **Spec Kit**
  (`/specify→/plan→/tasks`) → branch via `gh issue develop` → close with `semantic-release` (MIT)
  / `release-please` (Apache-2.0) on merge. `Conventional Commits` + `commitlint` as the contract;
  `pr-size-labeler` (`fail_if_xl`) to **force the agent to split mega-PRs.** Caveats:
  claude-code-action **does not auto-create PRs** (bridge with `gh pr create`/`gh pr merge
  --auto` + branch protection); use a **GitHub App token** so bot commits re-trigger CI;
  **sanitize untrusted issue text** (prompt-injection).
- **CI generation + fix-forward loop (COMPOSE/LEARN):** `act` (run workflows locally pre-push),
  `dagger` (code-defined pipelines, no local/CI drift), `get_job_logs`/`gh run rerun --failed`
  (read-and-react). Fix-forward pattern: classify failure → patch on temp branch → PR (never
  auto-merge) → re-run failed jobs → **cap retries ~3** → escalate. **Agent in the data-plane**
  (code/test fixes); **control-plane** (pipeline config, deploy policy) gated behind human review.
- **Progressive delivery with deterministic auto-rollback (COMPOSE):** `Argo CD` (deploy = merged
  manifest) + `Argo Rollouts` (Apache-2.0, CNCF Graduated — metric-analyzed canary vs.
  Prometheus/`Sloth` SLOs, `failureLimit` → **automatic abort+revert with zero agent
  involvement**) + `OpenFeature`/`flagd` (ship behind a disabled flag, flip via a git commit).
  Rollback is controller-enforced, **not LLM-judged** — the right property for autonomy. Avoid
  Keptn (CNCF-archived Sep 2025).
- **Regression gates as required checks (COMPOSE):** a11y via `@axe-core/playwright` (MPL-2.0,
  file-scoped copyleft; block on critical/serious) + `Lighthouse CI`; performance via
  `github-action-benchmark` (MIT) or `Bencher` (statistical thresholds). The **baseline-ratchet**
  (fail only on *new* regressions, not pre-existing debt) is what makes these usable on real repos.

**Gaps to own:** (1) **closed-loop autonomous production remediation** is unsolved in OSS —
deterministic deploy/rollback is production-proven and agentic-SRE tools only *diagnose*; the
consensus is agent stays data-plane, controllers stay control-plane. We can be the **connective
tissue** (agent proposes config + SLO defs + flag flips; controllers enforce) without making the
agent the rollback decision-maker. (2) **Baseline-ratcheting for regression gates** has no clean
OSS standard — every tool reinvents it; we'd build the violation-fingerprint/baseline-diff layer.

## E. Agent meta-layer — economics, evals, self-improvement

The self-governance layer: what each run costs, whether the loop is improving, and safe
self-modification.

- **Unified meta-backend (COMPOSE):** `Langfuse` (MIT, self-hostable) ingests Claude Code's
  **native OTel traces** (cost-per-subagent for free) and reuses the *same* instance for eval
  scores and human-feedback annotations — one tool instead of three. (`ccusage` MIT for a quick
  local spend readout. Helicone entered maintenance mode Mar 2026 — skip.)
- **Loop-level eval gate (COMPOSE):** run a small **SWE-bench-style held-out set through the
  *whole loop*** (`Inspect AI`, MIT) + `promptfoo` (MIT) regression on every prompt/skill edit →
  **fail the PR on regression.** Converts "we tweaked a prompt" into a measured decision; the
  prerequisite for safe self-improvement. (`DeepEval` Apache-2.0 is the pytest-native alternative.)
- **Model routing / budget (COMPOSE/LEARN):** `LiteLLM` proxy (MIT) for per-run budget caps +
  model-mix; `RouteLLM` (Apache-2.0) strong-vs-cheap routing is a calibration project (learn the
  pattern). Cheaper workers under an Opus orchestrator.
- **Gated self-improvement (COMPOSE + discipline):** `claude-reflect-system` writes lessons from
  corrections (`learnings.md`); **every self-rewritten skill must pass the eval gate before going
  live** (the SAGE/Trace2Skill discipline). Voyager is the skill-library north star. PRELUDE/PROSE
  — treat the reviewer's *edits* to a build as a preference signal.
- **Runtime guardrails (COMPOSE):** NeMo Guardrails **execution rails** (Apache-2.0) for runtime
  action policy; `Invariant` (now Snyk) guards the agent's **tool/MCP surface** — distinct from
  code SAST.

**Gap to own:** a **self-evaluating loop that tracks its own bug-escape-rate** (defects merged
then reverted/hotfixed) **and slop-rate** (anti-slop flags per KLOC) as first-class longitudinal
metrics, and **only keeps a self-rewrite if those trends improve on the held-out set.** Langfuse
stores scores but defines no such metric; promptfoo/Inspect are point-in-time; self-improvement
frameworks rewrite skills but don't *prove* the rewrite lowered escapes. "The system grades its
own bug-escape rate and only ships self-changes that lower it" is unbuilt.

## Cross-cutting design principles surfaced in round 2

1. **Determinism at the gate.** Every addition reduces to an exit-code / threshold the loop can
   block on — model judgment proposes, deterministic checks gate.
2. **The toolchain is part of the threat model.** Pin gate tools by SHA, least-privilege CI
   tokens, verify attestations, diversify vendors (Trivy compromise).
3. **Data-plane vs. control-plane.** The agent edits code/tests/config *proposals*; anything that
   touches production (deploy policy, rollback) stays behind deterministic controllers or a human.
4. **Baseline-ratchet, not absolute bars.** Regression/quality gates fail on *new* regressions so
   they're adoptable on debt-laden repos.

## Prioritized net-new shortlist (highest leverage first)

1. **Mutation + diff-coverage gates** (A) — directly kills the assertion-free-test failure mode;
   cheap, language-agnostic, deterministic.
2. **Loop-level eval gate + Langfuse meta-backend** (E) — makes every prompt/skill change a
   measured decision and gives cost-per-loop; prerequisite for self-improvement.
3. **Pre-install malicious-package gate (GuardDog)** (B) — closes a structural blind spot the
   current code-scanners cannot cover.
4. **Issue→spec→PR→release orchestration** (D) — the biggest gap between "writes code" and "ships
   from an idea"; makes the loop event-driven and terminal at a versioned release.
5. **Serena (LSP-over-MCP) symbol grounding + impact-scoped tests** (C) — compiler-accurate
   go-to-def/references/call-hierarchy beats fuzzy RAG; run only the tests a diff affects.
6. **Autonomous keep-deps-green+safe worker** (B) — greenfield; our loop is the missing validator.
7. **Progressive delivery + deterministic auto-rollback** (D) — safe path to prod without
   LLM-judged rollback.
8. **Self-evaluating loop (bug-escape + slop rate)** (E) — the long-game differentiator.

## New gaps we can own (consolidated)

- Mutation-guided test synthesis primitive (A).
- Autonomous keep-deps-green+safe worker with a real correctness/safety bar (B).
- Impact-analysis-scoped autonomous edits (scope → edit-within-scope → re-verify-scope) (C).
- Ground-truth-vs-LLM-diagram reconciler as a planner anti-hallucination check (C).
- A self-refilling dead-code + tech-debt backlog the loop burns down, gated on build+test (C).
- Data-plane/control-plane connective tissue for safe autonomous prod (D).
- Baseline-ratcheting regression-gate standard (D).
- Self-evaluating loop tracking + gating on its own bug-escape & slop rates (E).

## Round-2 sourcing caveats (honesty)

GitHub API was rate-limited from the research environment; star counts / dates were corroborated
against live HTML, raw LICENSE files, and package registries. The **Trivy compromise** is
confirmed by Aqua's own GHSA advisory + Microsoft + Wiz + CrowdStrike (high confidence). Some
SCA/comparison numbers came from vendor blogs (treat as marketing, not benchmarks). Re-verify
before depending: `jqwik` (EPL-2.0) and `Pact` license lines; `Codemod` funding (stand only on
"active, Apache-2.0, shipping 2026"); the OTel auto-instrumentation per-tool maturity table was
not fully completed this pass. Meta's ACH and RouteLLM are research, not productized releases.

## Round-2 sources (condensed)

StrykerJS stryker-mutator.io · diff_cover github.com/Bachmann1234/diff_cover · fast-check
github.com/dubzzz/fast-check · Hypothesis hypothesis.works · Meta ACH engineering.fb.com ·
Trivy compromise github.com/aquasecurity/trivy/security/advisories/GHSA-69fq-xp46-6x23 ·
OSV-Scanner google.github.io/osv-scanner · Dependency-Track owasp.org/www-project-dependency-track ·
GuardDog securitylabs.datadoghq.com · Socket socket.dev · Syft/Grype anchore (github.com) ·
Checkov / hadolint · Renovate docs.renovatebot.com · OpenSSF Scorecard github.com/ossf/scorecard ·
Serena github.com/oraios/serena · ast-grep github.com/ast-grep/ast-grep · SCIP github.com/sourcegraph/scip ·
stack-graphs github.com/github/stack-graphs · dependency-cruiser github.com/sverweij/dependency-cruiser ·
knip github.com/webpro-nl/knip · vulture github.com/jendrikseipp/vulture · qlty github.com/qltysh/qlty ·
CocoIndex github.com/cocoindex-io/cocoindex · Qdrant github.com/qdrant/qdrant · LanceDB
github.com/lancedb/lancedb · Aider repomap aider.chat/docs/repomap.html · Codemod
github.com/codemod-com/codemod · GritQL github.com/biomejs/gritql · libcst github.com/Instagram/libcst ·
Jelly github.com/cs-au-dk/jelly · Nx nx.dev · Bazel bazel.build · pytest-testmon
github.com/tarpas/pytest-testmon · claude-code-action github.com/anthropics/claude-code-action ·
spec-kit github.com/github/spec-kit · semantic-release / release-please · Argo Rollouts
argoproj.github.io/rollouts · OpenFeature openfeature.dev · axe-core github.com/dequelabs/axe-core ·
github-action-benchmark github.com/benchmark-action/github-action-benchmark · Bencher bencher.dev ·
Langfuse github.com/langfuse/langfuse · Claude Code OTel code.claude.com/docs/en/monitoring-usage ·
Inspect AI / SWE-bench github.com/swe-bench/SWE-bench · promptfoo · LiteLLM github.com/BerriAI/litellm ·
RouteLLM github.com/lm-sys/routellm · NeMo Guardrails · Invariant github.com/invariantlabs-ai/invariant
