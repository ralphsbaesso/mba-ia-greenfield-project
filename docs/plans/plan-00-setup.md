# Plano 00 — Setup e Pré-requisitos da Fase 03

> **Fase 03 — Upload e Processamento de Vídeos** do StreamTube.
> Este é o primeiro de 5 planos (`docs/plans/plan-00` a `plan-04`). Cada plano é autocontido
> e pode ser executado em uma sessão diferente. Fonte da verdade do desafio: `docs/desafio.md`.

## Contexto do projeto (comum a todos os planos)

- **StreamTube**: plataforma de compartilhamento de vídeos (estilo YouTube). Monorepo com
  `nestjs-project/` (backend NestJS 11 + TypeORM + PostgreSQL 17) e `next-frontend/` (fora do escopo da Fase 03).
- **Fases 01 e 02 concluídas**: módulos `auth/`, `users/`, `channels/`, `mail/`, `common/`, `config/`,
  `database/`, `swagger/`. Cada usuário tem um canal (1:1) criado no cadastro. Guard JWT global,
  filtro de exceções de domínio, `ValidationPipe` global, rate limiting, migrations e seeds.
- **Fase 03 (o desafio)**: módulo de vídeos + object storage (MinIO/S3) + fila de processamento +
  worker FFmpeg, tudo subindo via Docker Compose. Upload de até 10GB sem travar a API, pré-cadastro
  como rascunho, processamento automático (duração/metadados/thumbnail), URL única, streaming e download.
- **Workflow obrigatório** (pipeline de skills do projeto): `research` → `plan-context` → `plan-validate`
  → `plan-resolve` → `plan-build` → (`plan-test-specs` opcional) → `implement`. Pular etapas é reprova.
- **Docker**: tudo roda em containers. Hosts de serviços usam **sempre o service name do Compose**
  (ex.: `db`, `minio`), nunca `localhost`. Todo comando `npm`/`npx`/`node` roda **dentro do container**
  (`docker compose exec nestjs-api ...`), nunca no host.
- **Git Flow**: branches `feature/*` saem de `dev` e voltam para `dev`. **Nunca commitar direto na `main`**
  (reprova automática). Commits curtos e descritivos, focados no "porquê".
- **Definition of Done** (vale para qualquer entrega): suíte relevante verde + suíte completa verde +
  `npx tsc --noEmit` com código 0 + `npm run lint` passando.
- **Docs de libs**: antes de implementar com qualquer biblioteca, consultar a doc oficial via
  **context7 (MCP)** e seguir a versão instalada.

## Objetivo deste plano

Deixar o ambiente pronto e verificado para iniciar a Fase 03:
fork/remote corretos, branch `dev` criada, stack atual subindo, migrations aplicadas,
suíte atual 100% verde e MCP context7 disponível. **Nenhum código da Fase 03 é escrito aqui.**

## Estado verificado em 2026-07-27 (baseline)

- Branch local: apenas `main`. **`dev` não existe** — precisa ser criada.
- Remote `origin`: `https://github.com/ralphsbaesso/mba-ia-greenfield-project.git` (fork correto).
- `nestjs-project/compose.yaml`: apenas `nestjs-api`, `db` (Postgres 17) e `mailpit`.
- Migrations existentes: `CreateUsersAndChannels`, `CreateAuthTokens`. Sem tabela de vídeos.
- `.mcp.json` do projeto: apenas servidor `postgres`. **context7 não está configurado no projeto.**
- `docs/desafio.md`: arquivo untracked no git.
- Nenhuma lib de storage/fila/FFmpeg instalada no `package.json`.

## Passos

### 1. Sanidade do git e do fork

```bash
git status                  # working tree deve estar limpo (exceto docs/desafio.md e docs/plans/)
git remote -v               # origin deve apontar para o fork ralphsbaesso/mba-ia-greenfield-project
git fetch origin --prune    # verificar se existe dev remota antes de criar
git branch -a
```

- Se `origin/dev` **existir**: `git checkout -b dev origin/dev`.
- Se **não existir**: criar a partir da `main` e publicar:

```bash
git checkout main
git pull origin main
git checkout -b dev
git push -u origin dev
```

### 2. Commitar os arquivos soltos de documentação

`docs/desafio.md` (e esta pasta `docs/plans/`) devem entrar no repositório antes do trabalho começar,
para que todo artefato seja rastreável. Seguindo o Git Flow:

```bash
git checkout dev
git checkout -b docs/phase-03-challenge-and-plans
git add docs/desafio.md docs/plans/
git commit -m "docs: adiciona enunciado do desafio e planos de execução da fase 03"
git push -u origin docs/phase-03-challenge-and-plans
# merge em dev (via PR ou merge local, conforme preferência do dono do repo)
git checkout dev && git merge --no-ff docs/phase-03-challenge-and-plans && git push origin dev
```

### 3. Subir a stack atual e verificar infraestrutura

> Regra do projeto: "subir o ambiente" = **somente infraestrutura**. O dev server só sobe se
> explicitamente necessário.

```bash
cd nestjs-project
docker compose up -d
docker compose ps                                   # todos os serviços "running"
docker compose exec db pg_isready -U streamtube     # esperar "accepting connections"
```

### 4. Instalar dependências e aplicar migrations (dentro do container)

```bash
docker compose exec nestjs-api npm install
docker compose exec nestjs-api npm run migration:run   # confirmar o nome do script em package.json
```

Verificar no banco (via MCP postgres ou psql) que as tabelas de users/channels/tokens existem
e que a tabela de controle de migrations está consistente.

### 5. Confirmar a suíte atual 100% verde (baseline)

Tudo dentro do container. Integração/e2e compartilham um único banco de teste — **sempre `--runInBand`**:

```bash
docker compose exec nestjs-api npm test -- --runInBand
docker compose exec nestjs-api npm run test:e2e
docker compose exec nestjs-api npx tsc --noEmit      # exit code 0
docker compose exec nestjs-api npm run lint
```

- Se algo falhar aqui, **corrigir antes de qualquer trabalho da Fase 03** (ou registrar o problema
  se for pré-existente e alheio à fase — mas a Definition of Done final exige suíte completa verde,
  então provavelmente terá que ser resolvido de qualquer forma).
- Registrar o resultado (nº de suítes/testes passando) como baseline para comparação no fechamento.

### 6. Verificar o MCP context7

O desafio e o `CLAUDE.md` exigem lookup de docs via context7 antes de implementar com libs novas
(a Fase 03 trará SDK S3, lib de fila e FFmpeg).

- Testar se o context7 responde na sessão do Claude Code (ele pode estar configurado globalmente
  em `~/.claude.json` mesmo não estando no `.mcp.json` do projeto).
- Se **não** estiver disponível, adicionar ao `.mcp.json` do projeto:

```json
{
  "mcpServers": {
    "postgres": { "...": "manter como está" },
    "context7": {
      "command": "npx",
      "args": ["-y", "@upstash/context7-mcp"]
    }
  }
}
```

- Reiniciar a sessão do Claude Code e confirmar que as tools do context7 aparecem.
- Se alterar o `.mcp.json`, commitar via branch `docs/*` ou junto do passo 2.

### 7. Verificar ferramentas auxiliares no host

```bash
docker --version && docker compose version
git --version
```

Confirmar também espaço em disco razoável (a fase envolve arquivos de vídeo e imagens Docker novas:
MinIO, Redis/RabbitMQ, imagem do worker com FFmpeg).

## Critérios de conclusão deste plano

- [ ] Branch `dev` existe local e no `origin`
- [ ] `docs/desafio.md` e `docs/plans/` commitados via branch a partir da `dev` (nada na `main`)
- [ ] `docker compose ps` com todos os serviços atuais "running" e Postgres aceitando conexões
- [ ] Migrations aplicadas sem erro
- [ ] `npm test -- --runInBand`, `npm run test:e2e`, `npx tsc --noEmit` e `npm run lint` todos verdes (baseline registrado)
- [ ] MCP context7 respondendo na sessão
- [ ] Nenhum commit feito na `main`

## Próximo plano

`docs/plans/plan-01-research.md` — Research das decisões técnicas da Fase 03
(fila, upload 10GB, worker/FFmpeg, URL única/streaming, ciclo de status).
