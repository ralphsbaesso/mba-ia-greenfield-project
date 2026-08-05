---
subproject: backend
runner: jest+supertest
scope: phase-03-videos
si: SI-03.17
target_file: nestjs-project/test/videos-reprocess.e2e-spec.ts
---

# Video Reprocess Endpoint Test Plan

## Application Overview

O caminho explícito de recuperação: um ambiente corrigido republica o job de um vídeo que falhou, sem exigir novo upload. É deliberadamente **não** um loop de retry automático — a operação é guardada a vídeos em `error`. Fora desse estado responde `409 INVALID_VIDEO_STATE`; para um não-dono responde `404 VIDEO_NOT_FOUND`, nunca `403`. A transição de volta a `processing` e a limpeza da razão da falha acontecem na mesma operação que publica o job, reusando o `jobId` determinístico derivado do identificador do vídeo.

## Test Scenarios

### 1. Guarded reprocess — POST /videos/{videoId}/reprocess

**Setup:** `beforeEach` trunca `videos`, `channels` e `users` e limpa a fila `video-processing` no Redis; bootstrap com `Test.createTestingModule({ imports: [AppModule] }).compile()` reproduzindo a config global de `main.ts`; DB, MinIO e Redis reais; dois usuários com canais distintos semeados via signup da fase 02; o primeiro possui um vídeo em `error` com `failure_reason` preenchida cujo objeto **existe** no storage, e um vídeo em `ready`; `afterAll(() => app.close())`.

#### 1.1. owner-reprocesses-failed-video

**Covers AC:** #1
**Source:** auto
**Last sync:** 2026-07-31T23:43:58Z

**Steps:**
  1. `POST /videos/{videoId}/reprocess` com o token do dono, sobre o vídeo em `error`
    - expect: status `200`
    - expect: body traz `publicId` e `status: 'processing'`
  2. Inspecionar a fila `video-processing`
    - expect: existe exatamente um job com o `jobId` determinístico derivado do `videoId` — o mesmo id do envio original, não um novo
    - expect: o payload do job é `{ videoId }` e nada mais
  3. Deixar o worker consumir o job e aguardar a linha estabilizar
    - expect: `status` chega a `ready` sem que nenhum byte tenha sido reenviado
    - expect: duração, dimensões, codecs, container, tamanho e `thumbnail_key` estão preenchidos

#### 1.2. reprocess-outside-error-state-is-conflict

**Covers AC:** #2
**Source:** auto
**Last sync:** 2026-07-31T23:43:58Z

**Steps:**
  1. `POST /videos/{videoId}/reprocess` com o token do dono, sobre o vídeo em `ready`
    - expect: status `409`
    - expect: body traz o código `INVALID_VIDEO_STATE`
  2. Repetir para um vídeo em `draft` e para um em `processing`
    - expect: as duas respostas são `409` com `INVALID_VIDEO_STATE`
  3. Inspecionar a fila e as linhas
    - expect: nenhum job foi publicado e nenhuma linha mudou de estado

#### 1.3. anonymous-and-non-owner-are-refused

**Covers AC:** #3
**Source:** auto
**Last sync:** 2026-07-31T23:43:58Z

**Steps:**
  1. `POST /videos/{videoId}/reprocess` sem cabeçalho `Authorization`
    - expect: status `401`
  2. `POST /videos/{videoId}/reprocess` com o token do **segundo** usuário, sobre o vídeo em `error` do primeiro
    - expect: status `404`
    - expect: body traz o código `VIDEO_NOT_FOUND` — não `403`
  3. `POST` num `videoId` inexistente com o token do segundo usuário
    - expect: resposta idêntica à do passo 2 — a rota não é oráculo de existência
  4. Ler a linha e a fila
    - expect: a linha continua em `error` com sua razão de falha e nenhum job foi publicado

#### 1.4. failure-reason-is-cleared-after-successful-reprocess

**Covers AC:** #4
**Source:** auto
**Last sync:** 2026-07-31T23:43:58Z

**Steps:**
  1. `GET` na rota do dono do vídeo em `error`, antes de reprocessar
    - expect: status `200` com `status: 'error'` e a razão da falha presente
  2. `POST /videos/{videoId}/reprocess` com o token do dono e deixar o worker levar a linha a `ready`
    - expect: o reprocessamento conclui com sucesso
  3. `GET` na rota do dono novamente
    - expect: status `200` com `status: 'ready'`
    - expect: a razão da falha anterior não aparece mais na resposta — foi limpa na mesma operação que republicou o job
