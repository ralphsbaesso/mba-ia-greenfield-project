# Plano 04 — Fechamento: Definition of Done, Documentação e Entrega

> **Fase 03 — Upload e Processamento de Vídeos** do StreamTube.
> Este é o último de 5 planos (`docs/plans/plan-00` a `plan-04`). Cada plano é autocontido
> e pode ser executado em uma sessão diferente. Fonte da verdade do desafio: `docs/desafio.md`.
> **Pré-requisitos:** Planos 00–03 concluídos — implementação completa na branch `feature/*`,
> `progress.md` com todos os SIs `completed`.

## Contexto do projeto (comum a todos os planos)

- **StreamTube**: plataforma de compartilhamento de vídeos. Monorepo com `nestjs-project/`
  (backend NestJS 11 + TypeORM + PostgreSQL 17) e `next-frontend/` (fora do escopo da Fase 03).
- **Fase 03 entregue na implementação**: módulo `videos/`, MinIO (object storage), fila,
  worker FFmpeg — tudo no `compose.yaml`; upload de até 10GB direto ao storage com pré-cadastro
  como rascunho; processamento automático (duração/metadados/thumbnail); URL única; streaming
  com Range; download; ciclo de status draft → processing → ready/error.
- **Artefatos da fase**: `docs/decisions/technical-decisions-phase-03-videos.md` +
  `docs/phases/phase-03-videos/` (`context.md`, `validation.md` **clean**, `library-refs.md`,
  `phase-03-videos.md`, `progress.md`).
- **Docker**: hosts sempre pelo service name do Compose, nunca `localhost`. Comandos npm/npx
  **dentro do container** (`docker compose exec nestjs-api ...`).
- **Git Flow**: `feature/*` a partir de `dev`, merge de volta na `dev`. **Nunca commitar na `main`.**
- **Definition of Done**: suíte completa verde + `npx tsc --noEmit` (código 0) + `npm run lint`.
- **Reprova automática se**: `CLAUDE.md` inconsistente com o código; tsc com erro; lint quebrado;
  suíte vermelha; commit direto na `main`; infra simulada em vez de real no Compose.

## Objetivo deste plano

Fechar a fase: rodar a Definition of Done completa do zero, atualizar o `CLAUDE.md` (raiz e
`nestjs-project/`) para refletir o estado real do código, revisar os Critérios de Aceite do
desafio item a item e fazer o merge na `dev` + push do fork.

## Passos

### 1. Definition of Done completa, do zero

Derrubar e subir a stack inteira para provar que o Compose está autossuficiente:

```bash
cd nestjs-project
docker compose down -v        # ATENÇÃO: -v apaga volumes (banco/storage). Confirmar que não há dado a preservar.
docker compose up -d
docker compose ps             # TODOS os serviços "running": api, db, mailpit, minio, fila, worker
docker compose exec db pg_isready -U streamtube
docker compose exec nestjs-api npm install
docker compose exec nestjs-api npm run migration:run
```

Então a bateria completa (tudo no container):

```bash
docker compose exec nestjs-api npm test -- --runInBand    # unit + integração — 100% verde
docker compose exec nestjs-api npm run test:e2e           # e2e — 100% verde
docker compose exec nestjs-api npx tsc --noEmit && echo "TSC_OK"   # exit code 0
docker compose exec nestjs-api npm run lint               # sem erros
docker compose exec nestjs-api npm run build              # build de produção compila
```

Qualquer falha aqui = a fase **não** está pronta. Voltar ao Plano 03, corrigir e repetir este passo.

### 2. Smoke test manual do fluxo (validação funcional além dos testes)

Com a stack no ar, exercitar o caminho feliz de ponta a ponta (via curl/Swagger em
`http://localhost:3000`):

1. Registrar/logar um usuário (fluxo da Fase 02) e obter o JWT.
2. Iniciar um upload → conferir resposta (URLs pré-assinadas/upload id) e o vídeo criado como
   `draft` no banco.
3. Subir um vídeo pequeno de teste pelas URLs pré-assinadas (direto no MinIO).
4. Completar o upload → status vira `processing` → aguardar o worker → `ready`.
5. Conferir no banco: duração, metadados, chave do thumbnail, identificador de URL única.
6. Conferir no MinIO (console web): objeto do vídeo + thumbnail nos buckets/chaves esperados.
7. `GET` do vídeo pela URL única; requisição de streaming com header `Range: bytes=0-1023`
   esperando `206 Partial Content`; download do arquivo completo.
8. Caso de erro: subir um arquivo não-vídeo e confirmar status `error` sem derrubar o worker.

### 3. Atualizar o CLAUDE.md (raiz do repo)

Refletir o estado real pós-fase. Documentação citando arquivo/comportamento inexistente **reprova**.

- **Repository Structure**: corrigir a linha do `next-frontend/` ("not yet initialized" está
  desatualizado — ele existe desde a Fase 02) e mencionar o worker se ele viver fora de
  `nestjs-project/src/`.
- **Architecture**: o Message Queue deixa de ser "TBD" — nomear a tecnologia escolhida;
  Object Storage = MinIO (S3-compatível) em dev.
- **Seção de vídeos** (exigida pelo desafio): módulo `videos/`, fluxo de upload
  (initiate/presigned/complete), fila e worker, ciclo de status, streaming/download, URL única.
- Conferir se algum outro trecho ficou obsoleto com a fase.

### 4. Atualizar o nestjs-project/CLAUDE.md

- **Development Environment / Services**: adicionar os serviços novos do Compose (minio + console,
  broker da fila, worker) com portas e credenciais de dev.
- **Environment Startup Verification**: incluir os probes de prontidão dos serviços novos
  (ex.: healthcheck do MinIO, ping do broker).
- **Commands**: comandos novos relevantes (logs do worker, como rodar o worker em dev, scripts
  npm novos se existirem).
- **Architecture / Modules**: registrar o `VideosModule` e o entrypoint do worker.
- Env vars novas na seção de conventions do `.env` se houver pegadinha (aspas etc.).

### 5. Revisão dos Critérios de Aceite do desafio, item a item

Percorrer `docs/desafio.md` seção "Critérios de Aceite" e marcar cada item com evidência
(arquivo/teste/comando). Checklist condensado:

**Decisões e planejamento**
- [ ] `docs/decisions/technical-decisions-phase-03-videos.md` com fila, upload, streaming,
      processamento/thumbnail e ciclo de status decididos e justificados
- [ ] `docs/phases/phase-03-videos/` completa: `context.md`, `validation.md` (**status `clean`**),
      `phase-03-videos.md`, `progress.md`, `library-refs.md`
- [ ] Plano com SIs `SI-03.x` + Technical Specifications (Data Model, API Contracts,
      Authorization Matrix, Error Catalog, Events/Messages) + Dependency Map + Deliverables

**Feature**
- [ ] Upload até 10GB sem travar a API, com pré-cadastro `draft` no initiate
- [ ] Processamento automático: duração/metadados + thumbnail
- [ ] URL única sem conflito
- [ ] Streaming sem download completo + download disponível
- [ ] Ciclo de status refletido no banco (draft → processing → ready/error)

**Infra e qualidade**
- [ ] Storage, fila e worker sobem via `docker compose` junto com o backend
- [ ] Migration cria a tabela de vídeos; entidade ligada ao canal
- [ ] `npm test` e `npm run test:e2e` verdes
- [ ] `npx tsc --noEmit` código 0 + `npm run lint` ok
- [ ] Git Flow respeitado (tudo via `feature/*` a partir de `dev`; `git log main` sem commits diretos)

**Documentação**
- [ ] `CLAUDE.md` raiz e do nestjs-project coerentes com o código (checar cada afirmação nova)

Registrar essa revisão (ex.: em `docs/phases/phase-03-videos/progress.md` ao final, ou em nota de PR).

### 6. Merge e push (Git Flow)

```bash
git checkout feature/phase-03-videos
git push -u origin feature/phase-03-videos

# Merge na dev (idealmente via Pull Request no fork; local como alternativa):
git checkout dev
git pull origin dev
git merge --no-ff feature/phase-03-videos
git push origin dev
```

- O desafio pede a entrega no **fork público** — confirmar que o repositório
  `ralphsbaesso/mba-ia-greenfield-project` está público e com a `dev` atualizada.
- **Merge de `dev` → `main`**: o Git Flow do projeto prevê merge quando a `dev` está estável.
  Se fizer, **somente via merge/PR** (nunca commit direto). Confirmar antes se o avaliador espera
  o trabalho na `dev` ou também na `main`.

### 7. Verificação final pós-push

```bash
git log --oneline origin/main -5   # sem commits diretos novos na main (só merges, se houver)
git log --oneline origin/dev -15   # histórico da fase presente
git status                          # working tree limpo
```

Conferir no GitHub que os artefatos (`docs/decisions/`, `docs/phases/phase-03-videos/`,
`nestjs-project/compose.yaml`, módulo `videos/`, worker, migration) aparecem no fork.

## Critérios de conclusão deste plano

- [ ] Definition of Done completa passando a partir de uma stack recriada do zero
- [ ] Smoke test manual do fluxo completo ok (incluindo caso de erro)
- [ ] `CLAUDE.md` raiz + `nestjs-project/CLAUDE.md` atualizados e 100% coerentes com o código
- [ ] Critérios de Aceite do desafio revisados item a item, todos com evidência
- [ ] `feature/*` mergeada na `dev` e push feito no fork público; nada commitado direto na `main`
- [ ] Working tree limpo, sem arquivos esquecidos

## Fim da sequência de planos

Com este plano concluído, a Fase 03 está entregue conforme `docs/desafio.md`.
