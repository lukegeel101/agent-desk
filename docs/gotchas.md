# Gotchas

Problems hit while building Agent Desk, and their verified fixes.

## `node --test test/` runs every file in the folder

Passing the folder made Node 22 run `test/fake-claude.mjs` as a test too, which waits on stdin and fails.
Fix: `npm test` passes the glob `test/*.test.mjs`.

## A test that reads a running reply's first step can race the run

The fake run is marked running before it has written any events, so `lastStep` can still be empty.
Fix: the test waits until `lastStep` is present rather than until the status is `running`.

## Runs outlive the test process unless stopped

Runs are spawned detached (their own process group, so Stop can end the whole tree), so a test that leaves one sleeping keeps it alive after the test ends.
Fix: the end-to-end suite calls `desk.stopAll()` in `after()`, and the server does the same on SIGINT and SIGTERM.

## `claude` refuses to start inside another Claude Code session

A desk started from a Claude Code terminal inherits `CLAUDECODE`, and child `claude` processes then refuse to run.
Fix: `childEnv()` in `server/desk.mjs` removes `CLAUDECODE` and `CLAUDE_CODE_ENTRYPOINT` before spawning.

## Runs use your own Claude Code settings

`acceptEdits` alone would block Bash, but a run may still use it when your `~/.claude/settings.json` allows that command.
This is intended (your permission rules apply), but it means two people with the same `DESK_PERMISSION_MODE` can see different behaviour.

## Screenshots of a real desk show your working folder and username

The empty state and the live step text print the full `DESK_WORKDIR` path, which includes your home folder name.
Fix: when taking README screenshots, rewrite every `/api/` response in the browser (a Playwright `route`) to replace the folder with `~/work`, and use a scratch folder of made-up files.

## Screenshots of an old conversation show the "Cold resume" notice

A conversation idle for more than the prompt-cache lifetime shows a notice that the next message reads its context again.
This is expected; take screenshots soon after the runs if you want a page without it.

## A folder's own permission rules are ignored until the folder is trusted

A rule added to `<DESK_WORKDIR>/.claude/settings.json` had no effect: the run was still refused, and its error output said "Ignoring 1 permissions.allow entry from .claude/settings.json: this workspace has not been trusted".
Claude Code reads a project's settings only after the trust prompt has been accepted in that folder, and trust is per folder, not inherited from a trusted parent.
Fix: Add permission defaults to "This desk's runs only", a settings file in the desk's data folder that every Claude run gets with `--settings`, which works in any folder.
The two folder choices remain and say that the folder must be trusted.

## `codex exec --json` gives a turn's total tokens, not the context size

The `turn.completed` event sums every model call of the turn, so a small task that made three calls looked like it held three times its real context.
Fix: the context figure comes from the newest `token_count` record in the session file the Codex CLI keeps under `~/.codex/sessions` (`last_token_usage.total_tokens` and `model_context_window`).

## Codex prints an `error` item that is not a failure

A run can start with `{"type":"item.completed","item":{"type":"error","message":"Skill descriptions were shortened..."}}` and still succeed.
Fix: only `turn.failed` marks a Codex run as failed; a lone `error` item is ignored.

## An agent must not be able to click its own permission dialog

While testing, a script tried to click Add in the confirmation dialog through System Events, and the session's own safety check refused it.
That refusal is the point of the dialog: the test now injects a stand-in for the dialog, and a recording desk uses `DESK_PERMISSION_CONFIRM=none` with rules that go to its throwaway data folder.

## The permission test passed on macOS and failed in CI

CI runs on Linux without `zenity`, so the desk decided it had no way to ask and refused the write before the test's stand-in dialog was ever called.
Fix: `createDesk(config, { confirm })` treats an injected confirmation as a dialog on any platform; the platform rules themselves are tested separately with the platform passed in.
