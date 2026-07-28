# Plano 03 — Implementação da Fase 03 (SI a SI)

> **Fase 03 — Upload e Processamento de Vídeos** do StreamTube.
> Este é o quarto de 5 planos (`docs/plans/plan-00` a `plan-04`). Cada plano é autocontido
> e pode ser executado em uma sessão diferente. Fonte da verdade do desafio: `docs/desafio.md`.
> **Pré-requisitos:** Planos 00–02 concluídos — em especial, o plano executável
> `docs/phases/phase-03-videos/phase-03-videos.md` completo e o `validation.md` em **`clean`**.
> **Não implementar sem o plano fechado — pular o workflow é reprova automática.**

## Contexto do projeto (comum a todos os planos)

- **StreamTube**: plataforma de compartilhamento de vídeos. Monorepo com `nestjs-project/`
  (backend NestJS 11 + TypeORM + PostgreSQL 17) e `next-frontend/` (fora do escopo da Fase 03).
- **Fases 01 e 02 concluídas**: `auth/`, `users/`, `channels/`, `mail/`, `common/`, `config/`,
  `database/`, `swagger/`. Guard JWT global, filtro de exceções de domínio, ValidationPipe global,
  rate limiting, migrations versionadas. Cada usuário tem um canal (1:1); vídeos pertencem a um canal.
- **Fase 03**: módulo de vídeos + object storage (MinIO/S3) + fila + worker FFmpeg via Docker
  Compose. Upload de até 10GB sem travar a API, pré-cadastro como rascunho, processamento
  automático (duração/metadados/thumbnail), URL única, streaming e download.
- **Docker**: tudo em containers; hosts sempre pelo **service name do Compose** (ex.: `db`, `minio`,
  `redis`/`rabbitmq`), nunca `localhost`. **Todo comando npm/npx/node roda dentro do container**
  (`docker compose exec nestjs-api ...`).
- **Git Flow**: trabalho em `feature/*` a partir de `dev`, merge de volta na `dev`.
  **Nunca commitar na `main`** (reprova automática).
- **Definition of Done**: suíte do SI verde a cada passo + suíte completa verde ao final +
  `npx tsc --noEmit` (código 0) + `npm run lint`.
- **Docs de libs**: antes de usar qualquer API de lib nova, consultar via **context7 (MCP)** e
  seguir a versão pinada em `docs/phases/phase-03-videos/library-refs.md`.
- **Testes**: `*.spec.ts` (unit, colaboradores mockados, sem I/O), `*.integration-spec.ts`
  (DB/serviços reais, ao lado do fonte), `*.e2e-spec.ts` (HTTP completo via supertest, em
  `nestjs-project/test/`). Integração/e2e sempre com `--runInBand` (banco de teste compartilhado).
  **Não mockar o que dá para testar de verdade com a infra do Compose** (MinIO, fila, worker).

## Objetivo deste plano

Implementar a Fase 03 completa, conduzido pela skill **`implement`**, **SI a SI, na ordem do
Dependency Map do plano**, rodando os testes de cada SI e só avançando com a suíte do SI verde.
Manter `docs/phases/phase-03-videos/progress.md` atualizado a cada SI.

> O detalhamento fino de *o que* implementar vive no plano da fase
> (`docs/phases/phase-03-videos/phase-03-videos.md`) — ele é a fonte da verdade da implementação.
> Este documento organiza o *como conduzir* e os invariantes que nenhum SI pode violar.

## Preparação

1. Conferir a stack no ar e a suíte baseline verde:
   ```bash
   cd nestjs-project && docker compose up -d && docker compose ps
   docker compose exec nestjs-api npm test -- --runInBand
   docker compose exec nestjs-api npm run test:e2e
   ```
2. Criar/entrar na branch da fase a partir da `dev`:
   ```bash
   git checkout dev && git pull origin dev
   git checkout -b feature/phase-03-videos   # ou continuar na branch já criada nos planos anteriores
   ```
3. Ler o plano da fase inteiro (`phase-03-videos.md`) e o `progress.md` (se já existir, para saber
   de onde retomar — os SIs concluídos não se repetem).
4. Invocar a skill **`implement`** apontando para a fase `phase-03-videos`.
5. Ativar as skills de apoio conforme o SI: `nestjs-best-practices`, `typeorm`,
   `testing-guide-nestjs-project` (as rules em `.claude/rules/` carregam automaticamente por arquivo).

## Ritmo por SI (repetir para cada SI-03.x)

1. Ler o SI no plano (objetivo, ações técnicas, arquivos, testes esperados).
2. Consultar context7 para toda API de lib nova usada no SI (S3 SDK, fila, FFmpeg) — seguir a
   versão do `library-refs.md`.
3. Implementar seguindo as convenções do projeto (referência de forma: módulo `auth/`):
   separação controller/service/repository, DTOs com class-validator, erros de domínio pelo filtro
   existente, config namespaces em `config/`, transações onde o plano exigir.
4. Escrever/rodar os testes do SI:
   ```bash
   docker compose exec nestjs-api npm test -- --runInBand path/do/teste
   ```
5. Verificar tipo e lint do que foi tocado:
   ```bash
   docker compose exec nestjs-api npx tsc --noEmit
   docker compose exec nestjs-api npm run lint
   ```
6. Atualizar `docs/phases/phase-03-videos/progress.md` no formato da Fase 02
   (`phase-02-auth/progress.md`): por SI — `Status`, `Tests` (contagem passando + arquivos),
   `Observations` (aprendizados/desvios reais).
7. Commit pequeno e descritivo (o "porquê"), na branch `feature/*`.
8. Só então avançar para o próximo SI.

## Invariantes da fase (valem para todos os SIs — reprovas automáticas em jogo)

### Upload de 10GB
- O arquivo **nunca** transita pela API de forma que a trave. O fluxo é o decidido no research
  (esperado: API inicia multipart + pré-cadastra o vídeo como `draft`; cliente envia as parts
  **direto ao MinIO** via URLs pré-assinadas; API recebe o "complete" e publica o job na fila).
- O pré-cadastro como rascunho acontece **ao iniciar** o upload, não ao terminar.

### Infra real no Compose
- `nestjs-project/compose.yaml` ganha os serviços novos: **MinIO** (com volume, credenciais via
  env, healthcheck e criação de bucket no bootstrap), o **broker da fila** (Redis ou RabbitMQ,
  conforme decidido) e o **worker de vídeo** (container com FFmpeg/ffprobe instalados na imagem).
- Tudo sobe junto com a stack (`docker compose up -d`) e com healthchecks/depends_on corretos.
- Env vars novas seguem a convenção do projeto (`.env` + config namespace; valores com caracteres
  especiais entre aspas — regra do CLAUDE.md do nestjs-project).
- Os **testes exercitam a infra real** — não simular MinIO/fila onde o Compose fornece o serviço.

### Banco
- Migration `CreateVideos` versionada (padrão das migrations existentes em
  `src/database/migrations/`), entidade `Video` com FK para `Channel`, enum de status, chaves de
  storage (vídeo/thumbnail), duração, metadados e identificador de URL única com **índice único**.
- Regras TypeORM do projeto (`.claude/rules/typeorm-*.md`): repository pattern, sem synchronize,
  queries pelo repositório.

### Fila e worker
- Job de processamento com payload conforme a spec **Events/Messages** do plano; retry/backoff e
  DLQ conforme decidido; worker **idempotente** (job reentregue não corrompe estado).
- Worker em container separado, consumindo a fila e atualizando status:
  `processing` ao pegar o job → ffprobe (duração/metadados) → thumbnail via FFmpeg → upload do
  thumbnail ao storage → `ready`; em falha definitiva → `error` (com registro do motivo).

### API
- Endpoints conforme os **API Contracts** do plano; REST estrito (rules de controllers);
  autorização conforme a **Authorization Matrix** (dono do canal para upload; público/anônimo para
  assistir conforme decidido — usar o mecanismo de rota pública existente do guard global).
- Streaming honrando `Range`/`206 Partial Content` (ou redirect presigned, conforme decidido) —
  reprodução **sem download completo**. Download disponível (`Content-Disposition: attachment`
  ou equivalente presigned).
- URL única: geração sem conflito (colisão tratada), lookup público por identificador.
- Swagger/OpenAPI atualizado (padrão do módulo `swagger/` — decorators nos endpoints novos).

### Testes por nível (guia: skill `testing-guide-nestjs-project`)
- **Unit**: lógica pura (geração de identificador único, máquina de estados, montagem de chaves de
  storage, validações) com colaboradores mockados.
- **Integração**: repositório/entidade contra o Postgres real; storage service contra o MinIO real;
  producer/consumer contra a fila real; worker processando um vídeo pequeno de fixture
  (segundos de duração) com FFmpeg real.
- **E2E**: fluxo completo via supertest — initiate (vídeo nasce `draft`) → upload de fixture pequena
  ao MinIO → complete → aguardar processamento (polling de status com timeout) → `ready` com
  duração/thumbnail → streaming com `Range` → download. Casos de erro: arquivo inválido → `error`.
- Fixtures: vídeo(s) pequeno(s) versionados no repo (ex.: `test/fixtures/sample.mp4`, poucos KB/s)
  — o teste de 10GB é de arquitetura (multipart presigned), não de força bruta; **não** versionar
  arquivos gigantes.

## Fechamento da implementação (antes de passar ao Plano 04)

```bash
docker compose exec nestjs-api npm test -- --runInBand   # suíte completa
docker compose exec nestjs-api npm run test:e2e
docker compose exec nestjs-api npx tsc --noEmit           # exit 0
docker compose exec nestjs-api npm run lint
docker compose down && docker compose up -d               # stack inteira sobe do zero, incluindo worker
docker compose ps                                          # todos os serviços "running"
```

- `progress.md` com **todos** os SIs `completed` e status geral da fase.
- Nenhum arquivo fora do escopo da fase alterado (Scope Limits do CLAUDE.md — nada de mistura
  de refactor cosmético com a feature).

## Critérios de conclusão deste plano

- [ ] Todos os SIs do plano implementados, na ordem do Dependency Map, cada um com suíte verde antes de avançar
- [ ] MinIO + fila + worker subindo via `docker compose up -d` junto com o backend
- [ ] Migration `CreateVideos` aplicada; entidade ligada ao canal
- [ ] Upload 10GB por estratégia direta ao storage (nada de arquivo pela API); pré-cadastro `draft` no initiate
- [ ] Processamento automático funcionando: duração/metadados + thumbnail + ciclo de status até `ready`/`error`
- [ ] URL única sem conflito; streaming sem download completo; download disponível
- [ ] Testes unit + integração (infra real) + e2e verdes; `tsc --noEmit` = 0; lint ok
- [ ] `docs/phases/phase-03-videos/progress.md` completo e fiel ao que aconteceu
- [ ] Commits pequenos na `feature/*`; nada na `main`

## Próximo plano

`docs/plans/plan-04-fechamento.md` — Definition of Done final, atualização do CLAUDE.md,
revisão dos Critérios de Aceite item a item e merge/push.
