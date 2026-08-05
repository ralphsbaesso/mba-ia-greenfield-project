---
kind: phase
name: phase-03-videos
status: clean
issue_count: 0
sources_mtime:
  docs/phases/phase-03-videos/context.md: "2026-07-29T21:58:38-03:00"
  docs/decisions/technical-decisions-phase-03-videos.md: "2026-07-29T21:38:25-03:00"
  docs/decisions/technical-decisions-video-authorization-and-metadata.md: "2026-07-29T21:58:24-03:00"
  docs/decisions/technical-decisions-thumbnail-delivery.md: "2026-07-29T21:38:25-03:00"
issues:
  - id: IC-1
    status: resolved
    summary: "va/TD-04's 6 NOT NULL metadata columns contradict TD-05/TD-12's draft-at-initiate row"
    resolved_by: video-authorization-and-metadata/TD-04
  - id: AMB-1
    status: resolved
    summary: "\"extração de duração e metadados\" — which metadata fields is not enumerated"
    resolved_by: video-authorization-and-metadata/TD-04
  - id: MD-1
    status: resolved
    summary: "No TD decides auth/ownership model for the video upload and delivery endpoints"
    resolved_by: video-authorization-and-metadata/TD-01
  - id: MD-2
    status: resolved
    summary: "No TD decides how thumbnails are delivered from the private bucket"
    resolved_by: thumbnail-delivery/TD-01
  - id: DG-1
    status: resolved
    summary: "va/TD-01 presupposes a @Public() opt-out mechanism not recorded as delivered by phase 02"
    resolved_by: clarification
  - id: OQ-1
    status: resolved
    summary: "TD-01 pending — Object Storage Client SDK"
    resolved_by: phase-03-videos/TD-01
  - id: OQ-2
    status: resolved
    summary: "TD-02 pending — Local S3 Service in Docker Compose"
    resolved_by: phase-03-videos/TD-02
  - id: OQ-3
    status: resolved
    summary: "TD-03 pending — Bucket and Object Key Layout"
    resolved_by: phase-03-videos/TD-03
  - id: OQ-4
    status: resolved
    summary: "TD-04 pending — Queue Technology"
    resolved_by: phase-03-videos/TD-04
  - id: OQ-5
    status: resolved
    summary: "TD-05 pending — 10GB Upload Strategy and Draft Pre-registration"
    resolved_by: phase-03-videos/TD-05
  - id: OQ-6
    status: resolved
    summary: "TD-06 pending — Worker Runtime Shape and Database Access"
    resolved_by: phase-03-videos/TD-06
  - id: OQ-7
    status: resolved
    summary: "TD-07 pending — FFmpeg/ffprobe Invocation and Binary Provisioning"
    resolved_by: phase-03-videos/TD-07
  - id: OQ-8
    status: resolved
    summary: "TD-08 pending — How the Worker Reads the Source File"
    resolved_by: phase-03-videos/TD-08
  - id: OQ-9
    status: resolved
    summary: "TD-09 pending — Thumbnail Extraction Policy"
    resolved_by: phase-03-videos/TD-09
  - id: OQ-10
    status: resolved
    summary: "TD-10 pending — Unique Video URL Identifier"
    resolved_by: phase-03-videos/TD-10
  - id: OQ-11
    status: resolved
    summary: "TD-11 pending — Streaming and Download Delivery Strategy"
    resolved_by: phase-03-videos/TD-11
  - id: OQ-12
    status: resolved
    summary: "TD-12 pending — Video Status Lifecycle and Transitions"
    resolved_by: phase-03-videos/TD-12
  - id: OQ-13
    status: resolved
    summary: "TD-13 pending — Processing Failure Handling"
    resolved_by: phase-03-videos/TD-13
  - id: OQ-14
    status: resolved
    summary: "TD-14 pending — Worker Job Idempotency"
    resolved_by: phase-03-videos/TD-14
  - id: OQ-15
    status: resolved
    summary: "TD-15 pending — Abandoned Upload (Orphan Draft) Handling"
    resolved_by: phase-03-videos/TD-15
  - id: OQ-16
    status: resolved
    summary: "va/TD-01 pending — Video Endpoint Authentication Matrix"
    resolved_by: video-authorization-and-metadata/TD-01
  - id: OQ-17
    status: resolved
    summary: "va/TD-02 pending — Draft Ownership: Owning Entity and Grant Scoping"
    resolved_by: video-authorization-and-metadata/TD-02
  - id: OQ-18
    status: resolved
    summary: "va/TD-03 pending — Access Rule for Videos That Are Not ready"
    resolved_by: video-authorization-and-metadata/TD-03
  - id: OQ-19
    status: resolved
    summary: "va/TD-04 pending — ffprobe Metadata Field Set Persisted on videos"
    resolved_by: video-authorization-and-metadata/TD-04
  - id: OQ-20
    status: resolved
    summary: "thumb/TD-01 pending — Thumbnail Delivery Mechanism"
    resolved_by: thumbnail-delivery/TD-01
  - id: OQ-21
    status: resolved
    summary: "thumb/TD-02 pending — Missing-Thumbnail Contract on a ready Video"
    resolved_by: thumbnail-delivery/TD-02
---

# phase-03-videos — Validation

## Findings

### Inconsistencies

_None._

_(IC-1 is closed — see `## Resolved Issues`. Re-checked against the revised `va/TD-04`: zero columns remain marked `Null? no`, all six now read `yes, until `ready``, the `**Revisions:**` block is present, and the state-scoped `CHECK` is documented. The revision introduces no new contradiction: `va/TD-04`'s `CHECK (status <> 'ready' OR (…))` and `thumbnail-delivery/TD-02`'s `CHECK (status <> 'ready' OR thumbnail_key IS NOT NULL)` are two independent constraints on the same table keyed off the same enum, which Postgres permits and which `TD-13`'s fail-fast rule keeps satisfiable — a non-decodable input reaches `error`, never `ready`, so no `ready` row can exist without geometry or a thumbnail. All 21 `Capability:` fields still match a `## Scope` bullet verbatim, and no TD carries `Scope: Frontend`, so the Scope-Subsection orphan check does not fire.)_

### Ambiguities

_None._

_(AMB-1 closed in an earlier revision. The two self-resolving hedges are unchanged and remain non-issues: `TD-15`'s row-deletion policy ("if the plan prefers…") states its own preference in the same sentence — abort the multipart upload, leave the row for Fase 04 — and `TD-05`'s part-expiry hedge resolves to hours, with a "presign more parts" endpoint as the alternative to a longer TTL. Both are determinate enough for `/plan-build` to write the SI; recorded here so the build does not treat them as open questions.)_

### Missing Decisions

_None._

_(All 9 capability bullets map to ≥1 decided TD; all 21 TDs are claimed by at least one bullet. HTTP error-response format is satisfied by the inherited `phase-02-auth/TD-07`, which `va/TD-02` cites explicitly. Decisão #29 does not apply — it requires `ui_in_scope ∈ {true, logic-only}` and this phase has no `## UI Inventory`. **Bucket CORS** remains deliberately unfired for the third consecutive revision, on unchanged grounds: no browser client exists in this phase, `TD-11` already records CORS as a known consequence of the chosen option rather than an undiscovered one, and bucket-policy provisioning is `implement`-resolvable. Carried forward so the phase that lands the first browser consumer (Fase 05) inherits the note.)_

### Dependency Gaps

_None._

_(DG-1 closed — see `## Resolved Issues`. Prerequisites re-verified with all TDs decided: Fase 01 supplies the Compose/config foundation, Fase 02 supplies auth plus channels with URL handles (`phase-02-auth/TD-10`), and `va/TD-02` confirms phase 02 creates the channel at signup with `cascade`. The new infrastructure — object storage, Redis broker, worker container — is in-scope and owned by `TD-02`, `TD-04` and `TD-06` rather than inherited. Within-phase ordering is implied throughout: storage/keys (TD-01→TD-03) precede the handshake (TD-05); the queue (TD-04) precedes the worker (TD-06→TD-09); probing precedes thumbnail extraction in the same job; `thumb/TD-01`'s route depends on `TD-09` having produced the object.)_

### Inherited Constraint Conflicts

_None._

_(Check 5 ran against all 21 decided TDs for the second revision in a row, now including the revised `va/TD-04`. Four pairings examined, none conflicting:_

_• `va/TD-04`'s state-scoped `CHECK` vs phase 01's TypeORM migration conventions — compatible. Phase 01's inherited conventions govern `DataSource` construction, `registerAs` config factories and `TypeOrmModule.forRootAsync` wiring; they say nothing about DDL content, and a raw `CHECK` inside a generated migration is ordinary TypeORM usage. It is also the same shape `thumb/TD-02` already commits to in this phase, so the revision converges on an in-phase precedent rather than introducing a new idiom._

_• `phase-03-videos/TD-01`'s `@aws-sdk` client wiring vs phase 01's namespaced `registerAs` convention — compatible; TD-01 treats `endpoint` + `forcePathStyle` as configuration, which is exactly what a namespaced factory supplies. Same for `TD-04`'s Redis connection via `@nestjs/bullmq`'s `forRootAsync` + `useFactory`._

_• `va/TD-03`'s `404`-not-`403` rule vs the inherited `phase-02-auth/TD-07` error envelope — orthogonal by construction: TD-07 fixes the response shape (`{ statusCode, error, message }` + domain codes), TD-03 fixes which status code the delivery handlers return. A `404` carries the inherited envelope unchanged._

_• `TD-06`'s standalone Nest application context reuses the inherited `TypeOrmModule.forRootAsync` + single `databaseConfig` factory instead of duplicating connection parameters — it satisfies the inherited convention rather than conflicting with it, which is the stated reason TD-06 chose Option A.)_

### Unresolved Open Questions

_None._

_(All 21 TDs across the three source docs are `decided` — zero `pending` rows in `## Decisions Index`. No inventory Open Questions exist, since this phase has no `## UI Inventory`.)_

### UI Coverage Gaps

_None._

_(UI is not in scope — `context.md` carries no `## UI Inventory`, so `ui_in_scope: false`. UIG-N is not a concept here.)_

## Resolved Issues

- **IC-1** _(resolved_by video-authorization-and-metadata/TD-04)_ — `va/TD-04` marked six metadata columns (`duration_seconds`, `width`, `height`, `video_codec`, `container_format`, `size_bytes`) `NOT NULL`, while `phase-03-videos/TD-05` creates the draft row at initiate and `TD-12` only reaches `ready` after the worker probes — so the initiate INSERT could not satisfy them. Resolved as an **Append revision** (Option B unchanged; only the nullability semantics moved): the six columns are nullable at the column level, with `CHECK (status <> 'ready' OR (duration_seconds IS NOT NULL AND width IS NOT NULL AND height IS NOT NULL AND video_codec IS NOT NULL AND container_format IS NOT NULL AND size_bytes IS NOT NULL))` added in the same migration, mirroring `thumbnail-delivery/TD-02`'s treatment of `thumbnail_key`. A `**Revisions:**` block records the change, the Recommendation table's `Null?` cells read `yes, until `ready``, and the prose claim that those columns are "non-nullable" was corrected to "required *for a `ready` row*" so `/plan-build` cannot re-derive the broken migration from stale prose.
- **AMB-1** _(resolved_by video-authorization-and-metadata/TD-04)_ — Capability "Processamento automático do vídeo após upload (extração de duração e metadados)" did not enumerate *which* metadata fields are extracted and persisted. Closed by the ad-hoc TD "ffprobe Metadata Field Set Persisted on `videos`" (Option B, 8 promoted columns).
- **MD-1** _(resolved_by video-authorization-and-metadata/TD-01)_ — No TD decided the authorization and ownership model for the phase's HTTP surface. Covered by `va/TD-01` (auth matrix), `TD-02` (draft ownership) and `TD-03` (non-`ready` access rule).
- **MD-2** _(resolved_by thumbnail-delivery/TD-01)_ — A `ready` video carried a persisted `thumbnail_key` that no client could fetch, because TD-03 keeps the bucket private and TD-11 decided delivery for the video object only. Closed by `thumbnail-delivery/TD-01` (delivery mechanism) and `TD-02` (missing-thumbnail contract).
- **DG-1** _(resolved_by clarification)_ — `va/TD-01`'s anonymous-read tier depends on a globally applied auth guard with a `@Public()` opt-out, which `## Inherited Conventions` did not record. Resolved as a clarification: the user confirmed the mechanism exists as phase 02 built it. With the TDs now decided, `va/TD-01`'s Recommendation ("leaves the inherited guard exactly as phase 02 built it") is present in `## Decisions Detail`, so the assertion is visible to validate and did not re-raise.
- **OQ-1** _(resolved_by phase-03-videos/TD-01)_ — Object Storage Client SDK → **A** (`@aws-sdk/client-s3` v3 + `@aws-sdk/s3-request-presigner`).
- **OQ-2** _(resolved_by phase-03-videos/TD-02)_ — Local S3 Service in Docker Compose → **A** (pinned `minio/minio:RELEASE.2025-09-07T16-13-09Z`).
- **OQ-3** _(resolved_by phase-03-videos/TD-03)_ — Bucket and Object Key Layout → **A** (single private bucket, prefix per kind; `storage_key` + `thumbnail_key` persisted).
- **OQ-4** _(resolved_by phase-03-videos/TD-04)_ — Queue Technology → **A** (BullMQ + Redis via `@nestjs/bullmq`).
- **OQ-5** _(resolved_by phase-03-videos/TD-05)_ — 10GB Upload Strategy → **A** (presigned multipart, API-orchestrated, draft at initiate; 64 MiB parts).
- **OQ-6** _(resolved_by phase-03-videos/TD-06)_ — Worker Runtime Shape → **A** (same codebase, separate entrypoint, standalone application context; worker writes via TypeORM).
- **OQ-7** _(resolved_by phase-03-videos/TD-07)_ — FFmpeg/ffprobe Invocation → **A** (direct `execFile` with argument array + timeout; `ffmpeg` via apt in the worker image).
- **OQ-8** _(resolved_by phase-03-videos/TD-08)_ — Worker Source-File Read → **A** (download to temp file, concurrency 1, cleanup in `finally`).
- **OQ-9** _(resolved_by phase-03-videos/TD-09)_ — Thumbnail Extraction Policy → **B** (`max(1s, duration * 0.10)`, one JPEG frame, `scale=<W>:-2`).
- **OQ-10** _(resolved_by phase-03-videos/TD-10)_ — Unique Video URL Identifier → **B** (short random `public_id` via Node `crypto.randomBytes` base64url; UUID PK retained internally).
- **OQ-11** _(resolved_by phase-03-videos/TD-11)_ — Streaming and Download Delivery → **B** (`302` from stable authorized routes to a short-lived presigned URL).
- **OQ-12** _(resolved_by phase-03-videos/TD-12)_ — Video Status Lifecycle → **A** (Postgres enum, `draft → processing → ready | error`, guarded transitions).
- **OQ-13** _(resolved_by phase-03-videos/TD-13)_ — Processing Failure Handling → **A + fail-fast on non-decodable input** (`attempts: 3`, exponential backoff `delay: 5000`, `error` row with persisted reason, consumer-less `video-processing-dlq`, guarded re-enqueue path).
- **OQ-14** _(resolved_by phase-03-videos/TD-14)_ — Worker Job Idempotency → **A** (`jobId = videoId` + atomic conditional status update).
- **OQ-15** _(resolved_by phase-03-videos/TD-15)_ — Abandoned Upload Handling → **A, scoped** (persist `uploadId`, explicit cancel, conservative cleanup at a 24h threshold).
- **OQ-16** _(resolved_by video-authorization-and-metadata/TD-01)_ — Video Endpoint Authentication Matrix → **A** (anonymous reads by `publicId`, authenticated writes, owner route by `videoId`; thumbnail route added as a seventh `@Public()` row).
- **OQ-17** _(resolved_by video-authorization-and-metadata/TD-02)_ — Draft Ownership → **A** (`channel_id uuid NOT NULL` FK + non-unique index, resolved from JWT `sub` at initiate).
- **OQ-18** _(resolved_by video-authorization-and-metadata/TD-03)_ — Access Rule for Non-`ready` Videos → **A** (`ready`-only on public routes, `404` not `403`, filtered in the resolving query; owner reads any state).
- **OQ-19** _(resolved_by video-authorization-and-metadata/TD-04)_ — ffprobe Metadata Field Set → **B** (8 promoted columns; nullability state-scoped per IC-1's revision).
- **OQ-20** _(resolved_by thumbnail-delivery/TD-01)_ — Thumbnail Delivery Mechanism → **A** (`@Public()` route → `302` to presigned URL with `response-content-type=image/jpeg`, inheriting va/TD-03's `ready`-only `404`).
- **OQ-21** _(resolved_by thumbnail-delivery/TD-02)_ — Missing-Thumbnail Contract → **A** (required for `ready`; extraction failure → `error`; state-scoped `CHECK`, column nullable).
