# AI Catalog Format: Structural Definition

> Vendored from Agent-Card/ai-catalog `specification/ai-catalog.md` at commit
> `3f7c2407aaa181f6e19d3988d0e8a4011d27c9ac`. Structural sections only. See `README.md` for provenance
> and upgrade policy.

## Top-Level Structure

An AI Catalog document is a JSON object with these fields:

| Field         | Type                   | Required | Notes                                    |
| ------------- | ---------------------- | -------- | ---------------------------------------- |
| `specVersion` | string                 | Yes      | "Major.Minor" format (e.g., "1.0")       |
| `entries`     | array of Catalog Entry | Yes      | May be empty                             |
| `host`        | Host Info object       | No       | Identifies catalog operator              |
| `metadata`    | object (string → any)  | No       | Custom/vendor-specific properties        |

## Host Info Object

| Field              | Type           | Required | Notes                                |
| ------------------ | -------------- | -------- | ------------------------------------ |
| `displayName`      | string         | Yes      | Human-readable host name             |
| `identifier`       | string         | No       | Verifiable identifier (DID, domain)  |
| `documentationUrl` | string         | No       | URL to host documentation            |
| `logoUrl`          | string         | No       | URL to host logo                     |
| `trustManifest`    | Trust Manifest | No       | Verifiable identity/trust metadata   |

## Catalog Entry Object

| Field           | Type                  | Required | Notes                                  |
| --------------- | --------------------- | -------- | -------------------------------------- |
| `identifier`    | string                | Yes      | Unique artifact ID; URN recommended    |
| `type`          | string                | Yes      | Media type identifier for artifact     |
| `url` \| `data` | string \| JSON value  | Yes\*    | \*Exactly one must be present          |
| `displayName`   | string                | No       | Human-readable name                    |
| `description`   | string                | No       | Short description                      |
| `tags`          | array of string       | No       | Keywords for filtering/discovery       |
| `version`       | string                | No       | Semantic versioning recommended        |
| `publisher`     | Publisher object      | No       | Entity publishing artifact             |
| `trustManifest` | Trust Manifest        | No       | Verifiable identity/trust metadata     |
| `updatedAt`     | string (ISO 8601)     | No       | Last modification timestamp            |
| `metadata`      | object (string → any) | No       | Custom extension data                  |

**Entry content requirement**: Must contain exactly one of:

- `url` (string): Retrieval URL for full artifact
- `data` (JSON value): Inline artifact content

## Publisher Object

| Field          | Type   | Required | Notes                          |
| -------------- | ------ | -------- | ------------------------------ |
| `identifier`   | string | Yes      | Verifiable publisher ID        |
| `displayName`  | string | Yes      | Human-readable publisher name  |
| `identityType` | string | No       | Type hint (e.g., "did", "dns") |

## Metadata Extensibility Rules

**Key naming conventions** (recommended):

- Reverse-DNS prefix for vendor keys: `com.example.key`, `io.acme.field`
- Short unqualified names for broadly useful keys: `repository`, `homepage`, `license`
- Avoid shadowing standard fields (`displayName`, `description`, `tags`, `version`)

**Reserved keys**: None reserved; future versions may promote common metadata keys to standard fields.

**Value types**: Any valid JSON (string, number, boolean, array, object, null).

**Consumer behavior**: Unrecognized keys SHOULD be ignored.

## Version Handling

| Aspect                    | Rule                                                                      |
| ------------------------- | ------------------------------------------------------------------------- |
| Format                    | "Major.Minor" (e.g., "1.0", "2.1")                                        |
| Minor increment (1.0→1.1) | Adds optional fields/features; backward-compatible                        |
| Major increment (1.x→2.0) | Breaking changes; consumers should reject if unsupported                  |
| Consumer MUST             | Parse `specVersion`; accept matching major versions; ignore unknown fields |
| Producer MUST             | Set `specVersion` accurately; not higher than actually implemented        |

## Known Artifact Types (Recommended)

**Core (AI Catalog WG governed)**:

- `application/ai-catalog+json` — nested catalog
- `application/agent-card+json` — generic agent card (reserved)

**Ecosystem (externally governed)**:

- `application/a2a-agent-card+json`
- `application/mcp-server-card+json`
- `application/agent-skills+json`, `+md`, `+zip`, `+gzip`

Custom types are permitted; client implementation determines handling.
