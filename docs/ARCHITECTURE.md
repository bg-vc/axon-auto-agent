# Architecture

## Decision summary

Axon Auto Agent is an out-of-tree product layer on top of DeepSeek Harness (DSH),
not a fork of it. DSH owns the generic agent runtime. Axon Auto Agent owns the autonomy contract,
the product state machine, and the desktop experience.

The initial desktop implementation is **Electron + React** because DSH is a Node.js and
TypeScript runtime. Harness-facing code runs in an Electron Utility Process, not in Main
or Renderer. This avoids a separately installed Node sidecar while retaining a real process
boundary and crash supervision. It is a packaging decision, not a license to put business
logic in Electron IPC handlers.

The Axon Auto Agent desktop experience is the interaction reference—workspace isolation, contextual approvals,
business-level progress cards, artifact previews, and resumable runs—not a source-code
dependency. This repository must not import private Go packages from the existing desktop product.

## Shipping process model

```text
React Renderer
  home · conversation · approvals · artifacts · settings
                         │ window.axonAutoAgent (typed whitelist)
Sandboxed Preload        │ no generic ipcRenderer
                         ↓
Electron Main
  window · tray · dialogs · keychain · updates · custom artifact protocol
                         │ request/response + durable events
                         ↓
Utility Process
  compatibility adapter · sessions · agent loop · tools · plugins · event store
                         ↓
Selected workspace · model API · approved external tools
```

Main supervises and restarts the Utility Process. Renderer never receives API keys or
arbitrary filesystem access. Artifact previews use `axon-artifact://`; arbitrary `file://`
paths are not exposed to web content.

## Long-term layer model

```text
Desktop GUI
  goal brief · live canvas · artifact viewers · approval cards · history
                              │ typed IPC
Axon Auto Agent autonomy kernel
  outcome contract · run state · budgets · evaluators · checkpoints · retention
                              │ Cordis services/events
DeepSeek Harness
  sessions · agent loop · tools · jobs · workflows · subagents · policy · sandbox
                              │ capability seams
Plugins
  domain tools · model adapters · evaluators · renderers · execution providers
                              │
Execution worlds
  local workspace · container · remote host · browser · API · GPU · instrument
```

Dependencies point downward. Events and typed results flow upward. No plugin imports a
renderer, no renderer invokes a provider directly, and no domain tool modifies the global
agent loop.

## Upstream integration

The desktop profile pins DSH `0.1.0-rc.6` and performs a boot-time compatibility probe.
The published DSH headless entry points and Web host are still developer-preview surfaces,
so the current interactive path is translated through Axon's stable runtime contracts and
OpenAI-compatible streaming adapter. Native DSH Agent Loop/profile composition will replace
that implementation behind the same boundary as its public APIs stabilize.

The target integration composes supported DSH bundles and Axon Auto Agent plugins through
a profile package and documented extension points:

- durable facts through session events;
- guarded work through the tool execution pipeline;
- long operations through jobs and workflows;
- delegation through the subagent provider seam;
- filesystem and process confinement through sandbox providers;
- model and user context through scoped system-prompt sections;
- GUI projection from the append-only session event stream.

DSH is currently a developer preview and explicitly permits compatibility-breaking
changes. Axon Auto Agent will pin one tested upstream version, maintain a compatibility fixture, and
upgrade through a dedicated adapter package. Application code must never depend on an
undocumented DSH internal.

## Contracts owned by Axon Auto Agent

The following contracts will stay deliberately small until the first complete task
proves what they actually need to contain:

- [ ] `OutcomeContract` — goal, workspace, inputs, constraints,
  authority, budgets, evidence, evaluators, and deliverables.
- [ ] `RunEvent` — append-only lifecycle facts with stable IDs,
  timestamps, causation, and schema versions.
- [ ] `Artifact` — immutable identity plus provenance, media type,
  preview strategy, storage location, and producing step.
- [ ] `Evaluation` — evaluator identity, inputs, result, evidence,
  confidence class, and deterministic/model/human provenance.
- [ ] `DecisionRequest` — exact proposed side effect, reason, scope,
  expiry, alternatives, and the recorded human or policy decision.
- [ ] `Checkpoint` — the restorable relationship among workspace,
  session boundary, contract revision, evaluator state, and external receipts.

These types will be model-neutral and UI-neutral. JSON Schema fixtures will define their
wire format before any database schema is selected.

## Run lifecycle

```text
draft → contracting → ready → running ↔ waiting_for_decision
                                  │  ↘ blocked
                                  │  ↘ paused
                                  └──→ evaluating → checkpointed → running
                                                     └──────────→ completed
Any active state → cancelling → cancelled
Any active state → failed
```

- `completed` requires the Outcome Contract's completion evaluator and deliverables.
- A process exit changes no durable status by itself. On restart, the runtime reconciles
  external work and resumes, blocks, or fails with evidence.
- A denied action is a recorded path outcome, not a generic task failure.
- A model saying “done” is never sufficient to transition to `completed`.

## GUI projection

The desktop renderer consumes durable events and derives five user-facing projections:

1. goal and contract;
2. milestone and active-step status;
3. decisions and risks;
4. artifacts and evidence;
5. diagnostics and raw trace.

The raw trajectory is the last projection, not the homepage. A new projection must be
rebuildable from stored events so refresh and restart cannot disagree with live state.

## Trust boundaries

- The selected workspace is the default read/write boundary.
- Network, external accounts, publication, payments, destructive changes, and physical
  operations are separate capabilities with separate policies.
- Credentials are resolved at execution time and never copied into events or artifacts.
- Remote providers return signed receipts or structured results; the UI does not infer
  success from a disconnected stream.
- Evaluators run with the minimum capability set needed to inspect the candidate result.

## Open technical decisions

- [ ] Complete signed/notarized macOS and Windows clean-machine install tests before
  declaring the shell final. Boot, typed IPC, Utility Process restart, and unsigned macOS
  directory packaging already have automated coverage.
- [ ] Select the local event store only after replay and migration fixtures
  exist; SQLite is the leading candidate, not an accepted dependency.
- [ ] Decide how third-party DSH plugins are discovered, reviewed,
  pinned, and isolated before exposing a one-click marketplace.
- [ ] Define conflict and authority rules before multiple agents may
  mutate the same workspace concurrently.
- [ ] Define evidence and reproducibility contracts for research claims;
  generic LLM review is not an adequate scientific verifier.
