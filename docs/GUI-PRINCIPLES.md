# GUI Principles

## The interface promise

A user should be able to give Axon a meaningful outcome, understand what it is doing,
intervene at the right moment, inspect the result, and leave the application running
without learning agent-framework vocabulary.

## Default composition

```text
┌──────────────────────────────────────────────────────────────────────┐
│ Goal · status · elapsed time · budget · pause/stop                   │
├────────────────┬──────────────────────────────────┬──────────────────┤
│ Milestones     │ Work stream                      │ Artifacts        │
│                │                                  │                  │
│ ○ Goal         │ Human-readable progress cards   │ Live preview     │
│ ● Research     │ Evidence and decisions in place │ Versions         │
│ ○ Produce      │ Raw trace collapsed by default  │ Export/open      │
│ ○ Verify       │                                  │                  │
├────────────────┴──────────────────────────────────┴──────────────────┤
│ Contextual approval / question / blocked reason / next safe action   │
└──────────────────────────────────────────────────────────────────────┘
```

This is a conceptual information architecture, not a visual design lock.

## Interaction rules

1. **Start with the outcome.** The first screen asks what should exist or be true when
   the work is complete, not which agent or tool the user wants to run.
2. **Translate, then confirm.** Axon converts the brief into a short plan and asks
   the user to confirm boundaries, deliverables, budget, and high-risk authority.
3. **Show semantic progress.** “Comparing five sources” is useful; 8,413 streamed tokens
   are diagnostics. Milestones and evidence lead the interface.
4. **Put decisions in context.** An approval card shows the exact action, destination,
   data, cost, reversibility, reason, and safe alternatives.
5. **Make artifacts first-class.** A result appears in a preview with provenance and
   versions. A filesystem path is supporting metadata, not the experience.
6. **Distinguish waiting from failure.** Waiting for a model, a remote job, a user, a
   schedule, or a dependency are visibly different states.
7. **Never fake continuity.** After reconnect or restart, show reconciliation until the
   runtime has evidence of the real external state.
8. **Preserve expert depth.** Session events, tool calls, model requests, logs, and plugin
   configuration remain inspectable in a diagnostics drawer.

## User-facing state language

Prefer these states: `Preparing`, `Working`, `Waiting for you`, `Waiting for a service`,
`Checking the result`, `Paused`, `Blocked`, `Completed`, `Stopped`, and `Failed`.

Avoid anthropomorphic filler such as “thinking deeply” when the system only knows that a
request is pending. Never label a run “completed” while validation or artifact transfer
is still outstanding.

## Open design work

- [ ] Produce low-fidelity flows for new goal, running, decision, blocked,
  recovery, completion, and failure states before high-fidelity styling.
- [ ] Test whether milestone view or activity cards best reduce long-task
  anxiety with non-technical users.
- [ ] Define a compact mobile/notification projection without pretending the
  full desktop workbench is a responsive web page.
- [ ] Set keyboard, screen-reader, contrast, motion, and localization
  acceptance criteria before component implementation.
- [ ] Specify when screenshots, traces, artifacts, and prompts may leave
  the local device and how the UI communicates that boundary.
