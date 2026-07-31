---
subproject: backend
runner: jest+supertest
scope: phase-03-videos
si: SI-03.16
target_file: nestjs-project/test/videos-upload-cancel.e2e-spec.ts
---

# Upload Cancel Endpoint Test Plan

## Application Overview

O cancelamento explícito do dono: aborta o multipart upload aberto no `initiate` usando o `upload_id` persistido na linha, recuperando as partes já enviadas — que são a parte cara do abandono. A operação é guardada a vídeos em `draft`, porque é o único estado em que existe multipart aberto. Não-dono recebe `404 VIDEO_NOT_FOUND` (nunca `403`), e fora de `draft` a resposta é `409 INVALID_VIDEO_STATE`. A rotina de limpeza de rascunhos órfãos que complementa esta rota é coberta pelos testes unit/integration listados na Tests table do SI, não por este spec.

## Test Scenarios

### 1. Owner cancel — DELETE /videos/{videoId}/uploads

**Setup:** `beforeEach` trunca `videos`, `channels` e `users`; bootstrap com `Test.createTestingModule({ imports: [AppModule] }).compile()` reproduzindo a config global de `main.ts`; MinIO real; dois usuários com canais distintos semeados via signup da fase 02; o primeiro abre um upload via `POST /videos/uploads` e envia ao menos uma parte pela URL presignada; `afterAll(() => app.close())`.

#### 1.1. owner-cancels-draft-upload-and-reclaims-parts

**Covers AC:** #1
**Source:** auto
**Last sync:** 2026-07-31T23:43:58Z

**Steps:**
  1. Listar os multipart uploads em curso no bucket antes de cancelar
    - expect: o `upload_id` persistido na linha aparece na listagem, com a parte enviada contabilizada
  2. `DELETE /videos/{videoId}/uploads` com o token do dono
    - expect: status `204`
    - expect: corpo vazio
  3. Listar novamente os multipart uploads em curso e as partes do `upload_id`
    - expect: o `upload_id` não aparece mais — as partes já enviadas deixaram de ocupar espaço
    - expect: uma tentativa de `CompleteMultipartUpload` com aquele `upload_id` é recusada pelo storage

#### 1.2. anonymous-and-non-owner-are-refused

**Covers AC:** #2
**Source:** auto
**Last sync:** 2026-07-31T23:43:58Z

**Steps:**
  1. `DELETE /videos/{videoId}/uploads` sem cabeçalho `Authorization`
    - expect: status `401`
  2. `DELETE /videos/{videoId}/uploads` com o token do **segundo** usuário
    - expect: status `404`
    - expect: body traz o código `VIDEO_NOT_FOUND` — não `403`
  3. `DELETE` num `videoId` inexistente com o token do segundo usuário
    - expect: resposta idêntica à do passo 2 — a rota não distingue "não é seu" de "não existe"
  4. Listar os multipart uploads em curso
    - expect: o upload do dono continua aberto — nenhuma das chamadas recusadas abortou nada

#### 1.3. cancel-outside-draft-is-conflict

**Covers AC:** #3
**Source:** auto
**Last sync:** 2026-07-31T23:43:58Z

**Steps:**
  1. Concluir o upload do dono via `POST /videos/{videoId}/uploads/complete`, levando a linha a `processing`
    - expect: status `200`
  2. `DELETE /videos/{videoId}/uploads` com o token do dono
    - expect: status `409`
    - expect: body traz o código `INVALID_VIDEO_STATE`
  3. Ler a linha em `videos`
    - expect: `status` continua `processing` — a chamada recusada não alterou a linha nem tocou no objeto já consolidado
