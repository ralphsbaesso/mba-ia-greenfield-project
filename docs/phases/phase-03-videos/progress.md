# phase-03-videos — Progress

**Status:** completed
**SIs:** 17/17 completed

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
- **Status:** completed
- **Tests:** 15 passing (9 unit da política de seek + 6 integration com `ffmpeg` real e MinIO) — rodados no container `video-worker`
- **Observations:**
  - **Desvio consciente da fórmula do plano:** `max(1s, duration * 0.10)` é clampado para nunca passar do fim do arquivo (`min(preferido, duration - 0.1s)`). Sem o clamp, um clipe de menos de 1s buscaria além do EOF, o ffmpeg não decodificaria frame nenhum e o job inteiro falharia por causa de um input legítimo. Para tudo ≥ 1s a fórmula do plano vale sem alteração (vídeo de 5s → 1s, de 100s → 10s), e há teste para os dois lados.
  - Largura da thumbnail fixada em **640px** (`THUMBNAIL_WIDTH`). O plano fixa a expressão `scale=<W>:-2`, não o valor de `W`; o número foi escolhido aqui. O `-2` é o que preserva o aspect ratio e mantém a altura par — verificado no teste: o fixture 320x240 vira 640x480 exatos.
  - O AC "exatamente uma imagem JPEG" foi verificado por três vias em vez de listar o bucket (o `StorageService` não expõe `ListObjects`, e essa superfície não pertence a este SI): a chave é derivada do `id` (então só pode existir uma), os magic bytes do objeto são `FF D8 FF`, e o `ffprobe` sobre o objeto baixado reporta `mjpeg` — um único frame.
  - O AC de sobrescrita é testado plantando um **decoy** na chave exata antes de gerar: se a extração acrescentasse em vez de sobrescrever, o conteúdo velho sobreviveria. Depois roda duas vezes e confere que ambas devolvem a mesma chave.
  - Mesmo tratamento de `ENOENT` do SI-03.9: binário ausente vira erro comum, não `ThumbnailExtractionError`. Uma imagem de worker quebrada não pode se disfarçar de "vídeo ruim".
  - O `-ss` vai **antes** do `-i` de propósito (input seeking): o ffmpeg salta no arquivo em vez de decodificar tudo até a marca, o que num vídeo longo é a diferença entre milissegundos e minutos.
  - O `ThumbnailService` ainda não é chamado por ninguém — quem costura sonda + thumbnail + persistência é o processador de SI-03.11.

### SI-03.11 — Implementar o processador do job (persistência e transição para `ready`)
- **Status:** completed
- **Tests:** 22 passing (13 unit com deps mockadas + 9 integration contra Postgres + MinIO + Redis reais) — rodados no container `video-worker`
- **Observations:**
  - O `UPDATE` guardado por `WHERE status = 'processing'` **é** a fronteira de escrita única: metadados, `thumbnail_key` e a transição para `ready` saem num único statement. Um `ready` parcial é justamente o estado que quebraria o re-run limpo de um job repetido, e aqui ele é impossível por construção, não por convenção.
  - A idempotência tem duas camadas verificadas: o `findOne` escopado em `processing` faz uma segunda entrega virar no-op (`updated_at` não se move — teste explícito), e as duas chaves de storage derivam do `id`, então um re-run sobrescreve em vez de duplicar.
  - Uma linha que não está em `processing` (rascunho, já `ready`, ou inexistente) faz o job **terminar com sucesso**, não falhar. Falhar geraria retry e DLQ para uma situação que é normal — entrega duplicada é esperada em at-least-once.
  - O teste de integração sobe o **contexto raiz do worker de verdade** (`VideoProcessingModule` + `module.init()`), o que liga o worker BullMQ real; um dos testes publica na fila e espera a linha virar `ready` sem chamar o processor diretamente. Precisou de `init()` explícito: `compile()` sozinho não roda os lifecycle hooks e o worker nunca começaria a consumir. `afterAll` fecha o contexto — verificado que o jest sai limpo, sem reclamação de open handles (AC 5).
  - Falha em qualquer etapa (probe, thumbnail) **propaga** e não escreve nada na linha. É de propósito: quem traduz a exceção em `status = error` + `failure_reason` e decide retry vs. fail-fast é SI-03.12.
  - `VIDEO_PROCESSING_CONCURRENCY = 1` (declarada em SI-03.9) passou a ser aplicada de fato, no `@Processor(..., { concurrency })`.
  - O `VideoProcessingProcessor` só é registrado no `VideoProcessingModule`, que só o worker importa — a API nunca instancia um consumidor, então subir a API não consome fila.

### SI-03.12 — Implementar o tratamento de falhas do processamento
- **Status:** completed
- **Tests:** 44 passing (22 unit de classificação + handler, 13 unit do caminho feliz reexecutados, 9 integration contra Postgres + MinIO + Redis reais) — rodados no container `video-worker`
- **Observations:**
  - A classificação é deliberadamente **assimétrica**: permanente é só o veredito do próprio `ffprobe` (`NoDecodableVideoStreamError`); timeout de probe, falha de storage e binário ausente são todos transitórios. Chutar que uma falha de infra é permanente deixaria um vídeo bom parado para sempre — o custo do erro nas duas direções não é o mesmo.
  - O fail-fast usa `UnrecoverableError` do próprio BullMQ, não um `return`. Retornar marcaria o job como `completed` enquanto o vídeo está em `error`, e a fila mentiria sobre o que aconteceu.
  - `isLastAttempt` espelha a condição interna do BullMQ (`attemptsMade + 1 >= opts.attempts`). Verificado na fonte instalada (bullmq 5.81.3): dentro do handler `attemptsMade` conta as tentativas **já finalizadas** (0 na primeira execução) — o incremento do `moveToActive` cai em `attemptsStarted` (`ats`), campo diferente. Ler o campo errado teria declarado exaustão uma tentativa cedo demais.
  - A gravação de `error` + `failure_reason` também é guardada por `WHERE status = 'processing'`, pelo mesmo motivo da transição para `ready`: a falha de um job que não é mais dono da linha não pode sobrescrevê-la.
  - Enquanto restam tentativas, **nada é escrito** — a linha fica em `processing` para o retry encontrar um estado que permite re-run limpo. A linha só vira `error` no fail-fast ou na exaustão.
  - Publicação na DLQ **sem `jobId` determinístico**, ao contrário da fila principal. A DLQ não tem consumidor, então um id reusado descartaria silenciosamente a segunda falha de um vídeo reprocessado (SI-03.17) — aqui retenção vale mais que dedup.
  - Ordem deliberada na exaustão: grava a linha **antes** de publicar na DLQ (teste explícito com `invocationCallOrder`). A linha é o que o dono lê de volta; a DLQ é retenção. Uma indisponibilidade do Redis não pode custar o estado diagnosticável.
  - Adicionado `@OnWorkerEvent('error')`: um evento `error` sem listener é o que de fato derruba um processo Node. É o complemento do "capturar, registrar e retornar" para as falhas internas do worker (conexão Redis, lock), que não passam pelo `process()`.
  - `video-processing.processor.spec.ts` (SI-03.11) foi tocado: o job falso ganhou `attemptsMade`/`opts` reais e o provider da DLQ. Sem isso o teste passava por acidente aritmético (`NaN >= 1` é `false`) em vez de por decisão.
  - O spec de integração exercita as falhas com arquivos de verdade: `not-a-video.txt` no bucket para o permanente e objeto ausente para o transitório, com `attempts: 2` e backoff de 50ms sobrescritos no `add` — a política sob teste é o que acontece na exaustão, não quanto tempo o backoff real de 5s leva.

### SI-03.13 — Implementar as leituras de vídeo (pública `ready`-only e do dono)
- **Status:** completed
- **Tests:** 30 passing (14 unit com repo e `ChannelsService` mockados + 15 integration contra Postgres real + 1 de compilação do módulo); regressão de `src/videos` inteira reexecutada: 19 suites / 192 testes verdes
- **Observations:**
  - O filtro `status = 'ready'` vive **dentro** do `where` que resolve o `public_id` — uma query só. Teste explícito de que `findOne` é chamado uma única vez e de que um vídeo para de resolver no instante em que sai de `ready`, sem decisão em cache sobrevivendo à mudança.
  - As duas resoluções devolvem **shapes diferentes de propósito**: `PublicVideo` não carrega `status` (é `ready` por construção) nem o uuid interno; `OwnerVideo` carrega `status` + `failureReason`. Payload em camelCase, como as respostas de upload das SIs anteriores; as colunas do Data Model estão em snake_case só no banco.
  - Todo miss — id malformado, id desconhecido, vídeo de outro dono — devolve o **mesmo** `VideoNotFoundException`. Os testes comparam `errorCode`, `httpStatus` **e** `message` entre os casos em vez de checar cada um isoladamente: a exigência é indistinguibilidade, não "os dois dão 404".
  - `isVideoId` roda antes da query, então um path param malformado nunca vira `invalid input syntax for uuid` (que seria 500 e, pior, uma resposta diferente de "desconhecido").
  - `VideosModule` passou a importar `ChannelsModule` e a prover/exportar `VideosService`. O dono é resolvido via canal, e o lookup `sub` → `channel_id` mora em `ChannelsService` por decisão de TD-02 — o docstring de lá diz isso explicitamente. Como o `VideoProcessingModule` (worker) importa `VideosModule`, o worker passou a carregar `ChannelsModule` junto; `WORKER_ENTITIES` já incluía `Channel`, e a suite de compilação do módulo do worker continua verde.
  - **Duplicação conhecida, não resolvida aqui:** `VideoUploadsService.findOwnedVideo` (SI-03.6) faz a mesma resolução de dono que `VideosService.findOwnedEntity`. Exportei `findOwnedEntity` público justamente para ser o ponto único, mas não refatorei o uploads agora: os testes dele exercitam a lógica de dono de verdade e trocá-la por um mock de `VideosService` enfraqueceria a cobertura existente. SI-03.16 (cancel) e SI-03.17 (reprocess) são o terceiro e quarto chamadores — é lá que a consolidação deve acontecer, e aí os testes migram junto.

### SI-03.14 — Expor os endpoints de leitura de vídeo
- **Status:** completed
- **Tests:** 14 passing no e2e novo (`test/videos-read.e2e-spec.ts`, cobrindo os 6 cenários de `specs/videos-read.plan.md`) + 30 das suites de SI-03.13 reexecutadas após a mudança de nomes de campo
- **Observations:**
  - **Desambiguação de rota:** a família do dono virou `GET /videos/me/{videoId}` (3 segmentos) contra a pública `GET /videos/{publicId}` (2 segmentos) — disjuntas por contagem de segmentos, então a ordem de registro no Express não importa. A Routing note de `### API Contracts` autoriza explicitamente escolher um segmento próprio para a família do dono; o que é vinculante é a `### Authorization Matrix`, não o path literal. `GET /videos/me` fica livre para a listagem "meus vídeos" da Fase 04.
  - **Nomes de campo do payload mudaram em relação ao que SI-03.13 entregou.** O test spec 1.1 enumera `publicId`, `duration_seconds`, `width`, `video_codec`, … e o `### API Contracts` diz o mesmo nos dois endpoints de leitura. Adotei isso literalmente e reformatei `PublicVideo`/`OwnerVideo` (era camelCase), atualizando as suites de SI-03.13 junto. **Fica o registro de que o resultado é um payload de casing misto** (`publicId` + `duration_seconds`), inconsistente com as respostas de upload que são camelCase puro. Normalizar isso é decisão de contrato, não de implementação — cabe à Fase 04, antes de existir frontend consumindo.
  - O teste de "não é oráculo de existência" compara `body` inteiro entre um vídeo em `processing` e um `publicId` inexistente, em vez de checar 404 nos dois. Vale o mesmo para o não-dono na rota do dono.
  - Os três testes de desambiguação cobrem os dois sentidos: id interno na rota pública → 404, e `public_id` na rota do dono → 404 (nunca um 200 servido pelo handler público); e o terceiro confirma handlers distintos pela ausência/presença de `status` no body.
  - `VideosModule` ganhou o controller. Como o worker importa `VideosModule`, o contexto standalone passa a instanciar um controller — **verificado subindo `npm run start:worker` de verdade**: sobe limpo, sem rotas (application context não tem router). O teste de compilação de módulo sozinho não provaria isso.
  - `openapi.json` regenerado com `npm run openapi:export`: as duas rotas aparecem, a pública **sem** `security` e a do dono com `access-token`. O e2e assere o mesmo contra o documento construído em memória.

### SI-03.15 — Implementar a entrega por redirect presignado (streaming, download e thumbnail)
- **Status:** completed
- **Tests:** 9 passing no e2e novo (`test/videos-delivery.e2e-spec.ts`, cobrindo os 5 grupos de `specs/videos-delivery.plan.md`) + 30 das suites de `src/videos` e 14+6 dos e2e de leitura/swagger reexecutados
- **Observations:**
  - **Onde a lógica ficou:** os três endpoints estão em `VideosController` como o SI pede, mas a resolução da URL presignada foi para um `VideoDeliveryService` novo (`src/videos/delivery/`). O controller só traduz para HTTP; o filtro `ready`-only vem de um `VideosService.findReadyEntityByPublicId` extraído de `findPublicByPublicId`, que agora o chama — é o mesmo query, então metadata e as três rotas de entrega não podem divergir por descuido futuro.
  - **O `302` responde com corpo vazio, de propósito.** `res.redirect` do Express anexa uma página HTML de cortesia; numa API cuja tese é ficar fora do caminho de dados, isso são bytes sem função. O handler faz `setHeader` + `status(302).end()`.
  - **`@Header()` do Nest foi descartado para o `Cache-Control`.** Lendo `router-execution-context.js` (linha 44) os headers declarativos são aplicados **antes** do handler rodar — um `404` de vídeo não-`ready` sairia com `max-age`, e o browser cachearia a ausência de um vídeo que pode ficar pronto em seguida. O header é setado no caminho de sucesso.
  - `Cache-Control` divergente por rota: `public, max-age=300` na thumbnail (metade do TTL da assinatura, então um `302` cacheado nunca entrega assinatura vencida) e `no-store` em stream/download — a rota é o ponto de autorização, e a visibilidade unlisted/private da Fase 04 precisa poder apertar sem esperar cache expirar.
  - **Desvio deliberado do passo 2 do cenário 5.1 do test spec.** Reescrever o timestamp da assinatura invalida a *assinatura*, não a *validade* — o `403` viria de tampering e o teste passaria mesmo se a expiração não funcionasse. Em vez disso o teste assina a mesma chave com `expiresIn: 1`, espera 2s e só então chama: o `403` só pode vir de expiração. O passo 3 (URL original ainda dentro da janela → `200`) fecha o argumento.
  - `VideosModule` passou a importar `StorageModule`, então `videos.module.spec.ts` e `videos.service.integration-spec.ts` precisaram de `ConfigModule.forRoot({ isGlobal: true, load: [storageConfig] })` — mesmo padrão já usado em `video-uploads.service.integration-spec.ts`.
  - O throttler global (10 req/min) é limpo entre as chamadas dentro dos testes do grupo *Ready-only guard*: são 9 requisições num teste só, e sem isso o que estaria sendo medido é o rate limiter, não o filtro `ready`.
  - Contexto standalone do worker verificado subindo `npm run start:worker` de verdade após a mudança de `VideosModule` — sobe limpo. `openapi.json` regenerado: as três rotas aparecem sem `security` e com `Location`/`Cache-Control` documentados no `302`.
  - **Incidente de ambiente (fora do escopo do SI, resolvido):** matei uma execução de suíte completa que estava em background e ela parou dentro do spec de migrations — que desfaz as migrations e só as restaura no `afterAll`. O banco ficou meio-revertido (`users` e `videos` sumidos) e toda suíte com DB quebrou. Recuperado com `typeorm schema:drop` + `migration:run`, com autorização do usuário. Lição prática: **não interromper a suíte completa**, porque o spec de migrations não é resiliente a kill.

### SI-03.16 — Implementar o cancelamento de upload e a limpeza de rascunhos órfãos
- **Status:** completed
- **Tests:** 13 passing nas duas suites da Tests table (`orphan-draft-cleanup.service.spec.ts` 9 + `.integration-spec.ts` 8, sendo 4 do `it.each`) + 3 no e2e novo (`test/videos-upload-cancel.e2e-spec.ts`, cobrindo os 3 cenários de `specs/videos-upload-cancel.plan.md`) + 56 reexecutados de `src/storage` e `video-uploads.service` + 12 do e2e de uploads
- **Observations:**
  - **Bug de ambiente encontrado no MinIO fixado:** `ListMultipartUploads` **com `Prefix` devolve lista vazia**, e sem o parâmetro devolve todos os uploads abertos. Descoberto por sonda direta no SDK depois de 4 testes falharem juntos. `StorageService.listMultipartUploads` passou a filtrar no cliente — comportamento que vale igual em MinIO e S3. Vale lembrar disso em qualquer listagem futura contra essa imagem.
  - **`abortUpload` zera o `upload_id` depois de abortar.** A política conservadora de TD-15 é sobre **remoção de linha**; a linha continua lá, em `draft`. Zerar a coluna é o que mantém o estado honesto: um `complete` posterior responde `409` em vez de estourar dentro do cliente de storage, e a rotina de limpeza não reaborta o mesmo upload para sempre (`NoSuchUpload` a cada execução). O teste de idempotência entre duas execuções seguidas existe por causa disso.
  - **Nenhuma dependência nova.** TD-15 Opção A já aponta o scheduler do BullMQ como a infraestrutura da rotina, então `@nestjs/schedule` não entrou — a rotina é um `upsertJobScheduler` (chaveado por id, então cada boot converge para um agendamento em vez de empilhar) numa fila **separada**, `video-maintenance`. Não reusei `video-processing`: o processor dela não despacha por nome de job, e a concorrência 1 existe para limitar disco de scratch de transcodificação.
  - Produtor e consumidor ficam só no runtime do worker (`### Events/Messages`), em três peças pequenas: `OrphanDraftCleanupService` (a rotina), `...Processor` (consome) e `...Scheduler` (agenda). **Verificado subindo o worker de verdade:** o módulo inicializa e o primeiro job dispara na hora — o log `Running the orphan-draft cleanup` fecha a cadeia agendamento → fila → processor → serviço.
  - A rotina **loga e segue** quando um abort falha, em vez de propagar: um objeto inalcançável não pode derrubar o lote inteiro. O vídeo que falhou mantém o `upload_id`, então a execução seguinte tenta exatamente ele de novo — o teste unitário cobre esses dois lados.
  - O e2e sobe uma parte de verdade pela URL presignada antes de cancelar; um multipart vazio não provaria nada sobre o storage acumulado. E prova que o abort é real de duas formas: o `upload_id` some da listagem **e** um `CompleteMultipartUpload` com ele é recusado.
  - `openapi.json` regenerado: `DELETE /videos/{videoId}/uploads` com `204` sem schema (`204` não carrega body), mais 401/404/409 no envelope compartilhado.

### SI-03.17 — Expor o reprocessamento guardado
- **Status:** completed
- **Tests:** 44 passing nas suites da Tests table (`videos.service.spec.ts` com 7 casos novos de reprocess, `videos.service.integration-spec.ts` com 7, mais `videos.module.spec.ts`) + 6 no e2e novo (`test/videos-reprocess.e2e-spec.ts`, cobrindo os 4 cenários de `specs/videos-reprocess.plan.md`) + 14 do e2e de leitura reexecutados
- **Observations:**
  - **O achado do SI:** o `jobId` determinístico, que é o que dá a dedup de TD-14, é exatamente o que **impediria** o reprocessamento. O BullMQ ignora silenciosamente um `add` cujo `jobId` já existe — e a tentativa que falhou deixou um registro justamente sob esse id. Sem um `queue.remove(videoId)` antes do `add`, a rota responderia `200` e nada seria republicado. O teste de integração semeia um registro com payload marcado (`{ videoId: 'stale-record' }`) sob o id determinístico: sem o remove, é esse payload que sobreviveria.
  - O guard de estado está **dentro do `UPDATE`** (`WHERE id = ? AND status = 'error'`), não num read-then-write — mesmo idioma do `complete`. Dois reprocessos concorrentes não republicam os dois, e a limpeza da `failure_reason` acontece na mesmíssima operação que requeue.
  - Ordem das respostas preservada contra o oráculo: não-dono cai em `findOwnedEntity` e recebe `404` **antes** de qualquer checagem de estado, então um `409` nunca confirma a existência de vídeo alheio.
  - `VideosService` passou a depender da fila, então `VideosModule` importa `VideoQueueModule` e os dois specs que montam esse módulo ganharam `redisConfig` no `ConfigModule`.
  - **Como o e2e "deixa o worker consumir":** sobe `VideoProcessingModule` como um **segundo contexto Nest**, dentro dos dois testes que precisam disso e fechado ao final de cada um. Um worker vivo durante a suíte inteira drenaria a fila que os outros testes inspecionam — que é exatamente o que o `CLAUDE.md` do subprojeto adverte. Consequência: **esta suíte precisa rodar no container `video-worker`**, porque transcodifica de verdade (`ffprobe`/`ffmpeg` não existem na imagem da API).
  - `openapi.json` regenerado: 19 paths, com os 9 endpoints de vídeo da fase.

---

## Fechamento da fase

Rodada de encerramento, depois dos 17 SIs. Tudo aqui saiu de executar a Definition of
Done inteira contra o código, não de releitura de documentação.

### Correções de suíte

- **Regressão nas 10 suítes legadas de `auth`/`users`/`channels` (63 testes).** A relação
  inversa `Channel.videos`, introduzida por esta fase, só resolve se `Video` estiver na
  lista de entidades do `DataSource`; cada uma dessas suítes declara o próprio
  `ALL_ENTITIES` e não foi atualizada. Nenhum SI declarou essas suítes na sua Tests table,
  então a validação SI a SI ficou verde e o problema só apareceu na suíte completa.
- **`npm run test:e2e` vermelho como estava commitado.** Antes desta fase só
  `auth.e2e-spec.ts` tocava o banco; as 5 suítes novas de vídeo passaram a truncar as
  mesmas tabelas em paralelo. Resolvido com `maxWorkers: 1` no `test/jest-e2e.json` — no
  config, não no script, para valer também para quem invoca o jest direto.
- **Deadlock no spec de migrations.** O `beforeAll` dropava as tabelas em `Promise.all`;
  um `DROP ... CASCADE` trava a tabela dropada **e** tudo que a referencia, então drops
  concorrentes de tabelas com FK entre si pegam os locks em ordens diferentes. Só aparecia
  em `npm run test:integration`, que os Deliverables pedem mas cuja execução ninguém tinha
  registrado. Serializado.

### `ffmpeg` na imagem de dev da API

As observações dos SI-03.9 a SI-03.17 dizem que as suítes que spawnam `ffmpeg`/`ffprobe`
precisam rodar em `video-worker`. **Isso deixou de valer:** `Dockerfile.dev` passou a
instalar `ffmpeg`, e a suíte completa fecha verde em `nestjs-api`, que é o container que
todos os Deliverables citam. Partir a execução em dois containers não é expressável num
`npm test` e esconde suítes silenciosamente. O TD-07 segue valendo para a imagem de
**runtime** da API, que é onde a separação importa.

### `title` do vídeo — resolvido depois do plano

O plano registrava `title` como `_undetermined_` (`### API Contracts → POST /videos/uploads`),
delegando metadados descritivos à Fase 04. Mas a cláusula **Persistência** do desafio lista
`título` entre as colunas mínimas da tabela de vídeos. Fechado nesta rodada:

- Coluna `title varchar(200) NOT NULL`, em migration própria
  (`1785629400000-AddVideoTitle.ts`) em vez de editar a `CreateVideos` já publicada. Entra
  com `DEFAULT ''` e o default é removido em seguida, porque a tabela pode já ter linhas.
- Obrigatório no initiate (1..200 chars, aparado antes de validar, então título só de
  espaço em branco é `400`) — o rascunho pré-cadastrado nunca é uma linha sem nome.
- Exposto nas duas leituras, pública e do dono.
- Fase 04 continua dona da **edição** de metadados; `description` segue fora de escopo.

### Estado final da Definition of Done

Todos em `nestjs-api`, exit 0:

| Comando | Resultado |
|---|---|
| `npx tsc --noEmit` | exit 0 |
| `npm run lint` | 0 erros |
| `npx jest --runInBand` | 47 suítes, 384 testes |
| `npm run test:integration` | 22 suítes, 191 testes |
| `npm run test:e2e` | 8 suítes, 99 testes |

### Schemas de DTO vazios no `openapi.json` — corrigido

Todos os `components.schemas.*Dto` saíam como `{"type":"object","properties":{}}`. Sistêmico
e anterior a esta fase: atingia igualmente os DTOs de `auth` da Fase 02, e passava
despercebido porque os `paths` e os schemas de resposta escritos à mão nos `@ApiResponse`
estavam corretos — o spec parecia completo, só que sem nenhum corpo de requisição.

**Causa:** o CLI plugin do `@nestjs/swagger` é um transformer de AST do TypeScript — injeta
um `_OPENAPI_METADATA_FACTORY` em cada DTO em tempo de compilação, e é ele que converte os
decoradores de `class-validator` em schema. O script era
`ts-node -r tsconfig-paths/register src/openapi-export.ts`, que não passa pelo build da CLI
e portanto nunca aplica o transformer. A configuração no `nest-cli.json` sempre esteve
correta; quem não a executava era o script.

**Correção:** `openapi:export` passou a ser `nest build && node dist/openapi-export.js`.
Resultado: 0 schemas vazios em 10, com `required`, `enum`, `maxLength`, `minItems` e
`format` derivados dos decoradores, e as descrições vindas do `introspectComments`.

Vale para `ts-jest` também: um documento construído dentro de um teste não tem schema de
DTO. Contratos de corpo de requisição se conferem contra o `openapi.json` commitado.
