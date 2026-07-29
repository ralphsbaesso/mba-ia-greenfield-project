---
kind: phase
name: phase-03-videos
status: dirty
issue_count: 17
sources_mtime:
  docs/phases/phase-03-videos/context.md: "2026-07-28T21:55:51-03:00"
  docs/decisions/technical-decisions-phase-03-videos.md: "2026-07-28T21:33:44-03:00"
issues:
  - id: AMB-1
    status: open
    summary: "\"extração de duração e metadados\" — which metadata fields is not enumerated"
  - id: MD-1
    status: open
    summary: "No TD decides auth/ownership model for the video upload and delivery endpoints"
  - id: OQ-1
    status: open
    summary: "TD-01 pending — Object Storage Client SDK"
  - id: OQ-2
    status: open
    summary: "TD-02 pending — Local S3 Service in Docker Compose"
  - id: OQ-3
    status: open
    summary: "TD-03 pending — Bucket and Object Key Layout"
  - id: OQ-4
    status: open
    summary: "TD-04 pending — Queue Technology"
  - id: OQ-5
    status: open
    summary: "TD-05 pending — 10GB Upload Strategy and Draft Pre-registration"
  - id: OQ-6
    status: open
    summary: "TD-06 pending — Worker Runtime Shape and Database Access"
  - id: OQ-7
    status: open
    summary: "TD-07 pending — FFmpeg/ffprobe Invocation and Binary Provisioning"
  - id: OQ-8
    status: open
    summary: "TD-08 pending — How the Worker Reads the Source File"
  - id: OQ-9
    status: open
    summary: "TD-09 pending — Thumbnail Extraction Policy"
  - id: OQ-10
    status: open
    summary: "TD-10 pending — Unique Video URL Identifier"
  - id: OQ-11
    status: open
    summary: "TD-11 pending — Streaming and Download Delivery Strategy"
  - id: OQ-12
    status: open
    summary: "TD-12 pending — Video Status Lifecycle and Transitions"
  - id: OQ-13
    status: open
    summary: "TD-13 pending — Processing Failure Handling"
  - id: OQ-14
    status: open
    summary: "TD-14 pending — Worker Job Idempotency"
  - id: OQ-15
    status: open
    summary: "TD-15 pending — Abandoned Upload (Orphan Draft) Handling"
---

# phase-03-videos — Validation

## Findings

### Inconsistencies

_None._

_(No current-scope TD is decided yet, so no scope↔decision contradiction is observable. No TD carries `Scope: Frontend` — TD-05 and TD-11 are `Cross-layer`, which legitimately renders in backend subsections without an active UI scope, so the Scope-Subsection orphan check does not fire. Every TD in the index appears in `## Capability Coverage`, so no TD cites a capability absent from the phase scope.)_

### Ambiguities

- **AMB-1** — Capability "Processamento automático do vídeo após upload (extração de duração e metadados)" does not enumerate *which* metadata fields are extracted and persisted. The word "metadados" is open-ended (resolution? codec? bitrate? container? byte size? aspect ratio?), and no topic in `## Decisions Index` closes it: TD-06 covers worker runtime shape and DB access, TD-07 covers *how* ffmpeg/ffprobe is invoked and provisioned, TD-08 covers how the worker reaches the source file, and TD-12/TD-13/TD-14 cover lifecycle, failure and idempotency. Without an enumerated field list, `/plan-build` cannot derive the `videos` data-model columns for the extracted metadata nor the assertions of the processing SI. Explicit choice: enumerate the metadata fields to persist — either in the body of TD-07 (as part of the ffprobe invocation contract) or as a dedicated TD — then rerun `/plan-context phase-03-videos` and `/plan-validate phase-03-videos`.

### Missing Decisions

- **MD-1** — The phase exposes an HTTP surface (upload initiate/complete handshake, read by unique video URL, streaming, download — per the capabilities and the phase-scope doc's `scope_description`) and declares "Depende de: Fase 01, Fase 02", yet no TD in `## Decisions Index` and no inherited TD in `## Inherited Decisions Detail` decides the **authorization and ownership model for that surface**. Three sub-questions are left open: (a) which video endpoints require authentication and which are anonymous (the project premise is that anonymous users watch freely, so streaming/download may be public while upload must not be); (b) which channel/user owns the draft created by the "Pré-cadastro automático do vídeo como rascunho", i.e. whose identity scopes the pre-signed upload grant of TD-05; (c) whether a video in a non-`ready` status can be streamed/downloaded at all (interaction with TD-11 and TD-12). The inherited phase-02 TDs decide the auth *mechanism* (`phase-02-auth/TD-02` guards, `TD-03` refresh rotation, `TD-09` refresh token format) but never its *application* to a video surface that did not exist then. Consequence if left open: TD-05's upload handshake has no principal to scope the grant to, and TD-11's delivery endpoints have an undefined access rule — both are decided in this phase, so the gap blocks them. Explicit choice: run `/research phase-03-videos` to add a TD (`Scope: Backend`, or `Cross-layer` if it constrains the future client contract) covering video-endpoint authorization + draft ownership; an explicit "delivery endpoints are public, upload endpoints require the authenticated channel owner" is a valid decision as long as it is recorded as one.

_(Not fired — checked and covered: the HTTP error-response-format sub-check is satisfied by the inherited `phase-02-auth/TD-07` Custom Domain Exception Filter, which already fixes the `{ statusCode, error, message }` + domain-code shape for `nestjs-project`. The shared-types contract-sync sub-type (Decisão #29) does not apply — it requires `ui_in_scope ∈ {true, logic-only}` and this phase has no `## UI Inventory`. No "uncovered bullet" sub-type fires: all 9 capability bullets in `## Capability Coverage` map to ≥1 TD, and all 15 TDs are claimed by at least one bullet.)_

### Dependency Gaps

_None._

_(The phase's declared prerequisites — Fase 01 (Compose/config foundation) and Fase 02 (auth, users, channel handles per `phase-02-auth/TD-10`) — are both planned and delivered. The new infrastructure this phase needs (object storage service, queue broker, worker service) is in-scope and owned by TD-02, TD-04 and TD-06 rather than inherited. Within-phase ordering is implied by the pipeline itself: storage/key layout (TD-01→TD-03) precede the upload handshake (TD-05); the queue (TD-04) precedes the worker (TD-06→TD-09); metadata extraction precedes thumbnail generation inside the same worker job.)_

### Inherited Constraint Conflicts

_None._

_(Check 5 compares **decided** current-scope TDs against inherited conventions and inherited TDs. All 15 current-scope TDs are `pending`, so there is nothing to compare yet. Rerun after `/plan-resolve` — a newly decided TD may then conflict with an inherited constraint, which is exactly what the rerun semantics exist for.)_

### Unresolved Open Questions

_Operational note: all 15 entries below are pending TDs from a single decisions doc — `/plan-resolve phase-03-videos` batches them via `AskUserQuestion` instead of editing the doc by hand._

- **OQ-1** — TD-01 pending — Object Storage Client SDK. Resolution: fill the **Decision:** field of TD-01 in `docs/decisions/technical-decisions-phase-03-videos.md`, then re-run `/plan-validate phase-03-videos`.
- **OQ-2** — TD-02 pending — Local S3 Service in Docker Compose. Resolution: fill the **Decision:** field of TD-02 in `docs/decisions/technical-decisions-phase-03-videos.md`, then re-run `/plan-validate phase-03-videos`.
- **OQ-3** — TD-03 pending — Bucket and Object Key Layout. Resolution: fill the **Decision:** field of TD-03 in `docs/decisions/technical-decisions-phase-03-videos.md`, then re-run `/plan-validate phase-03-videos`.
- **OQ-4** — TD-04 pending — Queue Technology. Resolution: fill the **Decision:** field of TD-04 in `docs/decisions/technical-decisions-phase-03-videos.md`, then re-run `/plan-validate phase-03-videos`.
- **OQ-5** — TD-05 pending — 10GB Upload Strategy and Draft Pre-registration. Resolution: fill the **Decision:** field of TD-05 in `docs/decisions/technical-decisions-phase-03-videos.md`, then re-run `/plan-validate phase-03-videos`.
- **OQ-6** — TD-06 pending — Worker Runtime Shape and Database Access. Resolution: fill the **Decision:** field of TD-06 in `docs/decisions/technical-decisions-phase-03-videos.md`, then re-run `/plan-validate phase-03-videos`.
- **OQ-7** — TD-07 pending — FFmpeg/ffprobe Invocation and Binary Provisioning. Resolution: fill the **Decision:** field of TD-07 in `docs/decisions/technical-decisions-phase-03-videos.md`, then re-run `/plan-validate phase-03-videos`.
- **OQ-8** — TD-08 pending — How the Worker Reads the Source File. Resolution: fill the **Decision:** field of TD-08 in `docs/decisions/technical-decisions-phase-03-videos.md`, then re-run `/plan-validate phase-03-videos`.
- **OQ-9** — TD-09 pending — Thumbnail Extraction Policy. Resolution: fill the **Decision:** field of TD-09 in `docs/decisions/technical-decisions-phase-03-videos.md`, then re-run `/plan-validate phase-03-videos`.
- **OQ-10** — TD-10 pending — Unique Video URL Identifier. Resolution: fill the **Decision:** field of TD-10 in `docs/decisions/technical-decisions-phase-03-videos.md`, then re-run `/plan-validate phase-03-videos`.
- **OQ-11** — TD-11 pending — Streaming and Download Delivery Strategy. Resolution: fill the **Decision:** field of TD-11 in `docs/decisions/technical-decisions-phase-03-videos.md`, then re-run `/plan-validate phase-03-videos`.
- **OQ-12** — TD-12 pending — Video Status Lifecycle and Transitions. Resolution: fill the **Decision:** field of TD-12 in `docs/decisions/technical-decisions-phase-03-videos.md`, then re-run `/plan-validate phase-03-videos`.
- **OQ-13** — TD-13 pending — Processing Failure Handling. Resolution: fill the **Decision:** field of TD-13 in `docs/decisions/technical-decisions-phase-03-videos.md`, then re-run `/plan-validate phase-03-videos`.
- **OQ-14** — TD-14 pending — Worker Job Idempotency. Resolution: fill the **Decision:** field of TD-14 in `docs/decisions/technical-decisions-phase-03-videos.md`, then re-run `/plan-validate phase-03-videos`.
- **OQ-15** — TD-15 pending — Abandoned Upload (Orphan Draft) Handling. Resolution: fill the **Decision:** field of TD-15 in `docs/decisions/technical-decisions-phase-03-videos.md`, then re-run `/plan-validate phase-03-videos`.

### UI Coverage Gaps

_None._

_(UI is not in scope for this phase — `context.md` carries no `## UI Inventory` section, so `ui_in_scope: false`. UIG-N is not a concept here, and the shared-types contract-sync check (Decisão #29) does not fire either: it requires `ui_in_scope ∈ {true, logic-only}`. The frontend video UI is explicitly deferred; the `Cross-layer` client contracts of TD-05/TD-11 are exercised in this phase by `test/*.e2e-spec.ts` and `api.http`.)_

## Resolved Issues

_No issues resolved yet._
