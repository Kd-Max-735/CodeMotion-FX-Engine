# Tool field specifications

- `tools/` contains exactly one Markdown specification for each of the 120 registered tools.
- Every file uses the canonical `<tool_name>.md` name so the Registry mapping remains explicit and auditable.
- A field specification must classify every field as either model-generatable `params` or server-authorized `inputs`; one field cannot be both.
- Batch ownership remains in the source and test directories; it no longer determines the runtime Markdown path.
