# Axon Auto Agent

This repository is the GUI-first autonomous-work project built on DeepSeek Harness.
It contains a runnable desktop development build. Describe only capabilities verified by
the code and tests, and do not present remaining roadmap items as implemented features.

## Product rules

- The primary user experience is a desktop GUI. A CLI may exist later for CI and
  debugging, but it is never the main product surface.
- Treat DeepSeek Harness as an upstream runtime dependency and extension platform.
  Do not fork, vendor, or patch its source unless an accepted RFC records why an
  out-of-tree profile or plugin cannot solve the problem.
- Keep the product model-neutral. DeepSeek is the default reference adapter, not a
  permanent model lock-in.
- Describe autonomy as a verifiable loop: define an outcome, plan, act, observe,
  evaluate, checkpoint, and continue. Never equate an unbounded chat loop with
  reliable automation.
- Preserve a strict separation between the GUI, autonomy contracts, orchestration,
  plugins, execution providers, and external systems.
- Every durable fact must be replayable from an append-only run event stream.
- Irreversible, external, paid, or privacy-sensitive actions require explicit policy
  and an approval boundary. Silence is never approval.
- Long-running work must survive window closure, process restart, cancellation, and
  partial failure without pretending that incomplete work succeeded.

## Documentation rules

- Keep `README.md` and `README.zh-CN.md` in the same section order and meaning.
- Separate **Available today**, **In development**, and **North star** claims.
- Use plain-language checkboxes for planned work. Each item must name a concrete
  capability or decision; do not add category prefixes or project-management
  boilerplate just to make a list look formal.
- Architecture diagrams must remain editable SVG with accurate labels. Keep English
  and Chinese variants aligned.
- Do not publish benchmarks, security claims, model comparisons, or autonomy rates
  without a reproducible artifact checked into the appropriate future benchmark
  directory.
- User-facing prose should be ambitious but falsifiable. State hard problems openly.

## Repository boundaries

- `apps/desktop/`: desktop shell and GUI only.
- `packages/contracts/`: model-neutral goal, run, event, artifact, policy, and
  evaluation contracts.
- `packages/runtime/`: Axon Auto Agent orchestration plugins mounted into DeepSeek Harness.
- `profiles/desktop/`: the composed DSH desktop profile and configuration patches.
- `examples/`: reproducible vertical slices with evaluators and safe fixtures.
- `runs/`, `workspaces/`, and `artifacts/`: local generated data; never commit them.

## Validation

Run from the repository root:

```bash
pnpm check
```

Once executable packages are added, extend this command instead of replacing it.
