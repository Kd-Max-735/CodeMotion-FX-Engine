# Field-spec ownership

- `batch-01` through `batch-08` are the isolated field-spec ownership roots for future new effect-function batches.
- `existing-01` and `existing-02` are the isolated field-spec ownership roots for future adapters over existing effects.
- A directory placeholder is not an implementation and is never imported by the public registry.
- A field specification must classify every field as either model-generatable `params` or server-authorized `inputs`; one field cannot be both.
