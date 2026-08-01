# phase-03-videos — Progress

**Status:** in_progress
**SIs:** 6/17 completed

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
- **Status:** completed
- **Tests:** 26 passing (5 unit `public_id` + 18 integration da entidade + 1 module compilation + 2 do spec de migrations, atualizado)
- **Observations:**
  - As duas `CHECK` state-scoped foram declaradas com o decorator `@Check()` na entidade, e não escritas à mão na migration — assim o `migration:generate` as emite sozinho e entidade e schema não podem divergir. A migration foi gerada pelo CLI (regra `typeorm-migrations.md`), só formatada com Prettier depois.
  - `public_id` = `randomBytes(9).toString('base64url')` → 12 chars fixos, 72 bits de entropia, sem padding e URL-safe. `crypto` nativo, sem `nanoid` (TD-10).
  - `numeric(10,3)` e `bigint` voltam do Postgres como **string**. As colunas `duration_seconds`, `bitrate_bps` e `size_bytes` receberam um transformer que devolve `number` na leitura — o tipo da coluna continua exato no banco, e worker/payloads recebem número. Seguro nesta faixa: o teto de 10GB (≈1.07e10) fica muito abaixo de `Number.MAX_SAFE_INTEGER`. O plano não decidia isso.
  - `created_at`/`updated_at` são `timestamptz` conforme o Data Model. As tabelas da fase 01/02 usam `TIMESTAMP` sem timezone (os `@CreateDateColumn()` de lá não declaram tipo) — divergência preexistente, não tocada.
  - Três arquivos existentes precisaram acompanhar, todos por consequência direta da nova tabela/FK: `src/database/migrations.integration-spec.ts` (registra a 3ª migration, a tabela `videos` e o novo enum type — sem isso o `DROP TABLE channels CASCADE` do `beforeAll` derrubaria a FK de `videos` e deixaria o banco compartilhado quebrado para as suítes seguintes); `src/test/create-test-data-source.ts` (`cleanAllTables` apaga `videos` antes de `channels`); e `src/channels/entities/channel.entity.ts` (lado `@OneToMany` da relação).
  - O segundo teste de `migrations.integration-spec.ts` mudou de alvo: a última migration agora é `CreateVideos`, então ele passou a asseverar a remoção de `videos` em vez das tabelas de token. Mesma intenção ("reverter a última migration remove as tabelas dela"), alvo novo.

### SI-03.4 — Configurar a fila `video-processing` (BullMQ + Redis)
- **Status:** completed
- **Tests:** 9 passing (1 module compilation + 4 integration contra Redis real + 4 do spec de env validation, atualizado)
- **Observations:**
  - `bullmq@5.81.3` e `@nestjs/bullmq@11.0.4` — batem com o que o `library-refs.md` pesquisou (5.81.2 / 11.0.4).
  - `BullModule.forRootAsync` (root, com `defaultJobOptions`) e os dois `registerQueue` moram juntos no `VideoQueueModule`, que exporta `BullModule`. Isso deixa o worker de SI-03.8 importar um módulo só, em vez de repetir o root em dois entrypoints.
  - `REDIS_HOST` e `REDIS_PORT` entraram no Joi como `required()` — é o que satisfaz o AC "falha o startup de forma explícita quando as variáveis de conexão estão ausentes". Verificado: sem elas o schema devolve `"REDIS_HOST" is required. "REDIS_PORT" is required`. Exigiu estender de novo o fixture `requiredEnv` de `src/config/env.validation.integration-spec.ts`.
  - A dedup por `jobId` determinístico (TD-14) já foi coberta por teste aqui, embora o produtor só chegue em SI-03.6 — o comportamento é da fila, não do produtor. **Atenção para SI-03.11/03.12:** o `library-refs.md` avisa que `removeOnComplete`/`removeOnFailed` quebram essa dedup; nenhuma das duas está habilitada no `defaultJobOptions` atual, e habilitar exige a segunda camada do TD-14 (update condicional atômico no banco).
  - AC de boot verificado à mão: `npm run start:dev` sobe com o Redis disponível (`Nest application successfully started`, `curl localhost:3000` → 200).

### SI-03.5 — Implementar o initiate do upload multipart (pré-cadastro do rascunho)
- **Status:** completed
- **Tests:** 19 passing (13 unit + 6 integration contra Postgres + MinIO reais)
- **Observations:**
  - O `id` do vídeo é gerado na aplicação com `randomUUID()`, não pelo banco. É obrigatório: a `storage_key` deriva do `id` (TD-03) e o multipart precisa ser aberto **antes** do INSERT para que o `upload_id` já nasça persistido na linha (TD-05, TD-15). Há um teste que trava essa ordem (`multipart` antes de `save`).
  - O lookup `sub` → `channel_id` virou `ChannelsService.findIdByUserId()`, e não uma query ao repositório de `channels` dentro do módulo de vídeos — SRP conforme o CLAUDE.md raiz ("extrair imediatamente para o módulo correto"). Método novo em módulo existente.
  - TTL das URLs de parte fixado em **6h** (`UPLOAD_PART_URL_TTL_SECONDS`). O plano só dizia "ordem de horas, não os 7 dias máximos"; 6h dá ~2.7x de folga sobre a estimativa de 2.2h para 10GB a 10 Mbps. Número escolhido aqui, não no plano.
  - **Lacuna deixada de propósito para SI-03.16:** se o INSERT da linha falhar depois de `CreateMultipartUpload` ter sucesso, o multipart fica órfão **sem linha** — e a rotina de limpeza de rascunhos de TD-15 encontra órfãos pelo `upload_id` da linha, então esse caso escaparia dela para sempre. Abortar o multipart no catch resolveria, mas `AbortMultipartUpload` pertence a SI-03.16; avaliar lá se vale cobrir este caminho.
  - Os testes de integração deixam multipart uploads incompletos no bucket de dev (sem o abort ainda implementado). Volume desprezível (partes de poucos bytes), mas some quando SI-03.16 entrar e o teardown puder abortar.

### SI-03.6 — Implementar o complete do upload e a publicação do job
- **Status:** completed
- **Tests:** 40 passing nos dois arquivos do SI (28 unit + 12 integration contra Postgres + MinIO + Redis reais) — 21 deles novos, 19 são os de SI-03.5 que continuam verdes
- **Observations:**
  - A transição é um **update condicional** (`UPDATE ... WHERE id = ? AND status = 'draft'`), não um read-then-write: o `findOne` que carrega a linha serve para resolver dono e chave, mas quem decide a corrida é o `affected` do update. `affected = 0` responde `INVALID_VIDEO_STATE`. É a primeira metade do TD-14 do lado do produtor; a segunda (guard atômico no worker) é SI-03.11.
  - Ordem fixada por teste: `CompleteMultipartUpload` → `UPDATE` → `queue.add`. O objeto precisa existir antes de a linha avançar (AC 4), e o job só é publicado depois de a linha estar em `processing` — publicar antes deixaria o worker encontrar a linha ainda em `draft` e o guard atômico dele descartaria o job.
  - **A checagem de dono entrou aqui, não em SI-03.7.** O plano lista a action de owner em SI-03.7, mas o controller não tem acesso a banco — a resolução `sub` → `channel_id` → linha escopada é a única query que existe. `VideoUploadsService.findOwnedVideo()` faz o lookup já escopado por `channel_id` e devolve `VIDEO_NOT_FOUND` para os três casos (id malformado, id desconhecido, vídeo de outro canal). SI-03.7 só precisa expor.
  - `isVideoId()` (novo em `src/videos/videos.id.ts`) rejeita um `videoId` fora do formato UUID **antes** da query. Sem isso o Postgres levantaria `invalid input syntax for type uuid` (500) onde `### API Contracts → Validation Rules` exige `404 VIDEO_NOT_FOUND` — a regra diz explicitamente que malformado não pode ser distinguido de desconhecido nem virar `400`.
  - Usuário autenticado sem canal responde `VIDEO_NOT_FOUND` no complete, e não `CHANNEL_MISSING_FOR_USER`: o Error Catalog amarra esse código ao handler do **initiate**. Sem canal não se é dono de nada, e o anti-oráculo manda responder como qualquer outra não-posse.
  - `StorageService.completeMultipartUpload()` **ordena as partes por `partNumber`** antes de montar o `MultipartUpload.Parts` — o S3 exige ordem ascendente e o cliente manda na ordem em que os PUTs terminaram. Coberto pelo teste de integração, que sobe a parte e completa com a lista vinda do cliente.
  - **Janela de falha conhecida, não coberta:** se o `queue.add` falhar (Redis fora) depois do update, a linha fica em `processing` sem job — e nada a recupera, porque o reprocess de SI-03.17 só aceita `error`. Não há compensação possível de verdade aqui: voltar para `draft` não ajuda, já que o multipart foi consumido e um segundo complete falharia com `NoSuchUpload`. Avaliar em SI-03.12/SI-03.17 se vale um caminho de recuperação para `processing` órfão.
  - `upload_id` é **mantido** na linha após o complete (não é limpo). A limpeza de TD-15 filtra por `status = 'draft'`, então um `upload_id` obsoleto numa linha `processing` não é alcançado por ela.
  - O `describe` externo do integration spec foi renomeado de `VideoUploadsService — initiate (integration)` para `VideoUploadsService (integration)`, para os testes de complete reusarem a mesma fixture (um DataSource e uma conexão Redis por arquivo, em vez de duas).

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
