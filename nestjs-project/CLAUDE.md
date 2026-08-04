# CLAUDE.md

## Environment Startup Verification

**Default behavior:** starting the environment means starting **only infrastructure services** (database, mail, etc.) — **never** start the NestJS application server unless the user explicitly asks to run/serve the project (e.g., "rode o projeto", "suba o servidor", "run the app").

After starting infrastructure, always confirm the containers are up before proceeding:

```bash
docker compose ps   # all services must show status "running"
```

Then verify each infrastructure service is actually ready to accept connections — not just running:

- **PostgreSQL:** `docker compose exec db pg_isready -U streamtube` — expect `accepting connections`
- **MinIO:** `docker compose exec minio mc ready local` — expect `The cluster is ready`. The bucket is created by the one-shot `minio-init` service; `docker compose ps -a minio-init` must show `exited (0)`.
- **Redis:** `docker compose exec redis redis-cli ping` — expect `PONG`

Only start the NestJS dev server (`npm run start:dev`) when the user **explicitly** asks to run the application — never as part of "start the environment".

## Development Environment

This project runs inside Docker. Always use the container for development:

```bash
# Start containers
docker compose up -d

# Install dependencies (first time only)
docker compose exec nestjs-api npm install

# Run the dev server (watch mode)
docker compose exec nestjs-api npm run start:dev
```

Services:
- `nestjs-api` — NestJS API, port `3000`
- `db` — PostgreSQL 17, port `5432`, database `streamtube`, user/password `streamtube`
- `mailpit` — SMTP sink, SMTP `1025`, web UI `8025`
- `minio` — S3-compatible object storage, API `9000`, console `9001`, user/password `streamtube`
- `minio-init` — one-shot; creates the private bucket `streamtube` and exits
- `redis` — Redis 7, port `6379`, `maxmemory-policy noeviction` (BullMQ requires it)
- `video-worker` — video processing worker; same source tree, separate entrypoint (`src/worker.ts`), **no HTTP port**. Built from `Dockerfile.worker.dev`.

### Video worker

The worker container follows the same convention as `nestjs-api`: `docker compose up -d` starts the **container**, not the process. Start the worker explicitly, in background:

```bash
docker compose exec video-worker npm run start:worker:dev   # watch mode
docker compose exec video-worker npm run start:worker       # single run
```

**Do not leave the worker process running while the test suite runs.** It consumes `video-processing`, and several suites assert on queue contents (`getWaitingCount()`); a live consumer makes them flaky.

**`ffmpeg`/`ffprobe` are in both dev images**, so the full suite — including the specs under `src/videos/processing/` that spawn the binaries — runs in `nestjs-api`, which is the single container every command in this file targets:

```bash
docker compose exec nestjs-api npm test -- --runInBand
```

The split is a **runtime** concern, not a test one: only the worker processes video in production, so the runtime image of the API stays without the binaries (phase-03-videos/TD-07). In development both images carry them because splitting the test run across two containers is not expressible in a single `npm test` and silently hides suites.

The worker container mounts the same source tree and reads the same `.env`, so the full suite also passes there. Verify the binaries with `docker compose exec nestjs-api ffprobe -version`. The worker's scratch area is the named volume `worker-tmp`, mounted at `/var/tmp/streamtube` (`WORKER_TMP_DIR`) and owned by `node`.

### MinIO image pin

`minio` is pinned to `minio/minio:RELEASE.2025-09-07T16-13-09Z` on purpose. Upstream stopped publishing the community image, so `latest` is no longer a stable target — pinning is the only way `docker compose down -v && docker compose up -d` reproduces the same environment. Two consequences are **accepted, not worked around**:

- **The image is frozen.** It will not receive upstream fixes. Bumping the tag is a deliberate decision, not routine maintenance.
- **The console is reduced.** The web UI at `:9001` no longer offers full object-browsing/administration. Do **not** verify storage behavior through the console — verify through the S3 API instead:

```bash
# The `local` alias baked into the container is credential-less (it only serves the
# healthcheck) — set a credentialed alias before any read/write operation.
docker compose exec minio sh -c 'mc alias set st http://localhost:9000 streamtube streamtube \
  && mc ls st/streamtube \
  && mc anonymous get st/streamtube'   # expect: permission is `private`

curl -s -o /dev/null -w "%{http_code}\n" http://localhost:9000/streamtube/<key>   # expect 403
```

`minio-init` reuses the same pinned image (it already ships `mc`) so there is only one MinIO tag to keep in sync.

All verification and teardown commands run on the **host machine**:

```bash
# Verify NestJS is running (expect 200 + "Hello World!")
curl http://localhost:3000

# Verify PostgreSQL is ready (runs inside the db container)
docker compose exec db pg_isready -U streamtube

# Check container logs
docker compose logs nestjs-api
docker compose logs db

# Tear down the entire environment
docker compose down
```

## Commands

**Strict rule:** every `npm`, `npx`, `node`, `tsc`, and test command runs **inside the container**, never on the host. Running on the host causes env-var divergence (`DB_HOST` resolves to `localhost` instead of the Compose service), uses a different Node version, and produces results that do not reflect what runs in CI/prod.

### Container-only commands (always prefix with `docker compose exec nestjs-api`)

```bash
npm run start:dev                        # Dev server with hot-reload
npm run build                            # Compile to dist/
npm run start:prod                       # Run compiled build

npm test                                 # Unit tests
npm run test:watch                       # Unit tests in watch mode
npm run test:cov                         # Coverage report
npm run test:e2e                         # End-to-end tests (always with --runInBand)

npx tsc --noEmit                         # Type-check (required before declaring a task done)
npm run lint                             # ESLint with auto-fix
npm run format                           # Prettier formatting
```

### Host-only commands (Docker / connectivity probes)

```bash
docker compose ps
docker compose logs nestjs-api
docker compose exec db pg_isready -U streamtube
curl http://localhost:3000
```

### Test execution

Integration and e2e suites share a single test database. They **must** be run with `--runInBand`:

```bash
docker compose exec nestjs-api npm test -- --runInBand
docker compose exec nestjs-api npm run test:e2e   # serial via `maxWorkers: 1` in test/jest-e2e.json
```

Parallel execution causes FK violations, deadlocks, and cross-suite contamination because suites truncate or seed shared tables concurrently.

During active development, run only the tests related to the file being changed (`npm test -- path/to/file.spec.ts`). Before declaring a task done, run the full suite — see the global `CLAUDE.md` → "Definition of Done (Technical)".

## Long-running Processes

Commands that never exit (dev server, watch modes) must be run in background in the Bash tool — otherwise the agent blocks indefinitely waiting for the process to return.

This applies to: `start:dev`, `start:prod`, `test:watch`, and any other persistent process.

## Test Type Selection

Choose the suffix by what the test really does, not by where the code under test lives. The suffix is a contract that drives Jest config (`testRegex`, parallelism), CI steps, and reader expectations.

| Suffix                  | Purpose                                                              | DB / external I/O | Location                     |
|-------------------------|----------------------------------------------------------------------|-------------------|------------------------------|
| `*.spec.ts`             | **Unit** — pure logic, all collaborators mocked                      | Forbidden         | Next to the source file      |
| `*.integration-spec.ts` | **Integration** — exercises real DB, real repositories, real modules | Required          | Next to the source file      |
| `*.e2e-spec.ts`         | **End-to-end** — full HTTP cycle via `supertest`                     | Required          | `nestjs-project/test/`       |

A test that constructs a `TypeOrmModule.forRoot`, opens a connection, or hits the `db` service **must** be `*.integration-spec.ts`, never `*.spec.ts`. A test that boots the full Nest application and makes HTTP calls **must** be `*.e2e-spec.ts`.

Conventions for **how to write** each kind of test (mocking patterns, AAA structure, override strategies for global guards, etc.) live in `.claude/rules/nestjs-testing.md` and load when you edit a test file.

## Jest Configuration

These settings are required in `package.json` (jest config) and `test/jest-e2e.json` for the project's tests to work correctly:

- `setupFiles: ["dotenv/config"]` — without this, `.env` is not loaded inside the Jest process. `DB_HOST`, `JWT_SECRET`, etc. fall back to undefined or to the host's `localhost`, breaking container-to-container DNS.
- `testRegex: '.*\\.(spec|integration-spec)\\.ts$'` — covers both unit (`*.spec.ts`) and integration (`*.integration-spec.ts`) suffixes.
- `maxWorkers: 1` in `test/jest-e2e.json` — the e2e suites share one database and truncate the same tables. In parallel they produce FK violations inside `cleanAllTables` and cross-suite contamination (a `409` that arrives as `201`). The guarantee lives in the config, not in the `test:e2e` script, so it also holds for anyone invoking `jest --config ./test/jest-e2e.json` directly.

Do not add new test-file suffixes; if a new test type is needed, update the regex deliberately.

## Environment File Conventions

`.env` is parsed by both Docker Compose and `dotenv` — values containing shell-special characters (`<`, `>`, `|`, `&`, spaces) **must be quoted** or rewritten:

```dotenv
# Wrong — the unquoted angle brackets are shell redirection syntax and break parsing
MAIL_FROM=StreamTube <noreply@streamtube.local>

# Right — quote the value
MAIL_FROM="StreamTube <noreply@streamtube.local>"
```

Whenever possible, prefer storing only the bare address in `.env` and composing display names in code (e.g., in `mail.config.ts`) so the file stays shell-safe.

## Build Assets

`tsc` (and therefore `nest build`) only emits compiled `.ts` files to `dist/`. Any non-TypeScript runtime asset — Handlebars templates (`.hbs`), JSON fixtures, static config files, etc. — must be declared in `nest-cli.json` under `compilerOptions.assets` (with `watchAssets: true` for dev). Without that, the file exists in `src/` but is missing in `dist/` and runtime fails only after build.

## Architecture

NestJS with standard module structure. Source lives in `src/`, compiled output in `dist/`.

- Each domain feature gets its own module (e.g., `UsersModule`, `VideosModule`) registered in `AppModule`
- Controllers handle HTTP routing; Services hold business logic; both are scoped to their module

## Videos module

`src/videos/` is split by concern: `uploads/` (initiate, complete, cancel, orphan cleanup), `processing/` (queue, ffprobe, thumbnail, processor, failure handling), `delivery/` (presigned redirects), plus the read paths in `videos.service.ts` / `videos.controller.ts`.

### Endpoints

The authoritative contract is `openapi.json`, regenerated with `npm run openapi:export`.

That script is `nest build && node dist/openapi-export.js`, and the build step is **not** optional. The `@nestjs/swagger` CLI plugin configured in `nest-cli.json` is a TypeScript AST transformer: it injects an `_OPENAPI_METADATA_FACTORY` into each DTO at compile time, which is what turns the `class-validator` decorators into request-body schemas. Running the exporter through `ts-node` skips the transformer entirely and emits `"SomeDto": {"type":"object","properties":{}}` for every DTO — a spec that looks complete because the `paths` are all there, while every request body is empty. The same applies to `ts-jest`, so a document built inside a test has no DTO schemas either; assert request-body shapes against the committed `openapi.json`, not against a runtime-built document.

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `POST` | `/videos/uploads` | owner | Initiate: creates the `draft` row (with its `title`), opens the multipart upload, returns one presigned URL per part |
| `POST` | `/videos/{videoId}/uploads/complete` | owner | Complete the multipart upload and publish the processing job |
| `DELETE` | `/videos/{videoId}/uploads` | owner | Cancel: aborts the multipart upload and drops the draft |
| `GET` | `/videos/me/{videoId}` | owner | Read one of the caller's own videos **in any state** |
| `POST` | `/videos/{videoId}/reprocess` | owner | Re-publish the job for a video in `error` |
| `GET` | `/videos/{publicId}` | public | Public metadata — `ready` only |
| `GET` | `/videos/{publicId}/stream` | public | `302` to a presigned playback URL |
| `GET` | `/videos/{publicId}/download` | public | `302` to the same object, signed as an attachment |
| `GET` | `/videos/{publicId}/thumbnail` | public | `302` to a presigned thumbnail URL, pinned to `image/jpeg` |

Two identifiers, deliberately: owner routes take the internal `videoId` (UUID), public routes take `public_id`. `public_id` is `randomBytes(9).toString('base64url')` — 12 chars, 72 bits (`src/videos/videos.id.ts`). A malformed `videoId` answers `404 VIDEO_NOT_FOUND`, never `400` — see `isVideoId`.

Delivery TTLs live in `src/videos/delivery/video-delivery.constants.ts`: 15 min for the signature, and the video redirect is `no-store` (it *is* the authorization point) while the thumbnail redirect is cacheable for 5 min.

### Status cycle

`draft → processing → ready | error`, with `error → processing` via reprocess (`VideoStatus` in `src/videos/entities/video.entity.ts`).

Two `CHECK` constraints enforce the `ready` contract. Both are **state-scoped** (`status <> 'ready' OR ...`) because the initiate `INSERT` creates the row before a single byte exists:

- `CHK_videos_ready_requires_metadata` — `duration_seconds`, `width`, `height`, `video_codec`, `container_format`, `size_bytes` all present
- `CHK_videos_ready_requires_thumbnail` — `thumbnail_key` present

`audio_codec` and `bitrate_bps` stay nullable even for `ready`: a file may have no audio track, and some containers report no bitrate.

`title` is `NOT NULL` and comes from the initiate request (1..200 chars, trimmed) — a pre-registered draft is never a nameless row. Editing it belongs to Fase 04.

Migrations: `1785543527910-CreateVideos.ts`, then `1785629400000-AddVideoTitle.ts`.

### Storage key layout

One private bucket, one prefix per kind of object (`src/storage/storage.constants.ts`). Both keys derive from the video's `id`, so the worker and the delivery paths resolve them without a lookup and a re-run overwrites instead of duplicating:

```
videos/<video.id>.<ext>      # ext from the content type declared at initiate, never from the filename
thumbnails/<video.id>.jpg
```

`VIDEO_CONTENT_TYPE_EXTENSIONS` is both the extension map and the allow-list the initiate DTO validates against — a content type absent from it has no extension to derive and no fallback. The resolved key is **persisted** in `storage_key`, not recomputed from the convention.

### Queue contract

Two queues (`src/videos/processing/video-queue.constants.ts`, `src/videos/uploads/orphan-draft-cleanup.constants.ts`):

- `video-processing` — job `process-video`, payload `{ videoId }` and nothing else; the worker reads the rest from the row. `jobId` is the video id, so a client calling complete twice dedups at the queue level. `attempts: 3` with exponential backoff from 5s; concurrency 1, which bounds peak scratch disk to one downloaded file.
- `video-processing-dlq` — deliberately consumer-less. BullMQ has no native dead-letter queue, so this is the explicit pattern that keeps exhausted jobs instead of dropping them.
- `video-maintenance` — job `orphan-draft-cleanup`, scheduled hourly, aborts multipart uploads for drafts older than 24h. Its own queue so it never competes for `video-processing`'s single slot.

## Code Conventions

- **TypeScript:** `nodenext` module resolution, `ES2023` target, `strictNullChecks` on, `noImplicitAny` off
- **Decorators:** `emitDecoratorMetadata` + `experimentalDecorators` enabled — required for NestJS DI
- **Prettier:** single quotes, trailing commas everywhere
- **ESLint:** `no-explicit-any` allowed; `no-floating-promises` and `no-unsafe-argument` are warnings

## REST Conventions

This is a RESTful API. All endpoints must follow standard REST conventions — correct HTTP methods, proper status codes, plural resource nouns, and consistent URL structure. Details are enforced via rules on controller files.
