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
