---
kind: phase
name: phase-03-videos
test_specs_aware: true
sources_mtime:
  docs/phases/phase-03-videos/context.md: "2026-07-29T21:58:38-03:00"
  docs/phases/phase-03-videos/library-refs.md: "2026-07-29T21:58:38-03:00"
  docs/decisions/technical-decisions-phase-03-videos.md: "2026-07-29T21:38:25-03:00"
  docs/decisions/technical-decisions-video-authorization-and-metadata.md: "2026-07-29T21:58:24-03:00"
  docs/decisions/technical-decisions-thumbnail-delivery.md: "2026-07-29T21:38:25-03:00"
  docs/decisions/technical-decisions-openapi-docs-nestjs.md: "2026-07-27T20:38:54-03:00"
  docs/project-plan.md: "2026-07-27T20:38:54-03:00"
---

# Phase 03 — Upload e Processamento de Vídeos

## Objective

Entregar a fundação de vídeo do backend: serviço de armazenamento de arquivos (vídeos e thumbnails) e de processamento em segundo plano (filas), upload de arquivos de até 10GB sem impacto na performance com pré-cadastro automático do vídeo como rascunho ao iniciar o upload, processamento automático após o upload (extração de duração e metadados) com geração automática de thumbnail a partir de um frame do vídeo, URL única por vídeo sem conflito com outros vídeos, e reprodução via streaming (sem necessidade de download completo) além do download do vídeo pelo usuário.

---

## Step Implementations

### SI-03.1 — Provisionar MinIO e Redis no Docker Compose

**Description:** Sobe as duas infraestruturas que a fase inteira depende — o serviço S3-compatível local e o Redis da fila — antes de qualquer código de aplicação.

**Technical actions:**

1. Adicionar o serviço `minio` em `nestjs-project/compose.yaml` com a imagem **pinada** `minio/minio:RELEASE.2025-09-07T16-13-09Z` — pinar é a única forma de manter `docker compose down -v && up -d` reprodutível agora que a publicação community upstream parou (per `phase-03-videos/TD-02`).
2. Adicionar o serviço `redis` (imagem oficial, Redis ≥ 6.2) configurado com `--maxmemory-policy noeviction` (per `phase-03-videos/TD-04`).
3. Adicionar as variáveis de storage e de fila em `nestjs-project/.env.example` — endpoint, credenciais, nome do bucket, host/porta do Redis. Host é **sempre o nome do serviço Compose**, nunca `localhost`.
4. Criar o bucket privado único no start do ambiente (prefixo por tipo de objeto dentro dele, per `phase-03-videos/TD-03`).
5. Registrar em `nestjs-project/CLAUDE.md` as consequências do pin — imagem congelada e console reduzido — em vez de contorná-las (per `phase-03-videos/TD-02`).

**Tests:** _(empty — Infra)_

**Dependencies:** none

**Acceptance criteria:**

- `docker compose ps` mostra `minio` e `redis` com status `running` após `docker compose up -d`.
- `docker compose down -v && docker compose up -d` reproduz o mesmo ambiente sem baixar uma tag diferente da imagem do MinIO.
- O bucket privado existe e responde pela API S3 (verificação via `mc`/SDK, **não** pelo console — o console foi reduzido pelo pin).
- Uma requisição anônima a um objeto do bucket é recusada — o bucket é privado por padrão.

---

### SI-03.2 — Configurar o cliente de object storage e o layout de chaves

**Description:** Entrega o `StorageModule` — cliente S3 configurado por `registerAs` e o serviço que resolve chaves e presigna URLs — que todo o resto da fase consome.

**Technical actions:**

1. Criar `src/config/storage.config.ts` como factory `registerAs` namespaced (endpoint, credenciais, bucket, região), seguindo a convenção herdada da fase 01, e estendê-la no schema Joi de `src/config/env.validation.ts`.
2. Criar `src/storage/storage.service.ts` construindo o `S3Client` com `endpoint` + `forcePathStyle: true` — é isso que faz MinIO-em-dev / S3-em-prod ser uma mudança de configuração e não de código (per `phase-03-videos/TD-01`).
3. Implementar no serviço a resolução de chaves: bucket privado único, **prefixo por tipo de objeto**, ambas as chaves derivadas do `id` do vídeo — assim worker e entrega não precisam de lookup extra e um re-run sobrescreve em vez de duplicar. A extensão do objeto de vídeo vem do **content type declarado no initiate**, nunca do filename enviado pelo cliente (per `phase-03-videos/TD-03`).
4. Implementar os wrappers de presign sobre `getSignedUrl` para `GetObjectCommand` e `UploadPartCommand`, com `expiresIn` **explícito por chamador** — o default de 900s serve entrega, mas o upload precisa de horas (per `phase-03-videos/TD-01`, `phase-03-videos/TD-05`).
5. Registrar `StorageModule` em `AppModule` com `imports: [ConfigModule]` e injeção via `ConfigType<typeof storageConfig>` + `@Inject(storageConfig.KEY)`.

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `StorageService` (resolução de chaves) | Unit: branch logic — chave de vídeo/thumbnail derivada do `id`, extensão vinda do content type declarado | `src/storage/storage.service.spec.ts` |
| `StorageService` (I/O real) | Integration: adaptador local (MinIO) — put/head/get de um objeto e presign resolvível | `src/storage/storage.service.integration-spec.ts` |
| `StorageModule` | Unit: compilation test — módulo com imports configurados | `src/storage/storage.module.spec.ts` |

**Dependencies:** SI-03.1 — o MinIO precisa existir para o teste de integração falar com storage real

**Acceptance criteria:**

- Um objeto gravado pelo serviço é recuperável pela chave que o serviço resolveu para aquele `id` de vídeo.
- A URL presignada emitida pelo serviço permite `GET` do objeto enquanto válida e é recusada após o `expiresIn`.
- Trocar apenas as variáveis de ambiente de endpoint/credenciais aponta o serviço para outro provedor S3-compatível sem alteração de código.
- Dois pedidos de chave para o mesmo `id` de vídeo resolvem a mesma chave.

---

### SI-03.3 — Criar a entidade `Video` e sua migration

**Description:** Materializa a linha que a fase inteira lê e escreve — criada como rascunho no initiate e completada pelo worker — com os invariantes expressos como `CHECK` state-scoped.

**Technical actions:**

1. Criar `src/videos/entities/video.entity.ts` com todos os campos de `## Technical Specifications → Data Model → Video`, incluindo o enum de `status` com default `draft` (per `phase-03-videos/TD-12`) e a relação many-to-one com `Channel` via `channel_id` (per `video-authorization-and-metadata/TD-02`).
2. Implementar a geração do `public_id` com `crypto.randomBytes` renderizado base64url e cortado num comprimento fixo — mantendo o UUID interno como PK para as FKs e expondo **apenas** `public_id` em rotas e payloads. `nanoid` foi deliberadamente evitado: é ESM-only e declara `engines` que excluem o Node 25.6 deste container (per `phase-03-videos/TD-10`).
3. Criar a migration com: índice **único** em `public_id`, índice não-único em `channel_id`, e as duas constraints `CHECK` state-scoped listadas em `### Data Model` — a de metadados obrigatórios para `ready` (per `video-authorization-and-metadata/TD-04` § Revisions) e `CHECK (status <> 'ready' OR thumbnail_key IS NOT NULL)` (per `thumbnail-delivery/TD-02`), ambas na **mesma migration** que adiciona as colunas correspondentes.
4. Criar `src/videos/videos.module.ts` registrando a entidade via `TypeOrmModule.forFeature` e registrá-lo em `AppModule`.

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `Video` (entity) | Integration: constraints, defaults, unicidade de `public_id`, FK de `channel_id`, os dois `CHECK` state-scoped | `src/videos/entities/video.entity.integration-spec.ts` |
| Gerador de `public_id` | Unit: comprimento fixo, alfabeto base64url, ausência de colisão em massa | `src/videos/videos.id.spec.ts` |
| `VideosModule` | Unit: compilation test | `src/videos/videos.module.spec.ts` |

**Dependencies:** none

**Acceptance criteria:**

- Inserir uma linha apenas com `channel_id`, `public_id` e `storage_key` sucede e a linha nasce com `status = draft` — é isso que torna o pré-cadastro no initiate possível.
- Tentar promover uma linha a `status = ready` sem `duration_seconds`, `width`, `height`, `video_codec`, `container_format` ou `size_bytes` é recusado pelo banco.
- Tentar promover uma linha a `status = ready` sem `thumbnail_key` é recusado pelo banco.
- Inserir duas linhas com o mesmo `public_id` é recusado pelo banco.
- Uma linha `ready` sem `audio_codec` ou sem `bitrate_bps` é aceita — nem todo arquivo tem trilha de áudio e nem todo container reporta bitrate.
- Dois `public_id` gerados em sequência diferem e têm o mesmo comprimento.

---

### SI-03.4 — Configurar a fila `video-processing` (BullMQ + Redis)

**Description:** Entrega o serviço de processamento em segundo plano — registro do BullMQ, política de retry default e a DLQ — como infraestrutura, antes de qualquer produtor ou consumidor.

**Technical actions:**

1. Instalar `bullmq` `^5` e `@nestjs/bullmq` `^11`; criar `src/config/redis.config.ts` como factory `registerAs` e estender o schema Joi. BullMQ foi escolhido sobre pg-boss por ser **CommonJS** — pg-boss é ESM-only e este projeto é CommonJS de ponta a ponta, o que colocaria a Definition of Done em risco (per `phase-03-videos/TD-04`).
2. Registrar `BullModule.forRootAsync` com `imports: [ConfigModule]`, `inject: [redisConfig.KEY]` e `connection` apontando para o **nome do serviço Compose** `redis`, nunca `localhost`.
3. Registrar `BullModule.registerQueue({ name: 'video-processing' })` e a fila `video-processing-dlq` — esta última **deliberadamente sem consumidor**, o padrão explícito que supre a ausência de DLQ nativa no BullMQ (per `phase-03-videos/TD-04`, `phase-03-videos/TD-13`).
4. Definir `defaultJobOptions` na raiz com `attempts: 3` e `backoff: { type: 'exponential', delay: 5000 }`, de forma que a política de retry de `phase-03-videos/TD-13` viva uma vez só e não por chamada de `add()`.

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| Módulo de fila (imports configurados) | Unit: compilation test | `src/videos/processing/video-queue.module.spec.ts` |
| Registro da fila | Integration: Redis real — enfileirar e ler de volta o job com as opções default aplicadas | `src/videos/processing/video-queue.integration-spec.ts` |

**Dependencies:** SI-03.1 — o Redis precisa existir para o teste de integração

**Acceptance criteria:**

- Um job publicado em `video-processing` aparece na fila com `attempts` 3 e backoff exponencial de 5000ms sem que o produtor informe essas opções.
- A fila `video-processing-dlq` existe e aceita publicação sem nenhum consumidor ligado a ela.
- A aplicação sobe com o Redis disponível e falha o startup de forma explícita quando as variáveis de conexão estão ausentes.

---

### SI-03.5 — Implementar o initiate do upload multipart (pré-cadastro do rascunho)

**Description:** Entrega a operação que cria o rascunho **antes de qualquer byte** e devolve a concessão presignada — o núcleo do suporte a 10GB sem impacto na performance.

**Technical actions:**

1. Criar `src/videos/uploads/video-uploads.service.ts` com o método de initiate: resolve `sub` → `channel_id` (lookup na coluna única indexada de `channels`; per `video-authorization-and-metadata/TD-02`), resolve a `storage_key` via `StorageService`, abre o multipart com `CreateMultipartUploadCommand` e **persiste a linha `draft` com o `upload_id` retornado** (per `phase-03-videos/TD-05`, `phase-03-videos/TD-15`).
2. Calcular a partição do upload com **part size de 64 MiB** — ≈160 partes para 10GB, confortavelmente abaixo do teto de 10.000 partes e poucas o bastante para presignar todas já no initiate (per `phase-03-videos/TD-05`).
3. Presignar **todas** as partes via `UploadPartCommand` com `expiresIn` explícito na ordem de **horas, não os 7 dias máximos** — uma transferência de 10GB a 10 Mbps leva ≈2.2h (per `phase-03-videos/TD-05`).
4. Lançar `CHANNEL_MISSING_FOR_USER` (500) quando o `sub` não resolve para um canal — a fase 02 cria o canal no signup com `cascade`, então isso é violação de invariante, não erro de usuário (per `video-authorization-and-metadata/TD-02`, `### Error Catalog`).

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `VideoUploadsService` (initiate) | Unit: branch logic (repo e storage mockados) — cálculo de partes, ausência de canal → `CHANNEL_MISSING_FOR_USER` | `src/videos/uploads/video-uploads.service.spec.ts` |
| `VideoUploadsService` (initiate) | Integration: DB + MinIO reais — a linha `draft` nasce com `upload_id` e `storage_key` persistidos | `src/videos/uploads/video-uploads.service.integration-spec.ts` |

**Dependencies:** SI-03.2, SI-03.3

**Acceptance criteria:**

- Iniciar um upload cria a linha do vídeo em `draft` antes de qualquer byte transferido, com `channel_id`, `public_id`, `storage_key` e `upload_id` preenchidos.
- A concessão devolvida cobre todas as partes do arquivo declarado, com tamanho de parte de 64 MiB.
- Um `PUT` direto ao storage usando uma URL de parte da concessão é aceito **sem token de autenticação** — as partes vão direto ao storage por construção.
- Uma URL de parte deixa de ser aceita depois de expirada.
- Iniciar um upload para um usuário sem canal falha como violação de invariante (`CHANNEL_MISSING_FOR_USER`), não como erro de validação.

---

### SI-03.6 — Implementar o complete do upload e a publicação do job

**Description:** Fecha o multipart no storage e, na mesma operação, transiciona `draft → processing` e publica o job — mantendo a API como o único lugar que publica.

**Technical actions:**

1. Implementar o método de complete em `VideoUploadsService`: chama `CompleteMultipartUploadCommand` com a lista de ETags enviada pelo cliente. A API faz essa chamada de qualquer forma (ela precisa da lista de ETags), e é exatamente por isso que `phase-03-videos/TD-05` preferiu um endpoint chamado pelo cliente a uma bucket notification do MinIO — a notificação adicionaria um segundo caminho de ingresso, autenticado de outra forma, para uma informação que a API já tem.
2. Aplicar a transição **guardada**: a operação só aceita um vídeo em `draft`; qualquer outro estado responde `INVALID_VIDEO_STATE` (per `phase-03-videos/TD-12`, `### Error Catalog`).
3. Publicar o job em `video-processing` na **mesma operação** que grava `status = processing`, com `jobId` determinístico derivado do `videoId` — o dedup de fila que elimina o duplicado comum (cliente chamando complete duas vezes) (per `phase-03-videos/TD-14`).
4. Não habilitar `removeOnComplete`/`removeOnFailed` nesta fila sem revisitar a idempotência: remover o registro do job faz o `jobId` deixar de ser visto como duplicado — a segunda camada (guard atômico de status, SI-03.11) é o que torna isso seguro.

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `VideoUploadsService` (complete) | Unit: branch logic — estado não-`draft` → `INVALID_VIDEO_STATE`; `jobId` derivado do `videoId` | `src/videos/uploads/video-uploads.service.spec.ts` |
| `VideoUploadsService` (complete) | Integration: DB + MinIO + Redis reais — objeto consolidado, linha em `processing`, job enfileirado uma única vez | `src/videos/uploads/video-uploads.service.integration-spec.ts` |

**Dependencies:** SI-03.4, SI-03.5

**Acceptance criteria:**

- Completar um upload consolida o objeto no storage e deixa o vídeo em `processing`.
- Completar o mesmo upload duas vezes deixa exatamente um job na fila.
- Completar um vídeo que não está em `draft` é recusado com `INVALID_VIDEO_STATE` e não publica job.
- Completar um vídeo com lista de ETags incompleta não deixa a linha em `processing` — o estado só avança quando o objeto existe.

---

### SI-03.7 — Expor os endpoints de upload (initiate e complete)

**Route:** POST /videos/uploads, POST /videos/{videoId}/uploads/complete
**Test Specs:** see `nestjs-project/specs/videos-uploads.plan.md`
**Authorization:** initiate — autenticado; complete — autenticado + owner (per `### Authorization Matrix`)

**Description:** Publica a superfície HTTP do upload, que é a fronteira de segurança de todo o caminho — autenticar o initiate é o que escopa a concessão presignada.

**Technical actions:**

1. Criar `src/videos/uploads/video-uploads.controller.ts` com os dois endpoints exatamente nas shapes de `### API Contracts` (request headers, request body, respostas 201/200 e códigos de erro).
2. Criar os DTOs de request com `class-validator` seguindo `phase-02-auth/TD-06` e as regras de `### API Contracts → Validation Rules` — content type declarado e tamanho total obrigatórios no initiate; lista de ETags obrigatória e não-vazia no complete.
3. Aplicar o guard global herdado da fase 02 **sem alterações** — nenhuma classe nova de guard, nenhum `@OptionalAuth()`, nenhuma segunda chave de metadata; `@Public()` continua o único opt-out (per `video-authorization-and-metadata/TD-01`).
4. Implementar a checagem de owner resolvendo contra `videos.channel_id` e respondendo **`404 VIDEO_NOT_FOUND`, nunca `403`** — um `403` confirmaria a existência do vídeo (per `video-authorization-and-metadata/TD-03`).
5. Documentar ambos os endpoints com `@ApiOperation`, `@ApiResponse` por status code, `@ApiBody` e `@ApiParam` — a inferência automática do CLI plugin não cobre respostas por status nem contratos de erro (per `openapi-docs-nestjs/TD-01` § Revisions).

**Tests:** _(empty — controller/DTO são E2E-only por testing-guide; cenários autorados por /plan-test-specs)_

**Dependencies:** SI-03.6

**Acceptance criteria:**

- `POST /videos/uploads` sem token retorna `401`.
- `POST /videos/uploads` com payload válido retorna `201` com o identificador do vídeo e a concessão presignada.
- `POST /videos/uploads` sem o content type declarado retorna `400`.
- `POST /videos/{videoId}/uploads/complete` chamado por um usuário que não é o dono retorna `404` com `VIDEO_NOT_FOUND` — a resposta não distingue "não é seu" de "não existe".
- `POST /videos/{videoId}/uploads/complete` sobre um vídeo já em `processing` retorna `409` com `INVALID_VIDEO_STATE`.
- `openapi.json` descreve os dois endpoints com respostas tipadas por status code e o envelope de erro.

---

### SI-03.8 — Provisionar a imagem e o entrypoint do worker

**Description:** Cria o segundo container — mesmo código-fonte, entrypoint separado — com o FFmpeg instalado, sem contaminar a imagem da API.

**Technical actions:**

1. Criar um `Dockerfile` alvo para o worker estendendo a base `node:25.6.0-slim` já usada, com `apt-get install -y ffmpeg` — o pacote do Debian fornece `ffmpeg` **e** `ffprobe`, mantendo o binário fora do `npm install` e fora da imagem da API (per `phase-03-videos/TD-07`).
2. Criar `src/worker.ts` como entrypoint separado que sobe um **standalone application context** do Nest (não uma app HTTP), reusando a mesma entidade `Video` e a mesma configuração TypeORM da API — o single-sourcing de schema e config é o fator decisivo da decisão (per `phase-03-videos/TD-06`).
3. Adicionar o serviço do worker em `nestjs-project/compose.yaml`, ligado a `db`, `redis` e `minio` pelos nomes de serviço, com um **volume dedicado de arquivos temporários** (per `phase-03-videos/TD-08`).
4. Declarar em `nest-cli.json` qualquer asset não-TypeScript que o worker precise em runtime — `tsc` só emite `.ts` para `dist/`.
5. Registrar `onApplicationShutdown` de forma que o encerramento feche o worker BullMQ antes do contexto — e documentar no módulo que tocar o getter `worker` antes de `onModuleInit` lança "Worker has not yet been initialized".

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| Módulo do worker | Unit: compilation test — módulo com imports configurados | `src/videos/processing/video-processing.module.spec.ts` |

**Dependencies:** SI-03.4

**Acceptance criteria:**

- O container do worker sobe e permanece `running` sem expor porta HTTP.
- `ffmpeg -version` e `ffprobe -version` respondem dentro do container do worker.
- `ffprobe` **não** está disponível dentro do container da API — o binário não vazou para a imagem errada.
- O worker conecta em `db`, `redis` e `minio` pelos nomes de serviço Compose e escreve na mesma tabela `videos` que a API lê.

---

### SI-03.9 — Implementar o download para arquivo temporário e a sonda `ffprobe`

**Description:** Entrega a extração de duração e metadados — a leitura do arquivo-fonte e a invocação do `ffprobe` que alimentam as colunas do vídeo.

**Technical actions:**

1. Criar `src/videos/processing/source-file.service.ts` que **baixa o objeto para um arquivo temporário** no volume dedicado. É a única abordagem cuja correção não depende do layout do container nem do comportamento de seek remoto do FFmpeg — e correção é o que esta fase é avaliada. Limpeza sempre em `finally` (per `phase-03-videos/TD-08`).
2. Fixar a **concorrência do worker em 1**, de forma que o pico de disco de scratch seja um único arquivo (per `phase-03-videos/TD-08`).
3. Criar `src/videos/processing/ffprobe.service.ts` invocando `ffprobe -print_format json` com **`execFile` e array de argumentos, nunca string de shell** — as chaves de objeto derivam de entrada do usuário — e com **timeout explícito**, para que um input patológico não prenda o worker indefinidamente (per `phase-03-videos/TD-07`). `fluent-ffmpeg` foi descartado por estar deprecado, o que remove a única razão real para uma abstração.
4. Mapear a saída JSON para as colunas de `### Data Model`: `format.duration` → `duration_seconds` (fracionário, preservado em `numeric(10,3)`), primeiro stream de vídeo `.width`/`.height`/`.codec_name`, primeiro stream de áudio `.codec_name`, `format.format_name`, `format.bit_rate` (per `video-authorization-and-metadata/TD-04`).
5. Obter `size_bytes` via `HeadObjectCommand` — **o objeto no storage é autoritativo**, o `format.size` do ffprobe serve só como conferência (per `video-authorization-and-metadata/TD-04`).

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `FfprobeService` (mapeamento) | Unit: branch logic — JSON de ffprobe → colunas; arquivo sem trilha de áudio; container sem bitrate | `src/videos/processing/ffprobe.service.spec.ts` |
| `FfprobeService` (subprocesso real) | Integration: `ffprobe` real sobre fixtures de vídeo | `src/videos/processing/ffprobe.service.integration-spec.ts` |
| `SourceFileService` | Integration: MinIO real — download para temp, limpeza no `finally` | `src/videos/processing/source-file.service.integration-spec.ts` |

**Dependencies:** SI-03.8

**Acceptance criteria:**

- Sondar um vídeo com áudio devolve duração fracionária, largura, altura, codec de vídeo, codec de áudio, container e bitrate.
- Sondar um vídeo **sem** trilha de áudio devolve o restante dos campos com o codec de áudio ausente, sem erro.
- Sondar um arquivo que não é vídeo é reportado como entrada sem stream de vídeo decodificável.
- O arquivo temporário é removido do volume mesmo quando a sondagem falha.
- Uma entrada que trava a sondagem é interrompida pelo timeout em vez de prender o worker.
- O tamanho registrado é o do objeto no storage, mesmo quando o valor reportado pelo ffprobe diverge.

---

### SI-03.10 — Implementar a geração automática de thumbnail

**Description:** Extrai exatamente um frame do vídeo como thumbnail padrão — a capability de geração automática, engenheirada contra os modos de falha realistas.

**Technical actions:**

1. Criar `src/videos/processing/thumbnail.service.ts` que faz seek para `max(1s, duration * 0.10)` — a duração já foi extraída no mesmo job, então buscar ~10% não custa nada extra e evita a falha mais comum da alternativa: um frame de abertura preto (per `phase-03-videos/TD-09`).
2. Extrair exatamente um frame (`-frames:v 1`) em **JPEG** — universalmente suportado pelos browsers e muito menor que PNG para frames fotográficos — com `-vf scale=<W>:-2`, que preserva o aspect ratio e mantém a altura par (per `phase-03-videos/TD-09`).
3. Invocar o `ffmpeg` pelo mesmo padrão do SI-03.9 — `execFile` com array de argumentos e timeout explícito (per `phase-03-videos/TD-07`).
4. Gravar o objeto sob a chave de thumbnail resolvida pelo `StorageService` a partir do `id` do vídeo, de forma que um re-run **sobrescreva** em vez de duplicar (per `phase-03-videos/TD-03`, `phase-03-videos/TD-14`).

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `ThumbnailService` (política de seek) | Unit: branch logic — clamp `max(1s, duration * 0.10)` para clipes curtos e longos | `src/videos/processing/thumbnail.service.spec.ts` |
| `ThumbnailService` (ffmpeg + storage reais) | Integration: fixture de vídeo → JPEG único gravado na chave derivada | `src/videos/processing/thumbnail.service.integration-spec.ts` |

**Dependencies:** SI-03.9

**Acceptance criteria:**

- Processar um vídeo produz exatamente uma imagem JPEG no storage, na chave derivada do identificador daquele vídeo.
- Um vídeo de 5 segundos gera a thumbnail a partir de 1s, e não do frame zero.
- A imagem gerada preserva a proporção do vídeo e tem altura par.
- Reprocessar o mesmo vídeo sobrescreve a thumbnail existente em vez de criar uma segunda.

---

### SI-03.11 — Implementar o processador do job (persistência e transição para `ready`)

**Description:** Costura sondagem, thumbnail e persistência num único job idempotente que leva o vídeo de `processing` a `ready`.

**Technical actions:**

1. Criar `src/videos/processing/video-processing.processor.ts` como `@Processor('video-processing')` estendendo `WorkerHost`, com `concurrency` 1, orquestrando a sequência de `### Events/Messages → video-processing`: download para temp → `ffprobe` → `HeadObject` → extração de thumbnail → persistência.
2. Aplicar o **guard atômico de status** como `UPDATE ... WHERE status = 'processing'`, e não read-then-write, para que dois workers não possam ambos prosseguir — essa é a rede de segurança real da idempotência, já implicada pelas transições guardadas de `phase-03-videos/TD-12` (per `phase-03-videos/TD-14`).
3. Escrever metadados, `thumbnail_key` e `status = ready` **na mesma fronteira de escrita da linha** — uma extração falha deixa a linha em `error` e nunca num `ready` parcial, que é o estado que quebraria o re-run limpo de um job repetido (per `thumbnail-delivery/TD-02`, `phase-03-videos/TD-14`).
4. Escrever direto via TypeORM usando a entidade `Video` compartilhada, não por uma API HTTP interna — que adicionaria um hop de rede, uma segunda superfície de auth e dependência da disponibilidade da API, sem ganho (per `phase-03-videos/TD-06`).

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `VideoProcessingProcessor` | Unit: mock deps — ordem da pipeline, guard atômico rejeita vídeo fora de `processing` | `src/videos/processing/video-processing.processor.spec.ts` |
| `VideoProcessingProcessor` | Integration: DB + MinIO + Redis reais — job → linha `ready` com metadados e `thumbnail_key` | `src/videos/processing/video-processing.processor.integration-spec.ts` |

**Dependencies:** SI-03.10, SI-03.6

**Acceptance criteria:**

- Completar o upload de um vídeo válido leva a linha de `processing` a `ready` com duração, dimensões, codecs, container, tamanho e chave de thumbnail preenchidos.
- Executar o mesmo job duas vezes deixa a linha em `ready` uma única vez e não duplica objetos no storage.
- Um job cujo vídeo não está em `processing` termina sem alterar a linha.
- Nenhuma linha alcança `ready` com thumbnail ausente ou com metadados de geometria ausentes.
- Testes de integração que sobem o contexto do worker encerram sem handles abertos (a app é fechada no `afterAll`).

---

### SI-03.12 — Implementar o tratamento de falhas do processamento

**Description:** Garante que nenhuma falha derrube o worker nem se perca em silêncio — retry para o transitório, fail-fast para o permanente, DLQ para o exaurido.

**Technical actions:**

1. Aplicar a política de retry da fila (`attempts: 3`, `backoff` exponencial com `delay: 5000`) à classe transitória de falhas (per `phase-03-videos/TD-13`).
2. Implementar o **fail-fast**: quando o `ffprobe` reporta que a entrada não tem stream de vídeo decodificável, tratar como permanente e ir direto a `status = error` **sem consumir as tentativas restantes**. É barato classificar porque é o veredito do próprio ffprobe, não um palpite sobre infraestrutura — e é exatamente o caso que o smoke test exercita (per `phase-03-videos/TD-13`).
3. Na exaustão das tentativas, gravar `status = error` **mais a razão da falha persistida** na linha e publicar em `video-processing-dlq`, de forma que nada se perca silenciosamente (per `phase-03-videos/TD-13`, `### Events/Messages`).
4. Garantir que o handler **capture, registre e retorne** — o worker nunca pode deixar uma falha de processamento derrubar o processo (per `phase-03-videos/TD-13`).

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| Classificação de falhas | Unit: mock deps — entrada não-decodificável → `error` imediato; falha transitória → retry | `src/videos/processing/video-processing.failure.spec.ts` |
| Fluxo de falha | Integration: Redis + DB reais — exaustão grava `error` + razão e publica na DLQ | `src/videos/processing/video-processing.failure.integration-spec.ts` |

**Dependencies:** SI-03.11

**Acceptance criteria:**

- Subir um arquivo que não é vídeo deixa o vídeo em `error` com a razão persistida, sem derrubar o worker.
- Uma entrada não-decodificável chega a `error` na primeira tentativa, sem consumir as tentativas restantes.
- Uma falha transitória é retentada com backoff crescente antes de ser considerada permanente.
- Um job que esgota as tentativas aparece em `video-processing-dlq` e a fila permanece sem consumidor.
- O worker continua consumindo jobs subsequentes depois de qualquer uma dessas falhas.

---

### SI-03.13 — Implementar as leituras de vídeo (pública `ready`-only e do dono)

**Description:** Entrega as duas resoluções de vídeo — a pública, restrita a `ready`, e a do dono, que enxerga qualquer estado — com a regra de não vazar existência.

**Technical actions:**

1. Criar `src/videos/videos.service.ts` com a resolução pública por `public_id` filtrando `status = 'ready'` **na mesma query** que resolve o identificador — uma query, não fetch-then-check, para que não exista janela em que a checagem e a leitura discordem (per `video-authorization-and-metadata/TD-03`).
2. Implementar a resolução do dono por identificador interno, devolvendo a linha em **qualquer** estado, incluindo `error` com a razão persistida — é isso que torna um upload falho diagnosticável pelo dono em vez de silenciosamente ausente (per `video-authorization-and-metadata/TD-03`, `phase-03-videos/TD-13`).
3. Responder `VIDEO_NOT_FOUND` (404) para identificador desconhecido, vídeo não-`ready` em rota pública e chamador que não é o dono em rota de dono — **`404`, nunca `403`**: um `403` confirma que o vídeo existe, e esse é o vazamento que a regra de `unlisted` da Fase 04 não pode ter (per `video-authorization-and-metadata/TD-03`, `### Error Catalog`).
4. Expor no payload público apenas o `public_id` e o conjunto de metadados de `### Data Model` — o UUID interno permanece restrito às FKs e às rotas do dono (per `phase-03-videos/TD-10`).

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `VideosService` | Unit: branch logic (repo mockado) — não-`ready` → not-found; não-dono → not-found | `src/videos/videos.service.spec.ts` |
| `VideosService` | Integration: DB real — filtro `ready` na mesma query; linha em `error` visível ao dono com a razão | `src/videos/videos.service.integration-spec.ts` |

**Dependencies:** SI-03.3

**Acceptance criteria:**

- Resolver um vídeo `ready` pelo identificador público devolve seus metadados sem exigir autenticação.
- Resolver um vídeo em `draft`, `processing` ou `error` pelo identificador público é indistinguível de resolver um identificador inexistente.
- O dono consegue ler seu vídeo em qualquer estado, e em `error` a resposta traz a razão da falha.
- Um usuário autenticado que não é o dono recebe a mesma resposta que receberia para um vídeo inexistente.
- Nenhuma resposta pública contém o identificador interno do vídeo.

---

### SI-03.14 — Expor os endpoints de leitura de vídeo

**Route:** GET /videos/{publicId}, GET /videos/{videoId}
**Test Specs:** see `nestjs-project/specs/videos-read.plan.md`
**Authorization:** metadata público — `@Public()`, `ready`-only; visão do dono — autenticado + owner (per `### Authorization Matrix`)

**Description:** Publica as duas rotas de leitura — a pública anônima e o poll de status do dono — nas duas famílias disjuntas que a decisão de autorização definiu.

**Technical actions:**

1. Criar `src/videos/videos.controller.ts` com os dois endpoints nas shapes de `### API Contracts`, marcando a rota pública com `@Public()` — o único opt-out do guard global herdado (per `video-authorization-and-metadata/TD-01`).
2. Tornar as duas famílias de rota **disjuntas no router**, conforme a Routing note de `### API Contracts`: `video-authorization-and-metadata/TD-01` mapeia por **papel, não por path literal**, e sua Option A pede explicitamente "two disjoint route families". A matriz de `### Authorization Matrix` é o artefato vinculante da desambiguação.
3. Aplicar a checagem de owner devolvendo `404 VIDEO_NOT_FOUND` para não-donos, nunca `403` (per `video-authorization-and-metadata/TD-03`).
4. Documentar ambos com `@ApiOperation`, `@ApiResponse` por status code e `@ApiParam`, incluindo o contrato de erro (per `openapi-docs-nestjs/TD-01` § Revisions).

**Tests:** _(empty — controller/DTO são E2E-only por testing-guide; cenários autorados por /plan-test-specs)_

**Dependencies:** SI-03.13

**Acceptance criteria:**

- A rota pública de metadata de um vídeo `ready` responde `200` **sem** cabeçalho de autenticação.
- A rota pública de um vídeo em `processing` responde `404` com `VIDEO_NOT_FOUND`, e não `403`.
- A rota do dono sem token responde `401`.
- A rota do dono devolve `status` e, quando `error`, a razão da falha.
- As duas rotas de leitura resolvem sem ambiguidade — uma requisição a uma família nunca é atendida pelo handler da outra.
- `openapi.json` descreve ambas as rotas, marcando a pública como não autenticada.

---

### SI-03.15 — Implementar a entrega por redirect presignado (streaming, download e thumbnail)

**Route:** GET /videos/{publicId}/stream, GET /videos/{publicId}/download, GET /videos/{publicId}/thumbnail
**Test Specs:** see `nestjs-project/specs/videos-delivery.plan.md`
**Authorization:** `@Public()` nas três, `ready`-only (per `### Authorization Matrix`)

**Description:** Entrega reprodução via streaming, download e thumbnail com **um único idioma de entrega** — `302` para URL presignada de vida curta — mantendo a API fora do caminho de dados.

**Technical actions:**

1. Adicionar em `VideosController` os três endpoints, todos `@Public()`, respondendo `302` com `Location` apontando para a URL presignada resolvida pelo `StorageService`, com TTL em **minutos, não horas** (per `phase-03-videos/TD-11`).
2. Usar `response-content-disposition` na URL de download, de forma que **o mesmo objeto** sirva streaming e download — é a diferença entre as duas rotas (per `phase-03-videos/TD-11`).
3. Usar `response-content-type: image/jpeg` na URL da thumbnail: esses overrides viram **query params assinados**, então o content type servido fica fixado no momento da assinatura, independentemente do que o worker gravou no objeto, e o browser renderiza inline em vez de baixar (per `thumbnail-delivery/TD-01`).
4. Colocar `Cache-Control` **no próprio `302`**, não na imagem presignada — a assinatura rotaciona a cada request, então a cache key do browser nunca se repete e tentar cachear os bytes é a armadilha que a decisão descarta explicitamente (per `thumbnail-delivery/TD-01`).
5. Aplicar às três rotas o mesmo filtro `ready`-only da rota pública de metadata: uma rota de thumbnail que resolvesse vídeos que a rota de stream recusa viraria um oráculo de existência (per `thumbnail-delivery/TD-01`, `video-authorization-and-metadata/TD-03`).

**Tests:** _(empty — controller/DTO são E2E-only por testing-guide; cenários autorados por /plan-test-specs)_

**Dependencies:** SI-03.14, SI-03.2

**Acceptance criteria:**

- Um cliente anônimo consegue assistir a um vídeo `ready` seguindo o `302`, sem baixar o arquivo inteiro antes de começar — requisições `Range` são atendidas com conteúdo parcial pelo storage.
- A rota de download entrega o mesmo objeto do streaming, mas com disposição de anexo.
- A rota de thumbnail entrega uma imagem que o browser renderiza inline, independentemente do content type gravado no objeto.
- As três rotas respondem `404` com `VIDEO_NOT_FOUND` para um vídeo que não está `ready`, sem distinguir de um identificador inexistente.
- A URL presignada obtida por qualquer das três rotas deixa de funcionar após seu TTL de minutos.
- Nenhuma das três rotas faz os bytes do vídeo trafegarem pela API.

---

### SI-03.16 — Implementar o cancelamento de upload e a limpeza de rascunhos órfãos

**Description:** Fecha a higiene de storage da fase: o dono pode cancelar explicitamente, e uploads abandonados têm suas partes acumuladas recuperadas.

**Route:** DELETE /videos/{videoId}/uploads
**Test Specs:** see `nestjs-project/specs/videos-upload-cancel.plan.md`
**Authorization:** autenticado + owner (per `### Authorization Matrix`)

**Technical actions:**

1. Implementar em `VideoUploadsService` o `abortUpload`: `AbortMultipartUploadCommand` usando o `upload_id` persistido no initiate, guardado a vídeos em `draft` — só há multipart aberto nesse estado (per `phase-03-videos/TD-15`, `phase-03-videos/TD-12`).
2. Expor a operação de cancelamento do dono em `VideoUploadsController`, respondendo `204` no sucesso, `404 VIDEO_NOT_FOUND` para não-dono e `409 INVALID_VIDEO_STATE` fora de `draft`, documentada com os decoradores `@nestjs/swagger` explícitos.
3. Criar a rotina de limpeza que percorre rascunhos mais velhos que um limiar **generoso de 24h** — que excede confortavelmente qualquer transferência realista de 10GB — e **aborta o multipart**, recuperando o storage acumulado, que é a parte cara e o problema que o plano do projeto aponta (per `phase-03-videos/TD-15`).
4. Manter a política de remoção de linha **conservadora**: a rotina aborta o multipart e **deixa a linha** para o painel da Fase 04 tratar — a Fase 04 é dona da gestão de rascunhos, esta fase é dona da higiene de storage (per `phase-03-videos/TD-15`).

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| Rotina de limpeza | Unit: branch logic — limiar de 24h, seleção só de `draft` | `src/videos/uploads/orphan-draft-cleanup.service.spec.ts` |
| Rotina de limpeza | Integration: DB + MinIO reais — multipart abortado, linha preservada | `src/videos/uploads/orphan-draft-cleanup.service.integration-spec.ts` |

**Dependencies:** SI-03.7

**Acceptance criteria:**

- Cancelar um upload em `draft` responde `204` e as partes já enviadas deixam de ocupar espaço no storage.
- Cancelar um upload de outro usuário responde `404` com `VIDEO_NOT_FOUND`.
- Cancelar um vídeo fora de `draft` responde `409` com `INVALID_VIDEO_STATE`.
- A rotina de limpeza aborta o multipart de um rascunho com mais de 24h e **não** remove a linha correspondente.
- A rotina de limpeza não toca em rascunhos dentro da janela de 24h nem em vídeos em outros estados.

---

### SI-03.17 — Expor o reprocessamento guardado

**Route:** POST /videos/{videoId}/reprocess
**Test Specs:** see `nestjs-project/specs/videos-reprocess.plan.md`
**Authorization:** autenticado + owner (per `### Authorization Matrix`)

**Description:** Permite que um ambiente corrigido recupere um vídeo que falhou, sem exigir um novo upload — como caminho explícito, não como retry automático.

**Technical actions:**

1. Implementar o re-enqueue em `VideosService`, **guardado a vídeos em `error`** — deliberadamente não um loop de retry automático (per `phase-03-videos/TD-13`).
2. Transicionar a linha de volta a `processing` e limpar a razão da falha na mesma operação que publica o job, reusando o `jobId` determinístico derivado do identificador do vídeo (per `phase-03-videos/TD-12`, `phase-03-videos/TD-14`).
3. Expor o endpoint em `VideosController`, respondendo `409 INVALID_VIDEO_STATE` fora de `error` e `404 VIDEO_NOT_FOUND` para não-dono, documentado com os decoradores `@nestjs/swagger` explícitos.

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| Reprocessamento (`VideosService`) | Unit: branch logic — só aceita `error`; `jobId` determinístico preservado | `src/videos/videos.service.spec.ts` |
| Reprocessamento | Integration: DB + Redis reais — linha volta a `processing` e o job é republicado | `src/videos/videos.service.integration-spec.ts` |

**Dependencies:** SI-03.12, SI-03.14

**Acceptance criteria:**

- Reprocessar um vídeo em `error` o leva de volta a `processing` e, num ambiente saudável, ele chega a `ready` sem novo upload.
- Reprocessar um vídeo em qualquer estado que não `error` responde `409` com `INVALID_VIDEO_STATE`.
- Reprocessar o vídeo de outro usuário responde `404` com `VIDEO_NOT_FOUND`.
- Após um reprocessamento bem-sucedido, a razão da falha anterior não aparece mais na visão do dono.

---

## Technical Specifications

### Data Model

#### Video

New entity. The row is created at **initiate**, before any byte is uploaded (`phase-03-videos/TD-05`), which is why every column the worker fills is nullable and the invariants are enforced by state-scoped `CHECK`s instead of column-level `NOT NULL` (`video-authorization-and-metadata/TD-04` § Revisions, `thumbnail-delivery/TD-02`).

| Field | Type | Constraints |
|-------|------|-------------|
| `id` | uuid | PK, generated — internal identifier, used for FKs and for the owner routes (`phase-03-videos/TD-10`) |
| `public_id` | varchar | not null, **unique** — short random `crypto.randomBytes` rendered base64url, sliced to a fixed length; the only identifier exposed in public routes and payloads (`phase-03-videos/TD-10`) |
| `channel_id` | uuid | not null, FK → `channels(id)`, non-unique index — resolved from the JWT `sub` in the initiate handler (`video-authorization-and-metadata/TD-02`) |
| `status` | enum (`draft` \| `processing` \| `ready` \| `error`) | not null, default `draft` — Postgres enum column (`phase-03-videos/TD-12`) |
| `storage_key` | varchar | not null — resolved object key for the video, derived from `id` under the video prefix; persisted rather than recomputed from the convention (`phase-03-videos/TD-03`) |
| `thumbnail_key` | varchar | nullable — resolved object key for the thumbnail, written by the worker (`phase-03-videos/TD-03`, `phase-03-videos/TD-09`) |
| `upload_id` | varchar | nullable — the S3 multipart `uploadId`, persisted at initiate so the upload can always be aborted (`phase-03-videos/TD-15`) |
| `failure_reason` | text | nullable — persisted reason written when the worker moves the row to `error` (`phase-03-videos/TD-13`; the TD fixes the *existence* of a persisted reason, not the column name) |
| `duration_seconds` | numeric(10,3) | nullable — ffprobe `format.duration`; fractional, so `numeric(10,3)` keeps millisecond precision without float drift (`video-authorization-and-metadata/TD-04`) |
| `width` | integer | nullable — first video stream `.width` (`video-authorization-and-metadata/TD-04`) |
| `height` | integer | nullable — first video stream `.height` (`video-authorization-and-metadata/TD-04`) |
| `video_codec` | varchar(32) | nullable — first video stream `.codec_name` (`video-authorization-and-metadata/TD-04`) |
| `audio_codec` | varchar(32) | nullable — first audio stream `.codec_name`; stays nullable even for `ready` rows, a file may have no audio track (`video-authorization-and-metadata/TD-04`) |
| `container_format` | varchar(64) | nullable — ffprobe `format.format_name` (`video-authorization-and-metadata/TD-04`) |
| `bitrate_bps` | bigint | nullable — ffprobe `format.bit_rate`; stays nullable even for `ready` rows, absent for some containers (`video-authorization-and-metadata/TD-04`) |
| `size_bytes` | bigint | nullable — **from the storage object (`HeadObject`)**, not from ffprobe's `format.size`; ffprobe's value serves only as a cross-check (`video-authorization-and-metadata/TD-04`) |
| `created_at` | timestamptz | default now() — the age reference the orphan-draft cleanup routine reads (`phase-03-videos/TD-15`) |
| `updated_at` | timestamptz | default now(), updated on write |

**Relations:** `Channel` has many `Video` (one-to-many); `Video` belongs to `Channel` via `channel_id` (`video-authorization-and-metadata/TD-02`)

**Indexes:** unique on `public_id` (`phase-03-videos/TD-10`); non-unique on `channel_id` — it serves Fase 04's "list this channel's videos" query (`video-authorization-and-metadata/TD-02`)

**Constraints:**

- `CHECK (status <> 'ready' OR (duration_seconds IS NOT NULL AND width IS NOT NULL AND height IS NOT NULL AND video_codec IS NOT NULL AND container_format IS NOT NULL AND size_bytes IS NOT NULL))` — added in the same migration that adds the columns. Encodes "a file with no video stream is not a video" for the state where it is meaningful, without blocking the initiate `INSERT` (`video-authorization-and-metadata/TD-04` § Revisions, raised as IC-1 by `/plan-validate`).
- `CHECK (status <> 'ready' OR thumbnail_key IS NOT NULL)` — added in the same migration that adds `thumbnail_key`, so the "every `ready` video has a thumbnail" contract is enforced rather than merely documented. The column itself stays nullable: `draft` and `processing` rows have no thumbnail, and that is correct, not an exception (`thumbnail-delivery/TD-02`).

**Object key layout** (single private bucket, prefix per kind — `phase-03-videos/TD-03`): both keys derive from the video's `id`, so the worker and the delivery paths need no extra lookup, and a re-run overwrites rather than duplicates (`phase-03-videos/TD-14`). The video object's extension comes from the **declared content type on the initiate request**, never from the client-supplied filename.

### API Contracts

All errors use the inherited domain-error envelope `{ statusCode, error, message }` with machine-readable domain codes (`phase-02-auth/TD-07`, via `## Inherited Decisions Detail`). All routes are authenticated by the global guard inherited from phase 02 unless marked `@Public()` (`video-authorization-and-metadata/TD-01`). Every endpoint below is documented with explicit `@nestjs/swagger` decorators — `@ApiOperation`, `@ApiResponse` per status code, `@ApiParam`/`@ApiBody` — not only CLI-plugin schema inference (`openapi-docs-nestjs/TD-01` § Revisions).

> **Routing note (not a rename).** `video-authorization-and-metadata/TD-01` lists both `GET /videos/{videoId}` (owner) and `GET /videos/{publicId}` (public) — two literal path patterns that an Express router cannot tell apart. The TD anticipates this: it states the matrix "maps by **role**, not by literal path, if those decisions land differently", and its Option A rationale is "two **disjoint route families**". The paths are transcribed verbatim below; making the owner family disjoint at the router (a distinct owner-scoped path segment) is an `/implement` concern authorized by that clause — it is a disambiguation the TD sanctions, not a silent rename. The role → auth mapping is what is binding, and it is in `### Authorization Matrix`.

#### POST /videos/uploads

Initiate. The security boundary of the whole upload path — it is what mints the presigned part URLs, and those URLs are bearer capabilities for their TTL (`video-authorization-and-metadata/TD-01`). Creates the draft row **before any byte is uploaded**, which is what satisfies "pré-cadastro automático do vídeo como rascunho ao iniciar o upload" (`phase-03-videos/TD-05`, `phase-03-videos/TD-12`).

**Request headers:**
- Content-Type: application/json
- Authorization: Bearer {access token} — authenticated (`video-authorization-and-metadata/TD-01`)

**Request body:**
- declared content type: string, required — the object extension is derived from it, never from the client-supplied filename (`phase-03-videos/TD-03`)
- total size in bytes: integer, required — determines how many parts are presigned at initiate (`phase-03-videos/TD-05`)
- _(any further descriptive fields — title, description — are `_undetermined_`: no TD in scope fixes them; Fase 04 owns video metadata editing)_

**Response 201:**
- videoId: string (uuid) — the internal `id`; the client needs it for `complete` (`phase-03-videos/TD-05`)
- publicId: string — the short public identifier (`phase-03-videos/TD-10`)
- uploadId: string — the S3 multipart upload id, also persisted on the row (`phase-03-videos/TD-15`)
- part size: **64 MiB** — ≈160 parts for a 10GB file, comfortably under the 10,000-part ceiling (`phase-03-videos/TD-05`)
- presigned part URLs: array — **all** parts presigned at initiate; presigning them all up front is cheap at this part count (`phase-03-videos/TD-05`)
- expiry: presigned-part TTL on the order of **hours, not the 7-day maximum** — a 10GB transfer over a 10 Mbps link takes ≈2.2h (`phase-03-videos/TD-05`)

**Error responses:**
- 401: no/invalid token (inherited global guard)
- 400 validation error: when the request body fails schema validation
- 500 `CHANNEL_MISSING_FOR_USER`: the `sub` → `channel_id` lookup found no channel. Phase 02 creates the channel at signup with `cascade`, so this is a `500`-class invariant violation, **not** a user-facing `400` (`video-authorization-and-metadata/TD-02`)

_Note: the part `PUT`s themselves go straight to storage and are unauthenticated by construction — no guard can change that; authenticating **initiate** is what scopes the grant (`video-authorization-and-metadata/TD-01`, `phase-03-videos/TD-05`)._

---

#### POST /videos/{videoId}/uploads/complete

The API calls `CompleteMultipartUpload` (it needs the ETag list) and, in the same operation, flips the row to `processing` and publishes the job — so the API stays the single place that publishes. Preferred over a MinIO bucket notification, which would add a second, differently-authenticated ingress path for information the API already has (`phase-03-videos/TD-05`).

**Request headers:**
- Content-Type: application/json
- Authorization: Bearer {access token} — authenticated + owner (`video-authorization-and-metadata/TD-01`, `video-authorization-and-metadata/TD-02`)

**Request body:**
- part ETag list: array, required — one entry per uploaded part; the API needs it to call `CompleteMultipartUpload` (`phase-03-videos/TD-05`)

**Response 200:**
- publicId: string
- status: `processing` (`phase-03-videos/TD-12`)

**Error responses:**
- 401: no/invalid token
- 404 `VIDEO_NOT_FOUND`: unknown `videoId`, or the caller is not the owner — `404`, never `403`, so the route is not an existence oracle (`video-authorization-and-metadata/TD-03`)
- 409 `INVALID_VIDEO_STATE`: the video is not in `draft`. The transition is guarded — `complete` only accepts a video in `draft` — which is also what makes the job idempotent (`phase-03-videos/TD-12`, `phase-03-videos/TD-14`)
- 400 validation error: when the ETag list fails schema validation

---

#### DELETE /videos/{videoId}/uploads

Explicit cancel for the owner: aborts the multipart upload, reclaiming the accumulated parts — which is the costly part (`phase-03-videos/TD-15`). Path shape is not fixed by the TD (it fixes "an explicit cancel operation for the owner"); the role → auth mapping is binding.

**Request headers:**
- Authorization: Bearer {access token} — authenticated + owner

**Response 204:** No content.

**Error responses:**
- 401: no/invalid token
- 404 `VIDEO_NOT_FOUND`: unknown `videoId` or caller is not the owner
- 409 `INVALID_VIDEO_STATE`: the video is not in `draft` (there is no multipart upload to abort)

---

#### POST /videos/{videoId}/reprocess

Explicit re-enqueue path, **guarded to videos in `error`** — deliberately not an automatic retry loop — so a fixed environment can recover a video without a new upload (`phase-03-videos/TD-13`). Path shape is not fixed by the TD.

**Request headers:**
- Authorization: Bearer {access token} — authenticated + owner

**Response 200:**
- publicId: string
- status: `processing`

**Error responses:**
- 401: no/invalid token
- 404 `VIDEO_NOT_FOUND`: unknown `videoId` or caller is not the owner
- 409 `INVALID_VIDEO_STATE`: the video is not in `error`

---

#### GET /videos/{videoId}

Owner view — the status/progress poll. Returns the row in **any** state, including `error` with its persisted failure reason, which is what makes a failed upload diagnosable by its owner rather than silently absent (`video-authorization-and-metadata/TD-01`, `video-authorization-and-metadata/TD-03`).

**Request headers:**
- Authorization: Bearer {access token} — authenticated + owner

**Response 200:**
- publicId: string
- status: `draft` | `processing` | `ready` | `error`
- failure reason: string | null — populated when `status = error` (`phase-03-videos/TD-13`)
- duration_seconds, width, height, video_codec, audio_codec, container_format, bitrate_bps, size_bytes — null until the worker fills them (`video-authorization-and-metadata/TD-04`)

**Error responses:**
- 401: no/invalid token
- 404 `VIDEO_NOT_FOUND`: unknown `videoId` or caller is not the owner

---

#### GET /videos/{publicId}

`@Public()` — public metadata. Filters on `status = 'ready'` **in the same query that resolves `publicId`** — one query, not a fetch-then-check, so there is no window where the check and the read disagree (`video-authorization-and-metadata/TD-03`).

**Response 200:**
- publicId: string
- duration_seconds, width, height, video_codec, audio_codec, container_format, bitrate_bps, size_bytes (`video-authorization-and-metadata/TD-04`)
- _(`status` is `ready` by construction on this route)_

**Error responses:**
- 404 `VIDEO_NOT_FOUND`: unknown `publicId` **or** a video that is not `ready`. `404`, not `403` — a `403` confirms the video exists, which is the leak Fase 04's `unlisted` rule must not have; starting with `404` means that rule arrives as a tightening rather than a correction (`video-authorization-and-metadata/TD-03`)

---

#### GET /videos/{publicId}/stream

`@Public()` — `302` to a short-lived presigned URL. Keeps the API out of the data path (consistent with the phase's thesis on the upload side) and gets correct `Range`/`206` semantics from the storage server for free instead of hand-rolling partial-content handling; it also matches the architecture diagram's explicit `frontend → storage "Streams"` edge (`phase-03-videos/TD-11`).

**Response 302:**
- Location: presigned `GET` URL for `storage_key`, TTL in **minutes, not hours** (`phase-03-videos/TD-11`)

**Error responses:**
- 404 `VIDEO_NOT_FOUND`: unknown `publicId` or the video is not `ready` — same single-query `ready` filter as the metadata route (`video-authorization-and-metadata/TD-03`)

_The stable API route is the entry point precisely so authorization stays server-side and Fase 04/05 can tighten it without changing the client contract. What is given up versus proxying is per-range authorization — acceptable in this phase, where video viewing is anonymous by design, and revisitable in Fase 04 when unlisted/private visibility arrives (`phase-03-videos/TD-11`)._

---

#### GET /videos/{publicId}/download

`@Public()` — `302` with `content-disposition`. The **same object** serves both streaming and download; the difference is `response-content-disposition` on the presigned URL (`phase-03-videos/TD-11`).

**Response 302:**
- Location: presigned `GET` URL for `storage_key` carrying `response-content-disposition`, TTL in minutes

**Error responses:**
- 404 `VIDEO_NOT_FOUND`: unknown `publicId` or the video is not `ready`

---

#### GET /videos/{publicId}/thumbnail

`@Public()` — `302` to a short-lived presigned URL, the same delivery idiom as `/stream` and `/download` applied to a second object kind, so the phase ships **one** delivery idiom rather than two (`thumbnail-delivery/TD-01`).

**Response 302:**
- Location: presigned `GET` URL for `thumbnail_key` with **`response-content-type: image/jpeg`** set at signing time — `ResponseContentType`/`ResponseContentDisposition` map to signed query parameters, so the served content type is pinned regardless of what the worker set on the object, and the browser renders inline instead of downloading (`thumbnail-delivery/TD-01`)
- Cache-Control on the `302` itself, so a repeat view inside the window skips the round trip. Do **not** attempt to make the image itself cacheable under this option — the signature rotates per request, so the browser cache key never repeats (`thumbnail-delivery/TD-01`)
- TTL in minutes, matching `phase-03-videos/TD-11`; `getSignedUrl`'s default of 900s is already in that range, so an explicit value is a documented choice rather than a correction

**Error responses:**
- 404 `VIDEO_NOT_FOUND`: unknown `publicId` or the video is not `ready`. This route inherits `video-authorization-and-metadata/TD-03`'s `ready`-only rule **verbatim** — load-bearing, not boilerplate: a thumbnail route that resolved videos the stream route refuses would become an existence oracle (`thumbnail-delivery/TD-01`)

#### Validation Rules — video upload endpoints

- declared content type (initiate): required — the object extension derives from it, so an absent or unparseable value has no fallback (`phase-03-videos/TD-03`)
- total size in bytes (initiate): required, positive integer — presigned part count is computed from it against the 64 MiB part size (`phase-03-videos/TD-05`)
- part ETag list (complete): required, non-empty array — the API cannot call `CompleteMultipartUpload` without it (`phase-03-videos/TD-05`)
- `publicId` / `videoId` path parameters: required; a malformed value resolves to no row and therefore answers `404 VIDEO_NOT_FOUND`, never a validation `400` that would distinguish "malformed" from "unknown" (`video-authorization-and-metadata/TD-03`)

### Authorization Matrix

Roles map per `video-authorization-and-metadata/TD-01`. The matrix maps by **role**, not by literal path — this table is the binding artifact when a path shape has to be disambiguated at implementation (see the Routing note in `### API Contracts`). "Owner" is resolved against `videos.channel_id`, itself resolved from the JWT `sub` at initiate (`video-authorization-and-metadata/TD-02`); ownership lives in the `videos` row and nowhere else — `phase-03-videos/TD-03` explicitly rejected embedding the owner in the object key.

| Endpoint | Anonymous | Authenticated (non-owner) | Owner |
|----------|-----------|---------------------------|-------|
| `POST /videos/uploads` (initiate) | ✗ 401 | ✓ (becomes the owner) | ✓ |
| `POST /videos/{videoId}/uploads/complete` | ✗ 401 | ✗ 404 | ✓ |
| `DELETE /videos/{videoId}/uploads` (cancel) | ✗ 401 | ✗ 404 | ✓ |
| `POST /videos/{videoId}/reprocess` | ✗ 401 | ✗ 404 | ✓ |
| `GET /videos/{videoId}` (owner view, any state) | ✗ 401 | ✗ 404 | ✓ |
| `GET /videos/{publicId}` (public metadata) | ✓ `@Public()` — `ready` only | ✓ `ready` only | ✓ `ready` only |
| `GET /videos/{publicId}/stream` | ✓ `@Public()` — `ready` only | ✓ `ready` only | ✓ `ready` only |
| `GET /videos/{publicId}/download` | ✓ `@Public()` — `ready` only | ✓ `ready` only | ✓ `ready` only |
| `GET /videos/{publicId}/thumbnail` | ✓ `@Public()` — `ready` only | ✓ `ready` only | ✓ `ready` only |

Notes that the table cannot carry:

- The global guard from phase 02 is left **exactly as built** — no new guard class, no `@OptionalAuth()`, no second metadata key. `@Public()` is the sole opt-out, so every route added here is authenticated unless deliberately marked (`video-authorization-and-metadata/TD-01`).
- Non-owner access to an owner route answers **`404`, not `403`** — same anti-oracle reasoning as `video-authorization-and-metadata/TD-03`.
- The presigned part `PUT`s carry no guard by construction — they go straight to storage. The grant is scoped by authenticating **initiate** (`video-authorization-and-metadata/TD-01`).
- The presigned `GET` URLs handed out by `/stream`, `/download` and `/thumbnail` are bearer capabilities for their (minutes-long) TTL; per-range authorization is explicitly given up in this phase (`phase-03-videos/TD-11`).
- Rate limiting on initiate is inherited from the global `ThrottlerGuard` (`phase-02-auth/TD-08`); whether the video routes need a tighter bucket than the app default is an `/implement` concern, not a TD (`video-authorization-and-metadata/TD-01`).

### Error Catalog

Envelope: `{ statusCode, error, message }` with machine-readable domain codes, inherited from `phase-02-auth/TD-07` (`## Inherited Decisions Detail`) — this phase adds codes, it does not redefine the shape.

| errorCode | HTTP | Trigger |
|-----------|------|---------|
| `VIDEO_NOT_FOUND` | 404 | Unknown `publicId`/`videoId`; a public route resolving a video that is not `ready`; or an owner route reached by a non-owner. Always `404`, never `403` — a `403` confirms existence (`video-authorization-and-metadata/TD-03`) |
| `INVALID_VIDEO_STATE` | 409 | A guarded transition rejected: `complete` on a video not in `draft`, cancel on a video not in `draft`, or `reprocess` on a video not in `error` (`phase-03-videos/TD-12`, `phase-03-videos/TD-13`, `phase-03-videos/TD-14`) |
| `CHANNEL_MISSING_FOR_USER` | 500 | The initiate handler's `sub` → `channel_id` lookup found no channel. Phase 02 creates the channel at signup with `cascade`, so this is an invariant violation, not a user-facing `400` (`video-authorization-and-metadata/TD-02`) |
| validation error | 400 | Request body/params fail `class-validator` schema validation (`phase-02-auth/TD-06`) |
| — | 401 | No or invalid access token, from the inherited global guard (`phase-02-auth`) |

**Worker-side failures are not HTTP errors.** They are persisted on the row as `status = error` + `failure_reason` and read back through the owner route — that is what makes them diagnosable (`phase-03-videos/TD-13`, `video-authorization-and-metadata/TD-03`). The worker must **never** let a processing failure crash the process: the handler catches, records, and returns.

### Events/Messages

Queue technology: **BullMQ + Redis via `@nestjs/bullmq`** (`phase-03-videos/TD-04`). pg-boss was the more elegant fit on paper but is ESM-only against a CommonJS-end-to-end project; BullMQ is CommonJS, has an official NestJS 11 module, and provides worker concurrency and stalled-job recovery — the two properties that matter for CPU-heavy jobs consumed by a separate container. Redis is added as a Compose service (official image, Redis ≥ 6.2, `--maxmemory-policy noeviction`).

#### `video-processing`

**Payload:**

```json
{ "videoId": "uuid" }
```

The job carries only the `videoId`; the worker reads every other field from the `videos` row it shares with the API (`phase-03-videos/TD-06`).

**Producer:** the API's complete handler — the same operation that calls `CompleteMultipartUpload` and flips the row to `processing`, so the API remains the single place that publishes (`phase-03-videos/TD-05`, `phase-03-videos/TD-12`). Also produced by the guarded `reprocess` path (`phase-03-videos/TD-13`).
**Consumer:** the video worker — **same codebase, separate entrypoint, standalone Nest application context** (`phase-03-videos/TD-06`). It writes to the `videos` row **directly via TypeORM using the shared `Video` entity**, not through an internal HTTP API: an internal API would add a network hop, a second auth surface and a hard dependency on API availability, for no gain — both containers already legitimately reach `db`, and the architecture diagram states `worker → db "Updates"` explicitly.
**Trigger:** the multipart upload completed and the object exists in storage.
**Delivery semantics:** at-least-once, made safe by two layers (`phase-03-videos/TD-14`):
- **Deterministic `jobId` derived from `videoId`** — queue-level dedup, one line, eliminates the common duplicate (a client calling `complete` twice).
- **Atomic conditional status update** (`UPDATE ... WHERE status = 'processing'`), not read-then-write, so two workers cannot both proceed. This is the real safety net and is already implied by `phase-03-videos/TD-12`'s guarded transitions. Storage is idempotent too, because both keys derive from `videoId` (`phase-03-videos/TD-03`) — a re-run **overwrites** the thumbnail rather than duplicating it.

**Retry policy** (`phase-03-videos/TD-13`): `attempts: 3`, `backoff: { type: 'exponential', delay: 5000 }` for the transient class. On exhaustion the worker writes `status = error` **plus** the persisted failure reason and publishes to a consumer-less `video-processing-dlq` so nothing is lost silently. Layered on top: when `ffprobe` reports the input has **no decodable video stream**, treat it as permanent and go straight to `error` **without consuming the remaining attempts** — that is the exact case the smoke test exercises ("subir um arquivo não-vídeo e confirmar status `error` sem derrubar o worker"), and it is cheap to classify because it is ffprobe's own verdict rather than a guess about infrastructure.

**Job body** (what the consumer does, per `phase-03-videos/TD-06` → `TD-08` → `TD-07` → `TD-09` → `TD-12`):

1. **Download the source object to a temp file** (`phase-03-videos/TD-08`) — the only approach whose correctness does not depend on container-format layout or on FFmpeg's remote-seek behavior. The cost is bounded rather than avoided: worker **concurrency starts at 1** so peak scratch usage is one file, a dedicated temp volume is mounted for the worker, and cleanup always runs in a `finally`. (Streaming/remote-seek is the right later optimization and is a measurable question, not a design one.)
2. **`ffprobe -print_format json`** via `execFile` with an **argument array, never a shell string** (object keys derive from user input) and an **explicit timeout** so a pathological input cannot pin the worker forever (`phase-03-videos/TD-07`). `fluent-ffmpeg` is deprecated, which removes the only real reason to add an abstraction; `ffprobe`'s JSON output is a stable, documented, directly assertable contract. The binary comes from `apt-get install -y ffmpeg` in a worker image extending the existing `node:25.6.0-slim` base — out of `npm install` and out of the API image.
3. **`HeadObject`** for `size_bytes` — the storage object is authoritative, ffprobe's `format.size` serves only as a cross-check (`video-authorization-and-metadata/TD-04`).
4. **Extract exactly one thumbnail frame**: seek to `max(1s, duration * 0.10)`, `-frames:v 1`, output **JPEG**, `-vf scale=<W>:-2` so the aspect ratio is preserved and the height stays even (`phase-03-videos/TD-09`). Duration is already extracted in the same job, so seeking to ~10% costs nothing extra and avoids the black-opening-frame failure. Fase 04 owns custom thumbnails; this phase produces exactly one automatic default.
5. **Persist metadata + `thumbnail_key` + `status = ready` in one row-write boundary** — extraction shares the job and the write boundary with the metadata persist, so a failed extraction leaves the row in `error` and **never** in a partial `ready` state. This matters for the idempotency guard: a retried job must find the row in a state that permits a clean re-run, which a half-written `ready` would not be (`thumbnail-delivery/TD-02`, `phase-03-videos/TD-14`).

#### `video-processing-dlq`

**Payload:** the exhausted `video-processing` job.

**Producer:** the worker, on retry exhaustion (`phase-03-videos/TD-13`).
**Consumer:** **none** — deliberately consumer-less. BullMQ has no native DLQ; this is the small, explicit pattern that fills the gap so failures are retained rather than dropped (`phase-03-videos/TD-04`, `phase-03-videos/TD-13`).
**Trigger:** `attempts` exhausted on a transient-class failure.
**Delivery semantics:** best-effort retention.

#### Orphan-draft cleanup (scheduled)

**Trigger:** a cleanup routine wired **conservatively** on a schedule (`phase-03-videos/TD-15`).
**Producer/Consumer:** the worker runtime.
**Action:** for drafts older than a **generous 24h threshold** (comfortably exceeding any realistic 10GB transfer), **abort the multipart upload** using the `upload_id` persisted at initiate — that reclaims the accumulated storage, which is the costly part and the exact problem the project plan calls out.
**Row-deletion policy — deliberately conservative:** the routine aborts the multipart upload and **leaves the row** for Fase 04's panel to handle. That split is the safer reading of scope: Fase 04 owns draft management, this phase owns storage hygiene (`phase-03-videos/TD-15`).

---

<!-- phase-a-complete -->

## Dependency Map

```
SI-03.1 (root — MinIO + Redis no Compose)
├── SI-03.2 — depends on SI-03.1 (storage precisa existir para o cliente S3 ser testável)
│   └── (também alimenta SI-03.5 e SI-03.15)
└── SI-03.4 — depends on SI-03.1 (Redis precisa existir para a fila)
    ├── SI-03.6 — depends on SI-03.4 + SI-03.5 (fila e initiate antes de publicar o job)
    │   ├── SI-03.7 — depends on SI-03.6 (controller expõe initiate + complete)
    │   │   └── SI-03.16 — depends on SI-03.7 (cancelamento reusa o controller de upload)
    │   └── (também alimenta SI-03.11)
    └── SI-03.8 — depends on SI-03.4 (worker consome a fila registrada)
        └── SI-03.9 — depends on SI-03.8 (ffprobe roda dentro da imagem do worker)
            └── SI-03.10 — depends on SI-03.9 (a duração sondada define o seek da thumbnail)
                └── SI-03.11 — depends on SI-03.10 + SI-03.6 (pipeline completa + job publicado)
                    └── SI-03.12 — depends on SI-03.11 (falhas se penduram no processador)
                        └── SI-03.17 — depends on SI-03.12 + SI-03.14 (reprocessa o que falhou)

SI-03.3 (root — entidade Video + migration)
├── SI-03.5 — depends on SI-03.2 + SI-03.3 (chaves resolvidas + linha draft)
└── SI-03.13 — depends on SI-03.3 (leituras sobre a entidade)
    └── SI-03.14 — depends on SI-03.13 (controller expõe as leituras)
        └── SI-03.15 — depends on SI-03.14 + SI-03.2 (entrega presignada no mesmo controller)
```

Raízes independentes: **SI-03.1** (infraestrutura) e **SI-03.3** (schema) podem correr em paralelo. As duas cadeias só se encontram em **SI-03.5** (initiate precisa das chaves e da linha) e em **SI-03.11** (o processador precisa do job publicado por SI-03.6).

---

## Deliverables

- [x] SI-03.1 — Provisionar MinIO e Redis no Docker Compose
- [x] SI-03.2 — Configurar o cliente de object storage e o layout de chaves
- [x] SI-03.3 — Criar a entidade `Video` e sua migration
- [x] SI-03.4 — Configurar a fila `video-processing` (BullMQ + Redis)
- [x] SI-03.5 — Implementar o initiate do upload multipart (pré-cadastro do rascunho)
- [x] SI-03.6 — Implementar o complete do upload e a publicação do job
- [x] SI-03.7 — Expor os endpoints de upload (initiate e complete)
- [x] SI-03.8 — Provisionar a imagem e o entrypoint do worker
- [x] SI-03.9 — Implementar o download para arquivo temporário e a sonda `ffprobe`
- [x] SI-03.10 — Implementar a geração automática de thumbnail
- [x] SI-03.11 — Implementar o processador do job (persistência e transição para `ready`)
- [x] SI-03.12 — Implementar o tratamento de falhas do processamento
- [x] SI-03.13 — Implementar as leituras de vídeo (pública `ready`-only e do dono)
- [x] SI-03.14 — Expor os endpoints de leitura de vídeo
- [x] SI-03.15 — Implementar a entrega por redirect presignado (streaming, download e thumbnail)
- [x] SI-03.16 — Implementar o cancelamento de upload e a limpeza de rascunhos órfãos
- [x] SI-03.17 — Expor o reprocessamento guardado

**Full test suites:**

- [x] Backend tests pass (`docker compose exec nestjs-api npm test -- --runInBand`)
- [x] Integration tests pass (`docker compose exec nestjs-api npm run test:integration`)
- [x] E2E tests pass (`docker compose exec nestjs-api npm run test:e2e`)
- [x] Type/compilation checks pass (`docker compose exec nestjs-api npx tsc --noEmit`)
- [x] Lint passes (`docker compose exec nestjs-api npm run lint`)
- [x] `openapi.json` regenerado (`docker compose exec nestjs-api npm run openapi:export`) e commitado com os endpoints desta fase

_Todos os comandos `npm`/`npx` rodam **dentro do container**, nunca no host — rodar no host causa divergência de env vars (`DB_HOST` resolvendo para `localhost`) e usa outra versão do Node (`nestjs-project/CLAUDE.md` § Commands). As suítes de integração e e2e compartilham um único banco de teste e exigem `--runInBand`._
