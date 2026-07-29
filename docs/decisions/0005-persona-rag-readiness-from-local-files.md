# 0005. Persona RAG readiness comes from local files

Status: Accepted

## Context

The first-run experience must not show knowledge-dependent shortcuts before the user has completed
the guided Persona conversation. Reference files alone do not establish the brand's core identity.
The real retrieval index is not implemented yet, but the initial interface needs a testable local
readiness boundary and a local upload path.

## Decision

The desktop main process owns a fixed local directory: `企业知识库/用户Persona RAG/`. The renderer
starts a dedicated plain-text conversation through the existing streaming Agent API. The local
welcome message asks for the user's industry, then the Agent decides each follow-up from the full
conversation history and optional local reference context.

When the Agent returns the final report sections, the renderer presents the complete report as an
editable Markdown draft. Only an explicit user confirmation invokes the separate validated write
command that creates `persona.md`. Unconfirmed reports never create the file. The saved Markdown
remains editable through the existing local document editor.

Reference material is selected with a main-process file dialog and copied into the local `资料`
subdirectory. Readiness is true only while `persona.md` exists. The renderer polls once per second;
deleting the Persona requires explicit modal confirmation and permanently removes both the main
file and its local references. A successful deletion returns the interface to the guided setup.

## Consequences

- Reference uploads never masquerade as a completed Persona.
- Persona conversation history remains plain text and does not depend on tool calls or JSON cards.
- The final Agent report is preserved as editable local Markdown after explicit confirmation.
- Persona deletion is irreversible and requires a warning dialog before the main process removes
  the complete local Persona directory.
- Deleting the Persona main file changes the interface without application state flags.
- The renderer receives selected file names but never receives filesystem write authority.
- A future persistent index can replace this readiness rule without giving the renderer filesystem
  access.
