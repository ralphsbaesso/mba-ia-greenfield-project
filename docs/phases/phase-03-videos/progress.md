# phase-03-videos — Progress

**Status:** in_progress
**SIs:** 2/17 completed

### SI-03.1 — Provisionar MinIO e Redis no Docker Compose
- **Status:** completed
- **Tests:** no tests (Infra)
- **Observations:**
  - O bucket é criado por um serviço one-shot `minio-init` que **reusa a imagem pinada do MinIO** (ela já embarca o `mc`) em vez de introduzir um segundo tag `minio/mc` a versionar — mantém uma única tag MinIO a sincronizar.
  - As novas variáveis (`STORAGE_*`, `REDIS_*`) foram acrescentadas também ao `.env` local (gitignored), não só ao `.env.example` — sem isso o ambiente sobe mas o app não resolve as variáveis. A action pedia apenas o `.env.example`.
  - O alias `local` que vem embutido no container do MinIO é **sem credenciais** (serve só ao healthcheck `mc ready local`); qualquer leitura/escrita via `mc` exige `mc alias set st http://localhost:9000 ...` antes. Documentado no `nestjs-project/CLAUDE.md`.
  - Preflight: a árvore de trabalho tem dois arquivos untracked na raiz do repo (`PASSO-A-PASSO-FASE-03.md`, `step1.txt`), fora de `nestjs-project/`. Não foram tocados por este SI.

### SI-03.2 — Configurar o cliente de object storage e o layout de chaves
- **Status:** completed
- **Tests:** 16 passing (7 unit + 8 integration + 1 module compilation)
- **Observations:**
  - `@aws-sdk/client-s3` e `@aws-sdk/s3-request-presigner` instalados em `3.1101.0`; o `library-refs.md` pesquisou `3.1097.0`. Mesmo range `^3` pedido pelo plano, sem mudança de superfície de API entre as duas.
  - `STORAGE_ACCESS_KEY` / `STORAGE_SECRET_KEY` / `STORAGE_BUCKET` entraram no Joi como `required()` (espelhando o padrão `DB_USERNAME`/`DB_PASSWORD`/`DB_NAME`); `STORAGE_ENDPOINT` e `STORAGE_REGION` têm default. Isso obrigou a estender o fixture `requiredEnv` em `src/config/env.validation.integration-spec.ts` — arquivo de teste existente, fora da Tests table deste SI, mas a alteração é consequência direta da action 1 ("estender o schema Joi"). Suite continua verde (4/4).
  - O `StorageService` expõe `putObject` / `headObject` / `getObject` além das 5 technical actions, porque a própria Tests row de integração deste SI exige "put/head/get de um objeto". Os comandos de multipart (`CreateMultipartUpload`, `CompleteMultipartUpload`, `AbortMultipartUpload`) foram deliberadamente deixados para SI-03.5 / SI-03.6 / SI-03.16.
  - Content type não suportado no `resolveVideoKey` lança um `Error` simples, não uma `DomainException`: o Error Catalog da fase não tem código para isso e a Validation Rule trata como `400` de validação — quem devolve o 400 é o DTO do initiate, via a allow-list exportada `SUPPORTED_VIDEO_CONTENT_TYPES` em `src/storage/storage.constants.ts`. Chegar no serviço com um tipo inválido é violação de invariante.
  - Fora de escopo (não tocado): `nestjs-project/.env.example` não lista `APP_URL` nem `SWAGGER_ENABLED`, apesar de o schema Joi conhecer ambos.

### SI-03.3 — Criar a entidade `Video` e sua migration
- **Status:** pending
- **Tests:** —
- **Observations:** none

### SI-03.4 — Configurar a fila `video-processing` (BullMQ + Redis)
- **Status:** pending
- **Tests:** —
- **Observations:** none

### SI-03.5 — Implementar o initiate do upload multipart (pré-cadastro do rascunho)
- **Status:** pending
- **Tests:** —
- **Observations:** none

### SI-03.6 — Implementar o complete do upload e a publicação do job
- **Status:** pending
- **Tests:** —
- **Observations:** none

### SI-03.7 — Expor os endpoints de upload (initiate e complete)
- **Status:** pending
- **Tests:** —
- **Observations:** none

### SI-03.8 — Provisionar a imagem e o entrypoint do worker
- **Status:** pending
- **Tests:** —
- **Observations:** none

### SI-03.9 — Implementar o download para arquivo temporário e a sonda `ffprobe`
- **Status:** pending
- **Tests:** —
- **Observations:** none

### SI-03.10 — Implementar a geração automática de thumbnail
- **Status:** pending
- **Tests:** —
- **Observations:** none

### SI-03.11 — Implementar o processador do job (persistência e transição para `ready`)
- **Status:** pending
- **Tests:** —
- **Observations:** none

### SI-03.12 — Implementar o tratamento de falhas do processamento
- **Status:** pending
- **Tests:** —
- **Observations:** none

### SI-03.13 — Implementar as leituras de vídeo (pública `ready`-only e do dono)
- **Status:** pending
- **Tests:** —
- **Observations:** none

### SI-03.14 — Expor os endpoints de leitura de vídeo
- **Status:** pending
- **Tests:** —
- **Observations:** none

### SI-03.15 — Implementar a entrega por redirect presignado (streaming, download e thumbnail)
- **Status:** pending
- **Tests:** —
- **Observations:** none

### SI-03.16 — Implementar o cancelamento de upload e a limpeza de rascunhos órfãos
- **Status:** pending
- **Tests:** —
- **Observations:** none

### SI-03.17 — Expor o reprocessamento guardado
- **Status:** pending
- **Tests:** —
- **Observations:** none
