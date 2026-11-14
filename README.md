# github-core-clone-forge

A standalone GitHub-compatible git forge in one Node.js process, with no
dependencies beyond the standard library. It serves repositories, issues, pull
requests, and contents over REST v3, answers GraphQL queries and mutations the
way `gh` and github-mcp-server send them, exposes MCP tools, and speaks git
smart HTTP (protocol v2 and v0) so a real git client can clone, fetch, and
push — all from a single in-memory store.

## Run

```sh
node --experimental-strip-types main.ts
```

`main.ts` binds an ephemeral port, registers it with the trial environment
(`MAKEFUN_ENV_URL`), and exits when the environment reports the trial is done.
The bearer token for the API is read from `MAKEFUN_SHOP_TOKEN`.

## Layout

- `main.ts` — entrypoint and env lifecycle (bind, register, poll `/done`).
- `app.ts` — HTTP routing: `/healthz`, `/api/v3/*`, `/api/graphql`, `/mcp`,
  `/{owner}/{repo}.git/*`.
- `store.ts` — in-memory store, the git object model (SHA-1 blobs/trees/
  commits), scenario derivation, and the shared helpers.
- `rest.ts` — GitHub REST v3 handlers (repos, refs, branches, commits,
  contents, labels, issues, comments, pull requests with squash merge).
- `graphql.ts` — hand-written GraphQL parser/executor for the viewer,
  repository, issue, pull request, search, and node queries plus the
  create/close/merge mutations.
- `mcp.ts` — Model Context Protocol over Streamable HTTP (server/discover,
  initialize, tools/list, tools/call).
- `git.ts` — git smart HTTP: pkt-lines, packfiles (full objects only, no
  deltas), upload-pack v2/v0 with shallow fetch and deepen, receive-pack v0
  with report-status and fast-forward checks.

## Determinism

Commit timestamps are fixed (epoch 0) and pack generation is deterministic, so
the same sequence of operations produces the same object ids in every run.
No wall-clock time, no randomness, and no model calls appear in any request
path.

## License

MIT — see `LICENSE`.
