# Runtime adapter

The runtime package owns the stable boundary between the desktop process and the
developer-preview DeepSeek Harness packages. It also contains the append-only event
store, OpenAI-compatible stream parser, workspace confinement helpers, and development
plugin validator used by the desktop utility process.

Application UI code must not import DeepSeek Harness packages directly.
