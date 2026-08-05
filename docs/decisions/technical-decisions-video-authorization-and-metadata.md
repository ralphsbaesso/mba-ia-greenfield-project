---
scope_type: ad-hoc
related_phases: [3]
status: decided
date: 2026-07-29
scope_description: "Authorization and ownership model for the Fase 03 video endpoints (anonymous vs. authenticated routes, owning entity of the pre-registered draft, access rule for non-ready videos) plus the ffprobe metadata field set persisted by the worker."
---

# Technical Decisions — Video Endpoint Authorization, Draft Ownership and Persisted Metadata

_Subprojects in scope:_

- `nestjs-project/` — owns all four TDs: the guard/`@Public()` placement on the video routes, the `videos` ownership column and its resolution from the JWT, the status-based access rule on the delivery routes, and the metadata columns the worker writes.
- `next-frontend/` — **no open decision in this document.** The video UI is out of scope for Fase 03 (`docs/desafio.md`; the player screen belongs to Fase 05). TD-01 and TD-03 are marked `Cross-layer` because they fix client-facing contracts the future frontend must implement (which calls carry a bearer token; what a client sees for a video that is not `ready`), but no frontend choice is taken here — in this phase the client side of those contracts is exercised by `test/*.e2e-spec.ts` (supertest) and `api.http`.

**Why this document exists:** `/plan-validate phase-03-videos` raised `MD-1` (no TD decides authorization/ownership for the video HTTP surface) and `AMB-1` ("extração de duração e metadados" never enumerates which fields to persist). Both blocked the phase: `TD-05`'s upload handshake has no principal to scope its presigned grant to, `TD-11`'s delivery routes have no access rule, and `/plan-build` cannot derive the `videos` columns without a field list.

**Inherited constraints (not reopened here):** `JwtAuthGuard` is registered as a global `APP_GUARD` alongside `ThrottlerGuard` (`nestjs-project/src/auth/auth.module.ts:34-35`), following the canonical NestJS 11 pattern — the guard throws `UnauthorizedException` unless the route carries `@Public()`. `JwtPayload` is `{ sub, email }` (`src/auth/auth.types.ts`) — it does **not** carry a channel id. `Channel` is 1:1 with `User` through a `unique` `user_id` column (`src/channels/entities/channel.entity.ts`). Error shape is fixed by `phase-02-auth/TD-07`.

**Boundary note:** visibility (`público` / `unlisted`) and the `rascunho → publicação` flow are **Fase 04** capabilities; anonymous viewing and the download button are **Fase 05**. This document decides only the access rules the Fase 03 endpoints need, and deliberately leaves a seam for Fase 04 to tighten.

---

## TD-01: Video Endpoint Authentication Matrix

**Scope:** Cross-layer

**Capability:** Transversal — covers: "Upload de vídeos com suporte a arquivos de até 10GB sem impacto na performance", "Reprodução via streaming (sem necessidade de download completo)", "Download do vídeo pelo usuário"

**Context:** Because the guard is global with `@Public()` as the sole opt-out, every route this phase adds is authenticated unless someone deliberately marks it otherwise — so "which video routes are anonymous" is a decision that gets made whether or not it is recorded. The project premise states viewing is anonymous ("Usuários anônimos podem assistir livremente"), and `TD-11` already leans on that when it accepts authorizing once at redirect time instead of per byte-range; but with no TD stating it, the assumption is unverifiable when the plan is built. Depends on `TD-05` (which defines the initiate/complete calls) and `TD-11` (which defines the delivery routes); route paths below follow their recommendations, and the matrix maps by **role**, not by literal path, if those decisions land differently.

**Options:**

### Option A: Anonymous reads, authenticated writes
Public-facing reads keyed by `publicId` (metadata, stream, download) carry `@Public()`; the upload calls and the owner's own view of a video require a valid token. The owner's status poll is a **separate authenticated route keyed by the internal `videoId`**, so no route needs to serve both audiences.
- **Pros:** Matches the stated premise directly and keeps the canonical guard untouched — no new guard class, no second metadata key. Two disjoint route families (`publicId` = anonymous, `videoId` = owner) make the intent readable at the controller and trivially assertable in e2e (`no token → 200` on stream, `no token → 401` on initiate).
- **Cons:** Two read routes for one resource, which is mild duplication until Fase 04 gives them genuinely different payloads. An anonymous caller can enumerate `publicId`s; `TD-10`'s random identifier is what makes that impractical, so this option leans on that decision.

### Option B: Every video endpoint authenticated in Fase 03
No `@Public()` anywhere; anonymous access is opened in Fase 05 when the player screen lands.
- **Pros:** Smallest surface now and the most conservative default — nothing is exposed before a phase actually needs it exposed. All e2e tests run with one auth fixture.
- **Cons:** Contradicts the phase's own deliverable ("streaming funcionando") being demonstrable the way the product defines streaming — anonymous. Defers a decision that `TD-11` has already priced in, so the two TDs would disagree on the record. Fase 05 would then have to revisit routes shipped in Fase 03, which is the rework this pipeline exists to avoid.

### Option C: Anonymous reads with optional authentication
Reads are reachable without a token, but when a token *is* present the guard resolves it and populates `request.user`, so a handler can branch on identity (owner sees more).
- **Pros:** One read route instead of two, and it is the shape Fase 04 (owner previews an `unlisted`/draft video) and Fase 06 (did *I* like this) eventually need — adopting it now avoids a later split.
- **Cons:** Requires deviating from the canonical guard: the documented `AuthGuard` throws when no token is present, so optional auth needs either a second metadata key (`@OptionalAuth()`) plus a third branch in `canActivate`, or a separate guard composed after the global one. That machinery has **no consumer in Fase 03** — no Fase 03 handler branches on identity. It also makes every read route's behavior depend on a header that may or may not be there, which is the harder thing to test (three cases per route: absent, valid, invalid).

**Recommendation:** **Option A (anonymous reads, authenticated writes)** — it satisfies the premise, leaves the inherited guard exactly as phase 02 built it, and keeps the identity-branching machinery of Option C unbuilt until a phase has a handler that actually branches. Option C is the right *eventual* shape, and Option A does not block it: adding `@OptionalAuth()` later is additive, and the owner route can collapse into the public one at that point. Concretely, the matrix:

| Route (per TD-05 / TD-11) | Role | Auth |
|---|---|---|
| `POST /videos/uploads` (initiate) | write — creates the draft, returns the presigned grant | authenticated |
| `POST /videos/{videoId}/uploads/complete` | write — flips to `processing`, publishes the job | authenticated + owner (TD-02) |
| `GET /videos/{videoId}` | owner view — status/progress poll | authenticated + owner (TD-02) |
| `GET /videos/{publicId}` | public metadata | `@Public()` |
| `GET /videos/{publicId}/stream` | delivery — `302` to presigned URL | `@Public()` |
| `GET /videos/{publicId}/download` | delivery — `302` with `content-disposition` | `@Public()` |

The **initiate** call is the security boundary of the whole upload path: it is what mints presigned part URLs, and those URLs are bearer capabilities for their TTL. Authenticating initiate is therefore what scopes the grant — the part PUTs themselves are unauthenticated by construction (they go straight to storage, per `TD-05`), and no guard can change that. Rate limiting on initiate is inherited from the global `ThrottlerGuard`; whether the video routes need a tighter bucket than the app default is an implementation concern for `/implement`, not a TD.

**Decision:** A (anonymous reads keyed by publicId, authenticated writes + owner route keyed by videoId)

---

## TD-02: Draft Ownership — Owning Entity and Grant Scoping

**Scope:** Backend

**Capability:** Pré-cadastro automático do vídeo como rascunho ao iniciar o upload

**Context:** The draft row is created at initiate, before any byte exists (`TD-05`), so the row must record an owner at that moment — and the ownership check on `complete` and on the owner's status read (`TD-01`) resolves against it. The JWT carries only `sub` (the user id), so whatever column is chosen, the initiate handler must map `sub` → owner. `TD-03` (key layout) explicitly **rejected** embedding the owner in the object key, so ownership lives in the `videos` row and nowhere else. Fase 04 builds a channel management panel and a public channel page listing videos; Fase 07 builds home/search listings.

**Options:**

### Option A: `channel_id` FK on `videos`
The video belongs to a channel. Initiate resolves the caller's channel via `channels.user_id = sub` (already `unique`, so indexed) and stores `channel_id`.
- **Pros:** Domain-correct — in this product videos are published *by a channel*, and that is the entity Fase 04's panel and public channel page are built around, and that Fase 07's listings group by. The join to recover the user is always available through the 1:1 relation, so nothing is lost.
- **Cons:** One extra lookup at initiate to translate `sub` → `channel_id`. The ownership check on `complete` compares against the caller's channel rather than directly against `sub`, so it also pays that lookup (or caches it per request).

### Option B: `user_id` FK on `videos`
The video belongs directly to the user; the channel is derived when needed.
- **Pros:** Zero-lookup ownership check — `video.user_id === payload.sub` is a direct comparison against the token, with no query at all. Simplest possible initiate.
- **Cons:** Every channel-oriented read in Fase 04 and Fase 07 (channel page, panel, listings) must join `videos → users → channels` to answer "which channel published this", pushing the cost into the hotter read path instead of the once-per-upload write path. Models the domain as "user owns video", which the product's own vocabulary contradicts.

### Option C: Both `user_id` and `channel_id`
Denormalize so either question is answerable without a join.
- **Pros:** Both access patterns are direct. Because the User↔Channel relation is 1:1 and `unique`-enforced, the two columns cannot disagree in practice.
- **Cons:** Two sources of truth for one fact, with nothing in the schema forcing them to agree — a composite FK or trigger would be needed to make the invariant real, which is more machinery than either single-column option. Buys a join that Option A only pays on the write path and Option B only on the read path.

**Recommendation:** **Option A (`channel_id`)** — the lookup it adds lands on the write path (once per upload, on an already-unique indexed column), while Option B's lands on the read path (every channel page and listing, in Fases 04 and 07). Given the domain vocabulary and the fact that Fase 04 is literally named "Gerenciamento de Vídeos e Canal", `channel_id` is also the column those phases would migrate toward anyway. Concretely: `channel_id uuid NOT NULL` with an FK to `channels(id)` and a non-unique index (the channel page's "list this channel's videos" is the query it serves); resolve `sub` → `channel_id` in the initiate handler and reject with the inherited domain-error shape (`phase-02-auth/TD-07`) if the user somehow has no channel — phase 02 creates the channel at signup with `cascade`, so that is a `500`-class invariant violation, not a user-facing `400`.

**Sub-variant considered and not taken:** adding `channelId` to the JWT payload to skip the lookup entirely. Rejected because it mutates an inherited contract (`phase-02-auth`'s token shape) for a saving of one indexed query on a once-per-upload call, and it puts a value in a token that outlives changes to it — Fase 04 lets users edit channel fields, and while the id itself is stable, widening the token to carry denormalized channel state invites exactly that drift. If a later phase finds the lookup genuinely hot, the change is a phase-02 supersede, not a Fase 03 shortcut.

**Decision:** A (channel_id FK, resolved from sub at initiate)

---

## TD-03: Access Rule for Videos That Are Not `ready`

**Scope:** Cross-layer

**Capability:** Transversal — covers: "Reprodução via streaming (sem necessidade de download completo)", "Download do vídeo pelo usuário"

**Context:** `TD-12` gives four states (`draft → processing → ready | error`) and the delivery routes are anonymous (`TD-01`), so the delivery handlers must decide what to do when the requested video is not `ready`. Three facts make this non-trivial: a `processing` video may have no thumbnail and a source object that just finished a multipart assembly; an `error` video may hold an undecodable file (`TD-13` fails fast on exactly that); and the owner needs *some* way to learn that processing finished, because `TD-05`'s handshake ends at `complete` and nothing else reports the transition. The status-vs-response-code choice is also the seam Fase 04 tightens when `unlisted`/`público` arrive.

**Options:**

### Option A: `ready`-only on public routes (`404`), owner polls a separate authenticated route
Public `publicId` routes serve only `ready` videos and answer `404` for every other state. The owner reads its own video's status through the authenticated `videoId` route from `TD-01`'s matrix, in any state.
- **Pros:** Anonymous callers cannot distinguish "no such video" from "exists but not ready", so nothing leaks about drafts — which is the property Fase 04 needs for `unlisted` and gets for free by starting here. The owner's poll is unambiguous and testable, closing `TD-05`'s handshake. Never serves bytes that a player would choke on.
- **Cons:** A caller holding a legitimate `publicId` for a still-processing video sees a bare `404` with no "come back later" signal. Two routes to keep consistent as the payload grows.

### Option B: `ready`-only for everyone, no owner exception
Non-`ready` is `404` on every route; the owner discovers readiness through a future "my videos" listing in Fase 04.
- **Pros:** One rule, no exceptions, smallest handler logic.
- **Cons:** Leaves Fase 03 with no observable path from `complete` to `ready` — the phase's own e2e flow cannot assert the transition it is built to produce, and the deliverable "processamento automático do vídeo" becomes unverifiable end-to-end without reading the database directly from the test. Pushes a Fase 03 need into Fase 04.

### Option C: Serve whatever bytes exist, regardless of status
Delivery ignores status and presigns the object if the key is populated.
- **Pros:** Simplest handler; no status coupling in the delivery path at all.
- **Cons:** `processing` and `error` are precisely the states where the object is absent, partial, or undecodable, so this trades a clean `404` for a broken player, a stalled download, or a presigned URL to a nonexistent key. Also exposes draft content the moment a `publicId` is guessed, pre-breaking Fase 04's visibility rules.

**Recommendation:** **Option A** — it is the only option that both keeps unreadable content unreachable and gives Fase 03 an observable `processing → ready` transition to assert. The load-bearing detail is **`404`, not `403`**: a `403` confirms the video exists, which is the leak Fase 04's `unlisted` rule must not have, and starting with `404` means that rule arrives as a tightening rather than a correction. Concretely: the public metadata and both delivery handlers filter on `status = 'ready'` in the same query that resolves `publicId` (one query, not a fetch-then-check, so there is no window where the check and the read disagree); the owner route returns the row in any state including `error` with its persisted failure reason (`TD-13`), which is what makes a failed upload diagnosable by its owner rather than silently absent.

**Decision:** A (ready-only on public routes with 404; owner reads any state)

---

## TD-04: ffprobe Metadata Field Set Persisted on `videos`

**Scope:** Backend

**Capability:** Processamento automático do vídeo após upload (extração de duração e metadados)

**Context:** The capability says "duração e **metadados**" without naming a field, and no TD closes it — `TD-07` decides *how* the worker invokes ffprobe (`ffprobe -v error -print_format json -show_format -show_streams`, parsed directly) but not what is kept. The field set determines the `videos` columns, the migration, and the read payload, so `/plan-build` cannot derive the data model without it. Note that `TD-07`'s own Context already names "duration/resolution/codec/bitrate" as what the worker reads — the data is in hand either way, and this decision is only about what survives the job.

**Options:**

### Option A: Duration only
Persist `duration_seconds`; discard the rest of the ffprobe output.
- **Pros:** Smallest migration and the least to keep correct. Satisfies the one metadata field the capability names explicitly.
- **Cons:** Reads "metadados" as if it said only "duração", discarding fields already parsed at zero marginal cost. Fase 05's player layout and Fase 04's management panel both surface resolution; recovering it later means either a re-probe pass over existing objects or a backfill job.

### Option B: Playback-essential set
Persist duration, resolution, both codecs, container, bitrate and byte size as promoted columns.
- **Pros:** Covers every field a player, a management panel or a listing actually displays, and each one is a plain typed column that is cheap to query, index and assert. Nothing is stored that no phase reads.
- **Cons:** Seven or eight columns to migrate and type, with nullability that has to be reasoned about per field rather than assumed. Any field a later phase wants beyond the set still needs a migration.

### Option C: Promoted columns plus the raw ffprobe JSON
Option B, plus a `jsonb` column holding the full probe output for forensics.
- **Pros:** Nothing is ever lost; an unanticipated field is a query away instead of a re-probe. Useful when diagnosing why a specific file behaved oddly.
- **Cons:** The blob has no consumer in Fases 03–05, and an unschema'd column that *might* be read invites readers to query `jsonb` paths instead of columns — a schema by accident, with no migration discipline. It also stores per-video output of unbounded width. If a forensic need appears, adding the column later is a migration, and the probe can be re-run on demand.

**Recommendation:** **Option B (playback-essential set)** — it treats "metadados" as the plural the capability wrote while keeping every stored field one that a named later phase displays, and it avoids Option C's unschema'd escape hatch that nothing currently needs. Concretely, the columns and their ffprobe sources:

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

Three details the field list depends on. **`duration_seconds` is fractional** — ffprobe reports seconds with decimals, so an integer column silently truncates; `numeric(10,3)` keeps millisecond precision without float drift. **`size_bytes` comes from the storage object, not from `format.size`** — the object is what is billed and what `Content-Length` must agree with, so `HeadObject` is authoritative and ffprobe's value serves only as a cross-check. **A file with no video stream is not a video** — `width`/`height`/`video_codec` being required *for a `ready` row* is the schema stating that (enforced by the state-scoped `CHECK`; see Revisions), and such an input must fail as non-decodable per `TD-13` rather than reach `ready` with null geometry.

Deliberately **excluded**: frame rate (`r_frame_rate` is a rational string like `30000/1001`, and no phase displays fps — the browser handles playback timing), per-stream language/disposition tags, and rotation metadata (relevant only if the plan later adds orientation-correct thumbnails, which `TD-09` does not require).

**Decision:** B (playback-essential set, 8 promoted columns)

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

---

## Decisions Summary

| ID | Scope | Decision | Recommendation | Choice |
|----|-------|----------|---------------|--------|
| TD-01 | Cross-layer | Video Endpoint Authentication Matrix | A (anonymous reads keyed by `publicId`, authenticated writes + owner route keyed by `videoId`) | A (anonymous reads keyed by publicId, authenticated writes + owner route keyed by videoId) |
| TD-02 | Backend | Draft Ownership — Owning Entity and Grant Scoping | A (`channel_id` FK, resolved from `sub` at initiate) | A (channel_id FK, resolved from sub at initiate) |
| TD-03 | Cross-layer | Access Rule for Videos That Are Not `ready` | A (`ready`-only on public routes with `404`; owner reads any state) | A (ready-only on public routes with 404; owner reads any state) |
| TD-04 | Backend | ffprobe Metadata Field Set Persisted on `videos` | B (playback-essential set, 8 promoted columns) | B (playback-essential set, 8 promoted columns) |

**Dependencies between these TDs and the phase-scope doc:** TD-01 depends on `phase-03-videos/TD-05` (route shape of initiate/complete) and `phase-03-videos/TD-11` (delivery routes); TD-02 is depended on by TD-01's owner checks and constrains nothing in `phase-03-videos/TD-03` (keys stay `videoId`-derived); TD-03 depends on `phase-03-videos/TD-12` (the state enum) and `phase-03-videos/TD-13` (persisted failure reason); TD-04 depends on `phase-03-videos/TD-07` (the ffprobe invocation that produces the fields) and feeds `phase-03-videos/TD-12`'s `ready` transition.
