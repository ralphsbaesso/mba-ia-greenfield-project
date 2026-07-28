# Plano 02 — Pipeline de Planejamento da Fase 03

> **Fase 03 — Upload e Processamento de Vídeos** do StreamTube.
> Este é o terceiro de 5 planos (`docs/plans/plan-00` a `plan-04`). Cada plano é autocontido
> e pode ser executado em uma sessão diferente. Fonte da verdade do desafio: `docs/desafio.md`.
> **Pré-requisitos:** Plano 00 (setup) e Plano 01 (research) concluídos —
> `docs/decisions/technical-decisions-phase-03-videos.md` existe com as 5 decisões fechadas.

## Contexto do projeto (comum a todos os planos)

- **StreamTube**: plataforma de compartilhamento de vídeos. Monorepo com `nestjs-project/`
  (backend NestJS 11 + TypeORM + PostgreSQL 17) e `next-frontend/` (fora do escopo da Fase 03).
- **Fases 01 e 02 concluídas**: `auth/`, `users/`, `channels/`, `mail/`, `common/`, `config/`,
  `database/`, `swagger/`. Cada usuário tem um canal (1:1); vídeos pertencem a um canal.
- **Fase 03 (o desafio)**: módulo de vídeos + object storage (MinIO/S3) + fila + worker FFmpeg via
  Docker Compose. Upload de até 10GB sem travar a API, pré-cadastro como rascunho, processamento
  automático (duração/metadados/thumbnail), URL única, streaming e download.
- **Workflow obrigatório**: `research` → `plan-context` → `plan-validate` → `plan-resolve` →
  `plan-build` → (`plan-test-specs` opcional) → `implement`. Cada estágio é uma skill do projeto.
  Os sub-agents de leitura (`.claude/agents/`) são usados pelas skills por baixo dos panos —
  não invocá-los diretamente.
- **Docker**: hosts sempre pelo service name do Compose, nunca `localhost`. npm/npx no container.
- **Git Flow**: branches saem de `dev` e voltam para `dev`. Nunca commitar na `main`.
- **Definition of Done**: suíte completa verde + `npx tsc --noEmit` (código 0) + `npm run lint`.
- **Docs de libs**: consultar via **context7 (MCP)**; o plan-resolve pina as libs no `library-refs.md`.
- **Rastreabilidade**: toda informação nos artefatos deve ser rastreável ao plano, ao desafio ou ao código.

## Objetivo deste plano

Conduzir a pipeline de planejamento até o plano executável completo, gerando a pasta:

```
docs/phases/phase-03-videos/
├── context.md          ← plan-context
├── validation.md       ← plan-validate (precisa fechar em status: clean)
├── library-refs.md     ← plan-resolve (libs pinadas via context7)
└── phase-03-videos.md  ← plan-build (o plano com SIs, Technical Specs, Dependency Map, Deliverables)
```

**Referência de formato:** a pasta `docs/phases/phase-02-auth/` (e `phase-02-auth-frontend/` para o
`library-refs.md`, que a phase-02-auth não tem). O `progress.md` só nasce na implementação (Plano 03).

**Nenhum código é escrito aqui.** Reprova automática relacionada: plano sem SIs ou sem Technical
Specifications; `validation.md` que não fecha em `clean`.

## Etapas da pipeline (na ordem)

> Existe também a skill `plan-phase`/`plan-pipeline` que encadeia os estágios. Pode-se usá-la, desde
> que os 4 artefatos saiam no formato correto e cada saída seja revisada criticamente entre estágios.

### Etapa 1 — `plan-context` → `context.md`

Invocar a skill `plan-context` com alvo **phase-03-videos**.

O que o context.md precisa consolidar (conferir contra o formato de `phase-02-auth/context.md`):
- Escopo da Fase 03 vindo do `docs/project-plan.md` (capacidades, entregáveis, out-of-scope —
  ex.: edição de vídeo/visibilidade é Fase 04, player/página é Fase 05; **frontend fora do escopo**).
- O `## Decisions Detail` com as recomendações dos TDs de
  `docs/decisions/technical-decisions-phase-03-videos.md` (fila, upload multipart/presigned,
  worker/FFmpeg, URL única/streaming, ciclo de status, uso do storage).
- Convenções herdadas das fases anteriores (guard JWT global, filtro de exceções de domínio,
  ValidationPipe, repository pattern, migrations versionadas, sufixos de teste
  `*.spec.ts` / `*.integration-spec.ts` / `*.e2e-spec.ts`, `--runInBand`).
- Constraints de infra: tudo no Compose, service names como host, comandos no container.
- Relação Video → Channel (dono), vinda do modelo existente.

Revisar criticamente: se faltar decisão ou constraint, é melhor aparecer agora do que no validate.

### Etapa 2 — `plan-validate` → `validation.md`

Invocar a skill `plan-validate`. O artefato lista findings por categoria
(Inconsistencies, Ambiguities, Missing Decisions, Dependency Gaps, Inherited Constraint Conflicts,
Unresolved Open Questions — formato de `phase-02-auth/validation.md`) e fecha com um
**status `clean` ou `dirty`** no frontmatter.

- Primeira rodada quase certamente sai `dirty` — é o esperado.
- **Não editar o validation.md na mão para forçar `clean`** — isso invalida o processo.

### Etapa 3 — `plan-resolve` → resolve pendências + `library-refs.md`

Invocar a skill `plan-resolve` para cada finding do validate:
- Atualiza o doc de decisões e/ou o `context.md` resolvendo cada pendência.
- Gera `docs/phases/phase-03-videos/library-refs.md` com as **libs novas pinadas e confirmadas via
  context7** (formato de referência: `phase-02-auth-frontend/library-refs.md` — frontmatter com
  `libs:` incluindo `version`, `context7_id`, `fetched_at`, e seções de doc destilada por lib).
- Libs esperadas nesta fase (conforme decidido no research; confirmar versões instaláveis com
  NestJS 11): SDK S3 (`@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner` ou SDK MinIO),
  lib de fila + integração NestJS (ex.: `bullmq` + `@nestjs/bullmq`, ou `amqplib` +
  `@nestjs/microservices`), binding FFmpeg (ex.: `fluent-ffmpeg` + `@types/fluent-ffmpeg`, ou
  execução direta de ffmpeg/ffprobe).
- **Se a doc retornada pelo context7 não bater com a versão que será instalada, sinalizar a
  discrepância antes de prosseguir** (regra do CLAUDE.md).

### Etapa 4 — Iterar `validate ↔ resolve` até `clean`

Rodar `plan-validate` de novo após cada resolve. Repetir o ciclo até o `validation.md` fechar com
**status `clean`**. Critério de aceite do desafio — sem `clean`, reprova.

### Etapa 5 — `plan-build` → `phase-03-videos.md`

Invocar a skill `plan-build` para gerar o plano executável. Estrutura obrigatória
(formato de referência: `phase-02-auth/phase-02-auth.md`):

1. **Objective**
2. **Step Implementations** — SIs numerados `SI-03.1`, `SI-03.2`, … Cada SI com objetivo, ações
   técnicas, arquivos afetados e testes esperados. Fatiamento sugerido pela natureza da fase
   (o plan-build define o fatiamento final; validar que cubra pelo menos):
   - Dependências novas + config namespaces (storage/fila) + infra no `compose.yaml`
     (MinIO, broker da fila, worker)
   - Entidade `Video` + migration `CreateVideos` (ligada ao canal) + repository
   - Módulo `videos/` na API: initiate upload (pré-cadastro draft + presigned/multipart),
     complete upload (dispara job na fila)
   - Worker: consumo do job, ffprobe (duração/metadados), thumbnail, atualização de status
   - Endpoints de leitura: vídeo por URL única, streaming (Range/206), download
   - Tratamento de falha: retry/DLQ, status `error`
   - Testes e2e do fluxo completo com infra real do Compose
3. **Technical Specifications** — obrigatórias no desafio:
   - **Data Model** — tabela `videos` completa: id, channel_id (FK), title, status
     (draft/processing/ready/error), chaves de storage (vídeo e thumbnail), duração, metadados
     (jsonb?), identificador da URL única (único, indexado), timestamps
   - **API Contracts** — cada endpoint com método, rota, request/response, status codes
   - **Authorization Matrix** — quem pode o quê (dono do canal vs. autenticado vs. anônimo;
     lembrar que o guard JWT é global com rotas públicas via decorator)
   - **Error Catalog** — erros de domínio no formato do filtro existente
     (`{ statusCode, error, message }`)
   - **Events/Messages** — obrigatório por causa da fila: nome do job/evento, payload, produtor,
     consumidor, política de retry/backoff, DLQ, idempotência
4. **Dependency Map** — ordem e dependências entre SIs
5. **Deliverables** — mapeados aos entregáveis do desafio (upload 10GB, processamento automático,
   streaming, URLs únicas)

### Etapa 6 (opcional) — `plan-test-specs`

Se optar por rodar, gera as specs de teste da fase. Recomendado, dado o peso de testes nos
critérios de aceite — consultar também a skill `testing-guide-nestjs-project` e
`.claude/rules/nestjs-testing.md` para os níveis corretos.

## Revisão crítica final (antes de dar o plano por pronto)

Checar o plano contra os critérios de aceite do desafio:
- [ ] Todos os SIs `SI-03.x` presentes, fatiados finos, com testes por SI
- [ ] As 5 Technical Specifications presentes (incluindo **Events/Messages**)
- [ ] Upload de 10GB **não** passa pela API (estratégia direta ao storage no plano)
- [ ] Pré-cadastro como rascunho amarrado ao initiate do upload
- [ ] Infra (MinIO, fila, worker) prevista no `compose.yaml`
- [ ] Migration + entidade ligada ao canal previstas
- [ ] Ciclo de status completo incluindo falha
- [ ] Cada afirmação rastreável a decisão/desafio/código (nada inventado)

## Git

Trabalhar em branch a partir da `dev` (a mesma da fase, ex.: `feature/phase-03-videos`, ou uma
`docs/phase-03-planning` — manter a convenção escolhida no Plano 01). Commitar os artefatos por
etapa (commits pequenos: context, validation+resolve, plano). **Nunca na `main`.**

## Critérios de conclusão deste plano

- [ ] `docs/phases/phase-03-videos/context.md` criado e revisado
- [ ] `docs/phases/phase-03-videos/validation.md` com **status `clean`** (obtido por iteração real
      validate↔resolve, não por edição manual)
- [ ] `docs/phases/phase-03-videos/library-refs.md` com libs pinadas via context7
- [ ] `docs/phases/phase-03-videos/phase-03-videos.md` com SIs `SI-03.x`, as 5 Technical
      Specifications (Data Model, API Contracts, Authorization Matrix, Error Catalog,
      Events/Messages), Dependency Map e Deliverables
- [ ] Artefatos commitados em branch a partir da `dev`

## Próximo plano

`docs/plans/plan-03-implementacao.md` — Implementação SI a SI com a skill `implement`
(módulo, infra no Compose, migration, worker, testes e `progress.md`).
