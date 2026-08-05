---
subproject: backend
runner: jest+supertest
scope: phase-03-videos
si: SI-03.15
target_file: nestjs-project/test/videos-delivery.e2e-spec.ts
---

# Video Delivery Endpoints Test Plan

## Application Overview

As três rotas de entrega — streaming, download e thumbnail — todas `@Public()` e todas com **um único idioma**: `302` para uma URL presignada de vida curta (TTL em minutos), mantendo a API fora do caminho de dados. O mesmo objeto serve streaming e download; a diferença é o `response-content-disposition` na assinatura. A thumbnail fixa `response-content-type: image/jpeg` no momento da assinatura, de forma que o browser renderize inline independentemente do que o worker gravou no objeto. As três herdam o filtro `ready`-only verbatim: uma rota de thumbnail que resolvesse vídeos que o stream recusa viraria um oráculo de existência.

## Test Scenarios

### 1. Streaming

**Setup:** `beforeEach` trunca `videos`, `channels` e `users`; bootstrap com `Test.createTestingModule({ imports: [AppModule] }).compile()` reproduzindo a config global de `main.ts`; MinIO real com um objeto de vídeo de teste realmente gravado sob a `storage_key` da linha; a linha é semeada em `ready` com metadados completos e `thumbnail_key`; supertest configurado para **não** seguir redirects; `afterAll(() => app.close())`.

#### 1.1. anonymous-streams-ready-video-via-redirect

**Covers AC:** #1
**Source:** auto
**Last sync:** 2026-07-31T23:43:58Z

**Steps:**
  1. `GET /videos/{publicId}/stream` sem cabeçalho `Authorization`
    - expect: status `302`
    - expect: header `Location` aponta para o endpoint do storage com os query params de assinatura
  2. `GET` direto na URL do `Location` com header `Range: bytes=0-1023`
    - expect: status `206`
    - expect: header `Content-Range` presente e o corpo tem exatamente os bytes pedidos — a reprodução começa sem baixar o arquivo inteiro

#### 1.2. api-never-carries-video-bytes

**Covers AC:** #6
**Source:** auto
**Last sync:** 2026-07-31T23:43:58Z

**Steps:**
  1. `GET /videos/{publicId}/stream`, `GET /videos/{publicId}/download` e `GET /videos/{publicId}/thumbnail`, sem seguir redirects
    - expect: as três respondem `302` com corpo vazio
    - expect: nenhuma das três responde com `content-type` de vídeo ou de imagem
    - expect: o `content-length` de cada resposta é desprezível diante do tamanho do objeto — os bytes vêm do storage, não da API

### 2. Download

**Setup:** mesmo bootstrap do grupo 1.

#### 2.1. download-serves-same-object-as-attachment

**Covers AC:** #2
**Source:** auto
**Last sync:** 2026-07-31T23:43:58Z

**Steps:**
  1. `GET /videos/{publicId}/download` sem seguir redirects
    - expect: status `302`
    - expect: a URL do `Location` referencia a **mesma** `storage_key` que a URL devolvida por `/stream`
    - expect: a URL carrega `response-content-disposition` como query param assinado
  2. `GET` direto na URL do `Location`
    - expect: status `200`
    - expect: header `Content-Disposition` de anexo
    - expect: os bytes conferem com os do objeto gravado no setup

### 3. Thumbnail

**Setup:** mesmo bootstrap do grupo 1; a thumbnail é gravada no MinIO sob a `thumbnail_key` **com um content type deliberadamente diferente de `image/jpeg`** (por exemplo `application/octet-stream`), para provar que o override na assinatura é o que manda.

#### 3.1. thumbnail-renders-inline-regardless-of-stored-content-type

**Covers AC:** #3
**Source:** auto
**Last sync:** 2026-07-31T23:43:58Z

**Steps:**
  1. `GET /videos/{publicId}/thumbnail` sem seguir redirects
    - expect: status `302`
    - expect: a URL do `Location` carrega `response-content-type` assinado com `image/jpeg`
    - expect: o próprio `302` carrega `Cache-Control` — o cache é da resposta de redirect, nunca da imagem presignada
  2. `GET` direto na URL do `Location`
    - expect: status `200`
    - expect: header `Content-Type: image/jpeg`, apesar do content type gravado no objeto
    - expect: a resposta **não** traz `Content-Disposition` de anexo — o browser renderiza inline

### 4. Ready-only guard

**Setup:** mesmo bootstrap; além do vídeo `ready`, são semeados vídeos em `draft`, `processing` e `error`.

#### 4.1. all-three-routes-hide-non-ready-videos

**Covers AC:** #4
**Source:** auto
**Last sync:** 2026-07-31T23:43:58Z

**Steps:**
  1. Para cada estado não-`ready` (`draft`, `processing`, `error`), chamar `/stream`, `/download` e `/thumbnail` do respectivo `publicId`
    - expect: as nove respostas são `404` com o código `VIDEO_NOT_FOUND`
    - expect: nenhuma delas é `403`
  2. Chamar as três rotas com um `publicId` inexistente
    - expect: status, código e mensagem idênticos aos do passo 1 — nenhuma das três distingue "não está pronto" de "não existe"

### 5. Presigned URL lifetime

**Setup:** mesmo bootstrap do grupo 1.

#### 5.1. presigned-url-expires-after-its-minute-scale-ttl

**Covers AC:** #5
**Source:** auto
**Last sync:** 2026-07-31T23:43:58Z

**Steps:**
  1. `GET /videos/{publicId}/stream` e inspecionar os query params da URL do `Location`
    - expect: o parâmetro de expiração da assinatura está na ordem de **minutos**, não de horas — bem abaixo do TTL das URLs de parte do upload
  2. Reescrever o timestamp da assinatura para uma janela já vencida e chamar a URL resultante
    - expect: o storage recusa a requisição — a URL deixa de ser aceita depois de expirada
  3. Chamar a URL original, ainda dentro do TTL
    - expect: status `200` — a recusa do passo 2 veio da expiração, não de uma assinatura sempre inválida
