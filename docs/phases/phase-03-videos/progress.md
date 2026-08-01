# phase-03-videos — Progress

**Status:** in_progress
**SIs:** 9/17 completed

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
- **Status:** completed
- **Tests:** 12 passing em `test/videos-uploads.e2e-spec.ts` (5 do initiate + 4 do complete + 3 do contrato OpenAPI), cobrindo os 6 cenários do `specs/videos-uploads.plan.md`
- **Observations:**
  - O campo do corpo do initiate ficou **`sizeBytes`**, não `totalSizeBytes`: é o nome literal que o test spec usa (`{ contentType: 'video/mp4', sizeBytes: ... }`), e o `### API Contracts` só descreve o campo em prosa ("total size in bytes"). O controller mapeia `sizeBytes` → `totalSizeBytes` na chamada do serviço; o nome interno não mudou.
  - A allow-list de content type do DTO é a própria `SUPPORTED_VIDEO_CONTENT_TYPES` de `storage.constants.ts` (`@IsIn`), que deriva do mapa de extensões. Um tipo fora dela devolve `400` no DTO e nunca alcança o `resolveVideoKey`, que trataria isso como violação de invariante.
  - Nenhum guard novo, nenhuma metadata nova: o guard global da fase 02 cobre os dois endpoints e nada foi marcado `@Public()`. A checagem de dono já tinha entrado no serviço em SI-03.6 — aqui ela só é exposta, e o teste confirma que a resposta ao não-dono é **idêntica byte a byte** à de um `videoId` inexistente (`expect(nonOwner.body).toEqual(unknown.body)`).
  - **Desvio do test spec (cenário 1.1):** o expect "nenhum multipart upload aberto no bucket" não foi implementado. Exigiria expor `ListMultipartUploads` no `StorageService` (superfície que pertence a SI-03.16) e, pior, seria uma asserção sem sentido em bucket compartilhado — as suítes de SI-03.5/03.6 deixam multiparts órfãos ali. O que garante o mesmo é a asserção de que nenhuma linha nasce: initiate abre o multipart e grava a linha na mesma operação, então "sem linha" implica "sem multipart deste teste".
  - **Desvio do test spec (cenário 1.2):** o expect "o `id` interno não aparece em nenhum outro campo do payload além de `videoId`" foi implementado como asserção exata do conjunto de chaves do corpo. A leitura literal é impossível de satisfazer: as URLs presignadas **contêm** a chave do objeto, que por TD-03 deriva do `id`. Não é vazamento — o dono já recebe o `videoId` no mesmo payload —, mas a asserção literal falharia sempre.
  - **Achado pré-existente, fora de escopo:** o `openapi.json` exportado traz `properties: {}` para **todo** DTO de request — `InitiateUploadDto` e `CompleteUploadDto`, mas também `RegisterDto` e `LoginDto` da fase 02. O plugin CLI do `@nestjs/swagger` é um transformer de `tsc`, e tanto `openapi:export` (ts-node) quanto os testes (ts-jest) rodam sem ele; só `nest build` o aplica. O contrato que o frontend consome está, hoje, sem os schemas de corpo de requisição em todos os endpoints. A asserção do e2e verifica o que é verdade (o `requestBody` existe e referencia o schema do DTO) em vez de afirmar propriedades que o documento não tem. Correção pertence a uma task própria (gerar o `metadata.ts` de verdade com o `PluginMetadataGenerator`, ou exportar a partir do `dist/`).
  - `openapi.json` foi regenerado (`npm run openapi:export`) e agora descreve os dois endpoints: respostas tipadas por status (`201/400/401/500` e `200/400/401/404/409`), todas as de erro apontando para `ApiErrorEnvelope`, e `videoId` documentado como path param `uuid`.

### SI-03.8 — Provisionar a imagem e o entrypoint do worker
- **Status:** completed
- **Tests:** 1 passing (compilation test do `VideoProcessingModule`, que sobe o contexto raiz do worker contra Postgres e Redis reais)
- **Observations:**
  - **Bug real pego ao bootar o entrypoint à mão:** `autoLoadEntities: true` não funciona no worker. Ele só registra entidades de módulos que chamam `forFeature`, e o worker importa apenas `VideosModule` — mas o TypeORM constrói metadata sobre o **fecho de relações** (`Video` → `Channel` → `User`), então o boot morria com `Entity metadata for Video#channel was not found`. Trocado por uma lista explícita `WORKER_ENTITIES = [User, Channel, Video]`, que é preferível a importar `ChannelsModule`/`UsersModule` (serviços que o worker não usa) só para satisfazer o autoload.
  - O container do worker **não roda o processo do worker automaticamente** (`CMD tail -f /dev/null`, igual ao `nestjs-api`), e isso é deliberado por dois motivos: mantém a convenção documentada de que `docker compose up -d` sobe infra e não processos de aplicação; e, principalmente, **um worker vivo consumiria a fila durante os testes** — as suítes de SI-03.6 e do e2e de SI-03.7 asseveram `getWaitingCount()`. Scripts `start:worker` / `start:worker:dev` / `start:worker:prod` adicionados ao `package.json`, e o aviso está no `nestjs-project/CLAUDE.md`.
  - Os 4 acceptance criteria foram verificados à mão no ambiente: container `Up` sem nenhuma porta publicada; `ffmpeg 5.1.9` e `ffprobe 5.1.9` respondem no worker; `command -v ffprobe`/`ffmpeg` **não** acham nada no container da API; `getent hosts db redis minio` resolve os três pelo nome de serviço; e o `src/worker.ts` sobe o contexto standalone (`TypeOrmCoreModule`, `BullModule`, `StorageModule` inicializados, nenhum servidor HTTP) e permanece vivo.
  - O volume `worker-tmp` é montado em `/var/tmp/streamtube`. O `mkdir` + `chown node:node` acontece **no Dockerfile, antes do `USER node`** — um named volume herda a ownership do diretório da imagem que ele cobre, e sem isso o volume nasceria de `root` e o worker (que roda como `node`) não escreveria nele. Verificado com `touch` dentro do container.
  - `WORKER_TMP_DIR=/var/tmp/streamtube` foi declarado no serviço do Compose, mas **ainda não é lido por código nenhum** — quem vai consumir é o `source-file.service.ts` de SI-03.9. Não entrou no schema Joi de propósito: o worker precisa dela, a API não, e torná-la `required()` quebraria o boot da API.
  - Action 4 (assets não-TypeScript no `nest-cli.json`) ficou sem mudança: o worker não usa nenhum asset em runtime — os únicos declarados são os templates `.hbs` do mail, que são exclusivos da API.
  - O teste ficou como `video-processing.module.spec.ts` (nome do plano) mesmo abrindo conexão real com o banco, o que a "Test Type Selection" do `nestjs-project/CLAUDE.md` normalmente mandaria para `.integration-spec.ts`. É a convenção já estabelecida no projeto para **compilation tests de módulo** — `videos.module.spec.ts` e `video-queue.module.spec.ts` fazem o mesmo.

### SI-03.9 — Implementar o download para arquivo temporário e a sonda `ffprobe`
- **Status:** completed
- **Tests:** 25 passing (13 unit do mapeamento + 7 integration com `ffprobe` real + 7 integration do `SourceFileService` contra MinIO real) — rodados **dentro do container `video-worker`**
- **Observations:**
  - **Os testes de `ffprobe` só passam no container `video-worker`.** O binário existe só naquela imagem, por decisão de SI-03.8. Consequência para a verificação final da fase: **a suíte completa deve rodar no `video-worker`**, que monta o mesmo código e lê o mesmo `.env` — rodar no `nestjs-api` quebra o `ffprobe.service.integration-spec.ts`. Documentado no `nestjs-project/CLAUDE.md`.
  - **Wart corrigido durante a implementação:** o `catch` do `execFile` classificava *qualquer* falha como `NoDecodableVideoStreamError`, o que inclui o `ENOENT` de binário ausente. Numa imagem de worker mal configurada isso marcaria **todo** vídeo como permanentemente falho (`status = error`, sem retry) — o sintoma mais barulhento possível reportado como o mais silencioso. Agora `ENOENT` vira erro comum (classe transitória, com retry), e há teste com uma subclasse que aponta para um binário inexistente.
  - Três classes de falha ficam distintas para SI-03.12 escolher a política: `FfprobeTimeoutError` (o kill do timeout), `NoDecodableVideoStreamError` (veredito do próprio ffprobe sobre o input — permanente) e `Error` comum (infraestrutura, transitória).
  - `SourceFileService.withDownloadedObject(key, use)` é **callback-form de propósito**: torna "a limpeza sempre roda" uma propriedade da API, não de cada chamador lembrar do `finally`. O `rm` usa `force: true` para que um download que falhou antes de criar o arquivo não vire um segundo erro na saída.
  - `VideoProbe` **não tem campo de tamanho**. Em vez de expor `format.size` do ffprobe "só para conferência", a forma do tipo torna a confusão impossível: `size_bytes` só pode vir de `SourceFileService.sizeOf()`, que lê o `ContentLength` do objeto (`video-authorization-and-metadata/TD-04`).
  - `WORKER_TMP_DIR` agora é lido por `src/config/worker.config.ts`, com default `os.tmpdir()` — assim API e containers de teste, que não montam o volume `worker-tmp`, continuam funcionando. Continua fora do Joi pelo mesmo motivo de SI-03.8.
  - Action 2 (concorrência 1) entrou como a constante `VIDEO_PROCESSING_CONCURRENCY = 1`, ainda **não aplicada** — quem a consome é o `@Processor` de SI-03.11. O valor coincide com o default do BullMQ, então o comportamento efetivo já está certo; a constante existe para que aumentar isso seja decisão e não acidente.
  - Fixtures de vídeo commitadas em `test/fixtures/` (2s, 320x240, h264): `sample-with-audio.mp4` (46KB, aac), `sample-no-audio.mp4` (28KB) e `not-a-video.txt`. Geradas com os geradores `testsrc`/`sine` do próprio ffmpeg do worker — determinísticas e pequenas.
  - O AC "tamanho registrado é o do storage mesmo quando o ffprobe diverge" foi testado pela via estrutural (o probe não carrega tamanho + `sizeOf` lê do objeto) mais um teste com arquivo local divergente no mesmo diretório de scratch, em vez de forjar um arquivo cujo header mente sobre o tamanho.

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
