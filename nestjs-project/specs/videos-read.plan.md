---
subproject: backend
runner: jest+supertest
scope: phase-03-videos
si: SI-03.14
target_file: nestjs-project/test/videos-read.e2e-spec.ts
---

# Video Read Endpoints Test Plan

## Application Overview

As duas rotas de leitura de vídeo, em famílias **disjuntas** no router. A pública (`@Public()`) resolve por `public_id` filtrando `status = 'ready'` na mesma query — anônimos leem metadados de vídeos prontos e nada mais. A do dono é autenticada e devolve a linha em **qualquer** estado, incluindo `error` com a razão persistida, que é o que torna um upload falho diagnosticável em vez de silenciosamente ausente. Um vídeo não-`ready` na rota pública, e um não-dono na rota do dono, recebem ambos `404 VIDEO_NOT_FOUND` — nunca `403`, que confirmaria a existência.

## Test Scenarios

### 1. Public metadata — GET /videos/{publicId}

**Setup:** `beforeEach` trunca `videos`, `channels` e `users`; bootstrap com `Test.createTestingModule({ imports: [AppModule] }).compile()` reproduzindo a config global de `main.ts`; vídeos semeados direto pelo repositório nos estados necessários (`ready` com metadados completos e `thumbnail_key`; `processing`); `afterAll(() => app.close())`.

#### 1.1. anonymous-reads-ready-video-metadata

**Covers AC:** #1
**Source:** auto
**Last sync:** 2026-07-31T23:43:58Z

**Steps:**
  1. `GET /videos/{publicId}` de um vídeo `ready`, **sem** cabeçalho `Authorization`
    - expect: status `200`
    - expect: body traz `publicId`, `duration_seconds`, `width`, `height`, `video_codec`, `audio_codec`, `container_format`, `bitrate_bps`, `size_bytes`
    - expect: o body **não** contém o `id` interno do vídeo nem o `channel_id`

#### 1.2. non-ready-video-is-not-found-not-forbidden

**Covers AC:** #2
**Source:** auto
**Last sync:** 2026-07-31T23:43:58Z

**Steps:**
  1. `GET /videos/{publicId}` de um vídeo em `processing`
    - expect: status `404` — e explicitamente **não** `403`
    - expect: body traz o código `VIDEO_NOT_FOUND`
  2. `GET /videos/{publicId}` com um `publicId` que não existe
    - expect: mesma resposta do passo 1 — status, código e mensagem idênticos, de forma que a rota não funcione como oráculo de existência

### 2. Owner view — GET /videos/{videoId}

**Setup:** mesmo bootstrap do grupo 1; dois usuários com canais distintos são semeados; o primeiro possui um vídeo em `error` com `failure_reason` preenchida e um vídeo em `draft`.

#### 2.1. owner-view-without-token-is-unauthorized

**Covers AC:** #3
**Source:** auto
**Last sync:** 2026-07-31T23:43:58Z

**Steps:**
  1. `GET` na rota do dono para um `videoId` existente, sem cabeçalho `Authorization`
    - expect: status `401`
    - expect: a resposta não revela nada sobre o vídeo — o guard global responde antes do handler

#### 2.2. owner-view-returns-status-and-failure-reason

**Covers AC:** #4
**Source:** auto
**Last sync:** 2026-07-31T23:43:58Z

**Steps:**
  1. `GET` na rota do dono para o vídeo em `draft`, com o token do dono
    - expect: status `200`
    - expect: body traz `status: 'draft'` e os campos de metadados nulos
  2. `GET` na rota do dono para o vídeo em `error`, com o token do dono
    - expect: status `200`
    - expect: body traz `status: 'error'` e a razão da falha persistida
  3. `GET` na rota do dono para o vídeo em `error`, com o token do **segundo** usuário
    - expect: status `404` com o código `VIDEO_NOT_FOUND` — não `403`

### 3. Route disambiguation

**Setup:** mesmo bootstrap; um vídeo `ready` cujo `public_id` e cujo `id` interno são ambos conhecidos pelo teste.

#### 3.1. owner-and-public-families-are-disjoint

**Covers AC:** #5
**Source:** auto
**Last sync:** 2026-07-31T23:43:58Z

**Steps:**
  1. `GET` na rota pública passando o **`id` interno** no lugar do `publicId`
    - expect: status `404` com `VIDEO_NOT_FOUND` — o handler público nunca resolve um identificador da família do dono
  2. `GET` na rota do dono passando o **`public_id`** no lugar do `videoId`, com o token do dono
    - expect: status `404` com `VIDEO_NOT_FOUND` — e não uma resposta `200` servida pelo handler público
  3. `GET` na rota pública de um vídeo `ready` sem token e `GET` na rota do dono do mesmo vídeo com token
    - expect: as duas requisições são atendidas por handlers distintos — a pública omite `status` e a do dono o inclui

### 4. OpenAPI contract

**Setup:** bootstrap do documento Swagger a partir do módulo de teste, como no `swagger.e2e-spec.ts` existente.

#### 4.1. openapi-documents-both-read-routes

**Covers AC:** #6
**Source:** auto
**Last sync:** 2026-07-31T23:43:58Z

**Steps:**
  1. Gerar `openapi.json` e localizar a rota pública de metadata
    - expect: respostas tipadas para `200` e `404`
    - expect: a operação **não** declara security requirement — está marcada como não autenticada
    - expect: o path param está documentado
  2. Localizar a rota do dono
    - expect: respostas tipadas para `200`, `401` e `404`
    - expect: a operação declara o bearer security requirement
    - expect: o schema do `200` inclui `status` e a razão da falha
