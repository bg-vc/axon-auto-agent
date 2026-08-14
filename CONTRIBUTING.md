# Contributing

Axon Auto Agent is still early enough for a good contribution to change the shape of
the project.

The most useful work right now is work that makes one real autonomous task more reliable
or one important part of the desktop experience dramatically clearer.

## Where help matters

- embedding DeepSeek Harness in a restart-safe desktop application;
- turning runtime events into calm, understandable progress;
- sandboxing, permissions, and safe handling of local files;
- evaluators that can prove whether work actually improved;
- previews for documents, code, data, images, and video;
- reproducible research and engineering examples;
- accessibility, localization, and cross-platform packaging;
- honest technical writing in English and Chinese.

If you want to introduce a large feature, open an issue first. Explain the problem from
the user's point of view, the smallest version worth building, the main failure modes,
and how we would know it works. A concrete working slice is more valuable than a large
framework designed for hypothetical use cases.

## Pull requests

- Keep the change focused and explain what becomes possible because of it.
- Include tests or a reproducible example for executable behavior.
- Update English and Chinese public documentation together.
- Do not commit credentials, private traces, user files, generated runs, or machine-local
  configuration.
- Run `pnpm check` before submitting.

Please read [the architecture notes](docs/ARCHITECTURE.md),
[the roadmap](docs/ROADMAP.md), and [the security policy](SECURITY.md) before changing
runtime, persistence, permissions, or plugin boundaries.

By contributing, you agree that your contribution is licensed under Apache-2.0.
