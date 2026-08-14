# Security Policy

Axon Auto Agent is not yet a runnable release. No current commit should be treated as a
secure sandbox, production automation system, or authorization boundary.

## Reporting

Do not open a public issue for a vulnerability that could expose credentials, private
artifacts, local files, remote systems, or an actionable sandbox escape. Use GitHub's
private vulnerability reporting once the public repository enables it. Until then,
contact the maintainers through a private channel listed on the organization profile.

## Security invariants

- Selected workspaces are deny-by-default boundaries, not organizational hints.
- Credentials never appear in prompts, durable events, screenshots, or artifacts unless
  a protocol explicitly requires a redacted reference.
- External messages, payments, publication, destructive changes, and physical actions
  are separate authority classes.
- Approval records include the exact proposed action and cannot be reused for a broader
  action or silently extended after expiry.
- A plugin is executable code. Discovery does not imply trust; versions and integrity
  must be pinned before installation.
- Remote execution success requires a structured receipt or verified artifact, not a
  disconnected stream or optimistic UI state.

Future releases must publish a threat model, supported platform matrix, dependency
policy, update-signing contract, and security limitations before being called stable.
