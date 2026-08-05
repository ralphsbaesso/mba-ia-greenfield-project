---
kind: phase
name: phase-03-videos
sources_mtime:
  docs/project-plan.md: "2026-07-27T20:38:54-03:00"
  docs/decisions/technical-decisions-phase-03-videos.md: "2026-07-29T21:38:25-03:00"
  docs/decisions/technical-decisions-video-authorization-and-metadata.md: "2026-07-29T21:58:24-03:00"
  docs/decisions/technical-decisions-thumbnail-delivery.md: "2026-07-29T21:38:25-03:00"
  docs/decisions/technical-decisions-openapi-docs-nestjs.md: "2026-07-27T20:38:54-03:00"
  docs/phases/phase-01-configuracao-base/context.md: "2026-07-27T20:38:54-03:00"
  docs/phases/phase-02-auth/context.md: "2026-07-27T20:38:54-03:00"
  docs/phases/phase-02-auth-frontend/context.md: "2026-07-27T20:38:54-03:00"
  .claude/skills/testing-guide-nestjs-project/SKILL.md: "2026-07-27T20:38:54-03:00"
---

# phase-03-videos — Context

## Scope

**Phase name:** Upload e Processamento de Vídeos

**Capabilities** (literal, `docs/project-plan.md`):

- Serviço de armazenamento de arquivos (vídeos e thumbnails)
- Serviço de processamento em segundo plano (filas)
- Upload de vídeos com suporte a arquivos de até 10GB sem impacto na performance
- Pré-cadastro automático do vídeo como rascunho ao iniciar o upload
- Processamento automático do vídeo após upload (extração de duração e metadados)
- Geração automática de thumbnail a partir de um frame do vídeo
- URL única por vídeo, sem conflito com outros vídeos
- Reprodução via streaming (sem necessidade de download completo)
- Download do vídeo pelo usuário

**Out of scope:** _Not specified._
**Deliverables:** upload de até 10GB funcional, processamento automático do vídeo, streaming funcionando, URLs únicas geradas.
**Affected subprojects:** `nestjs-project` — no specific note (phase scope is backend upload/storage/queue/streaming; `docs/project-plan.md` does not name subproject paths for this phase).
**Deferred subprojects:** _None._
**Sequencing notes:** "Depende de: Fase 01, Fase 02"

**Neighbors (for boundary detection only):**

- **Phase 02:** Fase 02 — Cadastro, Login e Gerenciamento de Conta (Depende de: Fase 01)
- **Phase 04:** Fase 04 — Gerenciamento de Vídeos e Canal (Depende de: Fase 02, Fase 03)

## Decisions Index

| Ref | Source | Scope | Topic | Status | Decision | Libraries | Renders in |
|-----|--------|-------|-------|--------|----------|-----------|------------|
| phase-03-videos/TD-01 | phase | Backend | Object Storage Client SDK | decided | A (@aws-sdk/client-s3 v3 + s3-request-presigner) | `@aws-sdk/client-s3` `^3`, `@aws-sdk/s3-request-presigner` `^3` | — |
| phase-03-videos/TD-02 | phase | Repo-wide | Local S3 Service in Docker Compose | decided | A (pinned minio/minio:RELEASE.2025-09-07T16-13-09Z) | — | — |
| phase-03-videos/TD-03 | phase | Backend | Bucket and Object Key Layout | decided | A (single private bucket, prefix per kind) | — | — |
| phase-03-videos/TD-04 | phase | Backend | Queue Technology | decided | A (BullMQ + Redis via @nestjs/bullmq) | `bullmq` `^5`, `@nestjs/bullmq` `^11`; Compose service `redis` (Redis ≥ 6.2, `--maxmemory-policy noeviction`) | — |
| phase-03-videos/TD-05 | phase | Cross-layer | 10GB Upload Strategy and Draft Pre-registration | decided | A (presigned multipart, API-orchestrated, draft at initiate) | — | — |
| phase-03-videos/TD-06 | phase | Backend | Worker Runtime Shape and Database Access | decided | A (same codebase, separate entrypoint, standalone app context) | — | — |
| phase-03-videos/TD-07 | phase | Backend | FFmpeg/ffprobe Invocation and Binary Provisioning | decided | A (direct execFile; ffmpeg via apt in worker image) | none (Node built-in `child_process`); system package `ffmpeg` in worker image | — |
| phase-03-videos/TD-08 | phase | Backend | How the Worker Reads the Source File | decided | A (download to temp file, low concurrency) | — | — |
| phase-03-videos/TD-09 | phase | Backend | Thumbnail Extraction Policy | decided | B (percentage of duration, clamped; single JPEG) | — | — |
| phase-03-videos/TD-10 | phase | Backend | Unique Video URL Identifier | decided | B (short random public_id, unique index, built-in crypto) | none (Node built-in `crypto`) | — |
| phase-03-videos/TD-11 | phase | Cross-layer | Streaming and Download Delivery Strategy | decided | B (302 to short-lived presigned URL) | — | — |
| phase-03-videos/TD-12 | phase | Backend | Video Status Lifecycle and Transitions | decided | A (minimal draft → processing → ready \| error) | — | — |
| phase-03-videos/TD-13 | phase | Backend | Processing Failure Handling | decided | A + fail-fast on non-decodable input | — | — |
| phase-03-videos/TD-14 | phase | Backend | Worker Job Idempotency | decided | A (deterministic jobId + atomic status guard) | — | — |
| phase-03-videos/TD-15 | phase | Backend | Abandoned Upload (Orphan Draft) Handling | decided | A, scoped (persist uploadId, abort path, conservative cleanup) | — | — |
| video-authorization-and-metadata/TD-01 | ad-hoc | Cross-layer | Video Endpoint Authentication Matrix | decided | A (anonymous reads by publicId, auth writes + owner route by videoId) | — | — |
| video-authorization-and-metadata/TD-02 | ad-hoc | Backend | Draft Ownership — Owning Entity and Grant Scoping | decided | A (channel_id FK, resolved from sub at initiate) | — | — |
| video-authorization-and-metadata/TD-03 | ad-hoc | Cross-layer | Access Rule for Videos That Are Not `ready` | decided | A (ready-only on public routes with 404; owner reads any state) | — | — |
| video-authorization-and-metadata/TD-04 | ad-hoc | Backend | ffprobe Metadata Field Set Persisted on `videos` | decided | B (playback-essential set, 8 promoted columns) | — | — |
|     └─ Last revision: 2026-07-29 — Nullability of `duration_seconds`, `width`, `height`, `video_codec`, `container_format`, `size_bytes` moved to a state-scoped `CHECK` | | | | | | | |
| thumbnail-delivery/TD-01 | ad-hoc | Cross-layer | Thumbnail Delivery Mechanism | decided | A (@Public() route → 302 to short-lived presigned URL, mirrors TD-11) | — | — |
| thumbnail-delivery/TD-02 | ad-hoc | Backend | Missing-Thumbnail Contract on a `ready` Video | decided | A (required for ready; extraction failure → error per TD-13) | — | — |

_Source files:_

- phase-03-videos — `docs/decisions/technical-decisions-phase-03-videos.md` (scope_type: phase, related_phases: [3])
- video-authorization-and-metadata — `docs/decisions/technical-decisions-video-authorization-and-metadata.md` (scope_type: ad-hoc, related_phases: [3])
- thumbnail-delivery — `docs/decisions/technical-decisions-thumbnail-delivery.md` (scope_type: ad-hoc, related_phases: [3])

## Capability Coverage

| Capability (from project-plan.md) | Covered by |
|-----------------------------------|------------|
| Serviço de armazenamento de arquivos (vídeos e thumbnails) | phase-03-videos/TD-01, phase-03-videos/TD-02, phase-03-videos/TD-03 |
| Serviço de processamento em segundo plano (filas) | phase-03-videos/TD-04 |
| Upload de vídeos com suporte a arquivos de até 10GB sem impacto na performance | phase-03-videos/TD-05, video-authorization-and-metadata/TD-01 |
| Pré-cadastro automático do vídeo como rascunho ao iniciar o upload | phase-03-videos/TD-05, phase-03-videos/TD-12, phase-03-videos/TD-15, video-authorization-and-metadata/TD-02 |
| Processamento automático do vídeo após upload (extração de duração e metadados) | phase-03-videos/TD-06, phase-03-videos/TD-07, phase-03-videos/TD-08, phase-03-videos/TD-12, phase-03-videos/TD-13, phase-03-videos/TD-14, video-authorization-and-metadata/TD-04 |
| Geração automática de thumbnail a partir de um frame do vídeo | phase-03-videos/TD-07, phase-03-videos/TD-09, thumbnail-delivery/TD-01, thumbnail-delivery/TD-02 |
| URL única por vídeo, sem conflito com outros vídeos | phase-03-videos/TD-10 |
| Reprodução via streaming (sem necessidade de download completo) | phase-03-videos/TD-11, video-authorization-and-metadata/TD-01, video-authorization-and-metadata/TD-03 |
| Download do vídeo pelo usuário | phase-03-videos/TD-11, video-authorization-and-metadata/TD-01, video-authorization-and-metadata/TD-03 |

## Decisions Detail

### phase-03-videos/TD-01

**Recommendation:** presigning `UploadPartCommand` is a hard requirement of the recommended upload strategy (TD-05) and Option A is the only one that provides it natively. It is CommonJS, which matters: this project has no `"type": "module"` and compiles/tests through CommonJS, so ESM-only libraries are a Definition-of-Done risk. `endpoint` + `forcePathStyle: true` makes MinIO-in-dev / S3-in-prod a config change, matching the architecture diagram's "S3 or MinIO".
**Libraries:** `@aws-sdk/client-s3` `^3`, `@aws-sdk/s3-request-presigner` `^3`

### phase-03-videos/TD-02

**Recommendation:** MinIO is a given, and pinning is the only way to keep `docker compose down -v && up -d` reproducible now that upstream community publishing has stopped. The frozen-image and reduced-console consequences are acceptable for a local dev/eval environment and should be recorded in `nestjs-project/CLAUDE.md` rather than worked around. Verification in the smoke test should go through the S3 API (`mc` / SDK / integration tests), not the console.
**Libraries:** —

### phase-03-videos/TD-03

**Recommendation:** the phase needs private-by-default storage with presigned or proxied access; nothing in Fase 03 requires public thumbnails, and Option B would pre-empt Fase 04's visibility rules (público/unlisted) by making thumbnails publicly addressable. Deriving both keys from `videoId` keeps the worker and delivery paths free of extra lookups. **Persist the resolved keys in the `videos` row anyway** (`storage_key`, `thumbnail_key`) rather than recomputing from a convention — the row must stay readable if the convention ever changes. Object extension comes from the initiate request's declared content type, not from the client-supplied filename.
**Libraries:** —

### phase-03-videos/TD-04

**Recommendation:** pg-boss is genuinely the more elegant fit on paper (no new infrastructure, native DLQ, transactional enqueue), and it would be the recommendation if not for one concrete blocker: it is ESM-only, and this project is CommonJS end-to-end (`typeorm-ts-node-commonjs`, ts-jest CJS transform, no `"type": "module"`). Fighting that in the same phase that introduces storage, a worker, and FFmpeg puts the Definition of Done (`tsc --noEmit` + green suite) at risk for a benefit the phase does not need. BullMQ has an official NestJS 11-compatible module, is CommonJS, and gives worker concurrency and stalled-job recovery out of the box — the two properties that actually matter for CPU-heavy video jobs consumed by a separate container. Its missing DLQ is a small, explicit pattern (TD-13), and the added Redis container is one small official image. RabbitMQ's broker-level DLX is the strongest failure story but costs the heaviest container plus hand-built retry chains, for fan-out the project does not have.
**Libraries:** `bullmq` `^5`, `@nestjs/bullmq` `^11`; Compose service `redis` (official image, Redis ≥ 6.2, configured `--maxmemory-policy noeviction`)

### phase-03-videos/TD-05

**Recommendation:** it is the only option that actually reaches 10GB (B is capped at 5 GiB by S3), and it is the only one that keeps the bytes off the API (C fails on this, D partially). Concretely: **part size 64 MiB** (≈160 parts for 10GB — comfortably under the 10,000-part ceiling, and few enough that presigning all parts at initiate is cheap), presigned-part expiry on the order of **hours, not the 7-day maximum** (a 10GB transfer over a 10 Mbps link takes ~2.2h; if the plan prefers tighter expiry, add a "presign more parts" endpoint instead of stretching the TTL). The **draft row is created at initiate, before any byte is uploaded** — that is what satisfies "pré-cadastro automático do vídeo como rascunho ao iniciar o upload" and it also gives the client the `videoId` it needs for the subsequent calls. **On the completion trigger:** prefer the **client-called `complete` endpoint** over a MinIO bucket notification (`s3:ObjectCreated:CompleteMultipartUpload` → webhook). MinIO supports the notification, but `CompleteMultipartUpload` is a server-side call that the API must make anyway (it needs the ETag list), so the API already knows the exact moment the object exists — a webhook would add a second, differently-authenticated ingress path and a dev-only MinIO configuration step for information the API already has. The API remains the single place that publishes the job.
**Libraries:** —

### phase-03-videos/TD-06

**Recommendation:** the decisive factor is schema and config single-sourcing: the worker's job is to write `duration`, metadata, `thumbnail_key` and `status` to the same `videos` row the API reads, so sharing the entity and the TypeORM configuration eliminates the drift risk that Options B and C introduce. It also matches the challenge's continuity instruction ("Reuse os padrões do projeto") and keeps testability aligned with the existing integration-test style. The image-size cost is irrelevant in a dev/eval environment; if FFmpeg must be kept out of the API image later, that is a Dockerfile-target change, not an architecture change. **On database access:** the worker writes **directly via TypeORM** using the shared `Video` entity — not through an internal HTTP API. An internal API would add a network hop, a second auth surface, and a hard dependency of the worker on API availability, for no gain: both containers already legitimately reach `db`, and the diagram states `worker → db "Updates"` explicitly.
**Libraries:** —

### phase-03-videos/TD-07

**Recommendation:** the deprecated status of `fluent-ffmpeg` removes the only real reason to add an abstraction, and `ffprobe -print_format json` is a better contract than any wrapper: stable, documented, and directly assertable in tests. The worker image extends the existing `node:25.6.0-slim` base with `apt-get install -y ffmpeg` (Debian's package provides both `ffmpeg` and `ffprobe`), which keeps the binary out of `npm install` and out of the API image. Use `execFile` with an argument array (never a shell string) since object keys derive from user input, and set an explicit timeout so a pathological input cannot pin the worker forever.
**Libraries:** none (Node built-in `child_process`); system package `ffmpeg` in the worker image

### phase-03-videos/TD-08

**Recommendation:** it is the only option whose correctness does not depend on container-format layout or on FFmpeg's remote-seek behavior, and correctness is what this phase is graded on. Bound the cost instead of avoiding it: keep worker **concurrency low** (start at 1) so peak scratch usage is one file, mount a dedicated temp volume for the worker, and always clean up in a `finally`. Option B is the right optimization later — it should be revisited if processing latency becomes a concern, and its viability is a measurable question (does `ffprobe` over presigned HTTP read the header only for our inputs?) rather than a design one.
**Libraries:** —

### phase-03-videos/TD-09

**Recommendation:** duration is already extracted in the same job, so seeking to ~10% costs nothing extra and avoids the single most common failure of Option A (a black opening frame) without Option C's decode cost or non-determinism. Concretely: seek to `max(1s, duration * 0.10)`, extract exactly one frame (`-frames:v 1`), output **JPEG** (universally supported by browsers and far smaller than PNG for photographic frames), scale to a fixed width with `-vf scale=<W>:-2` so the aspect ratio is preserved and the height stays even. Store under the key from TD-03 and record `thumbnail_key` on the row. Fase 04 owns custom thumbnails; this phase produces exactly one automatic default.
**Libraries:** —

### phase-03-videos/TD-10

**Recommendation:** the project's own attention point asks for a *short* unique URL, which the 36-char UUID of Option A does not deliver, and Option C ties a permanent URL to a mutable title that Fase 04 will start editing. Generate it with Node's built-in **`crypto.randomBytes` rendered base64url** (sliced to a fixed length) rather than adding `nanoid`: `nanoid@6` is ESM-only *and* declares `engines: ^22 || ^24 || >=26`, which excludes this container's Node 25.6 — an avoidable dependency conflict for ~5 lines of code. Keep the internal UUID PK for foreign keys (the `Channel` relation) and expose only `public_id` in routes and payloads.
**Libraries:** none (Node built-in `crypto`)

### phase-03-videos/TD-11

**Recommendation:** for both streaming and download — it matches the architecture diagram's explicit `frontend → storage "Streams"` edge, it keeps the API out of the data path (consistent with the phase's whole thesis on the upload side), and it gets correct `Range`/`206` semantics from the storage server for free instead of hand-rolling partial-content handling. Keep a stable, authorized API route as the entry point (`/videos/{publicId}/stream` and `/videos/{publicId}/download`) rather than exposing raw URLs, so authorization stays server-side and Fase 04/05 can tighten it without changing the client contract; set the presigned TTL to minutes, not hours; and use `response-content-disposition` on the download URL so the same object serves both behaviors. The main thing given up versus Option A is per-range authorization — acceptable in this phase, where video viewing is anonymous by design (`docs/project-plan.md`, Fase 05: "Acesso anônimo à visualização de vídeos"), and revisitable in Fase 04 when unlisted/private visibility arrives.
**Libraries:** —

### phase-03-videos/TD-12

**Recommendation:** it maps one-to-one onto the acceptance criterion and every state corresponds to an event the API actually observes. Option B's `uploading` is unmaintainable precisely because TD-05 keeps the API out of the transfer, and Option C's second axis belongs to Fase 04's visibility work. Concretely: a Postgres **enum** column defaulting to `draft`; transitions are `initiate → draft`, `complete → processing` (in the same operation that publishes the job), `worker success → ready`, `worker permanent failure → error` (with the reason persisted, per TD-13). Transitions are guarded — the complete endpoint only accepts a video in `draft`, and the worker only advances a video in `processing` — which is also what makes the job idempotent (TD-14).
**Libraries:** —

### phase-03-videos/TD-13

**Recommendation:** retries with exponential backoff (start at `attempts: 3`, `backoff: exponential, delay: 5000`) handle the transient class; on exhaustion the worker writes `status = error` **plus a persisted failure reason** and publishes to a consumer-less `video-processing-dlq` so nothing is lost silently. Layer on top: when `ffprobe` reports the input has no decodable video stream, treat it as permanent and go straight to `error` without consuming the remaining attempts — that is the exact case the smoke test exercises ("subir um arquivo não-vídeo e confirmar status `error` sem derrubar o worker"), and it is cheap to classify because it is ffprobe's own verdict rather than a guess about infrastructure. The worker must never let a processing failure crash the process: the handler catches, records, and returns. **Reprocessing** is exposed as an explicit re-enqueue path guarded to videos in `error` (not an automatic retry loop) so a fixed environment can recover a video without a new upload.
**Libraries:** —

### phase-03-videos/TD-14

**Recommendation:** the queue-level dedup is one line and eliminates the common duplicate (a client calling complete twice), while the status guard is the real safety net and is already implied by TD-12's guarded transitions. Make the guard an **atomic conditional update** rather than a read-then-write so two workers cannot both proceed, and keep the storage keys derived from `videoId` (TD-03) so any re-run is idempotent in storage too — the thumbnail is overwritten, not duplicated. Option C's token is the right answer only if concurrent reprocessing of the same video becomes possible; it is not in this phase, where reprocessing is guarded to videos in `error`.
**Libraries:** —

### phase-03-videos/TD-15

**Recommendation:** **Option A, scoped down: persist `uploadId` and implement an explicit `abortUpload` path plus a cleanup service method; wire the schedule conservatively** — the part-accumulation problem in Option C is real and is called out in the project plan, and Option B leaves the database side unaddressed. The minimum honest implementation is (1) store the `uploadId` on the draft row so the multipart upload can always be aborted, (2) expose an explicit cancel operation for the owner, and (3) provide a cleanup routine that aborts and removes drafts older than a generous threshold (24h comfortably exceeds any realistic 10GB transfer). Keep the *row deletion* policy conservative — if the plan prefers, the routine can abort the multipart upload (reclaiming the storage, which is the costly part) and leave the row for Fase 04's panel to handle; that split is the safer reading of scope, since Fase 04 owns draft management and this phase owns storage hygiene.
**Libraries:** —

### video-authorization-and-metadata/TD-01

**Recommendation:** it satisfies the premise, leaves the inherited guard exactly as phase 02 built it, and keeps the identity-branching machinery of Option C unbuilt until a phase has a handler that actually branches. Option C is the right *eventual* shape, and Option A does not block it: adding `@OptionalAuth()` later is additive, and the owner route can collapse into the public one at that point. Concretely, the matrix:

| Route (per TD-05 / TD-11) | Role | Auth |
|---|---|---|
| `POST /videos/uploads` (initiate) | write — creates the draft, returns the presigned grant | authenticated |
| `POST /videos/{videoId}/uploads/complete` | write — flips to `processing`, publishes the job | authenticated + owner (TD-02) |
| `GET /videos/{videoId}` | owner view — status/progress poll | authenticated + owner (TD-02) |
| `GET /videos/{publicId}` | public metadata | `@Public()` |
| `GET /videos/{publicId}/stream` | delivery — `302` to presigned URL | `@Public()` |
| `GET /videos/{publicId}/download` | delivery — `302` with `content-disposition` | `@Public()` |

The **initiate** call is the security boundary of the whole upload path: it is what mints presigned part URLs, and those URLs are bearer capabilities for their TTL. Authenticating initiate is therefore what scopes the grant — the part PUTs themselves are unauthenticated by construction (they go straight to storage, per `TD-05`), and no guard can change that. Rate limiting on initiate is inherited from the global `ThrottlerGuard`; whether the video routes need a tighter bucket than the app default is an implementation concern for `/implement`, not a TD.
**Libraries:** —

### video-authorization-and-metadata/TD-02

**Recommendation:** the lookup it adds lands on the write path (once per upload, on an already-unique indexed column), while Option B's lands on the read path (every channel page and listing, in Fases 04 and 07). Given the domain vocabulary and the fact that Fase 04 is literally named "Gerenciamento de Vídeos e Canal", `channel_id` is also the column those phases would migrate toward anyway. Concretely: `channel_id uuid NOT NULL` with an FK to `channels(id)` and a non-unique index (the channel page's "list this channel's videos" is the query it serves); resolve `sub` → `channel_id` in the initiate handler and reject with the inherited domain-error shape (`phase-02-auth/TD-07`) if the user somehow has no channel — phase 02 creates the channel at signup with `cascade`, so that is a `500`-class invariant violation, not a user-facing `400`. **Sub-variant considered and not taken:** adding `channelId` to the JWT payload to skip the lookup entirely. Rejected because it mutates an inherited contract (`phase-02-auth`'s token shape) for a saving of one indexed query on a once-per-upload call, and it puts a value in a token that outlives changes to it — Fase 04 lets users edit channel fields, and while the id itself is stable, widening the token to carry denormalized channel state invites exactly that drift. If a later phase finds the lookup genuinely hot, the change is a phase-02 supersede, not a Fase 03 shortcut.
**Libraries:** —

### video-authorization-and-metadata/TD-03

**Recommendation:** it is the only option that both keeps unreadable content unreachable and gives Fase 03 an observable `processing → ready` transition to assert. The load-bearing detail is **`404`, not `403`**: a `403` confirms the video exists, which is the leak Fase 04's `unlisted` rule must not have, and starting with `404` means that rule arrives as a tightening rather than a correction. Concretely: the public metadata and both delivery handlers filter on `status = 'ready'` in the same query that resolves `publicId` (one query, not a fetch-then-check, so there is no window where the check and the read disagree); the owner route returns the row in any state including `error` with its persisted failure reason (`TD-13`), which is what makes a failed upload diagnosable by its owner rather than silently absent.
**Libraries:** —

### video-authorization-and-metadata/TD-04

**Recommendation:** it treats "metadados" as the plural the capability wrote while keeping every stored field one that a named later phase displays, and it avoids Option C's unschema'd escape hatch that nothing currently needs. Concretely, the columns and their ffprobe sources:

| Column | Type | ffprobe source | Null? |
|---|---|---|---|
| `duration_seconds` | `numeric(10,3)` | `format.duration` | yes, until `ready` |
| `width` | `integer` | first video stream `.width` | yes, until `ready` |
| `height` | `integer` | first video stream `.height` | yes, until `ready` |
| `video_codec` | `varchar(32)` | first video stream `.codec_name` | yes, until `ready` |
| `audio_codec` | `varchar(32)` | first audio stream `.codec_name` | **yes** — a file may have no audio track |
| `container_format` | `varchar(64)` | `format.format_name` | yes, until `ready` |
| `bitrate_bps` | `bigint` | `format.bit_rate` | yes — absent for some containers |
| `size_bytes` | `bigint` | storage object size (see below) | yes, until `ready` |

Three details the field list depends on. **`duration_seconds` is fractional** — ffprobe reports seconds with decimals, so an integer column silently truncates; `numeric(10,3)` keeps millisecond precision without float drift. **`size_bytes` comes from the storage object, not from `format.size`** — the object is what is billed and what `Content-Length` must agree with, so `HeadObject` is authoritative and ffprobe's value serves only as a cross-check. **A file with no video stream is not a video** — `width`/`height`/`video_codec` being required *for a `ready` row* is the schema stating that (enforced by the state-scoped `CHECK`; see Revisions), and such an input must fail as non-decodable per `TD-13` rather than reach `ready` with null geometry. Deliberately **excluded**: frame rate (`r_frame_rate` is a rational string like `30000/1001`, and no phase displays fps — the browser handles playback timing), per-stream language/disposition tags, and rotation metadata (relevant only if the plan later adds orientation-correct thumbnails, which `TD-09` does not require).
**Libraries:** —

**Revisions:**

- 2026-07-29 — Nullability of `duration_seconds`, `width`, `height`, `video_codec`, `container_format` and `size_bytes`
  moved from column-level `NOT NULL` to a state-scoped constraint: the columns are nullable, and
  `CHECK (status <> 'ready' OR (duration_seconds IS NOT NULL AND width IS NOT NULL AND height IS NOT NULL AND video_codec IS NOT NULL AND container_format IS NOT NULL AND size_bytes IS NOT NULL))`
  is added in the same migration. The field set itself is unchanged (Option B stands). _Rationale:_ nullable +
  state-scoped CHECK — `phase-03-videos/TD-05` creates the draft row at initiate, before any byte is uploaded, and
  `phase-03-videos/TD-12` only reaches `ready` after the worker probes, so six column-level `NOT NULL` constraints made
  the initiate INSERT impossible. The invariant those constraints encoded ("a file with no video stream is not a video")
  is preserved for the state where it is meaningful, mirroring `thumbnail-delivery/TD-02`'s treatment of `thumbnail_key`
  in this same phase. Raised as IC-1 by `/plan-validate phase-03-videos`.

### thumbnail-delivery/TD-01

**Recommendation:** three reasons, in order of weight. (1) **It is the only option that leaves TD-03 and TD-11 both intact.** Option C requires superseding TD-03's explicit reasoning; Option B requires re-litigating TD-11's Option C rejection on a weaker case. Option A is the same decision TD-11 already made, applied to a second object kind — which means the phase ships *one* delivery idiom, not two. (2) **The cost Option A is criticized for is not yet incurred, and the decision that would justify paying it belongs to a later phase.** Fase 03 has no listing endpoint — the public metadata route serves a single video, so `N` is 1 here. The `N`-per-page pressure appears in Fase 04/07, and whether public-read is even *legal* depends on Fase 04's `unlisted`/`público` rules. Pre-optimizing for the grid now would mean deciding Fase 04's visibility model as a side effect of a Fase 03 caching concern — exactly the inversion TD-03 refused. (3) **The migration path out is cheap and additive.** If Fase 04 settles visibility such that public thumbnails are acceptable for `público` videos, Option C becomes correct for that subset, and the change is a scoped supersede of TD-03 + this TD with the route kept as a compatibility entry point — no client contract breaks, because clients were always pointed at `/videos/{publicId}/thumbnail`.

Three concrete details this decision fixes:

- **The route inherits `video-authorization-and-metadata/TD-03`'s `ready`-only rule verbatim** — `status = 'ready'` is filtered in the same query that resolves `publicId`, and a non-`ready` or unknown `publicId` answers `404`, never `403`. This is load-bearing, not boilerplate: a thumbnail route that resolved videos the stream route refuses would become an existence oracle and defeat va/TD-03's whole reason for choosing `404`.
- **Set `response-content-type: image/jpeg` on the presigned URL.** Per the AWS SDK v3 schema, `ResponseContentType`/`ResponseContentDisposition` are mapped to signed query parameters (`response-content-type`, `response-content-disposition`), so the served content type is pinned at signing time regardless of what content type the worker happened to set on the object — the browser renders inline instead of downloading.
- **TTL in minutes, matching TD-11**, and `getSignedUrl`'s default of 900s is already in that range, so the explicit value is a documented choice rather than a correction. Put `Cache-Control` on the `302` itself so a repeat view inside the window skips the round trip; do not attempt to make the *image* cacheable under this option — the signature rotates per request, so the browser cache key never repeats, and pretending otherwise is the trap that makes Option B look cheaper than it is.

**Libraries:** —

### thumbnail-delivery/TD-02

**Recommendation:** on the grounds va/TD-04 already established for this codebase. (1) **TD-09's policy is engineered specifically against the realistic failure modes.** Clamping to `max(1s, duration * 0.10)` is what removes the black-opening-frame and short-clip cases that would otherwise make extraction failure routine. What remains is a genuinely broken input — and TD-13 already routes broken inputs to `error` with a persisted reason that the owner can read through va/TD-03's owner route, so the failure is diagnosable rather than silent. (2) **Option B's cost is paid repeatedly by later phases, for a state TD-09 works to make unreachable.** An optional thumbnail field forces a placeholder branch in Fase 04's panel, Fase 05's sidebar and Fase 07's grid — three consumers carrying a conditional for a case that should not occur. If it turns out to occur in practice, relaxing A → B later is a migration plus a nullable field, and it is a decision made with evidence instead of in anticipation. (3) **Option C is dominated.** It buys A's contract at the price of unobservability, which is the one property this phase's failure handling (TD-13's persisted reason) was designed to preserve.

Two concrete details:

- **Add `CHECK (status <> 'ready' OR thumbnail_key IS NOT NULL)` in the same migration that adds the column**, so the invariant is enforced rather than merely documented. The column itself stays nullable — `draft` and `processing` rows have no thumbnail, and that is correct, not an exception.
- **Extraction shares the job and the row-write boundary with the metadata persist**, so a failed extraction leaves the row in `error` and never in a partial `ready` state. This matters for `TD-14`'s idempotency guard: a retried job must find the row in a state that permits a clean re-run, which a half-written `ready` would not be.

Deliberately **excluded** from this document: a thumbnail regeneration/retry endpoint (Fase 04 owns custom thumbnails and is the natural home for a re-generate action), and multiple thumbnail sizes or responsive variants (no phase displays more than one image per video, and TD-09 commits to exactly one).

**Libraries:** —

## Inherited Decisions Detail

### phase-01-configuracao-base/TD-01

**Recommendation:** Option A (@nestjs/config) — Official, core-team-maintained, guaranteed NestJS 11 compatibility. The `registerAs()` factory pattern solves the TypeORM CLI sharing problem: the factory function can be imported as a plain function by `data-source.ts` while also serving as a DI injection token inside NestJS. Building a custom module recreates solved functionality; third-party packages carry maintenance risk.
**Libraries:** `@nestjs/config@^4.x`

### phase-01-configuracao-base/TD-02

**Recommendation:** Option A (Joi) — First-class integration with `@nestjs/config` via `validationSchema`, requiring zero custom wiring. Handles string-to-number coercion natively. Using a different tool for env validation vs. request validation is reasonable — env config is validated once at startup, DTOs are validated per-request. Zod is elegant but adds a third validation paradigm to the project.
**Libraries:** `joi@^17.x`

### phase-01-configuracao-base/TD-03

**Recommendation:** Option B (Namespaced/grouped with registerAs) — The project roadmap explicitly calls for auth, email, and storage in upcoming phases. Namespaced configs provide clear file boundaries per domain, typed injection via `ConfigType<typeof databaseConfig>`, and natural scalability. The `registerAs()` factory is dual-purpose: DI token inside NestJS and plain importable function for `data-source.ts`. Initial files for Phase 01: `src/config/database.config.ts`, `src/config/app.config.ts`.
**Libraries:** —

### phase-01-configuracao-base/TD-04

**Recommendation:** Option A (Shared registerAs factory) — Natural outcome of choosing `@nestjs/config` with `registerAs`. The factory is already callable by design. `data-source.ts` imports it, calls `dotenv.config()`, then calls the factory. Zero duplication, minimal code, no extra abstraction.
**Libraries:** `dotenv` (transitive via `@nestjs/config`)

### phase-02-auth/TD-01

**Recommendation:** Argon2id — For a greenfield project in 2026, Argon2id is the OWASP-recommended choice. The native build dependency is a one-time Docker setup cost. The project has no legacy constraints favoring bcrypt. OWASP minimum: 19MiB memory, 2 iterations.
**Libraries:** `argon2@^0.41.x`

### phase-02-auth/TD-02

**Recommendation:** Option A (@nestjs/passport) — The project plan includes only email/password auth for now, but the plugin architecture costs little and future phases may add social login. Aligns with official NestJS docs, making onboarding and maintenance easier.

**Note:** Decision deliberately diverged from the Recommendation during implementation — custom guards were preferred over `@nestjs/passport` to keep the dependency surface smaller; social login is not on the near-term roadmap, so the plugin-architecture benefit did not justify the extra abstraction layer.
**Libraries:** `@nestjs/jwt@^11.0.0`

### phase-02-auth/TD-03

**Recommendation:** Option A (Refresh Token Rotation) — Provides the strongest security model with automatic theft detection. The DB write overhead is acceptable for a video platform (auth refresh is infrequent vs. video operations). PostgreSQL is already in the stack, so no new infrastructure needed. Race conditions can be mitigated with a short grace period for the old token.
**Libraries:** —

### phase-02-auth/TD-04

**Recommendation:** Option B (Random Opaque Tokens in DB) — Revocability is important: when a user requests a new password reset, previous tokens should be invalidated. The DB table is trivial to implement, and the tokens table can also serve future needs (e.g., API keys). Keeps email tokens decoupled from the JWT auth system.
**Libraries:** —

### phase-02-auth/TD-05

**Recommendation:** Option A (@nestjs-modules/mailer) — Best NestJS integration with minimal boilerplate. Supports SMTP (matching the architecture diagram), works with MailHog/Mailpit for local development without external dependencies, and scales to any SMTP provider in production. Template engine support (Handlebars) simplifies email formatting. No vendor lock-in.
**Libraries:** `@nestjs-modules/mailer@^2.x`, `handlebars@^4.x`

### phase-02-auth/TD-06

**Recommendation:** Option A (class-validator + class-transformer) — This is a backend-only project (no shared schemas with frontend), so Zod's single-source-of-truth advantage is less impactful. class-validator is the documented NestJS approach, and the project already uses decorators extensively (TypeORM entities, NestJS DI). Fewer integration surprises with NestJS 11.
**Libraries:** `class-validator@^0.14.x`, `class-transformer@^0.5.x`

### phase-02-auth/TD-07

**Recommendation:** Option A (Custom Domain Exception Filter) — Provides machine-readable error codes that the Next.js frontend can switch on, without the overhead of RFC 9457's URI-based type system. The project is single-consumer (first-party frontend), so a simple `{ statusCode, error, message }` format with domain codes balances clarity and simplicity. The custom filter cost is low — two small files.
**Libraries:** —

### phase-02-auth/TD-08

**Recommendation:** Option A (@nestjs/throttler) — Native NestJS integration is decisive: the guard system allows scoping rate limiting to `AuthModule` only via module-level `APP_GUARD`, with `@SkipThrottle()` for exemptions. The project is single-instance with no distributed requirements, so in-memory storage is sufficient. Using express-rate-limit would bypass NestJS's DI and guard lifecycle for no clear benefit.
**Libraries:** `@nestjs/throttler@^6.x`

### phase-02-auth/TD-09

**Recommendation:** Option B (Opaque) — Since DB lookup is mandatory (TD-03), JWT signature adds no security value. Opaque tokens are shorter, leak no data, and are simpler to generate.

**Note:** Decision deliberately diverged from the Recommendation — JWT was kept to reuse the access-token signing/verification infrastructure (`@nestjs/jwt`), trading token size and base64-readability for a single token format across the codebase.
**Libraries:** `@nestjs/jwt@^11.0.0`

### phase-02-auth/TD-10

**Recommendation:** Option A — The platform is a video sharing service with URL-based channel handles. A strict `[a-z0-9_]` allowlist is the simplest and most portable choice: no extra dependencies, no edge cases around hyphen positioning, and the `user_<random>` fallback provides a valid handle even for extreme email prefixes. Hyphens can always be added in a future iteration if user feedback justifies it.
**Libraries:** —

### phase-02-auth-frontend/TD-01

**Recommendation:** Three reasons. (1) **Architectural fit.** The strict-BFF model in `next-frontend-config-base/TD-03` already nominates the Route Handler as the only NestJS caller; cookie-based sessions are the natural match, and Auth.js's framework adds layers between the BFF and the cookie that buy nothing because the backend is the auth authority — Auth.js's value (DB adapters, OAuth providers, magic-link, `getServerSession` helpers) is mostly unused in this configuration. (2) **Smaller blast radius.** A ~50-LOC session helper is grep-friendly, debuggable, and test-friendly via the existing MSW+BFF integration test pattern; a misconfigured Auth.js callback is a longer fault-isolation loop. (3) **Compatibility with Next.js 16 / React 19.** Built-in `next/headers` `cookies()` is the canonical primitive both runtimes already use; Auth.js v5 versions track Next.js majors with a lag, adding compatibility risk that Option A does not have. Option C is rejected as unsafe (`localStorage` for refresh tokens) and architecturally regressive (loses RSC personalization).
**Libraries:** —

### phase-02-auth-frontend/TD-02

**Recommendation:** Three reasons. (1) **Defense in depth on the cookie content** — `httpOnly` blocks JS, encryption blocks accidental log/proxy inspection; the marginal cost is one ~3KB dep. (2) **Single cookie to manage** simplifies logout (one `session.destroy()` call) and avoids the orphan-cookie failure mode of Option A. (3) **Room to carry minimal user metadata** (`userId`, `email`, `channelSlug`) lets `app/layout.tsx` RSC render the authenticated chrome (avatar, channel name) without a per-render `/auth/me` round-trip — Phase 04+ gains compound here. Option A is a viable downgrade if the team rejects `iron-session` for any reason; the migration A→B (or B→A) is a one-Route-Handler refactor with no test changes downstream because the BFF interface is unchanged. Option C is rejected: it solves a problem (server-side revocation) the project does not have at the cost of infrastructure the project does not own.
**Libraries:** iron-session

### phase-02-auth-frontend/TD-03

**Recommendation:** The single-flight detail is non-trivial and goes in the helper from day one — tested by MSW with a "two concurrent intercepted upstream calls; one refresh expected" assertion. Option B's client-driven pattern is rejected because it doesn't replace Option A (RSC still needs server-side refresh) — adopting B means doing both. Option C's pre-emptive timer is rejected because the failure modes (multiple tabs, sleep/wake) outweigh the latency saving and force a `"use client"` shell near the root.
**Libraries:** —

### phase-02-auth-frontend/TD-04

**Recommendation:** Three reasons. (1) **Decoupled from TD-05** — works with Route Handlers OR Server Actions; the form code does not change if TD-05 is revisited later. (2) **Aligned with shadcn's canonical form primitive** — the project already commits to `radix-nova` shadcn (`components.json`); `npx shadcn@latest add form` produces react-hook-form wrappers; choosing react-hook-form means using the supported primitive instead of hand-rolling around it. (3) **Zod-first developer ergonomics match the rest of the FE foundation** — `next-frontend-config-base/TD-01` chose Zod 4 for env; the same schemas-as-source-of-truth pattern carries to forms with zero new validator paradigm. Option B is rejected for impedance with shadcn's primitive and for over-investing in progressive-enhancement that the strict-BFF model does not require. Option C is rejected for the per-field boilerplate and the loss of client-side feedback on a project that values quick, type-safe form iteration.
**Libraries:** react-hook-form, @hookform/resolvers

### phase-02-auth-frontend/TD-05

**Recommendation:** Three reasons. (1) **Strict-BFF alignment.** `next-frontend-config-base/TD-03` named Route Handlers as the BFF surface; Option A keeps every mutation visible under `app/api/**`. (2) **Test scaffold already exists** — `next-frontend/CLAUDE.md` § Testing and `next-frontend-msw-foundation` were authored for Route-Handlers-as-functions; Option A reuses them with zero invention. (3) **Single mutation surface** — Phase 02 sets the precedent for Phases 03–07; uniformity beats per-mutation idiom-picking when the cost of inconsistency compounds (Option C). Option B has real ergonomic appeal for the simplest forms but fragments the BFF surface and forces test-pattern reinvention; if the team later wants progressive enhancement for specific forms, the migration A→B is per-form and doesn't require touching unrelated routes — A is the safer default and the cheaper baseline.
**Libraries:** —

### phase-02-auth-frontend/TD-06

**Recommendation:** Two reinforcing reasons. (1) **No first-render flicker, no round-trip** — the session is delivered in the same response as the page HTML; the Client Provider hydrates with the correct initial state; users never see "Login" briefly turn into their avatar. (2) **No new BFF endpoint** — the cookie is the source of truth, RSC reads it, the Provider broadcasts it; the BFF surface stays minimal. The `router.refresh()` requirement after mid-session mutations is a small price (one line in the relevant mutation handler) for the structural benefits. Option B is rejected for the double-read-and-flicker; Option C is dominated by Option B and rejected.
**Libraries:** —

### phase-02-auth-frontend/TD-07

**Recommendation:** Three reasons. (1) **First-paint-correct** — the user sees the right outcome on the first paint, no skeleton, no flicker. (2) **Single integration pattern across both flows** — confirmation is RSC-only; reset is RSC + Client form (TD-04, TD-05 patterns reused) — both share the "RSC owns the token, Client Component owns the input" split. (3) **Email-prefetch behavior** is solved at the backend's idempotent-confirmation level (a small note for `/plan-build` to confirm; not a separate TD). Option B's Route-Handler-as-link-target adds redirects for no clean gain. Option C is dominated.
**Libraries:** —

### openapi-docs-nestjs/TD-01

**Recommendation:** Option A (`@nestjs/swagger`) — é a única opção que preserva as decisões anteriores (`class-validator` em TD-06 de phase-02-auth) sem re-platform; o CLI plugin com `classValidatorShim: true` aproveita os decoradores `class-validator` existentes para inferir schemas, mantendo o boilerplate baixo. Nestia tem mérito técnico real mas o custo de migração do stack de validação inviabiliza-a sem uma decisão upstream de supersede de TD-06. Manual authoring é descartado.
**Libraries:** @nestjs/swagger

**Revisions:**

- 2026-05-12 — Esclarece que o CLI plugin (`classValidatorShim: true`) cobre apenas inferência de schemas de DTOs a partir de `class-validator`; documentação de operações, respostas tipadas por status code, contratos de erro (alinhados ao envelope de phase-02-auth/TD-07) e exemplos exigem decoradores explícitos (`@ApiOperation`, `@ApiResponse`, `@ApiBody`, `@ApiParam`, `@ApiQuery`, `@ApiExtraModels`). _Rationale:_ openapi.json gerado pelo bootstrap atual está genérico — sem detalhes de parâmetros, schemas de retorno por status, nem contratos de erro — porque a base instalada se apoiou só na introspecção automática. Esta revisão fixa que enriquecimento via decoradores explícitos faz parte da Option A escolhida, não é trabalho fora do escopo do TD.

### openapi-docs-nestjs/TD-02

**Recommendation:** Option C (Ambos) — o custo marginal sobre Option A é apenas um npm script (~15 linhas) e o benefício é uma fundação correta para futura integração FE (codegen offline) sem perder a UI interativa que dev/QA usam. Option B sozinho pune a experiência de desenvolvimento em dev/local; Option A sozinho compromete o pipeline de codegen futuro. Combinar é dominante.
**Libraries:** —

### openapi-docs-nestjs/TD-03

**Recommendation:** Option B (Apenas em dev/staging) — alinha com a postura defensiva já estabelecida em phase 02 e não compromete consumidores legítimos (o `openapi.json` commitado em TD-02 cumpre o papel de "spec consultável fora da UI"). Re-abrir como Option A ou C é trivial no futuro se um caso de uso de API pública aparecer.
**Libraries:** —

## Inherited Conventions

- Backend config uses `@nestjs/config` with namespaced `registerAs(name, () => ({...}))` factories — one file per domain in `src/config/`. _(from phase 01)_
- Env variables are validated by a Joi schema in `src/config/env.validation.ts`, passed to `ConfigModule.forRoot({ validationSchema, validationOptions...` _(from phase 01)_
- Config is injected into modules via `ConfigType<typeof xxxConfig>` and `@Inject(xxxConfig.KEY)`; the same factory is importable as a plain function... _(from phase 01)_
- `data-source.ts` loads `.env` via `import 'dotenv/config'` at the top, then imports `databaseConfig` and calls it as a plain function. _(from phase 01)_
- Database connection parameters (host, port, etc.) are sourced from a single `databaseConfig` factory — never duplicated between `AppModule` and... _(from phase 01)_
- `TypeOrmModule.forRootAsync` is used (not `forRoot`), with `imports: [ConfigModule]`, `inject: [databaseConfig.KEY]`, `useFactory` returning... _(from phase 01)_

_(Source: `phase-02-auth/context.md` § Inherited Conventions — phase 01's own artifacts carry no `Conventions to Match`, so its context.md § Inherited Conventions is the first-phase origin; provenance tags preserved verbatim. Slices `phase-02-auth` and `phase-02-auth-frontend` add no conventions of their own.)_

## Inherited Deferred Capabilities

| Capability | Status | Origin phase | Rationale |
|-----------|--------|--------------|-----------|
| Telas de frontend | deferred | phase-01-configuracao-base | `next-frontend/` is not initialized in this phase; UI surfaces start in a later phase. |
| Telas de cadastro, login, confirmação de conta e recuperação de senha | deferred | phase-02-auth | `next-frontend/` is not initialized in this phase; UI surfaces start in a later phase. |
| "Confirmação de conta via e-mail com link de ativação" | deferred | phase-02-auth-frontend | deferred_to_next_phase — UI landing screen de-scoped 2026-05-14; FE confirmation flow (TD-07) picked up by a future phase. BE side unchanged in `phase-02-auth`. |
| "Logout" | deferred | phase-02-auth-frontend | deferred_to_next_phase — logout button lives inside authenticated chrome (typically Phase 04). Phase 02 still implements POST `/api/auth/logout` (BFF route handler + `session.destroy()`) so the contract is ready when the chrome lands. |
| "Recuperação de senha (destination screen / set-new-password)" | deferred | phase-02-auth-frontend | deferred_to_next_phase — `/forgot-password` ships this phase sending the e-mail; the reset-password destination screen is absent from Figma → link destination remains a 404 until a later phase delivers the screen via `/screen-inventory` extension run. Documented as a known gap. |
| "Telas de cadastro, login, confirmação de conta e recuperação de senha" | deferred | phase-02-auth-frontend | a tela de confirmação da conta não será implementada nesta fase corrente, será adiada — the umbrella bullet's full coverage requires the confirmação and reset-password destination screens; both are deferred per Non-UI rows above. The 3 ship-this-phase telas (signup, login, forgot-password) are inventoried and covered by their own verbs; the umbrella bullet itself is deferred to the phase that lands the missing screens. |

## Non-UI / Deferred Capabilities

_None._

## Testing Requirements

### nestjs-project

| Artifact type | Required layers |
|---------------|-----------------|
| Entity (`*.entity.ts`) | Integration: constraints, defaults, `select: false` |
| Service with branching + DB | Unit: branch logic (mock repo) + Integration: DB contract |
| Service with DB only (no branching) | Integration: DB contract |
| Service with configured lib (JWT, cache) | Unit: real lib with test config |
| Service with side-effect dep (email, storage) | Integration: real capture service (Mailpit) or local adapter |
| Module with configured imports | Unit: compilation test |
| Controller | E2E only — do NOT write unit tests |
| DTO | E2E: one validation wiring test per endpoint |
| Guard (delegates to service for business logic) | E2E + Unit if complex internal logic |
| Guard (simple, delegates to Passport) | E2E only |
| Strategy (Passport) | E2E via guard |
| Pipe (custom transformation/validation) | Unit |
| Interceptor (response transform, logging) | Unit and/or E2E |
| Exception Filter | Unit + E2E |
| Middleware | E2E |
| Queue consumer / processor (with business logic) | Unit: mock deps + Integration: real DB/storage |
| Queue consumer / processor (external system calls only) | Integration: real systems |

_Source: `.claude/skills/testing-guide-nestjs-project/SKILL.md` § 3 (Feature Implementation Checklist), plus `artifacts/future-types.md` § "Queue Consumers / Processors" for the two queue rows (this phase is the first to introduce them). "E2E" here means HTTP-layer integration tests via supertest, not browser-based testing._

_Artifact types this phase introduces that the guide does not yet cover: the **standalone worker entrypoint** (a Nest standalone application context rather than an HTTP app) and **FFmpeg/ffprobe subprocess invocation**. Layer requirements for both are deferred to implementation; `references/external-systems.md` covers the storage/queue boundary strategy those tests will rely on._
