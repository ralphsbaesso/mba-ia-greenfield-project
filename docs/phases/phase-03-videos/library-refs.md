---
libs:
  "@aws-sdk/client-s3":
    version: "^3 (researched 3.1097.0)"
    context7_id: "/aws/aws-sdk-js-v3"
    fetched_at: "2026-07-29T21:47:08-03:00"
  "@aws-sdk/s3-request-presigner":
    version: "^3 (researched 3.1097.0)"
    context7_id: "/aws/aws-sdk-js-v3"
    fetched_at: "2026-07-29T21:47:08-03:00"
  "bullmq":
    version: "^5 (researched 5.81.2)"
    context7_id: "/taskforcesh/bullmq"
    fetched_at: "2026-07-29T21:47:08-03:00"
  "@nestjs/bullmq":
    version: "^11 (researched 11.0.4)"
    context7_id: "/nestjs/bull"
    fetched_at: "2026-07-29T21:47:08-03:00"
sources_mtime:
  docs/decisions/technical-decisions-phase-03-videos.md: "2026-07-29T21:38:25-03:00"
  docs/decisions/technical-decisions-video-authorization-and-metadata.md: "2026-07-29T21:58:24-03:00"
  docs/decisions/technical-decisions-thumbnail-delivery.md: "2026-07-29T21:38:25-03:00"
---

# Library Reference Cache

Distilled from Context7 for the surfaces this scope's TDs actually use. Not a general API tour — each section is scoped to the decided TD that introduced the dependency.

Only 2 of the 21 decided TDs introduce installable packages (`phase-03-videos/TD-01`, `phase-03-videos/TD-04`). `TD-07` and `TD-10` deliberately resolve to Node built-ins (`child_process`, `crypto`); `TD-02` pins a container image, not an npm package; `TD-04` additionally provisions a `redis` Compose service. None of those are cached here.

---

## @aws-sdk/client-s3

_Introduced by `phase-03-videos/TD-01`. Consumed by TD-03 (key layout), TD-05 (multipart handshake), TD-08 (worker download), TD-15 (abort path), `video-authorization-and-metadata/TD-04` (`size_bytes` via HeadObject)._

**MinIO-vs-S3 as config only** (TD-01's stated reason for this option): construct the client with `endpoint` + `forcePathStyle: true` so dev (MinIO) and prod (S3) differ by configuration, not code. Per phase 01's inherited convention this belongs in a namespaced `registerAs` factory under `src/config/`, not inline.

**Multipart lifecycle** — the exact call sequence TD-05 orchestrates:

```typescript
// 1. initiate — API-side, returns UploadId
const { UploadId } = await client.send(new CreateMultipartUploadCommand({ Bucket, Key }));

// 2. per part — the API PRESIGNS these; the client PUTs them directly to storage
//    (see @aws-sdk/s3-request-presigner below)
const partResponse = await client.send(new UploadPartCommand({
  Bucket, Key, UploadId, PartNumber: n, Body, ContentLength,
}));
completedParts.push({ PartNumber: n, ETag: partResponse.ETag });

// 3. complete — API-side; needs the full ETag list from the client
await client.send(new CompleteMultipartUploadCommand({
  Bucket, Key, UploadId,
  MultipartUpload: { Parts: completedParts },   // [{ ETag, PartNumber }]
}));

// 4. abort — TD-15's cleanup path and any failure unwind
await client.send(new AbortMultipartUploadCommand({ Bucket, Key, UploadId }));
```

`CompleteMultipartUploadCommand` requires `Bucket`, `Key`, `UploadId` and returns `{ Bucket, Key, ETag }`. `ListPartsCommand({ Bucket, Key, UploadId })` returns `Parts[]` with their `ETag`s — useful for reconciling a client that lost its part list mid-transfer.

**Why the API must make the `complete` call itself** (TD-05's rationale): `CompleteMultipartUpload` is server-side and needs the ETag list, so the API already knows the moment the object exists. That is why TD-05 chose a client-called `complete` endpoint over a MinIO bucket notification.

**`HeadObjectCommand`** — `va/TD-04` makes this authoritative for `size_bytes` (ffprobe's `format.size` is only a cross-check).

## @aws-sdk/s3-request-presigner

_Introduced by `phase-03-videos/TD-01`. Consumed by TD-05 (presigned `UploadPart` URLs), TD-11 (stream/download delivery), `thumbnail-delivery/TD-01` (thumbnail delivery)._

```typescript
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";

const url = await getSignedUrl(client, new GetObjectCommand(params), { expiresIn: 3600 });
```

**`expiresIn` defaults to 900 seconds (15 min).** This matters twice:

- **TD-11 / thumb-TD-01** want "minutes, not hours" — the default already satisfies that, so an explicit value is a documented choice rather than a correction.
- **TD-05** wants part URLs valid for **hours** (a 10GB transfer over 10 Mbps ≈ 2.2h), so `expiresIn` must be set explicitly there. TD-05 prefers a "presign more parts" endpoint over stretching toward the 7-day maximum.

**Response-header overrides become SIGNED QUERY PARAMS.** Per the client-s3 schema, `ResponseContentType` → `response-content-type` and `ResponseContentDisposition` → `response-content-disposition` are `[_hQ]` (query-string) parameters folded into the signature:

```
https://…/key?response-content-type=image%2Fjpeg&response-content-disposition=attachment%3Bfilename%3D…&X-Amz-Signature=…
```

Two decided consequences:

- **TD-11** uses `response-content-disposition=attachment` so one object serves both stream and download.
- **thumb-TD-01** uses `response-content-type=image/jpeg` so the browser renders inline regardless of the object's stored content type.

**Load-bearing caveat for thumb-TD-01:** because these params are *inside the signature*, and the signature is regenerated on every presign, the full URL changes per request. A browser's cache key is the full URL, so **presigned image bytes are never reusable across page loads** — no `Cache-Control` value changes this. This is exactly why thumb-TD-01 rejected Option B as "Option A's caching penalty without Option A's stable entry point", and why the `Cache-Control` it does prescribe goes on the `302` response, not on the presigned target.

Works with any command (`GetObjectCommand`, `PutObjectCommand`, `UploadPartCommand`). Presigning strips `amz-sdk-invocation-id`, `amz-sdk-request` and `x-amz-user-agent` headers before signing.

## bullmq

_Introduced by `phase-03-videos/TD-04`. Consumed by TD-13 (failure handling), TD-14 (idempotency), TD-08 (concurrency)._

**Deterministic `jobId` deduplication** — the mechanism TD-14 relies on. Adding jobs with an identical `jobId` is a no-op for every duplicate:

```typescript
await queue.add('process-video', { videoId }, { jobId: videoId });   // TD-14: jobId = videoId
```

> **GOTCHA (from the BullMQ docs, directly relevant to TD-14):** `removeOnComplete` / `removeOnFailed` **interfere with duplicate detection** — once the job record is removed, a re-added job with the same `jobId` is no longer seen as a duplicate. TD-14's second layer (the atomic conditional status update in the DB) is what makes this safe, so do NOT rely on `jobId` alone if either removal option is enabled.

**Retries with exponential backoff** — TD-13's transient class (`attempts: 3`, `delay: 5000`):

```typescript
await queue.add('process-video', { videoId }, {
  jobId: videoId,
  attempts: 3,
  backoff: { type: 'exponential', delay: 5000 },
});
```

**Failure classification in `Worker.handleFailed`** — how BullMQ itself partitions errors, which is the seam TD-13's fail-fast rule plugs into:

- `RateLimitError` → job moves back to `wait`.
- `DelayedError` / `WaitingError` / `WaitingChildrenError` → non-fatal; worker fetches the next job.
- **any other error** → `job.moveToFailed(err, token)`, emits `failed`, and retries per the job's `attempts` / `backoff`.

So TD-13's "fail fast on non-decodable input without consuming remaining attempts" is not a built-in error class — it must be implemented by the handler recording `status = error` and returning normally (or by adding the job with `attempts: 1` for that class). TD-13's requirement that "the worker must never let a processing failure crash the process" maps to catching inside `process()` rather than letting the throw reach BullMQ, except where a retry is actually wanted.

**Worker concurrency** — TD-08 requires starting at 1 so peak scratch disk is one 10GB file: set the worker's `concurrency` option (default 1).

**Events:** `worker.on('completed', (job, returnvalue) => …)`, `worker.on('failed', (job, error) => …)`.

**DLQ:** BullMQ has no native dead-letter queue — TD-13's `video-processing-dlq` is an ordinary consumer-less queue the handler publishes to on attempt exhaustion. `job.attemptsMade` is available for detecting exhaustion.

## @nestjs/bullmq

_Introduced by `phase-03-videos/TD-04`. Consumed by TD-06 (standalone worker entrypoint) and the module-compilation test the testing guide requires for any module with configured imports._

**Async root config** — the shape that composes with phase 01's `registerAs` + `ConfigType` convention:

```typescript
BullModule.forRootAsync({
  imports: [ConfigModule],
  inject: [redisConfig.KEY],
  useFactory: (cfg: ConfigType<typeof redisConfig>) => ({
    connection: { host: cfg.host, port: cfg.port },   // host = Compose service name, never localhost
  }),
}),
BullModule.registerQueue({ name: 'video-processing' }),
```

`registerQueueAsync({ name, useFactory })` is available when the queue's own options need injected services. Root options accept `defaultJobOptions` (`attempts` / `backoff`), which is where TD-13's retry policy can live once instead of per `add()` call.

**Processor** — the idiomatic consumer shape:

```typescript
@Processor('video-processing')
class VideoProcessingProcessor extends WorkerHost {
  async process(job: Job<{ videoId: string }>): Promise<void> { /* TD-07/08/09 pipeline */ }

  @OnWorkerEvent('failed')
  onFailed(job: Job, err: Error) { /* TD-13: persist failure reason */ }
}
```

`WorkerHost` is abstract with `abstract process(job, token?)`. Inject a queue as a producer with `@InjectQueue('video-processing')`.

> **GOTCHA — `worker` getter timing:** `WorkerHost.worker` **throws** if accessed before the `onModuleInit` lifecycle hook has run ("Worker has not yet been initialized"). Touch it in `onApplicationBootstrap` or later, not in a constructor.

> **GOTCHA — shutdown can hang, and it bites tests:** `onApplicationShutdown` calls `worker.close()` for every worker (BullMQ's `force=true` by default) and then closes the queue; `forceDisconnectOnShutdown` additionally force-disconnects Redis. **A worker still running a job can block shutdown** if `close()` waits for active jobs. With TD-08's design (a whole 10GB object downloaded, then ffmpeg invoked), a job can legitimately run for minutes — so an integration test that forgets `afterAll(() => app.close())`, or one that closes while a job is active, is a Jest open-handle hang. This compounds the testing guide's existing "forget `afterAll(() => app.close())` causes Jest to hang" pitfall; TD-07's explicit `execFile` timeout is what bounds the worst case.
