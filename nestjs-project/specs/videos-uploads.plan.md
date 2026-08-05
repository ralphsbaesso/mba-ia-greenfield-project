---
subproject: backend
runner: jest+supertest
scope: phase-03-videos
si: SI-03.7
target_file: nestjs-project/test/videos-uploads.e2e-spec.ts
---

# Video Upload Endpoints Test Plan

## Application Overview

Os dois endpoints que abrem e fecham o upload multipart de um vídeo. O `initiate` é a fronteira de segurança de todo o caminho: é ele que cria a linha `draft` **antes de qualquer byte** e minta as URLs presignadas de parte — que são capabilities bearer pelo seu TTL. O `complete` recebe a lista de ETags, chama `CompleteMultipartUpload`, vira a linha para `processing` e publica o job na mesma operação. Ambos ficam sob o guard global herdado da fase 02; o `complete` adiciona a checagem de dono, que responde `404 VIDEO_NOT_FOUND` — nunca `403`, que confirmaria a existência do vídeo.

## Test Scenarios

### 1. Initiate — POST /videos/uploads

**Setup:** `beforeEach` trunca as tabelas `videos`, `channels` e `users` via `dataSource.query('DELETE FROM ...')`; bootstrap do módulo de teste com `Test.createTestingModule({ imports: [AppModule] }).compile()` reproduzindo a config global de `main.ts` (ValidationPipe, exception filter do envelope de erro); MinIO real para o multipart; usuário + canal semeados via signup da fase 02; `afterAll(() => app.close())`.

#### 1.1. anonymous-initiate-is-rejected

**Covers AC:** #1
**Source:** auto
**Last sync:** 2026-07-31T23:43:58Z

**Steps:**
  1. `POST /videos/uploads` sem cabeçalho `Authorization`, com body válido (content type declarado + tamanho total)
    - expect: status `401`
    - expect: nenhuma linha nova em `videos`
    - expect: nenhum multipart upload aberto no bucket

#### 1.2. authenticated-initiate-returns-draft-and-grant

**Covers AC:** #2
**Source:** auto
**Last sync:** 2026-07-31T23:43:58Z

**Steps:**
  1. `POST /videos/uploads` com token válido e body `{ contentType: 'video/mp4', sizeBytes: <tamanho de ~3 partes> }`
    - expect: status `201`
    - expect: body traz `videoId` (uuid), `publicId` e `uploadId`
    - expect: body traz o part size de 64 MiB
    - expect: a lista de URLs presignadas cobre **todas** as partes derivadas de `sizeBytes` contra o part size
    - expect: cada URL presignada carrega expiry na ordem de horas (não os 7 dias máximos)
  2. Ler a linha correspondente em `videos` direto pelo `DataSource`
    - expect: `status = 'draft'`
    - expect: `channel_id`, `public_id`, `storage_key` e `upload_id` preenchidos
    - expect: `public_id` do body é igual ao persistido, e o `id` interno não aparece em nenhum outro campo do payload além de `videoId`

#### 1.3. initiate-without-declared-content-type-is-rejected

**Covers AC:** #3
**Source:** auto
**Last sync:** 2026-07-31T23:43:58Z

**Steps:**
  1. `POST /videos/uploads` com token válido e body sem o content type declarado
    - expect: status `400`
    - expect: body no envelope `{ statusCode, error, message }`
    - expect: nenhuma linha nova em `videos`

### 2. Complete — POST /videos/{videoId}/uploads/complete

**Setup:** mesmo bootstrap do grupo 1; além disso, dois usuários com canais distintos são semeados, e um vídeo `draft` com multipart aberto é criado via `initiate` pelo primeiro usuário.

#### 2.1. complete-by-non-owner-is-not-found

**Covers AC:** #4
**Source:** auto
**Last sync:** 2026-07-31T23:43:58Z

**Steps:**
  1. `POST /videos/{videoId}/uploads/complete` com o token do **segundo** usuário e uma lista de ETags válida
    - expect: status `404`
    - expect: body traz o código `VIDEO_NOT_FOUND`
    - expect: a resposta é byte-a-byte indistinguível da resposta a um `videoId` inexistente (mesmo status, mesmo código, mesma mensagem)
  2. Ler a linha em `videos`
    - expect: `status` continua `draft` — a chamada do não-dono não alterou nada

#### 2.2. complete-on-processing-video-is-conflict

**Covers AC:** #5
**Source:** auto
**Last sync:** 2026-07-31T23:43:58Z

**Steps:**
  1. `POST /videos/{videoId}/uploads/complete` com o token do dono e a lista de ETags das partes enviadas
    - expect: status `200`
    - expect: body traz `publicId` e `status: 'processing'`
  2. `POST /videos/{videoId}/uploads/complete` uma segunda vez, com o mesmo token e a mesma lista
    - expect: status `409`
    - expect: body traz o código `INVALID_VIDEO_STATE`
    - expect: a linha permanece em `processing` e nenhum segundo job é publicado (o `jobId` determinístico deduplica)

### 3. OpenAPI contract

**Setup:** bootstrap do documento Swagger a partir do módulo de teste, como no `swagger.e2e-spec.ts` existente.

#### 3.1. openapi-documents-both-upload-endpoints

**Covers AC:** #6
**Source:** auto
**Last sync:** 2026-07-31T23:43:58Z

**Steps:**
  1. Gerar `openapi.json` e localizar `POST /videos/uploads`
    - expect: respostas tipadas para `201`, `400`, `401` e `500`
    - expect: o schema do `500` é o envelope de erro com `CHANNEL_MISSING_FOR_USER`
    - expect: o request body está documentado com o content type declarado e o tamanho total
  2. Localizar `POST /videos/{videoId}/uploads/complete`
    - expect: respostas tipadas para `200`, `400`, `401`, `404` e `409`
    - expect: `videoId` documentado como path param
    - expect: os schemas de `404` e `409` são o envelope de erro, carregando `VIDEO_NOT_FOUND` e `INVALID_VIDEO_STATE`
