# Desktop application

Runnable Electron 43 + React 18 desktop application for Axon Auto Agent.

## Process boundaries

- `src/renderer`: sandboxed React UI. No Node.js integration or raw IPC access.
- `src/preload`: the typed `window.axonAutoAgent` whitelist only.
- `src/main`: windows, tray, dialogs, credentials, updates, artifact protocol, and
  Utility Process supervision.
- `src/runtime`: sessions, streaming model adapter, workspace tools, decisions,
  artifacts, plugin loading, and append-only persistence.

The Runtime process may crash and restart without taking down the desktop window. API
keys are resolved by Main and passed to Runtime memory only; they are not included in
Renderer state, events, logs, or diagnostics.

## Commands

Run from the repository root:

```bash
pnpm dev
pnpm check
pnpm test:e2e
pnpm package:mac
```

`package:mac` creates an arm64 DMG and ZIP. Signing and notarization activate when
`APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, and `APPLE_TEAM_ID` are provided with a valid
Developer ID identity. Never commit those values.

## Current boundary

Harness `0.1.0-rc.6` is pinned and compatibility-checked. The interactive execution path
currently uses the stable Axon runtime adapter; native DSH Agent Loop composition remains
behind that adapter until the preview API is sufficiently stable. This application does
not embed the DSH WebUI and does not provide a CLI user workflow.
