# Roadmap

Axon will grow in one direction: first make a single long-running task trustworthy,
then make the same foundation useful across many kinds of work.

This is not a calendar of promised features. It is the order in which we believe the
hard problems should be solved.

## Now — make one autonomous task real

The first release should prove a complete experience, not a collection of demos.

- [ ] Package a pinned DeepSeek Harness runtime inside the desktop app.
- [ ] Start from a plain-language goal without exposing Node.js, a terminal, or runtime
  setup to the user.
- [ ] Show progress, important decisions, boundary crossings, artifacts, and failures in a focused
  React interface.
- [ ] Persist the run as an event stream and restore the same visible state after a crash
  or restart.
- [ ] Complete one bounded, read-only task and return a real artifact with evidence.

The milestone is done when a development build can be closed during a task, reopened,
and continue from the same trustworthy state.

## Next — close the loop

Once the desktop spine works, Axon needs to prove that it can improve work instead of
merely producing more of it.

- [ ] Establish a baseline, make one change, evaluate it, keep or discard it, and repeat
  within a hard budget.
- [ ] Introduce stable schemas for goals, events, artifacts, evaluations, decisions, and
  checkpoints only after the first end-to-end run proves what is actually needed.
- [ ] Enforce declared boundaries before writing outside the workspace, spending money,
  publishing, messaging people, or taking a destructive action.
- [ ] Ship a reproducible optimization example inspired by autoresearch, with a mechanical
  metric, a fixed budget, a complete history, and working rollback.

The loop is credible only when it can reject its own bad work, survive interruption, and
cannot declare success with persuasive prose alone.

## Then — become a useful workbench

- [ ] Preview code diffs, Markdown, PDFs, spreadsheets, datasets, images, video, and
  structured reports without forcing users into another tool.
- [ ] Run the same task against local, containerized, and remote execution environments.
- [ ] Support multiple model providers without moving provider-specific assumptions into
  the autonomy kernel.
- [ ] Publish a plugin SDK, compatibility tests, trust metadata, and example evaluators.
- [ ] Let background tasks continue without keeping the main window open, with useful
  notifications when the user is actually needed.

At this point, unrelated use cases should share the same core and interface. If every
new domain needs a new orchestration stack, the architecture has failed.

## Later — coordinate larger systems

- [ ] Coordinate specialized agents with explicit ownership, budgets, merge rules, and
  independent evaluation.
- [ ] Turn verified run history into reusable knowledge without turning stale conclusions
  into permanent truth.
- [ ] Move portable checkpoints across local devices, cloud sandboxes, GPUs, and external
  systems.
- [ ] Add organization policies, audit exports, reproducibility bundles, and scoped
  delegation.

Multi-agent execution will be added when it produces a measured advantage over one good
agent—not because a diagram with more agents looks more advanced.

## The long horizon

These are research directions, not release promises:

- Closed-loop scientific work across literature, hypotheses, code, simulation,
  experiments, and analysis.
- Systems that improve their tools, prompts, evaluators, and orchestration without hiding
  reward hacking behind a higher score.
- Safe connections to laboratories, robots, enterprise systems, and public infrastructure.
- Shared libraries of verified procedures and results that do not centralize credentials,
  private data, or irreversible authority.

Some of this is beyond what current models and infrastructure can do reliably. That is
not a reason to pretend it already works, and it is not a reason to aim lower.
