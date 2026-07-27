# 0005. Persona RAG readiness comes from local files

Status: Accepted

## Context

The first-run experience must not show knowledge-dependent shortcuts before the user has completed
the guided Persona conversation. Reference files alone do not establish the brand's core identity.
The real retrieval index is not implemented yet, but the initial interface needs a testable local
readiness boundary and a local upload path.

## Decision

The desktop main process owns a fixed local directory: `企业知识库/用户Persona RAG/`. The renderer
starts a dedicated conversation through the existing streaming Agent API; it contains no fixed
question sequence. The API gives the Agent a Persona-interviewer instruction, the current local
reference context, and a typed `propose_persona` tool.

The Agent decides what to ask based on the conversation and references. When it has enough reliable
information, it calls `propose_persona`. Main validates the tool arguments but does not write a
file. The renderer shows the structured draft, and only an explicit user confirmation invokes the
separate validated write command that creates `persona.md`. Invalid tool arguments and unconfirmed
drafts never create the file.

Reference material is selected with a main-process file dialog and copied into the local `资料`
subdirectory. Readiness is true only while `persona.md` exists. The renderer polls once per second;
deleting the main file returns the interface to the guided setup action even when references remain.

## Consequences

- Reference uploads never masquerade as a completed Persona.
- Deleting the Persona main file changes the interface without application state flags.
- The renderer receives selected file names but never receives filesystem write authority.
- A future persistent index can replace this readiness rule without giving the renderer filesystem
  access.
