# Specifications

This directory contains normative contracts for behavior that must remain stable across
the GUI, Electron Main, the Runtime process, DeepSeek Harness adapters, and plugins.

Specifications are not product announcements. A requirement is included here only when
it can be reviewed through code, a durable fixture, an automated test, or an explicit
release procedure.

## Active specifications

- [Desktop Runtime Reliability and Release Acceptance](DESKTOP-RUNTIME-RELIABILITY.md) —
  run-state integrity, recovery, cancellation, credentials, workspace boundaries, IPC,
  plugin isolation, and desktop release gates.

## Change rules

- Use `MUST`, `MUST NOT`, `SHOULD`, and `MAY` as normative terms.
- State current exceptions under **Known gaps**; do not weaken a requirement silently to
  match incomplete code.
- A change to a durable event, security boundary, approval rule, or release gate MUST
  update its tests and this specification in the same pull request.
- Design discussion belongs in an RFC. Roadmap ordering belongs in
  [`docs/ROADMAP.md`](../ROADMAP.md). This directory contains accepted behavior only.
