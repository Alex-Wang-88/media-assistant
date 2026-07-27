# 0004. Recoverable local task deletion

Status: Accepted

## Context

The desktop sidebar presents workspace tasks as recent conversations. Users need to remove an
entry, but a task directory can contain generated files and local content that cannot be recreated.
The renderer is sandboxed and must not mutate workspace files directly.

## Decision

Task deletion is exposed as a typed `tasks:delete` IPC operation. The main process validates the
project UUID, resolves the project from the active workspace, and moves its directory into
`.yoom/trash/任务` before removing its project and file-index rows in one database transaction.

If the database update fails, the directory is moved back to its original location. The renderer
requires an explicit confirmation and refreshes the task query only after the operation succeeds.
Deletion is disabled while a chat response is streaming.

## Consequences

- Deleted tasks immediately disappear from recent conversations.
- Task content remains locally recoverable from the workspace trash.
- Renderers retain no filesystem authority.
- A failed delete leaves the task visible and restores its directory, so the user can retry.
