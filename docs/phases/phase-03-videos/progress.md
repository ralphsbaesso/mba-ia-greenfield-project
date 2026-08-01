# phase-03-videos — Progress

**Status:** in_progress
**SIs:** 1/17 completed

### SI-03.1 — Provisionar MinIO e Redis no Docker Compose
- **Status:** completed
- **Tests:** no tests (Infra)
- **Observations:**
  - O bucket é criado por um serviço one-shot `minio-init` que **reusa a imagem pinada do MinIO** (ela já embarca o `mc`) em vez de introduzir um segundo tag `minio/mc` a versionar — mantém uma única tag MinIO a sincronizar.
  - As novas variáveis (`STORAGE_*`, `REDIS_*`) foram acrescentadas também ao `.env` local (gitignored), não só ao `.env.example` — sem isso o ambiente sobe mas o app não resolve as variáveis. A action pedia apenas o `.env.example`.
  - O alias `local` que vem embutido no container do MinIO é **sem credenciais** (serve só ao healthcheck `mc ready local`); qualquer leitura/escrita via `mc` exige `mc alias set st http://localhost:9000 ...` antes. Documentado no `nestjs-project/CLAUDE.md`.
  - Preflight: a árvore de trabalho tem dois arquivos untracked na raiz do repo (`PASSO-A-PASSO-FASE-03.md`, `step1.txt`), fora de `nestjs-project/`. Não foram tocados por este SI.

### SI-03.2 — Configurar o cliente de object storage e o layout de chaves
- **Status:** pending
- **Tests:** —
- **Observations:** none

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
