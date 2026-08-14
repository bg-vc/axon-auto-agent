# Desktop Runtime Reliability and Release Acceptance

Status: Active

Applies to: `apps/desktop`, `packages/contracts`, `packages/runtime`, and
`profiles/desktop`

## 1. Purpose

This specification defines the minimum trustworthy behavior of the Axon Auto Agent
desktop application. It covers the failure cases that decide whether a long-running
Agent is a usable product: duplicated execution, false success, stale approvals, leaked
credentials, commands that survive cancellation, unreplayable UI state, and packages
that build but do not start on a clean machine.

`MUST`, `MUST NOT`, `SHOULD`, and `MAY` are normative terms.

## 2. Process and API boundaries

- The Renderer MUST run with sandboxing and context isolation enabled and Node integration
  disabled.
- Preload MUST expose a typed, capability-specific API. It MUST NOT expose generic
  `ipcRenderer`, arbitrary channels, filesystem primitives, or shell execution.
- Main MUST accept privileged IPC only from the top frame of the current main window and
  its exact packaged renderer URL or configured development origin.
- Agent execution, model streaming, tools, plugins, sessions, and event persistence MUST
  run in the Utility Process. They MUST NOT run in Renderer or block Electron Main.
- Main MUST supervise one current Runtime child. Exit events from an obsolete child MUST
  NOT clear or restart a newer child.
- A Runtime that fails to become ready MUST be terminated before another start attempt.
- Renderer MUST consume Axon contracts only. Harness-specific or provider-specific types
  MUST remain behind the Runtime adapter.

## 3. Durable run-state invariants

- A session MUST have at most one active run controller and one tracked run promise.
  Concurrent send or resume requests MUST NOT create duplicate Agent loops.
- Durable events MUST contain `sessionId`, strictly increasing `seq`, `timestamp`, `type`,
  and payload. An event MUST be appended before it is announced as durable to Renderer.
- UI state after replay MUST agree with the last durable lifecycle event.
- Runtime startup MUST reconcile a session left in `running` or
  `waiting_for_decision`. It MUST deny stale pending decisions and append
  `run/interrupted`; it MUST NOT present the old action as active or successful.
- A denied, cancelled, failed, or interrupted action MUST NOT be projected as completed.
- A model stream with no content, reasoning, or tool call MUST fail. It MUST NOT create an
  empty assistant result followed by `run/completed`.
- An assistant tool-call turn MUST be replayed only when every declared tool call has a
  corresponding durable result. Incomplete tool-call groups and stray tool results MUST
  be removed before the transcript is sent back to a provider.
- `run/completed` currently means that the model produced a non-empty terminal turn with
  no unfinished tool call. Outcome-level completion MUST later be gated by the accepted
  evaluation contract; model prose alone is not sufficient for that future transition.

## 4. Cancellation, shutdown, and recovery

- Stop MUST abort the active model request and any running command for that session.
- Stopping or shutting down while waiting for approval MUST durably resolve the decision
  as denied before the Runtime exits.
- Runtime shutdown MUST wait for tracked runs to settle within a bounded deadline. Main
  MAY kill the Utility Process after that deadline, but the next startup MUST reconcile
  the interrupted run.
- A command timeout or abort MUST prevent delayed command side effects from continuing
  under the application-owned process.
- Runtime restart MUST preserve durable events and MUST NOT display an unfinished action
  as successful.
- Automatic continuation from the exact interrupted action requires a durable checkpoint
  and external-side-effect reconciliation. Until that exists, recovery MUST stop honestly
  and require explicit resume.

## 5. Credentials and model transport

- API keys MUST be stored through Electron `safeStorage` when encryption is available.
  Plaintext credentials MUST NOT be written to configuration, events, artifacts, logs,
  diagnostics, or Renderer state.
- Credentials MUST be injected into Runtime memory only when configuring or invoking a
  provider.
- Provider errors and model output MUST be redacted before persistence. Redaction MUST
  also work when a credential is split across streamed chunks.
- Model response bodies, SSE lines, accumulated streamed payload, tool-call count, and
  request duration MUST have explicit limits.
- Provider endpoints MUST use HTTPS. Plain HTTP MAY be used only for localhost development
  endpoints. Credentials embedded in endpoint URLs MUST be rejected.
- Packaged Renderer content security policy MUST NOT permit arbitrary network connections;
  model networking belongs to Runtime.

## 6. Workspace, attachments, tools, and artifacts

- Read and write tools MUST be confined to the user-selected workspace by both lexical
  path checks and real-path checks. Symbolic links MUST NOT escape the boundary.
- A workspace write or command MUST follow the configured decision policy. Missing policy
  data or a stale decision MUST NOT be treated as approval.
- Message attachments MUST be copied into application-owned storage before the message is
  committed, so later source-file changes cannot silently change replayed input.
- The first release accepts at most five text or JSON attachments of at most 300 KB each.
  Unsupported or oversized inputs MUST fail before a user message or run is committed.
- Artifacts MUST be registered only after a successful write and MUST preserve producing
  session, local path, media type, size, and creation time.
- Renderer MUST access previews through the controlled `axon-artifact://` protocol. It
  MUST NOT receive a general-purpose `file://` capability.
- Shell execution is trusted local code with user approval, not an operating-system
  sandbox. Product copy MUST NOT describe it as one until platform sandbox tests exist.

## 7. Plugins and Harness compatibility

- The application MUST pin one tested DeepSeek Harness version and report a compatibility
  mismatch without silently loading an unknown internal API.
- Axon UI and contracts MUST NOT import undocumented Harness internals.
- Development plugins MUST execute in Runtime, declare identity, version, Harness
  compatibility, and capabilities, and fail without crashing Main or Renderer.
- Third-party plugins MUST NOT inject arbitrary React, HTML, preload code, or Main-process
  handlers.
- Loading a local development plugin means executing trusted local code. The interface
  MUST state that boundary; validation is compatibility checking, not a security sandbox.
- Migration from the current OpenAI-compatible loop to the native DSH Agent Loop MUST
  happen behind the existing Runtime contract and include a pinned profile/plugin-tree
  fixture.

## 8. User-facing failure behavior

- Send failure MUST preserve unsent text and attachments.
- Runtime interruption, user stop, tool failure, and model failure MUST have distinct
  durable states and understandable recovery actions.
- Closing the main window MAY hide it to the tray while work continues. Explicit quit MUST
  identify active tasks, require confirmation, flush durable events, and stop Runtime.
- The GUI SHOULD foreground goals, decisions, current work, failures, and artifacts.
  Raw trajectories and session logs MUST remain secondary diagnostics.

## 9. Required verification

Every change to Runtime lifecycle, IPC, credentials, tools, persistence, packaging, or
updater behavior MUST pass:

```bash
pnpm check
pnpm audit --registry=https://registry.npmjs.org
pnpm test:e2e
```

The automated suite MUST cover at least:

- replay of a completed stream;
- real workspace artifact creation;
- approval before a guarded write;
- stale approval and interrupted-run reconciliation;
- attachment snapshotting and binary rejection;
- empty model response failure;
- credential redaction in errors and across stream chunks;
- cancellation of a command before a delayed side effect;
- production Renderer startup and typed communication with Runtime.

A public macOS release additionally MUST pass all of the following on a clean user account:

1. build the arm64 application without relying on a separately installed Node.js;
2. sign every executable component with the intended Developer ID;
3. notarize and staple the DMG;
4. install, launch, configure a provider, stream a response, read an approved workspace,
   generate and preview a local artifact, hide to tray during work, and recover from a
   forced Runtime exit;
5. verify that exported diagnostics and on-disk events contain no API key;
6. uninstall without leaving an active service or process.

An unsigned directory build is valid for automated functional testing. It is not release
evidence and MUST NOT be presented as a signed/notarized acceptance result.

## 10. Change and migration requirements

- Adding or changing a durable event type MUST include projection, replay, and recovery
  tests. If old sessions need transformation, the migration rule MUST be versioned.
- Changing IPC MUST update contracts, Preload, Main validation, and Renderer callers in the
  same change.
- Changing Harness, Electron, updater, or packaging dependencies MUST run the production
  dependency audit and packaged-application smoke test.
- A release MAY temporarily accept a documented known gap. It MUST NOT relabel the missing
  behavior as implemented or weaken a safety invariant to make a test pass.

## 11. Known gaps

- Native DSH Agent Loop and profile composition have not yet replaced the compatibility
  OpenAI loop.
- The JSONL store does not yet serialize appends at the storage layer or recover a corrupt
  trailing record; current correctness still depends on the single Runtime control flow.
- Interrupted tool actions do not yet resume automatically from a durable checkpoint.
- Commands are approval-gated but do not yet run in a platform-enforced sandbox.
- Signed and notarized clean-account DMG acceptance has not yet been completed.
- Package size has not yet been budgeted or reduced after determining the required native
  Harness plugin tree.
