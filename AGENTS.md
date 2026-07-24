# Yoom architecture constraints

- Do not add a web product or remote renderer entry point. Electron is the only product UI.
- Renderer code must not access Node or Electron APIs directly.
- Local files are the only writable content source of truth.
- The server returns pending deliveries and must never overwrite local workspace files.
- AI SDK is a UI streaming consumer only; Pydantic AI owns agent decisions and tools.
- Business modules must consume typed provider adapters, never raw third-party responses.
- Define and validate schemas before adding IPC, HTTP API, Markdown, or device commands.
- Never hand-edit generated code under `packages/generated-api-client`.
- New behavior requires success, failure, retry, and recovery coverage where applicable.
- Keep dependencies explicit. Do not introduce global business-state singletons or untyped events.
- Update a short ADR and boundary tests before changing a core architecture boundary.
