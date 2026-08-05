---
scope_type: phase
related_phases: [3]
status: decided
date: 2026-07-28
scope_description: "Backend foundation for video upload and processing: S3-compatible object storage usage, background job queue, 10GB direct-to-storage upload handshake, separate FFmpeg worker, unique video URL, streaming/download delivery, and the video status lifecycle with failure handling."
---

# Technical Decisions — Phase 03: Upload e Processamento de Vídeos

_Subprojects in scope:_

- `nestjs-project/` — backend that delivers the videos module (upload initiate/complete, read by unique URL, streaming, download), the object-storage integration, the queue producer, and the FFmpeg worker. Also owns the new Compose services (object storage, queue broker, worker) and the `videos` migration.
- `next-frontend/` — **Frontend deferred.** The video UI is out of scope for this phase (`docs/desafio.md`: "Há um frontend no repositório, mas a interface de vídeo não faz parte do escopo desta fase"); the player screen belongs to Fase 05. Two TDs here are marked `Cross-layer` (TD-05 upload handshake, TD-11 delivery mode) because they define client-facing protocol contracts that the future frontend must implement — but **no frontend decision is taken in this document** and no frontend code is produced in this phase. In this phase the client side of those contracts is exercised by `test/*.e2e-spec.ts` (supertest) and `api.http`.

**Given constraint (not an open decision):** object storage is **S3-compatible, MinIO in local Docker** — fixed by `docs/desafio.md` ("ele não é uma escolha em aberto"). What TD-01 → TD-03 decide is *how* it is used (SDK, Compose wiring, bucket/key layout), not *which* storage.

---

## TD-01: Object Storage Client SDK

**Scope:** Backend

**Capability:** Serviço de armazenamento de arquivos (vídeos e thumbnails)

**Context:** The API must presign upload URLs, read objects for streaming, and the worker must download the source file and upload the generated thumbnail. The SDK choice is constrained by two things: it must run against MinIO in dev and real S3 in prod without code changes, and it must be able to presign **individual multipart part uploads** (see TD-05), which is the operation where SDKs diverge most.

**Options:**

### Option A: `@aws-sdk/client-s3` v3 + `@aws-sdk/s3-request-presigner`
Official AWS modular SDK (`3.1097.0`, CommonJS, `engines: node>=20`). `S3Client` accepts `endpoint` + `forcePathStyle: true` to target MinIO; `getSignedUrl(client, new UploadPartCommand({...}))` presigns any command, including each multipart part.
- **Pros:** Presigns *any* command uniformly — `PutObject`, `UploadPart`, `GetObject` — which is exactly what the multipart handshake needs. Same code path for MinIO and S3 (only `endpoint`/`forcePathStyle` change). CommonJS, so no ESM friction with this project's `typeorm-ts-node-commonjs` / ts-jest setup. Ships `CreateMultipartUpload` / `UploadPart` / `CompleteMultipartUpload` / `AbortMultipartUpload` as first-class commands.
- **Cons:** Larger dependency surface (client + presigner + transitive `@smithy/*`). Verbose command-object API. Requires explicitly setting `region` even though MinIO ignores it.

### Option B: `minio` (official MinIO JS SDK)
MinIO's own client (`8.0.7`, CommonJS). Friendlier API (`presignedPutObject`, `getObject`, `fPutObject`).
- **Pros:** Smaller and simpler for the common cases. Purpose-built for MinIO; no `forcePathStyle` ceremony.
- **Cons:** **No first-class API for presigning individual multipart parts** — a long-standing gap tracked upstream ([minio-js#772](https://github.com/minio/minio-js/issues/772), [minio-go#1834](https://github.com/minio/minio-go/issues/1834)); community answers route people to the AWS SDK for this exact case. Since TD-05 requires presigned `UploadPart`, this SDK would have to be supplemented by hand-rolled SigV4 signing. Also couples the code to MinIO's client rather than the S3 API the architecture diagram targets ("S3 or MinIO").

### Option C: Hand-rolled SigV4 signing over `fetch`
Sign requests manually with `crypto` and talk to the S3 REST API directly.
- **Pros:** Zero dependencies. Full control over the signature and the exact wire format.
- **Cons:** SigV4 is easy to get subtly wrong (canonical request, payload hash, `UNSIGNED-PAYLOAD` for presigned PUT). Re-implements a solved problem in a phase that already carries queue + worker + FFmpeg risk. No upside for this project.

**Recommendation:** **Option A (`@aws-sdk/client-s3` v3 + `s3-request-presigner`)** — presigning `UploadPartCommand` is a hard requirement of the recommended upload strategy (TD-05) and Option A is the only one that provides it natively. It is CommonJS, which matters: this project has no `"type": "module"` and compiles/tests through CommonJS, so ESM-only libraries are a Definition-of-Done risk. `endpoint` + `forcePathStyle: true` makes MinIO-in-dev / S3-in-prod a config change, matching the architecture diagram's "S3 or MinIO".

**Libraries:** `@aws-sdk/client-s3` `^3`, `@aws-sdk/s3-request-presigner` `^3`

**Decision:** A (@aws-sdk/client-s3 v3 + s3-request-presigner)

---

## TD-02: Local S3 Service in Docker Compose

**Scope:** Repo-wide

**Capability:** Serviço de armazenamento de arquivos (vídeos e thumbnails)

**Context:** The storage service must come up with `docker compose up -d` alongside `nestjs-api`, `db` and `mailpit` (acceptance criterion: "Object storage, fila e worker subindo via `docker compose`"). This is not a "pick a library" decision — it is a **dev-environment** decision, and it needs an explicit call because MinIO's community distribution changed materially in 2025: the Console UI was cut down to a plain object browser (May 2025), community container images stopped being published (October 2025), and the open-source project was put in maintenance mode (December 2025). Verified today: `minio/minio:latest` on Docker Hub still resolves and is pullable, but it is frozen at `RELEASE.2025-09-07T16-13-09Z` (pushed 2025-09-07); `bitnami/minio:latest` returns 404.

**Options:**

### Option A: Pin `minio/minio` to the last published release
`image: minio/minio:RELEASE.2025-09-07T16-13-09Z`, `command: server /data --console-address ":9001"`, named volume for `/data`, `MINIO_ROOT_USER`/`MINIO_ROOT_PASSWORD` from `.env`, healthcheck on `/minio/health/live`. A one-shot `mc` sidecar (or app-side ensure-bucket on boot) creates the bucket.
- **Pros:** Exactly the storage the challenge prescribes, byte-identical S3 API surface, still pullable today. An explicit tag is reproducible — no silent drift, and no dependency on new upstream releases (there are none). Widely documented; the whole ecosystem of examples applies.
- **Cons:** Frozen image — no future security patches from upstream community builds. The web console is reduced to an object browser, so console-based verification is limited (a smoke test should verify objects via `mc ls` / `aws s3 ls` / the API rather than via console screens). Requires a bucket-bootstrap step, since MinIO does not create buckets declaratively.

### Option B: `minio/minio:latest` (floating tag)
Same service, unpinned tag.
- **Pros:** One less thing to write; resolves to the newest available build.
- **Cons:** `latest` currently *is* the September 2025 release, so it buys nothing while hiding what is actually running. If the tag is ever republished or removed, the environment changes or breaks without a code change — unacceptable for a reproducible `docker compose down -v && up -d` gate.

### Option C: A different S3-compatible server (SeaweedFS, Garage, LocalStack S3, `adobe/s3mock`)
Swap the container for another S3 implementation, keeping the AWS SDK.
- **Pros:** Actively maintained images. Some are lighter than MinIO.
- **Cons:** Contradicts the challenge's explicit given ("na prática você roda **MinIO** localmente em Docker"). Multipart-upload and presigned-URL fidelity varies between implementations — `adobe/s3mock` in particular is a test double, not a dev server. Introduces a compatibility unknown into the riskiest part of the phase (10GB multipart) for a benefit the phase does not need.

**Recommendation:** **Option A (pinned `minio/minio:RELEASE.2025-09-07T16-13-09Z`)** — MinIO is a given, and pinning is the only way to keep `docker compose down -v && up -d` reproducible now that upstream community publishing has stopped. The frozen-image and reduced-console consequences are acceptable for a local dev/eval environment and should be recorded in `nestjs-project/CLAUDE.md` rather than worked around. Verification in the smoke test should go through the S3 API (`mc` / SDK / integration tests), not the console.

**Decision:** A (pinned minio/minio:RELEASE.2025-09-07T16-13-09Z)

---

## TD-03: Bucket and Object Key Layout

**Scope:** Backend

**Capability:** Serviço de armazenamento de arquivos (vídeos e thumbnails)

**Context:** Two kinds of objects are stored: the uploaded source video (up to 10GB, private, read by the worker and by the delivery endpoints) and the generated thumbnail (small, read by clients). The layout determines what the `videos` table stores (TD-12's storage-key columns), how access policy is expressed, and whether lifecycle rules can distinguish the two.

**Options:**

### Option A: One bucket, prefix per kind
Bucket `streamtube` (name from env). Keys: `videos/{videoId}/original{ext}` and `thumbnails/{videoId}/default.jpg`. Bucket stays fully private; every read is presigned or proxied.
- **Pros:** One bucket to create and healthcheck — smallest Compose/bootstrap surface. Both keys are derivable from `videoId`, so the DB columns are short and the worker needs no extra lookup. Prefix-scoped IAM policies and lifecycle rules are still possible in real S3.
- **Cons:** Thumbnails cannot be made publicly readable without a prefix-level policy (bucket-wide public would also expose videos). Mixed object sizes in one bucket make storage metrics slightly less legible.

### Option B: Two buckets — `streamtube-videos` (private) + `streamtube-thumbnails` (public-read)
Separate buckets per kind, with different access policies.
- **Pros:** Thumbnails can be served directly by a plain public URL — no presigning, cache-friendly, cheapest for listing pages (which arrive in Fase 04/07). Clean per-bucket lifecycle and metrics.
- **Cons:** Two buckets to bootstrap and two env vars. A public bucket makes thumbnails of unlisted/draft videos publicly reachable by key — and Fase 04 introduces exactly those visibility rules, so a public thumbnail bucket pre-commits a decision belonging to a later phase.
- **Cons (cont.):** Two clients' worth of configuration for what is one storage concern in this phase.

### Option C: Channel-scoped keys — `videos/{channelId}/{videoId}/original{ext}`
Same as A, but keys embed the owning channel.
- **Pros:** Human-legible ownership when browsing the bucket; per-channel prefix operations (e.g. delete a whole channel) become trivial.
- **Cons:** The key stops being derivable from `videoId` alone — the worker and the delivery endpoints must resolve `channelId` first, or the full key must be persisted anyway. Video ownership can change conceptually (it cannot in this project, but the coupling is gratuitous). Adds no capability the phase asks for.

**Recommendation:** **Option A (single private bucket, prefix per kind)** — the phase needs private-by-default storage with presigned or proxied access; nothing in Fase 03 requires public thumbnails, and Option B would pre-empt Fase 04's visibility rules (público/unlisted) by making thumbnails publicly addressable. Deriving both keys from `videoId` keeps the worker and delivery paths free of extra lookups. **Persist the resolved keys in the `videos` row anyway** (`storage_key`, `thumbnail_key`) rather than recomputing from a convention — the row must stay readable if the convention ever changes. Object extension comes from the initiate request's declared content type, not from the client-supplied filename.

**Decision:** A (single private bucket, prefix per kind)

---

## TD-04: Queue Technology

**Scope:** Backend

**Capability:** Serviço de processamento em segundo plano (filas)

**Context:** This is the phase's main open stack decision — `docs/project-plan.md` and `docs/diagrams/software-arch.mermaid` leave the Message Queue as **"TBD"**. The API publishes one job when an upload completes; a **worker in a separate container** consumes it, runs ffprobe/FFmpeg, and updates PostgreSQL. Requirements that discriminate between the options: NestJS 11 integration, retry with backoff, a dead-letter path for permanently failed jobs, worker-side concurrency control (video processing is CPU-heavy), a small Compose footprint, and — non-negotiable here — compatibility with this project's **CommonJS** build (no `"type": "module"`; `typeorm-ts-node-commonjs`; ts-jest CJS transform), since `npx tsc --noEmit` and a green suite are part of the Definition of Done.

**Options:**

### Option A: BullMQ (Redis) + `@nestjs/bullmq`
`bullmq@5.81.2` on a Redis service; `@nestjs/bullmq@11.0.4` declares peers `@nestjs/common ^10||^11` and `bullmq ^3||^4||^5`, so NestJS 11 is supported. `BullModule.forRoot` + `registerQueue` on the API side; `@Processor()` + `WorkerHost` on the worker side. Per-job `attempts` + `backoff: { type: 'exponential' }`; custom `jobId` gives natural dedup.
- **Pros:** Official NestJS module with DI-native producer/consumer wiring. CommonJS-compatible (`bullmq` and `ioredis` are both CJS). Worker concurrency, rate limiting, stalled-job recovery (lock-based, `maxStalledJobCount`) and job progress are built in. One small Redis container (`redis:8` / `redis:7.4-alpine`, official images, still actively published). Largest body of NestJS-specific examples of the three.
- **Cons:** Adds a whole new datastore to the stack purely for queueing. **No native dead-letter queue** — exhausted jobs land in a `failed` set and a DLQ is an explicit pattern (re-publish to a `*-dlq` queue from the failed handler). Requires `maxmemory-policy noeviction` on Redis (BullMQ breaks if Redis evicts keys) and Redis ≥ 6.2 (7.2+ recommended). Job durability depends on Redis persistence config.

### Option B: pg-boss (PostgreSQL as the broker)
`pg-boss@12.26.3` runs the queue inside the PostgreSQL already in the stack. Native `deadLetter: '<queue>'` per queue, `retryLimit` / `retryDelay` / `retryBackoff` (jittered exponential, implemented in SQL), `policy` modes, and `notify` for low-latency dispatch.
- **Pros:** **Zero new infrastructure** — no extra Compose service, no extra credentials. Jobs are rows: transactional enqueue alongside the `videos` update, and trivially inspectable/testable with the Postgres MCP already configured. **Native dead-letter queues** with `redrive`, plus jittered exponential backoff — the two things BullMQ makes you build.
- **Cons:** **ESM-only** (`"type": "module"`, `engines: node >= 22.12`). This project compiles and tests as CommonJS, so adoption means dynamic `import()` at the boundary, a ts-jest/transform change, or moving the module mode — a direct Definition-of-Done risk (`tsc --noEmit` + jest, which does not use Node's `require(esm)`). No official NestJS module — module wiring, graceful shutdown and worker registration are hand-written. Queue load shares the same PostgreSQL as application data. v12 also dropped automatic migration from ≤ v10.

### Option C: RabbitMQ (AMQP) via `@nestjs/microservices` or `@golevelup/nestjs-rabbitmq`
A `rabbitmq:*-management` container; the worker is an AMQP consumer.
- **Pros:** Purpose-built broker with true dead-letter **exchanges** at the broker level (`deadLetterExchange` / `deadLetterRoutingKey`), per-message ack/nack semantics, and a management UI for inspection. Best fit if the project later fans out to multiple consumer services or non-Node consumers.
- **Cons:** Heaviest container of the three. Retry-with-backoff is not native — the idiomatic solution is a TTL'd retry queue chain (main → retry(TTL) → main → DLQ), which is real design work. `@nestjs/microservices`' RMQ transport is a generic abstraction that hides AMQP's useful parts and pushes toward default exchanges; getting DLX semantics usually means dropping to `@golevelup/nestjs-rabbitmq` (third-party) or `amqplib` directly. No job-level concept of attempts/progress — that has to be modeled.

**Recommendation:** **Option A (BullMQ + Redis, via `@nestjs/bullmq`)** — pg-boss is genuinely the more elegant fit on paper (no new infrastructure, native DLQ, transactional enqueue), and it would be the recommendation if not for one concrete blocker: it is ESM-only, and this project is CommonJS end-to-end (`typeorm-ts-node-commonjs`, ts-jest CJS transform, no `"type": "module"`). Fighting that in the same phase that introduces storage, a worker, and FFmpeg puts the Definition of Done (`tsc --noEmit` + green suite) at risk for a benefit the phase does not need. BullMQ has an official NestJS 11-compatible module, is CommonJS, and gives worker concurrency and stalled-job recovery out of the box — the two properties that actually matter for CPU-heavy video jobs consumed by a separate container. Its missing DLQ is a small, explicit pattern (TD-13), and the added Redis container is one small official image. RabbitMQ's broker-level DLX is the strongest failure story but costs the heaviest container plus hand-built retry chains, for fan-out the project does not have.

**Libraries:** `bullmq` `^5`, `@nestjs/bullmq` `^11`; Compose service `redis` (official image, Redis ≥ 6.2, configured `--maxmemory-policy noeviction`)

**Decision:** A (BullMQ + Redis via @nestjs/bullmq)

---

## TD-05: 10GB Upload Strategy and Draft Pre-registration

**Scope:** Cross-layer

**Capability:** Transversal — covers: "Upload de vídeos com suporte a arquivos de até 10GB sem impacto na performance", "Pré-cadastro automático do vídeo como rascunho ao iniciar o upload"

**Context:** Routing a 10GB body through the API is an **automatic fail** ("Passar o arquivo de 10GB pela API de forma que trave o sistema"). The decision covers the whole handshake: who creates the upload, who transfers the bytes, how the API learns the transfer finished, and at which point the draft row is created. Hard S3 facts that constrain it: a **single PUT is capped at 5 GiB**, while **multipart** allows up to 10,000 parts of 5 MiB–5 GiB each (no minimum on the last part), and SigV4 presigned URLs expire after at most **7 days**. Cross-layer because the byte-transfer loop lives in the client: whatever is chosen here is the contract Fase 05's uploader and this phase's e2e tests must implement.

**Options:**

### Option A: Presigned **multipart** upload — API orchestrates, client transfers
`POST /videos/uploads` (initiate): API creates the `videos` row as `draft`, calls `CreateMultipartUpload`, and returns `videoId`, `uploadId`, part size, and a presigned `UploadPart` URL per part. Client PUTs each part **directly to MinIO/S3** and collects `PartNumber`+`ETag`. `POST /videos/{id}/uploads/complete` sends the part list; API calls `CompleteMultipartUpload`, flips status to `processing`, and publishes the queue job.
- **Pros:** Bytes never touch the API — Node's event loop stays free. The only path that supports 10GB (single PUT caps at 5 GiB). Parts can be retried individually and uploaded in parallel; a failed part does not restart the transfer. `AbortMultipartUpload` gives a clean cancel/cleanup path. Server keeps full control: it authorizes the initiate, owns the key, and is the one that publishes the job.
- **Cons:** The richest contract of the options — three API calls plus N part PUTs, and the client must track ETags. Client-side complexity in Fase 05 (chunking, concurrency, retries). Presigned-URL count and expiry need a policy (at 64 MiB parts, 10GB ≈ 160 URLs; at the 5 MiB minimum it would be ~2048). Requires CORS on the bucket for browser clients.

### Option B: Single presigned `PutObject` URL
Initiate returns one presigned PUT; the client sends the whole file in one request.
- **Pros:** Simplest possible contract — one URL, one PUT. Bytes still bypass the API.
- **Cons:** **Hard-blocked by the requirement:** a single PUT cannot exceed 5 GiB, and the phase demands 10GB. No resumability — a broken connection at 9GB restarts from zero. No per-part retry. Fails the deliverable outright.

### Option C: Upload through the API with streaming (Busboy/`stream.pipeline` → S3 `Upload`)
The client posts to the API, which streams the body straight into `@aws-sdk/lib-storage`'s managed multipart without buffering to disk or memory.
- **Pros:** Single API call, single URL, no CORS or presigning; the API can validate content type mid-stream. Easiest client.
- **Cons:** Every byte transits the API container: 10GB per upload of sustained socket + TLS + buffer churn, multiplied by concurrent uploaders. It saturates exactly the process that must stay responsive, and the challenge names this as the wrong path ("passar o arquivo inteiro pela API é o caminho errado"). Also puts the request timeout/proxy limits of the API in the critical path of a multi-hour transfer.

### Option D: tus resumable protocol (`@tus/server`)
Run a tus endpoint with an S3 store; the client uses a tus uploader for resumable chunked upload.
- **Pros:** Standardized resumable protocol with mature clients (Uppy); best-in-class resume-after-disconnect UX; offset negotiation is handled by the protocol.
- **Cons:** `@tus/server@2.4.2` is **ESM-only** — same CommonJS friction as pg-boss in TD-04. Chunks land on the tus server (the API container) before being relayed to S3 unless the S3 store's specific configuration is tuned — reintroducing the very traffic Option A avoids. A second HTTP surface with its own auth story alongside the JWT guard. Considerable complexity for resumability the challenge does not require.

**Recommendation:** **Option A (presigned multipart, API-orchestrated)** — it is the only option that actually reaches 10GB (B is capped at 5 GiB by S3), and it is the only one that keeps the bytes off the API (C fails on this, D partially). Concretely: **part size 64 MiB** (≈160 parts for 10GB — comfortably under the 10,000-part ceiling, and few enough that presigning all parts at initiate is cheap), presigned-part expiry on the order of **hours, not the 7-day maximum** (a 10GB transfer over a 10 Mbps link takes ~2.2h; if the plan prefers tighter expiry, add a "presign more parts" endpoint instead of stretching the TTL). The **draft row is created at initiate, before any byte is uploaded** — that is what satisfies "pré-cadastro automático do vídeo como rascunho ao iniciar o upload" and it also gives the client the `videoId` it needs for the subsequent calls.

**On the completion trigger:** prefer the **client-called `complete` endpoint** over a MinIO bucket notification (`s3:ObjectCreated:CompleteMultipartUpload` → webhook). MinIO supports the notification, but `CompleteMultipartUpload` is a server-side call that the API must make anyway (it needs the ETag list), so the API already knows the exact moment the object exists — a webhook would add a second, differently-authenticated ingress path and a dev-only MinIO configuration step for information the API already has. The API remains the single place that publishes the job.

**Decision:** A (presigned multipart, API-orchestrated, draft at initiate)

---

## TD-06: Worker Runtime Shape and Database Access

**Scope:** Backend

**Capability:** Processamento automático do vídeo após upload (extração de duração e metadados)

**Context:** The architecture diagram fixes a **separate `Video Worker` container** that reads the queue, reads/writes storage, and updates the database. What is open is *what runs inside it*: how the process is built, how it reuses the project's entities/config, and how it writes to PostgreSQL. FFmpeg must be present in the worker image but must not bloat the API image.

**Options:**

### Option A: Same codebase, separate entrypoint — standalone Nest application context
A `src/main.worker.ts` boots `NestFactory.createApplicationContext(WorkerModule)` (no HTTP listener). `WorkerModule` imports `ConfigModule`, `TypeOrmModule`, the storage provider, and the BullMQ `@Processor`. Same `Dockerfile.dev`, different `command:` in Compose; FFmpeg installed in the image.
- **Pros:** Full reuse of entities, migrations, config namespaces, repository pattern and the DI container — the worker updates `videos` through the same TypeORM repository the API uses, so there is exactly one schema definition. Fits the project's conventions (`nestjs-project/CLAUDE.md`) with no new paradigm. `createApplicationContext` skips the HTTP layer, so no accidental second API surface. Integration tests can boot `WorkerModule` the same way they boot other modules today.
- **Cons:** The worker image carries the API's full dependency tree (plus FFmpeg). Compose needs a distinct `command`/entrypoint per service off the same build. A crash in shared bootstrap code affects both services.

### Option B: Separate Nest application (own `package.json` / own project)
A second app (Nest monorepo `apps/*` or a sibling directory) with its own dependencies and its own build.
- **Pros:** Independent dependency surface — FFmpeg bindings and video libs never enter the API's tree. Clean deploy and scaling boundary. Smallest worker image.
- **Cons:** Entities, config and migrations must be shared via a workspace package or duplicated — either restructures the repo (workspaces are not set up) or invites schema drift, which is the worst failure mode here. Doubles CI/lint/test surface. A large structural change for a phase that already introduces three new infrastructure services.

### Option C: Plain Node/TypeScript script (no Nest)
A standalone script instantiating a BullMQ `Worker` and a raw `pg` client or a bare TypeORM `DataSource`.
- **Pros:** Minimal, fast to boot, no framework overhead. Easy to reason about.
- **Cons:** Loses DI, config namespaces (`registerAs`), and the repository pattern; hand-wires everything the project already solved. Either re-declares the `videos` schema or imports entities while bypassing the module system. Diverges from the project's conventions and from the "reuse the patterns, don't rewrite" instruction in the challenge.

**Recommendation:** **Option A (same codebase, separate entrypoint, standalone application context)** — the decisive factor is schema and config single-sourcing: the worker's job is to write `duration`, metadata, `thumbnail_key` and `status` to the same `videos` row the API reads, so sharing the entity and the TypeORM configuration eliminates the drift risk that Options B and C introduce. It also matches the challenge's continuity instruction ("Reuse os padrões do projeto") and keeps testability aligned with the existing integration-test style. The image-size cost is irrelevant in a dev/eval environment; if FFmpeg must be kept out of the API image later, that is a Dockerfile-target change, not an architecture change.

**On database access:** the worker writes **directly via TypeORM** using the shared `Video` entity — not through an internal HTTP API. An internal API would add a network hop, a second auth surface, and a hard dependency of the worker on API availability, for no gain: both containers already legitimately reach `db`, and the diagram states `worker → db "Updates"` explicitly.

**Decision:** A (same codebase, separate entrypoint, standalone app context)

---

## TD-07: FFmpeg/ffprobe Invocation and Binary Provisioning

**Scope:** Backend

**Capability:** Transversal — covers: "Processamento automático do vídeo após upload (extração de duração e metadados)", "Geração automática de thumbnail a partir de um frame do vídeo"

**Context:** The worker needs two operations: read duration/resolution/codec/bitrate (ffprobe) and extract one frame as a JPEG (ffmpeg). Two things must be decided: which Node abstraction invokes the binaries, and how the binaries get into the worker image. The obvious default is a trap: **`fluent-ffmpeg` is deprecated** — npm marks `2.1.3` as *"Package no longer supported"* and the GitHub repository was **archived on 2025-05-22**.

**Options:**

### Option A: Direct invocation via `node:child_process` (`execFile`)
Call `ffprobe -v error -print_format json -show_format -show_streams <input>` and parse the JSON; call `ffmpeg -ss <t> -i <input> -frames:v 1 ...` for the frame. Wrap both in a small typed service.
- **Pros:** No dependency, therefore nothing to be deprecated. `ffprobe -print_format json` is a stable, documented, machine-readable contract — no wrapper's opinion between the data and the code. Exact control over arguments (including `-ss` placement, which materially changes seek performance). `execFile` with an argument array avoids shell interpolation of untrusted paths. Trivial to unit-test by mocking the exec boundary and to integration-test against a real fixture.
- **Cons:** Argument strings and JSON shapes must be typed and validated by hand. Error handling (exit code + stderr) is on us. No built-in progress events.

### Option B: `fluent-ffmpeg`
The historically standard fluent wrapper (`ffmpeg().screenshots(...)`, `ffmpeg.ffprobe(...)`).
- **Pros:** Ergonomic chainable API; `screenshots()` covers thumbnail generation in a couple of lines; large body of tutorials.
- **Cons:** **Deprecated on npm and archived upstream** — no fixes, no security patches, no maintainer. Adopting it in a greenfield phase in 2026 means knowingly taking on an abandoned dependency for syntax sugar over a CLI call. Its own maintainer's stated rationale for phasing it out is that it is "essentially a command-line generator". Types come from a separate `@types` package.

### Option C: A maintained wrapper or WASM build (`@ffmpeg/ffmpeg`, `ffmpeg-static` + a thin wrapper)
`ffmpeg-static` ships a prebuilt binary via npm; `@ffmpeg/ffmpeg` is a WebAssembly port.
- **Pros:** `ffmpeg-static` removes the apt step and pins the binary version through `package.json`. `@ffmpeg/ffmpeg` needs no system binary at all.
- **Cons:** `ffmpeg-static` still leaves the invocation problem unsolved (it is a binary, not an API) — it only replaces *how the binary arrives*, and it adds a ~70MB npm postinstall download to every `npm install`. `@ffmpeg/ffmpeg` (WASM) is dramatically slower and memory-bound — a non-starter for multi-GB inputs, and it is aimed at browsers.

**Recommendation:** **Option A (direct `execFile` of `ffprobe`/`ffmpeg`), with the binaries installed in the worker image via apt** — the deprecated status of `fluent-ffmpeg` removes the only real reason to add an abstraction, and `ffprobe -print_format json` is a better contract than any wrapper: stable, documented, and directly assertable in tests. The worker image extends the existing `node:25.6.0-slim` base with `apt-get install -y ffmpeg` (Debian's package provides both `ffmpeg` and `ffprobe`), which keeps the binary out of `npm install` and out of the API image. Use `execFile` with an argument array (never a shell string) since object keys derive from user input, and set an explicit timeout so a pathological input cannot pin the worker forever.

**Libraries:** none (Node built-in `child_process`); system package `ffmpeg` in the worker image

**Decision:** A (direct execFile; ffmpeg via apt in worker image)

---

## TD-08: How the Worker Reads the Source File

**Scope:** Backend

**Capability:** Processamento automático do vídeo após upload (extração de duração e metadados)

**Context:** ffprobe and the thumbnail frame extraction need to read the uploaded object, which may be 10GB. How the worker gets at those bytes decides whether the worker container needs tens of gigabytes of scratch disk, and how long a job holds its queue lock.

**Options:**

### Option A: Download the whole object to a temp file, then probe/extract, then delete
`GetObject` → stream to `os.tmpdir()`; run both FFmpeg commands against the local path; `finally` unlink.
- **Pros:** FFmpeg gets a real seekable local file — the fastest and most reliable case for both `-show_format` and frame seeking. Fully deterministic; no network mid-processing. Simplest to reason about and to test.
- **Cons:** Needs up to 10GB of free scratch space **per concurrent job** — a real Compose/volume consideration. The download itself dominates job duration and lengthens the lock hold. Leaks disk if cleanup is skipped on a crash (mitigated by a temp volume that resets with the container).

### Option B: Pass a presigned `GetObject` URL directly to FFmpeg (HTTP input)
Generate a short-lived presigned GET and hand the URL to `ffprobe`/`ffmpeg` as the input; FFmpeg's HTTP protocol issues Range requests as it seeks.
- **Pros:** No local disk at all. For metadata + an early frame, FFmpeg reads only the header and one keyframe region — potentially seconds of work on a 10GB file instead of a full download. Dramatically shorter jobs.
- **Cons:** Depends on FFmpeg's HTTP/Range behavior and on the container image being built with the needed protocol support; behavior varies with container format (a non-fragmented MP4 with a trailing `moov` atom forces extra seeking, and some formats degrade to near-full reads). Presigned URL must outlive the whole probe. Failure modes become network failures mid-FFmpeg, which are harder to diagnose. Two processes (probe + frame) each re-open the remote input.
- **Cons (cont.):** A presigned URL is passed as a process argument — it must not be logged.

### Option C: Range-download only the head, probe that, then a second targeted read for the frame
Fetch the first N MB, probe it, and use the metadata to fetch only the byte range needed for the chosen frame.
- **Pros:** Bounded disk and bounded transfer; conceptually the cheapest correct approach.
- **Cons:** Requires container-format knowledge to pick N and to locate the frame's byte range — exactly the work FFmpeg exists to do. Fragile across formats; a wrong N produces "moov atom not found" style failures. Substantial complexity for an optimization the phase does not need.

**Recommendation:** **Option A (download to a temp file)** — it is the only option whose correctness does not depend on container-format layout or on FFmpeg's remote-seek behavior, and correctness is what this phase is graded on. Bound the cost instead of avoiding it: keep worker **concurrency low** (start at 1) so peak scratch usage is one file, mount a dedicated temp volume for the worker, and always clean up in a `finally`. Option B is the right optimization later — it should be revisited if processing latency becomes a concern, and its viability is a measurable question (does `ffprobe` over presigned HTTP read the header only for our inputs?) rather than a design one.

**Decision:** A (download to temp file, low concurrency)

---

## TD-09: Thumbnail Extraction Policy

**Scope:** Backend

**Capability:** Geração automática de thumbnail a partir de um frame do vídeo

**Context:** "Um frame do vídeo" leaves the frame choice, output format and dimensions open. The values matter because they are baked into every future listing page (Fase 04's management panel, Fase 05's sidebar, Fase 07's home grid) and because a bad choice yields black or duplicated thumbnails. Depends on TD-07 (invocation) and TD-08 (local file available).

**Options:**

### Option A: Fixed early timestamp (e.g. `-ss 00:00:01`), one JPEG
Seek one second in and grab a single frame; scale to a fixed width preserving aspect ratio.
- **Pros:** Trivial and fast — with `-ss` before `-i` FFmpeg seeks without decoding the preceding frames. Deterministic and easy to assert in tests. Works for any duration ≥ 1s.
- **Cons:** Frame 1s in is often a black frame, a fade-in, or a title card. For very short clips it needs a guard (clamp to `min(1s, duration/2)`).

### Option B: Percentage of duration (e.g. 10%), one JPEG
Probe duration first (already required by the phase), then seek to a fraction of it.
- **Pros:** Reuses the duration that ffprobe already returns — no extra cost. Avoids intros/black lead-ins far more often than a fixed 1s. Naturally correct for both 5-second and 3-hour videos. Still fully deterministic and assertable.
- **Cons:** One extra ordering constraint (probe must precede extraction — which TD-12's flow already implies). A pathological video can still yield a dull frame.

### Option C: Content-aware selection (`-vf thumbnail` or scene-change filter), or N candidates
Let FFmpeg pick the most representative frame from a window, or generate several and store one.
- **Pros:** Best-looking result; avoids black frames by construction. `thumbnail` filter is designed exactly for this.
- **Cons:** Must decode a window of frames rather than seeking — meaningfully more CPU on large files. Non-deterministic output makes tests assert "an image exists" rather than a known frame. Multiple candidates imply a chooser UI, which belongs to Fase 04's custom-thumbnail capability, not here.

**Recommendation:** **Option B (percentage of duration, clamped)** — duration is already extracted in the same job, so seeking to ~10% costs nothing extra and avoids the single most common failure of Option A (a black opening frame) without Option C's decode cost or non-determinism. Concretely: seek to `max(1s, duration * 0.10)`, extract exactly one frame (`-frames:v 1`), output **JPEG** (universally supported by browsers and far smaller than PNG for photographic frames), scale to a fixed width with `-vf scale=<W>:-2` so the aspect ratio is preserved and the height stays even. Store under the key from TD-03 and record `thumbnail_key` on the row. Fase 04 owns custom thumbnails; this phase produces exactly one automatic default.

**Decision:** B (percentage of duration, clamped; single JPEG)

---

## TD-10: Unique Video URL Identifier

**Scope:** Backend

**Capability:** URL única por vídeo, sem conflito com outros vídeos

**Context:** Every video needs a public identifier that "nunca conflite com outro vídeo" (`docs/project-plan.md` § Pontos de Atenção) and that addresses the video in the read/streaming/download routes. The project's existing entities use `@PrimaryGeneratedColumn('uuid')` PKs, so the question is whether the public identifier is the PK itself or a separate, shorter column.

**Options:**

### Option A: Reuse the UUID primary key as the public identifier
Routes are `/videos/{uuid}`; no extra column.
- **Pros:** Zero new code, zero collision risk (uniqueness is the PK constraint), no extra index. Consistent with `users`/`channels`. One identifier to reason about, log and test.
- **Cons:** 36-character URLs — noticeably uglier than the short IDs the platform is modeled on. Exposes the primary key in public URLs, coupling the external contract to the internal key. No opportunity to change internal keys later without breaking links.

### Option B: Separate short random identifier column (`public_id`), unique-indexed
A dedicated column holding a short, URL-safe random string (e.g. 11–12 characters from a 64-symbol alphabet), generated at insert, with a `UNIQUE` index and a retry on the (astronomically rare) conflict.
- **Pros:** Short, YouTube-like URLs — the aesthetic the project explicitly calls out ("URL curta e única"). Decouples the public contract from the internal PK. Non-sequential, so it is not enumerable. Collision probability at 11 chars over a 64-symbol alphabet (~66 bits) is negligible at this project's scale, and the unique index makes a collision a caught error rather than data corruption.
- **Cons:** One more column, one more index, and a generator to write and test. Two identifiers in play (internal `id` vs public `public_id`) — every route and DTO must be clear about which it uses.

### Option C: Slug from the title + disambiguating suffix
`meu-video-incrivel-x7f2`, derived from the title.
- **Pros:** Human-readable and marginally better for SEO.
- **Cons:** Titles are editable in Fase 04 — either the URL changes (breaking links) or the slug drifts from the title. Requires the same random suffix as Option B to guarantee uniqueness, so it inherits all of B's cost plus normalization/transliteration concerns already navigated for nicknames in `technical-decisions-phase-02-auth.md` TD-10. Empty/emoji-only titles need fallbacks. Most complexity of the three, for a benefit the phase does not ask for.

**Recommendation:** **Option B (separate short random `public_id` with a unique index)** — the project's own attention point asks for a *short* unique URL, which the 36-char UUID of Option A does not deliver, and Option C ties a permanent URL to a mutable title that Fase 04 will start editing. Generate it with Node's built-in **`crypto.randomBytes` rendered base64url** (sliced to a fixed length) rather than adding `nanoid`: `nanoid@6` is ESM-only *and* declares `engines: ^22 || ^24 || >=26`, which excludes this container's Node 25.6 — an avoidable dependency conflict for ~5 lines of code. Keep the internal UUID PK for foreign keys (the `Channel` relation) and expose only `public_id` in routes and payloads.

**Libraries:** none (Node built-in `crypto`)

**Decision:** B (short random public_id, unique index, built-in crypto)

---

## TD-11: Streaming and Download Delivery Strategy

**Scope:** Cross-layer

**Capability:** Transversal — covers: "Reprodução via streaming (sem necessidade de download completo)", "Download do vídeo pelo usuário"

**Context:** Playback must start without downloading the whole file (which in HTTP terms means honoring `Range` and answering `206 Partial Content`), and a separate download action must deliver the full file. Because the bucket is private (TD-03), something must mediate access. This is a client-facing contract: whether the client receives bytes or a redirect determines what Fase 05's player does, and it determines whether the API is in the data path for every second of every view. Note that the architecture diagram already draws `frontend → storage "Streams"`, i.e. the intended data path does **not** pass through the API.

**Options:**

### Option A: API proxies the bytes, honoring `Range` → `206`
`GET /videos/{publicId}/stream` reads the client's `Range` header, issues `GetObject` with the same `Range`, and pipes the result back with `206`, `Content-Range`, `Accept-Ranges: bytes` and `Content-Length`. Download is the same with `Content-Disposition: attachment` and no range.
- **Pros:** One origin — no CORS, no presigning, no URL expiry to manage. Authorization is enforced per byte-range request, so access can be revoked instantly and per-request rules (private/unlisted in Fase 04) apply naturally. Easiest to assert in e2e tests (`Range: bytes=0-1023` → `206` in one supertest call, no external hop). Storage credentials never leave the server.
- **Cons:** Every viewer's bytes transit the API container — the same load profile the phase spent TD-05 avoiding for uploads, now on the read side and for the lifetime of every view. Contradicts the diagram's `frontend → storage` edge. Node must handle many long-lived streaming sockets; scaling reads means scaling the API. Doubles egress (storage → API → client).

### Option B: `302` redirect to a short-lived presigned `GetObject` URL
`GET /videos/{publicId}/stream` authorizes, then redirects to a presigned URL; MinIO/S3 serves the bytes and honors `Range`/`206` itself. Download redirects to a presigned URL carrying `response-content-disposition=attachment`.
- **Pros:** Bytes go client ↔ storage directly, exactly as the architecture diagram specifies; the API stays out of the data path and handles one cheap request per playback session. `Range`/`206` is provided by the storage server, which already implements it correctly — no partial-content code to write or get wrong. Native CDN story later. Players follow redirects transparently.
- **Cons:** The presigned URL is a bearer capability for its lifetime — anyone holding it can read the object until it expires, so the TTL must be short (minutes). Authorization is checked once at redirect time, not per range request. Browser clients need CORS on the bucket. e2e tests assert the `302` and its `Location`, then optionally follow it — two hops instead of one.

### Option C: Return the presigned URL in the JSON payload
`GET /videos/{publicId}` includes a `streamUrl` (and `downloadUrl`) the client assigns to the player.
- **Pros:** Same data-path benefits as B with no redirect round-trip; the client can prefetch/inspect the URL.
- **Cons:** The capability URL is now embedded in cacheable JSON and in client state, widening exposure and making the payload's cacheability dangerous. Playback breaks silently once the URL expires mid-session (the player just stalls) with no chance to re-authorize, whereas a redirect endpoint is re-requestable. The API loses the interception point that Fase 04's visibility rules will want.

**Recommendation:** **Option B (`302` to a short-lived presigned URL)** for both streaming and download — it matches the architecture diagram's explicit `frontend → storage "Streams"` edge, it keeps the API out of the data path (consistent with the phase's whole thesis on the upload side), and it gets correct `Range`/`206` semantics from the storage server for free instead of hand-rolling partial-content handling. Keep a stable, authorized API route as the entry point (`/videos/{publicId}/stream` and `/videos/{publicId}/download`) rather than exposing raw URLs, so authorization stays server-side and Fase 04/05 can tighten it without changing the client contract; set the presigned TTL to minutes, not hours; and use `response-content-disposition` on the download URL so the same object serves both behaviors. The main thing given up versus Option A is per-range authorization — acceptable in this phase, where video viewing is anonymous by design (`docs/project-plan.md`, Fase 05: "Acesso anônimo à visualização de vídeos"), and revisitable in Fase 04 when unlisted/private visibility arrives.

**Decision:** B (302 to short-lived presigned URL)

---

## TD-12: Video Status Lifecycle and Transitions

**Scope:** Backend

**Capability:** Transversal — covers: "Pré-cadastro automático do vídeo como rascunho ao iniciar o upload", "Processamento automático do vídeo após upload (extração de duração e metadados)"

**Context:** The challenge requires the status cycle "rascunho → processando → pronto/erro" to be reflected in the database. The open question is whether extra states are warranted between them, since each state must be produced by a real transition, be observable, and be meaningful to Fase 04's management panel (which lists videos by status). Depends on TD-05 (which defines the initiate/complete moments) and TD-04 (which defines job dispatch).

**Options:**

### Option A: Minimal four states — `draft → processing → ready | error`
`draft` on initiate; `processing` when the complete endpoint publishes the job; `ready` when the worker finishes; `error` on permanent failure.
- **Pros:** Exactly what the challenge asks for, with no invented requirements — every state is produced by an unambiguous event in the flow. Smallest enum, smallest state machine to test. `draft` naturally doubles as "upload in progress", and Fase 04's rascunho → publicação flow reuses it rather than colliding with it.
- **Cons:** `draft` conflates "created but bytes not yet uploaded" with "uploaded but not yet complete" — a client polling status cannot distinguish them. No dedicated state for "worker picked the job up" versus "job queued".

### Option B: Add transfer states — `draft → uploading → uploaded → processing → ready | error`
Explicit states for the transfer window and for the completed-but-not-yet-dequeued window.
- **Pros:** Precise observability: an operator can tell a stalled transfer from a stalled queue. `uploaded` makes orphan detection (TD-15) trivially queryable.
- **Cons:** `uploading` cannot be maintained truthfully — the API does not see the part PUTs (they go straight to storage per TD-05), so it could only be *assumed* on initiate, which is exactly what `draft` already means. `uploaded` and `processing` are separated by microseconds in the same request handler, so the state is almost never observable. Invents requirements the challenge does not state and adds transitions with no observer.

### Option C: Two-axis model — `status` (draft/published) + `processing_state` (pending/processing/ready/error)
Separate the publication lifecycle from the processing lifecycle.
- **Pros:** Genuinely orthogonal concerns: Fase 04's rascunho → publicação is about visibility, while processing is about readiness. Avoids the future awkwardness of a video that is both "published" and "processing".
- **Cons:** Two columns, two enums and a cross-product of valid combinations to validate, in a phase whose acceptance criterion names a single cycle. Fase 04 owns the publication axis and can introduce it (with its own visibility rules) when it needs it; pre-building it here means guessing that phase's requirements.

**Recommendation:** **Option A (minimal `draft → processing → ready | error`)** — it maps one-to-one onto the acceptance criterion and every state corresponds to an event the API actually observes. Option B's `uploading` is unmaintainable precisely because TD-05 keeps the API out of the transfer, and Option C's second axis belongs to Fase 04's visibility work. Concretely: a Postgres **enum** column defaulting to `draft`; transitions are `initiate → draft`, `complete → processing` (in the same operation that publishes the job), `worker success → ready`, `worker permanent failure → error` (with the reason persisted, per TD-13). Transitions are guarded — the complete endpoint only accepts a video in `draft`, and the worker only advances a video in `processing` — which is also what makes the job idempotent (TD-14).

**Decision:** A (minimal draft → processing → ready | error)

---

## TD-13: Processing Failure Handling

**Scope:** Backend

**Capability:** Processamento automático do vídeo após upload (extração de duração e metadados)

**Context:** Video processing fails for both transient reasons (storage blip, disk pressure, worker restart) and permanent ones (the object is not a decodable video). The two must be treated differently: retrying a corrupt file forever wastes the worker, and failing a transient error immediately strands the video in `error`. Depends on TD-04 (BullMQ, which has retries with backoff but **no native dead-letter queue**) and TD-12 (which defines the `error` state).

**Options:**

### Option A: BullMQ retries with exponential backoff + `error` row on exhaustion + a separate DLQ queue
Job declares `attempts: N` and `backoff: { type: 'exponential', delay: D }`. While attempts remain, the worker throws and BullMQ re-delivers. On the final failure, the worker sets `status = error` with a persisted reason and publishes the job to a `video-processing-dlq` queue that has no consumer, retaining the payload for inspection/redrive.
- **Pros:** Uses BullMQ's native retry/backoff, so transient errors self-heal. The `error` state plus a stored reason satisfies the acceptance criterion visibly in the database and gives Fase 04's panel something to show. The DLQ queue makes permanently failed payloads inspectable and redrivable without writing an admin surface now. Nothing is silently lost.
- **Cons:** The DLQ is a convention the code must maintain (BullMQ gives no `deadLetter` option), so the failed handler must not itself fail. Two places record the failure (queue + DB row), which must stay consistent. A permanent error still burns N attempts unless errors are classified.

### Option B: Retries only, no DLQ — rely on BullMQ's `failed` set
Same retry configuration; on exhaustion, set `status = error`. Exhausted jobs simply remain in BullMQ's built-in `failed` set.
- **Pros:** Least code — the `failed` set is already there and is inspectable via BullMQ APIs or a board UI. One source of failure truth.
- **Cons:** The `failed` set is a retention window, not a queue: it is trimmed by `removeOnFail` policies and is not designed for redrive-as-a-flow. Loses the explicit "these need human attention" signal that a named DLQ gives, which the plan for this phase calls out as expected coverage.

### Option C: Error classification — fail fast on permanent errors, retry only transient ones
Distinguish a non-decodable input (ffprobe exits non-zero with a parse error) from infrastructure failures; permanent errors skip remaining attempts (BullMQ's `UnrecoverableError`), transient ones retry with backoff.
- **Pros:** Correct semantics: a corrupt upload goes to `error` in seconds instead of after N backed-off attempts, and the worker is not occupied re-decoding garbage. Best user-facing latency for the most common failure (wrong file type).
- **Cons:** Requires classifying FFmpeg/ffprobe exit codes and stderr, which is heuristic and can misclassify. More branches to test. Adds behavior on top of A rather than replacing it.

**Recommendation:** **Option A as the baseline, with Option C's fail-fast applied to the one clearly-classifiable case** — retries with exponential backoff (start at `attempts: 3`, `backoff: exponential, delay: 5000`) handle the transient class; on exhaustion the worker writes `status = error` **plus a persisted failure reason** and publishes to a consumer-less `video-processing-dlq` so nothing is lost silently. Layer on top: when `ffprobe` reports the input has no decodable video stream, treat it as permanent and go straight to `error` without consuming the remaining attempts — that is the exact case the smoke test exercises ("subir um arquivo não-vídeo e confirmar status `error` sem derrubar o worker"), and it is cheap to classify because it is ffprobe's own verdict rather than a guess about infrastructure. The worker must never let a processing failure crash the process: the handler catches, records, and returns. **Reprocessing** is exposed as an explicit re-enqueue path guarded to videos in `error` (not an automatic retry loop) so a fixed environment can recover a video without a new upload.

**Decision:** A + fail-fast on non-decodable input

---

## TD-14: Worker Job Idempotency

**Scope:** Backend

**Capability:** Processamento automático do vídeo após upload (extração de duração e metadados)

**Context:** At-least-once delivery is the norm: a job can be re-delivered after a worker crash or a lost lock (BullMQ moves stalled jobs back to `wait`), and a client can call the complete endpoint twice. Reprocessing (TD-13) can also enqueue the same video again. Without a guard, one video can be probed twice, produce two thumbnails, and race on its own status row.

**Options:**

### Option A: Deterministic `jobId` (= `videoId`) + status guard in the worker
Publish with `jobId: video.id`, which BullMQ deduplicates while the job exists; the worker additionally only advances a video whose status is `processing`, and the complete endpoint only accepts a video in `draft`.
- **Pros:** Two independent layers: the queue rejects duplicate enqueues, and the DB state machine rejects duplicate *effects* even if a duplicate slips through (e.g. after the original job was cleaned up). The DB guard is the one that actually matters and it costs nothing extra, since TD-12 already defines guarded transitions. Thumbnail and video keys are derived from `videoId` (TD-03), so a re-run overwrites in place rather than accumulating garbage objects.
- **Cons:** BullMQ's dedup only holds while the job record exists — after completion/removal, the same `jobId` can be added again (which is desirable for reprocessing, but means `jobId` alone is not a sufficient guard). The status check must be an atomic conditional update, not a read-then-write, or two concurrent workers can both pass it.

### Option B: DB-only guard via a conditional status update
No special `jobId`; the worker's first action is `UPDATE videos SET status='processing' WHERE id=$1 AND status='processing'`-style conditional claim, and it aborts if no row is affected.
- **Pros:** Single source of truth (the database), no reliance on queue semantics. Portable if the queue is ever swapped.
- **Cons:** Duplicate jobs are still enqueued and still dequeued — the worker burns a slot to discover it has nothing to do. Needs an extra claim state or a `processing_started_at`/token column to distinguish "claimed" from "queued", which grows TD-12's model.

### Option C: Dedicated idempotency token per attempt
Persist a `processing_token` on the row; the job payload carries it, and the worker only acts if the token matches.
- **Pros:** Precise: distinguishes "this exact attempt" from any other, so a stale re-delivery after a reprocess is rejected. Useful if attempts ever need independent audit.
- **Cons:** An extra column, an extra field in the message contract, and token lifecycle rules — real complexity for a scenario (overlapping reprocess of the same video) that this phase's flow does not produce. Over-engineering relative to the guarantees needed.

**Recommendation:** **Option A (deterministic `jobId` + atomic status guard)** — the queue-level dedup is one line and eliminates the common duplicate (a client calling complete twice), while the status guard is the real safety net and is already implied by TD-12's guarded transitions. Make the guard an **atomic conditional update** rather than a read-then-write so two workers cannot both proceed, and keep the storage keys derived from `videoId` (TD-03) so any re-run is idempotent in storage too — the thumbnail is overwritten, not duplicated. Option C's token is the right answer only if concurrent reprocessing of the same video becomes possible; it is not in this phase, where reprocessing is guarded to videos in `error`.

**Decision:** A (deterministic jobId + atomic status guard)

---

## TD-15: Abandoned Upload (Orphan Draft) Handling

**Scope:** Backend

**Capability:** Pré-cadastro automático do vídeo como rascunho ao iniciar o upload

**Context:** TD-05 creates the `draft` row *before* any byte moves, so a client that initiates and then disappears leaves two artifacts: a `draft` row that will never advance, and an **incomplete multipart upload** in the bucket whose already-uploaded parts still consume storage (S3 and MinIO both bill/hold parts until the upload is completed or aborted). The phase must decide whether it cleans this up, and where.

**Options:**

### Option A: Scheduled cleanup job — abort the multipart upload and delete the stale draft
A repeatable job (BullMQ's scheduler, already available from TD-04) periodically finds `draft` videos older than a threshold, calls `AbortMultipartUpload` for each, and deletes the row.
- **Pros:** Reclaims both the storage and the database row, using infrastructure the phase already introduces. `AbortMultipartUpload` is the API's documented mechanism for exactly this. Testable as a plain service method, independent of the scheduler.
- **Cons:** Needs the `uploadId` persisted on the row to abort (a column the flow otherwise only needs transiently). Requires choosing a threshold — too short and it kills a slow legitimate 10GB transfer, so it must comfortably exceed the worst realistic upload time. Deleting rows a user might expect to see is a product decision being made by a cleanup job.

### Option B: Storage-side lifecycle rule for incomplete multipart uploads
Configure a bucket lifecycle rule that aborts incomplete multipart uploads after N days; leave the `draft` rows alone.
- **Pros:** Zero application code; the storage layer's own, purpose-built feature. Correct in production S3 by default.
- **Cons:** Solves only half the problem — the orphan `draft` rows remain forever. Requires bucket configuration at provisioning time, which in local MinIO means another bootstrap step and something the tests cannot easily exercise. Day-granularity only.

### Option C: Leave drafts in place; do not clean up in this phase
Drafts stay as-is; Fase 04's management panel surfaces them and the user deletes them.
- **Pros:** No invented requirement — the challenge does not ask for cleanup, and Fase 04 explicitly owns the draft-management panel where deletion naturally lives. Smallest possible surface for a phase already carrying three new services.
- **Cons:** Incomplete multipart parts accumulate invisibly in the bucket — the one consequence that is genuinely a storage-cost problem and that `docs/project-plan.md` flags as an attention point ("vídeos grandes consomem muito espaço... planejar o crescimento e os custos"). Nothing tells the user why a video is stuck.

**Recommendation:** **Option A, scoped down: persist `uploadId` and implement an explicit `abortUpload` path plus a cleanup service method; wire the schedule conservatively** — the part-accumulation problem in Option C is real and is called out in the project plan, and Option B leaves the database side unaddressed. The minimum honest implementation is (1) store the `uploadId` on the draft row so the multipart upload can always be aborted, (2) expose an explicit cancel operation for the owner, and (3) provide a cleanup routine that aborts and removes drafts older than a generous threshold (24h comfortably exceeds any realistic 10GB transfer). Keep the *row deletion* policy conservative — if the plan prefers, the routine can abort the multipart upload (reclaiming the storage, which is the costly part) and leave the row for Fase 04's panel to handle; that split is the safer reading of scope, since Fase 04 owns draft management and this phase owns storage hygiene.

**Decision:** A, scoped (persist uploadId, abort path, conservative cleanup)

---

## Decisions Summary

| ID | Scope | Decision | Recommendation | Choice |
|----|-------|----------|---------------|--------|
| TD-01 | Backend | Object Storage Client SDK | A (`@aws-sdk/client-s3` v3 + `s3-request-presigner`) | A (@aws-sdk/client-s3 v3 + s3-request-presigner) |
| TD-02 | Repo-wide | Local S3 Service in Docker Compose | A (pinned `minio/minio:RELEASE.2025-09-07T16-13-09Z`) | A (pinned minio/minio:RELEASE.2025-09-07T16-13-09Z) |
| TD-03 | Backend | Bucket and Object Key Layout | A (single private bucket, prefix per kind) | A (single private bucket, prefix per kind) |
| TD-04 | Backend | Queue Technology | A (BullMQ + Redis via `@nestjs/bullmq`) | A (BullMQ + Redis via @nestjs/bullmq) |
| TD-05 | Cross-layer | 10GB Upload Strategy and Draft Pre-registration | A (presigned multipart, API-orchestrated, draft at initiate) | A (presigned multipart, API-orchestrated, draft at initiate) |
| TD-06 | Backend | Worker Runtime Shape and Database Access | A (same codebase, separate entrypoint, standalone app context) | A (same codebase, separate entrypoint, standalone app context) |
| TD-07 | Backend | FFmpeg/ffprobe Invocation and Binary Provisioning | A (direct `execFile`; `ffmpeg` via apt in worker image) | A (direct execFile; ffmpeg via apt in worker image) |
| TD-08 | Backend | How the Worker Reads the Source File | A (download to temp file, low concurrency) | A (download to temp file, low concurrency) |
| TD-09 | Backend | Thumbnail Extraction Policy | B (percentage of duration, clamped; single JPEG) | B (percentage of duration, clamped; single JPEG) |
| TD-10 | Backend | Unique Video URL Identifier | B (short random `public_id`, unique index, built-in `crypto`) | B (short random public_id, unique index, built-in crypto) |
| TD-11 | Cross-layer | Streaming and Download Delivery Strategy | B (`302` to short-lived presigned URL) | B (302 to short-lived presigned URL) |
| TD-12 | Backend | Video Status Lifecycle and Transitions | A (minimal `draft → processing → ready \| error`) | A (minimal draft → processing → ready \| error) |
| TD-13 | Backend | Processing Failure Handling | A + fail-fast on non-decodable input | A + fail-fast on non-decodable input |
| TD-14 | Backend | Worker Job Idempotency | A (deterministic `jobId` + atomic status guard) | A (deterministic jobId + atomic status guard) |
| TD-15 | Backend | Abandoned Upload (Orphan Draft) Handling | A, scoped (persist `uploadId`, abort path, conservative cleanup) | A, scoped (persist uploadId, abort path, conservative cleanup) |

---

## New Dependencies (to be pinned by `plan-resolve` via context7)

| Package | Version researched | Purpose | Notes |
|---------|--------------------|---------|-------|
| `@aws-sdk/client-s3` | `3.1097.0` | S3/MinIO client | CommonJS, `engines: node>=20` |
| `@aws-sdk/s3-request-presigner` | `3.1097.0` | Presign `UploadPart` / `GetObject` | CommonJS |
| `bullmq` | `5.81.2` | Queue engine | CommonJS; requires Redis ≥ 6.2 |
| `@nestjs/bullmq` | `11.0.4` | NestJS integration | peers: `@nestjs/common ^10 \|\| ^11`, `bullmq ^3 \|\| ^4 \|\| ^5` |

**Rejected for concrete, verified reasons — do not reintroduce without revisiting the TD:**

| Package | Reason |
|---------|--------|
| `fluent-ffmpeg` | npm-deprecated (*"Package no longer supported"*, latest `2.1.3`); GitHub repo archived, last push 2025-05-22 (TD-07) |
| `pg-boss` | `12.26.3` is ESM-only (`"type": "module"`, `node>=22.12`) — incompatible with this project's CommonJS build/test setup without structural changes (TD-04) |
| `@tus/server` | `2.4.2` is ESM-only; same friction, plus it reintroduces API-transiting bytes (TD-05) |
| `nanoid` | `6.0.0` is ESM-only **and** declares `engines: ^22 \|\| ^24 \|\| >=26`, which excludes the container's Node 25.6 (TD-10) |
| `minio` (JS SDK) | `8.0.7` has no first-class presigned-multipart-part API, which TD-05 requires (TD-01) |

## Infrastructure Added to `compose.yaml`

| Service | Image | Purpose |
|---------|-------|---------|
| `minio` | `minio/minio:RELEASE.2025-09-07T16-13-09Z` (pinned — see TD-02) | S3-compatible object storage; named volume for `/data` |
| `redis` | official `redis` image, `--maxmemory-policy noeviction` (BullMQ requirement) | Queue broker |
| `video-worker` | same build as `nestjs-api`, `ffmpeg` installed, distinct `command` | Queue consumer; FFmpeg/ffprobe processing |

Hosts always reference Compose **service names** (`db`, `minio`, `redis`) per the project's Docker rule — never `localhost`.

## Sources

- [Amazon S3 multipart upload limits](https://docs.aws.amazon.com/AmazonS3/latest/userguide/qfacts.html) — max 10,000 parts, part size 5 MiB–5 GiB, no minimum on the last part
- [`@aws-sdk/s3-request-presigner` `getSignedUrl`](https://github.com/aws/aws-sdk-js-v3/blob/main/packages/s3-request-presigner/src/getSignedUrl.ts) and [S3Client `endpoint`/`forcePathStyle`](https://github.com/aws/aws-sdk-js-v3/blob/main/clients/client-s3/src/endpoint/EndpointParameters.ts)
- [BullMQ Redis compatibility](https://docs.bullmq.io/guide/redis-tm-compatibility) and [going to production (`noeviction`)](https://docs.bullmq.io/guide/going-to-production)
- [BullMQ worker failure/stalled-job handling](https://github.com/taskforcesh/bullmq/blob/master/src/classes/worker.ts)
- [`@nestjs/bullmq` on npm](https://www.npmjs.com/package/@nestjs/bullmq) — v11.0.4 peer ranges
- [pg-boss queue options — `deadLetter`, `retryBackoff`](https://github.com/timgit/pg-boss/blob/master/docs/api/queues.md)
- [`fluent-ffmpeg` on npm](https://www.npmjs.com/package/fluent-ffmpeg) (deprecated) and [Phasing out fluent-ffmpeg](https://github.com/fluent-ffmpeg/node-fluent-ffmpeg/issues/1324)
- [minio-js: presigned multipart not supported](https://github.com/minio/minio-js/issues/772), [minio-go equivalent](https://github.com/minio/minio-go/issues/1834)
- [MinIO bucket notifications (`s3:ObjectCreated:CompleteMultipartUpload`)](https://github.com/minio/minio/blob/master/docs/bucket/notifications/README.md)
- [MinIO Community Edition archived / maintenance mode](https://thecloudsupportengineer.com/the-end-of-an-era-minio-community-edition-is-archived-whats-next/) and [community Docker images discontinued](https://algustionesa.com/minio-ends-docker-images-what-you-need-to-know/)
- [`nanoid` ESM/CommonJS constraint](https://github.com/ai/nanoid/issues/491)
- [MDN — 206 Partial Content](https://developer.mozilla.org/docs/Web/HTTP/Status/206)

Registry/API facts (versions, `type`, `engines`, deprecation flags, image tags) were verified directly against `registry.npmjs.org`, Docker Hub and Quay on 2026-07-28.
