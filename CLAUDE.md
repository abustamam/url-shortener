# CLAUDE.md — Project Conventions

## What This Project Is

A URL shortener built phase-by-phase as a learning-in-public blog series. Each phase introduces one infrastructure concept. The running themes: measure before optimizing, show the failure before the fix.

See [ROADMAP.md](ROADMAP.md) for the full phase plan.

---

## Branching Strategy

**`main`** = the most recently completed and published phase. Always deployable.

**`phase/N-name`** = active development branch for the next phase. Branch off `main`.

**Tags** = permanent snapshots at each phase completion. Format: `vN-short-name` (e.g., `v1-baseline`, `v2-redis-cache`).

### Workflow per phase

```
git checkout -b phase/N-name        # start new phase
# ... build, deploy, measure, write post ...
# open PR → merge to main
git tag vN-short-name               # tag the merge commit on main
git push origin vN-short-name       # push tag
```

Blog posts link to the PR (diff = what changed) and the tag (full state at that phase).

---

## What Lives on `main`

Everything, including deployment config (`Caddyfile`, `docker-compose.yml`). If we migrate away from Caddy or Docker later, we update or delete those files then.

---

## Repo Conventions

- **`drafts/`** — blog post drafts. Gitignored, never committed.
- **`ROADMAP.md`** — phase tracking. Update status and check off tasks as work completes.
- **AI transparency** — implementation may be AI-scaffolded. All measurements, chaos experiments, and deployment observations must be hands-on and real.

<!-- CODELEDGER:BEGIN -->
## CodeLedger Integration

This repo uses [CodeLedger](https://github.com/codeledgerECF/codeledger) for deterministic context selection.
CodeLedger is a **real CLI tool** — not a prompt technique. All commands must run in a real shell.
Version and license tier are **local runtime state**, not shared repo state. Check them with `codeledger --version` and `codeledger license status` on the current machine.

### How It Works — Zero Friction

CodeLedger runs **entirely in the background** via hooks. You don't need to learn any commands.
Just describe your task in plain English and start coding — CodeLedger handles the rest:

1. **You send a message** → CodeLedger automatically extracts the task intent
2. **Context is selected** → the most relevant files are scored and bundled deterministically
3. **Bundle is ready** → `.codeledger/active-bundle.md` contains ranked files with code excerpts
4. **You code normally** → CodeLedger tracks progress, drift, and recall in the background
5. **Session ends** → CodeLedger shows how well the bundle predicted the files you changed

Meaningful-task auto-refresh is automatic in environments that honor CodeLedger hooks (for example Claude Code sessions).
Repo-local ambient wrappers like `./.codeledger/bin/codex "your request"` and `./.codeledger/bin/claude "your request"` now apply the same rule before handoff in non-hook environments.
In browser/cloud agent containers, use the pinned runtime directly: `node .codeledger/bin/codeledger-standalone.cjs auto-refresh --prompt "<user request>"`.
If you need to trigger the rule directly, use `./.codeledger/bin/codeledger auto-refresh --prompt "<user request>"`: refresh on new meaningful tasks, skip acknowledgements like "yes please" or same-task follow-ups.
Ambient toggles live in `.codeledger/config.json` under `ambient.auto_refresh_enabled` and `ambient.prompt_coach_enabled`.
For mid-session retrieval, call `./.codeledger/bin/codeledger broker refresh --task "<user request>" --json` first. Use the returned ranked files and bundle delta before falling back to raw shell search.
Broker responses include `retrievalContract.schema_version: "codeledger/broker-first/v1"`, and hooks/wrappers write `.codeledger/runtime/latest-broker-contract.json` as proof that raw search is only a fallback.
To inspect the current session state, use `./.codeledger/bin/codeledger broker current --json` for the current bundle/delta and `./.codeledger/bin/codeledger broker timeline --limit 10 --json` for the recent truth tail.

### CLI Resolution

Use the repo-local wrapper at `./.codeledger/bin/codeledger` when it exists.
It keeps repo-local behavior stable when versions differ and falls back to the vendored standalone runtime when needed.

```bash
# Preferred in a repo after `codeledger init`:
./.codeledger/bin/codeledger <command> [args...]

# Global shorthand (same machine, outside repo-local wrapper):
codeledger <command> [args...]

# Pinned fallback (browser/cloud/CI or debugging):
node .codeledger/bin/codeledger-standalone.cjs <command> [args...]
```

**Do NOT use `npx codeledger`** — it may resolve to a stale version from the npm registry.

### Auto-Activation (Hooks Handle This)

Hooks in `.claude/hooks.json` run automatically — you do NOT need to run activate manually.
When you send a message, the `UserPromptSubmit` hook checks whether the prompt starts or materially changes the task, then refreshes context only when needed.
It is intentionally designed to refresh for meaningful prompts like "Please make sure we have this happening in all environments" and skip follow-ups like "Yes please."

If you need to activate manually (e.g., to refine the task description):

```bash
./.codeledger/bin/codeledger refresh
./.codeledger/bin/codeledger activate --task "describe the task"
```

### Core Rules

1. **Execute via shell** — never simulate, fabricate, or approximate CodeLedger output. If a command fails, say so.
2. **Verify results** — check exit codes. Show errors to the user. Suggest `codeledger init` for missing config.
3. **`.codeledger/` is read-only** — never create/edit files there. Use CLI commands instead (`activate`, `session-progress`, `session-summary`).
4. **Read the live truth ledger lightly** — before a new turn, inspect only the latest timeline state from `.codeledger/session/timeline.md` (for example the last 20-25 entries), not the whole file.

### Mid-Session Commands

| Command | When to use |
|---------|-------------|
| `./.codeledger/bin/codeledger progress-check` | After completing a stage — see bundle coverage |
| `./.codeledger/bin/codeledger refresh` | Force a rebuild of the repo graph/index during a long session |
| `./.codeledger/bin/codeledger refine --learned "..."` | When you discover new context or task shifts |
| `./.codeledger/bin/codeledger broker refresh --task "..." --json` | First retrieval step for a new or shifted task inside the same session |
| `./.codeledger/bin/codeledger broker current --json` | Inspect the current active bundle, bundle delta, and recent timeline tail |
| `./.codeledger/bin/codeledger broker timeline --limit 10 --json` | Inspect the recent truth ledger tail without rereading the whole file |
| `./.codeledger/bin/codeledger review-coverage` | Mid-review — check which bundle files are unread |

### All Commands

`activate`, `scan`, `refresh`, `bundle`, `refine`, `progress-check`, `session-progress`, `session-summary`,
`review-coverage`, `doctor`, `verify`, `manifest`, `intent`, `checkpoint`, `setup-ci`, `vendor`, `pre-pr`, `auto-refresh`

Run `./.codeledger/bin/codeledger help` for details on any command.

**Trigger phrases:** If the user asks for a "session summary" or "how did the bundle do" — run `./.codeledger/bin/codeledger session-summary`. Do not construct the output yourself.

### Hooks (Automatic)

Hooks in `.claude/hooks.json` run automatically:

- **SessionStart** — scans repo, warms index
- **UserPromptSubmit** — intent-aware auto-refresh; skips "yes please" style follow-ups and same-task replies
- **PreToolUse** — reminds agent to check the active bundle before editing
- **PostToolUse** — shows bundle recall/precision and a compact value receipt after git commits
- **PreCompact** — saves progress snapshot before context compaction
- **Stop** — shows final session recap with recall, precision, token savings

### Multi-Session

If `CODELEDGER_SESSION` is set, pass `--session $CODELEDGER_SESSION` to commands.
Session bundle: `.codeledger/sessions/{session-id}/active-bundle.md`.

<!-- CODELEDGER:END -->