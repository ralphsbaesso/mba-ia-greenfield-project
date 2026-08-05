---
scope_type: ad-hoc
related_phases: [3]
status: decided
date: 2026-07-29
scope_description: "How a client obtains the auto-generated thumbnail of a Fase 03 video, given that TD-03 keeps the bucket private and TD-11 decided delivery for the video object only, plus the contract when a ready video has no thumbnail."
---

# Technical Decisions — Thumbnail Delivery

_Subprojects in scope:_

- `nestjs-project/` — owns both TDs: the delivery route (or absence of one) for the generated thumbnail, and the nullability contract that determines whether the public payload's thumbnail field is optional.
- `next-frontend/` — **no open decision in this document.** Fase 03 ships no screen; the consumers that render a thumbnail arrive later (Fase 04's management panel, Fase 05's player sidebar, Fase 07's home grid). Both TDs below are marked `Cross-layer` / `Backend` on the strength of the *contract* they fix for those consumers, but no frontend code is written or constrained into existence by this phase.

---

## TD-01: Thumbnail Delivery Mechanism

**Scope:** Cross-layer

**Capability:** Geração automática de thumbnail a partir de um frame do vídeo

**Context:** `phase-03-videos/TD-09` produces exactly one JPEG per video and records `thumbnail_key` on the row; `phase-03-videos/TD-03` places it in a **single private bucket** under `thumbnails/{videoId}/default.jpg` and explicitly rejected the public-read thumbnail bucket because it "would pre-empt Fase 04's visibility rules (público/unlisted) by making thumbnails publicly addressable". `phase-03-videos/TD-11` then decided delivery for the **video object only**, and `video-authorization-and-metadata/TD-01`'s route matrix lists six routes, none of them a thumbnail route. The net effect is a `ready` video with a persisted, generated thumbnail that no client can fetch — the capability produces an artifact with no reader. One asymmetry with TD-11 drives the option analysis: a video is consumed one-per-page, whereas thumbnails are consumed **N-per-page** in every listing context Fase 04 and Fase 07 introduce, so per-image round-trip cost and cacheability matter here in a way they did not there. Depends on `TD-03` (key layout and bucket privacy), `TD-09` (that exactly one JPEG exists), `TD-11` (the delivery idiom to be consistent with), `video-authorization-and-metadata/TD-01` (the route matrix this adds a row to) and `video-authorization-and-metadata/TD-03` (the `ready`-only access rule).

**Options:**

### Option A: Stable authorized route + `302` to a presigned URL (mirrors TD-11)
`GET /videos/{publicId}/thumbnail` carries `@Public()`, resolves `thumbnail_key` in the same `status = 'ready'` query that resolves `publicId`, then redirects to a presigned `GetObject` URL with a minutes-scale TTL.
- **Pros:** Byte-identical in shape to TD-11's stream/download decision — one delivery idiom for the entire phase, one pattern to test, one server-side interception point that Fase 04's `unlisted` rule tightens without changing the client contract. Storage stays fully private, so TD-03's rationale is untouched. The route URL is stable, so it is safe to embed in a cacheable payload and in `<img src>`.
- **Cons:** Two HTTP round-trips per image, and an `N`-thumbnail listing page in Fase 04/07 costs `N` redirects plus `N` signatures. Because the presigned target is re-signed per request, the browser can cache the `302` response but **never the image bytes across page loads**.

### Option B: Presigned thumbnail URL embedded in the metadata response
`GET /videos/{publicId}` returns a `thumbnailUrl` field holding a presigned URL signed at read time.
- **Pros:** Zero extra round-trips — the client assigns it straight to `<img src>`. A future listing endpoint carries every URL in one response, with no per-image API hit at all.
- **Cons:** This is precisely TD-11's rejected Option C, and both of its objections transfer: the capability URL lands inside a cacheable JSON payload, and it expires — a page left open past the TTL shows broken images with no re-authorization path. It also removes the interception point Fase 04 wants. And since the signature is regenerated on every read, the URL is never cache-stable either, so this option pays Option A's caching penalty *without* buying Option A's stable entry point.

### Option C: Public-read prefix for `thumbnails/*`, stable permanent URL
A prefix-scoped anonymous-read policy makes `thumbnails/**` world-readable; the row stores (or the payload returns) a plain unsigned URL.
- **Pros:** By a wide margin the cheapest and most cacheable option — a stable immutable URL that browsers and any future CDN cache indefinitely, zero signing cost, zero API involvement, and exactly the right shape for `N`-per-page grids.
- **Cons:** **Contradicts TD-03's recommendation** rather than extending it — TD-03 rejected public thumbnails specifically because Fase 04 introduces `unlisted`/`público` visibility, and a publicly addressable thumbnail leaks both the existence and the first frame of a non-public video. Adopting it here is a supersede of TD-03's reasoning, not a refinement. It also adds a bucket-policy step to the Compose bootstrap (`TD-02`'s surface), and a key once made public cannot be retracted for already-published objects.

### Option D: Not served in Fase 03 — persist `thumbnail_key`, expose nothing
The worker writes the object and the column; no route, no response field. Delivery lands with the first screen that renders it.
- **Pros:** Smallest surface, and defensible on the literal bullet — the capability says "geração", not "exibição". Leaves the delivery decision to the phase that has an actual consumer and real layout constraints.
- **Cons:** Makes the phase's own deliverable unobservable end-to-end: you can assert a row and an object, but never that the thumbnail is *usable*. Fase 04 then opens with a blocking decision instead of a screen, and `GET /videos/{publicId}` ships without a thumbnail field, so Fase 04 must change an already-published response shape rather than populate a reserved one.

**Recommendation:** **Option A (`302` from a stable `@Public()` route to a short-lived presigned URL)** — three reasons, in order of weight.

(1) **It is the only option that leaves TD-03 and TD-11 both intact.** Option C requires superseding TD-03's explicit reasoning; Option B requires re-litigating TD-11's Option C rejection on a weaker case. Option A is the same decision TD-11 already made, applied to a second object kind — which means the phase ships *one* delivery idiom, not two.

(2) **The cost Option A is criticized for is not yet incurred, and the decision that would justify paying it belongs to a later phase.** Fase 03 has no listing endpoint — the public metadata route serves a single video, so `N` is 1 here. The `N`-per-page pressure appears in Fase 04/07, and whether public-read is even *legal* depends on Fase 04's `unlisted`/`público` rules. Pre-optimizing for the grid now would mean deciding Fase 04's visibility model as a side effect of a Fase 03 caching concern — exactly the inversion TD-03 refused.

(3) **The migration path out is cheap and additive.** If Fase 04 settles visibility such that public thumbnails are acceptable for `público` videos, Option C becomes correct for that subset, and the change is a scoped supersede of TD-03 + this TD with the route kept as a compatibility entry point — no client contract breaks, because clients were always pointed at `/videos/{publicId}/thumbnail`.

Three concrete details this decision fixes:

- **The route inherits `video-authorization-and-metadata/TD-03`'s `ready`-only rule verbatim** — `status = 'ready'` is filtered in the same query that resolves `publicId`, and a non-`ready` or unknown `publicId` answers `404`, never `403`. This is load-bearing, not boilerplate: a thumbnail route that resolved videos the stream route refuses would become an existence oracle and defeat va/TD-03's whole reason for choosing `404`.
- **Set `response-content-type: image/jpeg` on the presigned URL.** Per the AWS SDK v3 schema, `ResponseContentType`/`ResponseContentDisposition` are mapped to signed query parameters (`response-content-type`, `response-content-disposition`), so the served content type is pinned at signing time regardless of what content type the worker happened to set on the object — the browser renders inline instead of downloading.
- **TTL in minutes, matching TD-11**, and `getSignedUrl`'s default of 900s is already in that range, so the explicit value is a documented choice rather than a correction. Put `Cache-Control` on the `302` itself so a repeat view inside the window skips the round trip; do not attempt to make the *image* cacheable under this option — the signature rotates per request, so the browser cache key never repeats, and pretending otherwise is the trap that makes Option B look cheaper than it is.

**Decision:** A (@Public() route → 302 to short-lived presigned URL, mirroring TD-11)

---

## TD-02: Missing-Thumbnail Contract on a `ready` Video

**Scope:** Backend

**Capability:** Geração automática de thumbnail a partir de um frame do vídeo

**Context:** `phase-03-videos/TD-09` extracts one frame at `max(1s, duration * 0.10)`; `phase-03-videos/TD-13` fails fast on non-decodable input. Between those two lies a third case: a file that probes and plays fine but whose frame extraction still yields nothing — a corrupt mid-stream region, an odd-geometry output that trips the `scale` filter, an ffmpeg non-zero exit on an otherwise valid container. `thumbnail_key` must be nullable at the column level by construction, because `draft` and `processing` rows legitimately have none, so nullability alone cannot express "a `ready` video always has a thumbnail". `video-authorization-and-metadata/TD-04` set the local precedent for this class of question — it made `width`/`height`/`video_codec` non-nullable precisely so the schema states the invariant, and routed violations to `error` via TD-13. Which way this goes determines whether TD-01's route has a "video resolved but image missing" branch and whether the public payload's thumbnail field is optional for every future consumer. Depends on `TD-09` (extraction policy), `TD-12` (the status enum), `TD-13` (failure handling) and `TD-01` above (the delivery route that reads the result).

**Options:**

### Option A: Thumbnail is required for `ready` — extraction failure fails the job
The worker treats a failed extraction exactly like a failed probe: status → `error` with the persisted reason from TD-13. `ready` therefore implies `thumbnail_key IS NOT NULL`, enforced by a state-scoped constraint.
- **Pros:** The invariant lives in the schema, so every downstream consumer can treat the thumbnail field as non-optional on a `ready` payload — no null branch in Fase 04, 05 or 07. Consistent with va/TD-04's philosophy of using constraints to state what a valid row means. TD-01's route never needs a partial-success branch.
- **Cons:** A video that plays perfectly is rejected over a cosmetic artifact — and after a 10GB upload, that failure lands at the very last step of the pipeline.

### Option B: Thumbnail is optional — `ready` without one is valid
Extraction failure is logged, the job completes, `thumbnail_key` stays null. The public payload omits the field; TD-01's route answers `404`.
- **Pros:** Never fails a playable video for a cosmetic reason — the primary capability (playback) is not held hostage to the secondary one. Degrades gracefully by construction.
- **Cons:** Pushes an optional field onto three future consumers, each needing its own placeholder branch. "No thumbnail" becomes a permanent silent state with no retry path in this phase, and nothing distinguishes "never generated" from "generation failed".

### Option C: Guaranteed fallback — copy a bundled placeholder JPEG
On extraction failure the worker writes a static default image to the video's thumbnail key, so `thumbnail_key` is always populated for `ready`.
- **Pros:** Delivers Option A's non-optional contract without failing the job; consumers never branch.
- **Cons:** Makes a failure indistinguishable from a success at the data layer — nothing in the row records that the image is a placeholder, so the condition is invisible to operators and un-retryable later without adding exactly the flag column that Option B would have made explicit. It satisfies the contract by hiding the fault.

**Recommendation:** **Option A (required for `ready`; extraction failure routes to `error`)** — on the grounds va/TD-04 already established for this codebase.

(1) **TD-09's policy is engineered specifically against the realistic failure modes.** Clamping to `max(1s, duration * 0.10)` is what removes the black-opening-frame and short-clip cases that would otherwise make extraction failure routine. What remains is a genuinely broken input — and TD-13 already routes broken inputs to `error` with a persisted reason that the owner can read through va/TD-03's owner route, so the failure is diagnosable rather than silent.

(2) **Option B's cost is paid repeatedly by later phases, for a state TD-09 works to make unreachable.** An optional thumbnail field forces a placeholder branch in Fase 04's panel, Fase 05's sidebar and Fase 07's grid — three consumers carrying a conditional for a case that should not occur. If it turns out to occur in practice, relaxing A → B later is a migration plus a nullable field, and it is a decision made with evidence instead of in anticipation.

(3) **Option C is dominated.** It buys A's contract at the price of unobservability, which is the one property this phase's failure handling (TD-13's persisted reason) was designed to preserve.

Two concrete details:

- **Add `CHECK (status <> 'ready' OR thumbnail_key IS NOT NULL)` in the same migration that adds the column**, so the invariant is enforced rather than merely documented. The column itself stays nullable — `draft` and `processing` rows have no thumbnail, and that is correct, not an exception.
- **Extraction shares the job and the row-write boundary with the metadata persist**, so a failed extraction leaves the row in `error` and never in a partial `ready` state. This matters for `TD-14`'s idempotency guard: a retried job must find the row in a state that permits a clean re-run, which a half-written `ready` would not be.

Deliberately **excluded** from this document: a thumbnail regeneration/retry endpoint (Fase 04 owns custom thumbnails and is the natural home for a re-generate action), and multiple thumbnail sizes or responsive variants (no phase displays more than one image per video, and TD-09 commits to exactly one).

**Decision:** A (required for ready; extraction failure → error per TD-13)

---

## Decisions Summary

| ID | Scope | Decision | Recommendation | Choice |
|----|-------|----------|---------------|--------|
| TD-01 | Cross-layer | Thumbnail Delivery Mechanism | A (`@Public()` route → `302` to short-lived presigned URL, mirroring TD-11) | A (@Public() route → 302 to short-lived presigned URL, mirroring TD-11) |
| TD-02 | Backend | Missing-Thumbnail Contract on a `ready` Video | A (required for `ready`; extraction failure → `error` per TD-13) | A (required for ready; extraction failure → error per TD-13) |

---

## Dependencies on the phase-scope and sibling ad-hoc docs

- **TD-01 adds a seventh row to the route matrix decided in `video-authorization-and-metadata/TD-01`:** `GET /videos/{publicId}/thumbnail` — delivery, `302` to presigned URL, `@Public()`. When that TD is resolved, the matrix should carry this row; the two decisions are consistent by construction (both derive the anonymous-read tier from the same project premise).
- **TD-01 consumes `phase-03-videos/TD-03`** (private bucket, `thumbnails/{videoId}/default.jpg`, `thumbnail_key` persisted on the row) and **is consistent with, not a revision of, `phase-03-videos/TD-11`** — same idiom, second object kind. Choosing TD-01's Option C instead would require superseding TD-03.
- **TD-01 inherits `video-authorization-and-metadata/TD-03`'s `404`-not-`403` rule.** If that TD is resolved to a different option, TD-01's status filter follows it rather than keeping an independent rule.
- **TD-02 constrains `phase-03-videos/TD-13`'s failure taxonomy** by adding "thumbnail extraction failed" to the set of conditions that produce `status = error`, and **is read by `phase-03-videos/TD-14`** (a retried job must not encounter a partial `ready`).
- **TD-02 does not alter `video-authorization-and-metadata/TD-04`'s column table** — `thumbnail_key` is owned by TD-03/TD-09, not by the ffprobe field set. TD-02 only decides its nullability semantics relative to `status`.
