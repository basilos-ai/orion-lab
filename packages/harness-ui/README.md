# Basilos UI source adoption

Direct source adoption of the user-supplied Web UI Harness PromptInput and required UI primitives. The project owner expressly authorized MIT redistribution on 2026-10-20. Original SHA-256 values and adaptations are retained in docs/component-provenance.json. No Workbench business modules or credentials are included.

Import relocation, type-only structural interfaces, line ending normalization and the optional clearOnSubmit flag differ in PromptInput: controlled host drafts must not clear before admission. PromptInput's own file/screenshot capabilities remain disabled; any separate image flow belongs to the host.

The 2026-10-28 integration follows the official local CLI and source synchronization guides. Card, Alert, NativeSelect, Table, Skeleton, Empty, Progress, Separator and Kbd are copied from the maintained Basilos component source, with no new runtime dependencies. Table adds containerProps so the actual scrolling container can receive an accessible name, keyboard focus and host styles. Other new modules differ only in line endings.

Exact source identities, adopted hashes and the recoverable Git baseline are recorded in `docs/basilos-ui-components.json`. Component behavior is consumed locally; the documentation preview application is never a runtime dependency.
