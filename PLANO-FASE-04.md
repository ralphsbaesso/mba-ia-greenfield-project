# Plano de Execução — Fase 04: Gerenciamento de Vídeos e Canal

> Documento de planejamento. **Nada aqui foi implementado.**
> Escopo acordado com o usuário em 2026-08-05: **Fase 04 completa** do `docs/project-plan.md`, **incluindo a tela de upload**, com o painel de gerenciamento mantido deliberadamente simples — um CRUD, não um YouTube Studio.

---

## 1. Objetivo

Entregar os 8 itens da Fase 04 (`docs/project-plan.md:87-102`):

| # | Item | Onde vive |
|---|---|---|
| 1 | Categorias de vídeo | backend (novo módulo) + select no form |
| 2 | Edição de título, descrição, categoria e thumbnail customizada | backend (`PATCH`) + form |
| 3 | Visibilidade: público / unlisted | backend (coluna + filtros) + form |
| 4 | Fluxo rascunho → publicação | backend (coluna) + ação no painel |
| 5 | Painel de gerenciamento de vídeos do canal | frontend `/studio` |
| 6 | Edição de vídeos a partir do painel | frontend `/studio/[videoId]` |
| 7 | Edição das informações do canal | backend (`PATCH /channels/me`) + `/studio/channel` |
| 8 | Página pública do canal | backend (2 rotas públicas) + `/c/[nickname]` |

Mais o **upload pela interface**, que a Fase 03 deixou só com backend.

### Explicitamente fora de escopo

- **Contadores de visualizações, likes e comentários no painel.** O item 5 do project-plan os menciona, mas as entidades não existem — likes/comentários são Fase 06 e views é Fase 05. O painel exibe as colunas que existem hoje (thumbnail, título, status, data, duração). **Registrar como pendência de Fase 06.**
- Player de vídeo, sugestões, home com grid, busca (Fases 05 e 07).
- Paginação infinita — a listagem usa paginação simples por `limit`/`offset`.

---

## 2. Ponto de partida — o que já existe

### Backend (`nestjs-project/`) — a Fase 03 entregou bastante

Endpoints prontos (`nestjs-project/openapi.json`, 19 paths):

```
POST   /videos/uploads                      initiate multipart, cria draft, devolve URL por parte
POST   /videos/{videoId}/uploads/complete   fecha o multipart e publica o job
DELETE /videos/{videoId}/uploads            aborta o multipart
GET    /videos/me/{videoId}                 leitura do dono, qualquer estado
POST   /videos/{videoId}/reprocess          re-enfileira vídeo em error
GET    /videos/{publicId}                   público, só ready
GET    /videos/{publicId}/stream|download|thumbnail   302 presigned
```

Peças reaproveitáveis:

- `src/videos/videos.service.ts` — `findOwnedEntity()` já resolve **ownership via canal** e responde sempre `VIDEO_NOT_FOUND` (nunca 403, para não virar oráculo de existência). Todo endpoint novo de dono **deve** passar por ele.
- `src/channels/channels.service.ts` — `findIdByUserId()`, `createChannel()` com retry de colisão de nickname.
- `src/storage/storage.service.ts` — multipart, presign GET/PUT, head, put, get.
- `src/common/exceptions/domain.exception.ts` — `VideoNotFoundException`, `InvalidVideoStateException`, `ChannelMissingForUserException`.
- Entidade `Video` com os dois `CHECK` state-scoped do contrato `ready`.

### Frontend (`next-frontend/`) — praticamente zero

4 páginas: `/`, `/login`, `/signup`, `/forgot-password`. Nenhuma tela de vídeo. `lib/api/types.gen.ts` só conhece `/auth/*`.

Peças reaproveitáveis:

- `lib/auth/session.ts` (iron-session), `SessionProvider`, `hooks/use-session.ts`.
- `lib/auth/refresh.ts` → `withRefresh(fetcher)` — retry único em 401 com `POST /auth/refresh`, dedup por promise de módulo. **Existe e não tem nenhum caller.** Todo route handler autenticado da Fase 04 deve usá-lo.
- `lib/api/upstream.ts` — cliente `openapi-fetch` tipado, `server-only`.
- Padrão de form: `components/auth/login-form.tsx` (react-hook-form + Zod + `mapXErrorToForm`).
- Padrão de gate RSC: `app/page.tsx` e `app/(auth)/login/page.tsx`.
- Primitivas shadcn em `components/ui/`, tokens em `app/globals.css`.

---

## 3. Pré-requisitos — SI-00, antes de qualquer código de feature

Quatro coisas quebram ou bloqueiam a fase se não forem resolvidas primeiro. **Nenhuma delas é opcional.**

### 3.1 A cadeia de tipos do frontend está quebrada

`next-frontend/openapi.json` **não existe** e está no `.gitignore:42`, apesar de `.claude/rules/next-frontend-bff-api.md` descrevê-lo como *"committed by design"* com guarda de CI. Consequência: `lib/api/types.gen.ts` só tem `/auth/*` — o front não tem como tipar nenhuma chamada de vídeo.

Além disso, `.github/workflows/openapi-freshness.yml`, citado no mesmo doc, **não existe** (não há `.github/workflows/` no repo).

```bash
docker compose exec nestjs-api npm run openapi:export   # nest build && node dist/openapi-export.js
bash scripts/sync-openapi.sh                            # host: nestjs-project/ → next-frontend/
docker compose exec next-frontend npm run openapi:types
```

⚠️ `openapi:export` **precisa** do `nest build`: o plugin CLI do `@nestjs/swagger` é um transformer de AST. Rodar por `ts-node` gera `{"type":"object","properties":{}}` para todo DTO — spec que parece completa e não tem nenhum request body.

**Decisão a tomar:** remover `openapi.json` do `.gitignore` do front (alinhando com a regra) ou corrigir a regra. Recomendo remover do ignore e criar o workflow de CI que falta.

### 3.2 CORS do MinIO para o upload direto do browser

O upload é a única exceção sancionada ao BFF: o browser dá `PUT` **direto no object storage** com as URLs presigned (`CLAUDE.md` → "The video file never passes through the API"). Isso só funciona se o MinIO aceitar a origem `http://localhost:3001` e expor o header `ETag` — sem `ETag` exposto o browser não consegue montar o payload do `complete`.

Não há **nenhuma** configuração de CORS no `nestjs-project/compose.yaml` nem no `storage.service.ts`. Precisa entrar.

### 3.3 A sessão do front não carrega o canal

`app/api/auth/login/route.ts` sela `userId: ""` e `channelSlug: ""` — só `email` e `isLoggedIn` são úteis. O `/studio` e o link para `/c/[nickname]` precisam do nickname. O backend já expõe `GET /auth/me`.

Corrigir o `setSession` para popular `userId` e `channelSlug` a partir de `/auth/me` (ou de `GET /channels/me`, criado nesta fase). Aproveitar para remover o `console.log(error, data, response)` esquecido na linha 11.

### 3.4 Proteção de rota centralizada

Hoje o gate é por RSC, página a página — correto quando havia 1 rota protegida. A Fase 04 adiciona **5** (`/studio`, `/studio/upload`, `/studio/[videoId]`, `/studio/channel`, e os handlers BFF). É o momento de introduzir `proxy.ts` na raiz do `next-frontend/`.

⚠️ **No Next 16 `middleware.ts` foi renomeado para `proxy.ts`** (`node_modules/next/dist/docs/01-app/01-getting-started/16-proxy.md`). O gate autoritativo continua na RSC; o proxy é a checagem otimista.

⚠️ O proxy **deve decriptar** o cookie com `unsealData` do `iron-session`, não checar presença. Um cookie presente-mas-indecifrável (TTL vencido ou `SESSION_PASSWORD` rotacionado) faz proxy e RSC discordarem e produz loop `/` ⇄ `/login`. E manter o proxy **assimétrico** (só a direção anônimo→`/login`), deixando o bounce inverso na RSC — assim nenhum ciclo se forma.

---

## 4. Skills — quais usar e em que ordem

O repo tem um pipeline de planejamento próprio (`.claude/skills/`, `docs/plans/README.md`). **Seguir o pipeline é obrigatório** — o README da Fase 03 diz "pular etapa é reprova automática".

### 4.1 Sequência principal

| Ordem | Skill | Comando | Produz | Observação |
|---|---|---|---|---|
| 0 | — | — | branch `feature/phase-04-*` a partir de `dev`, stack no ar, suíte baseline verde | Git Flow: **nunca** commitar na `main` |
| 1 | **`research`** | `/research 04` | `docs/decisions/technical-decisions-phase-04-*.md` | Fecha os TDs da §5. **Não pular** — `plan-validate` aborta com MD-N se faltar decisão |
| 2 | **`screen-inventory`** | `/screen-inventory 04` | `docs/inventories/screen-inventory-phase-04-*.md` | Roda **antes** do `plan-context` (a própria skill diz "prepare the front-end inputs before /plan-context"). **Pede URLs do Figma** — ver §4.3 |
| 3 | **`plan-context`** | `/plan-context 04` | `docs/phases/phase-04-*/context.md` | Consolida project-plan + decisions + fases anteriores + inventory + testing guide |
| 4 | **`plan-validate`** | `/plan-validate 04` | `validation.md` com `status: clean\|dirty` | |
| 5 | **`plan-resolve`** | `/plan-resolve 04` | preenche `**Decision:**`, gera `library-refs.md` | **Só se `dirty`.** Volta ao passo 4 — laço até `clean` |
| 6 | **`plan-build`** | `/plan-build 04` | `docs/phases/phase-04-*/phase-04-*.md` | Pausa entre Phase A e B = checkpoint de revisão |
| 7 | **`plan-test-specs`** | `/plan-test-specs 04` | `nestjs-project/specs/*.plan.md` e `next-frontend/specs/*.plan.md` | Formato spec-driven; consumido pelo `implement` Step 3a |
| 8 | **`implement`** | `/implement 04` | código, SI a SI, testes verdes entre cada um | Só avança quando os testes do SI passam |
| 9 | — | — | DoD completo, `CLAUDE.md` atualizado, merge em `dev` | |

### 4.2 Skills de apoio, carregadas durante o passo 8

Ativar conforme o artefato que está sendo tocado:

**Backend**
- `nestjs-best-practices` — ao criar módulo/controller/service/DTO/guard
- `typeorm` — entidades, migrations, queries
- `testing-guide-nestjs-project` — o que testar, em que camada, com que sufixo

**Frontend**
- `next-best-practices` — RSC vs client, async APIs, route handlers, metadata
- `vercel-react-best-practices` — performance, data fetching, bundle
- `testing-guide-next-frontend` — camadas de teste e setup
- `playwright-cli` — padrões de E2E
- `figma-apply-tokens-tailwind-v4` / `figma-audit-tokens` — só se houver Figma (§4.3)

**Transversal**
- **context7 (MCP)** — obrigatório por `CLAUDE.md` antes de implementar com qualquer lib. Versões pinadas em `library-refs.md`
- `git-commit-generator` — mensagens de commit
- `decide` — se surgir necessidade de revisar um TD já decidido no meio da implementação
- `clean-comments` — passada final de limpeza, se necessário

### 4.3 Ponto de bloqueio no passo 2

`screen-inventory` **pede as URLs do Figma** de cada tela e extrai os componentes via Figma MCP. São 5 telas novas (`/studio`, `/studio/upload`, `/studio/[videoId]`, `/studio/channel`, `/c/[nickname]`).

**Decidir antes de rodar:** existe Figma para a Fase 04?
- **Se sim** — reunir as 5 URLs antes de invocar a skill.
- **Se não** — pular o passo 2 e construir as telas a partir de `docs/design-system-ai-implementable.md` + dos tokens de `app/globals.css`, reusando as primitivas existentes. Registrar a ausência de inventory no `context.md` para o `plan-validate` não acusar lacuna.

---

## 5. Decisões técnicas a fechar no `/research` (passo 1)

Estes são os TDs que o `research` precisa resolver. Cada um tem uma recomendação, mas **a decisão é do passo 1, não deste plano**.

### TD-01 — Como modelar publicação vs. visibilidade

O `status` atual (`draft|processing|ready|error`) é o ciclo de **upload**, não de publicação — e os dois `CHECK` da entidade dependem dele. Conflatar quebraria os contratos da Fase 03.

**Recomendação:** uma coluna nova e independente, `visibility ENUM('private','unlisted','public') NOT NULL DEFAULT 'private'`. Cobre os dois bullets do project-plan (visibilidade *e* rascunho→publicação) com uma coluna só: um upload novo nasce `private` (= rascunho), publicar é mudar para `public` ou `unlisted`. É também o modelo do YouTube.

**Alternativa:** `visibility ENUM('public','unlisted')` + `published_at TIMESTAMPTZ NULL`. Dois eixos separados, mais fiel à leitura literal do project-plan, mais estado para manter consistente.

### TD-02 — Onde o filtro de `unlisted` incide

`unlisted` = acessível por link direto, ausente de listagens. `GET /videos/{publicId}` **é** o link direto, então deve servir `unlisted`. As listagens (`/channels/{nickname}/videos`, e a home da Fase 07) devem excluir.

**Atenção:** as 3 rotas de delivery (`/stream`, `/download`, `/thumbnail`) compartilham `findReadyEntityByPublicId()` com a rota de metadata justamente para que nenhuma delas seja oráculo de existência (`thumbnail-delivery/TD-01`). O filtro novo **tem que entrar nesse método compartilhado**, ou a invariante quebra.

### TD-03 — Thumbnail customizada: por onde sobem os bytes

**Recomendação:** presigned `PUT` para `thumbnails/<video.id>.jpg`, coerente com "os bytes nunca passam pela API". Sobrescreve a que o worker gerou. Precisa de uma flag para o reprocess não sobrescrever a customizada de volta.

**Alternativa:** upload multipart-form pela API (arquivo é pequeno, ~100KB). Mais simples, quebra o princípio.

### TD-04 — `DELETE /videos/{videoId}`: o que acontece com os bytes

`StorageService` **não tem** `deleteObject`. Precisa ganhar um.

**Recomendação:** hard delete da linha + `deleteObjects([storage_key, thumbnail_key])`. Se o vídeo ainda for `draft` com `upload_id`, abortar o multipart antes. Ordem: aborta multipart → apaga objetos → apaga linha (objeto órfão é desperdício; linha órfã é 404 quebrado).

**Alternativa:** soft delete (`deleted_at`) — preserva histórico, mas exige filtrar em toda query e não libera storage.

### TD-05 — Publicar: `PATCH` ou endpoint dedicado

**Recomendação:** só `PATCH /videos/{videoId}` com `visibility` no corpo. Menos superfície, mais REST.
**Alternativa:** `POST /videos/{videoId}/publish` — mais explícito, espelha o `reprocess` que já existe.

### TD-06 — Categorias: tabela ou enum

**Recomendação:** tabela `categories` + seed via migration. Permite gerenciar sem deploy e dá `GET /categories` para popular o select.
**Alternativa:** enum Postgres — mais simples, exige migration para cada categoria nova.

### TD-07 — Nickname do canal é editável e é chave pública

`channels.nickname` é `unique` e vira a URL `/c/[nickname]`. Editá-lo quebra links existentes.

**A decidir:** permitir a edição (project-plan pede) com `409` em colisão, e se guarda-se histórico de nicknames para redirect. **Recomendação:** permitir, responder `409 NICKNAME_ALREADY_TAKEN`, **sem** histórico nesta fase (registrar como dívida).

### TD-08 — Estratégia do upload no browser

Fatiar o `File` em partes do tamanho que o initiate devolve (`partSizeBytes`), `PUT` por parte, coletar `ETag` de cada resposta, mandar a lista no `complete`.

**A decidir:** concorrência (recomendo 3–4 PUTs simultâneos), política de retry por parte, e se a retomada após falha persiste estado (recomendo **não** persistir nesta fase — retry em memória, cancelar chama `DELETE /videos/{videoId}/uploads`).

---

## 6. Backend — SIs detalhados

### SI-B1 — Módulo `categories`

Novo `nestjs-project/src/categories/`:

```
categories.module.ts
categories.controller.ts     GET /categories   @Public()
categories.service.ts
entities/category.entity.ts  id uuid PK, name varchar(50), slug varchar(50) unique,
                             created_at, updated_at
```

Migration `CreateCategories` + seed das categorias iniciais.
Registrar em `AppModule`.

### SI-B2 — Migration de colunas novas em `videos`

`AddVideoManagementColumns`:

```sql
ALTER TABLE videos ADD COLUMN description  TEXT NULL;
ALTER TABLE videos ADD COLUMN visibility   videos_visibility_enum NOT NULL DEFAULT 'private';
ALTER TABLE videos ADD COLUMN category_id  UUID NULL REFERENCES categories(id) ON DELETE SET NULL;
CREATE INDEX IDX_videos_channel_created ON videos (channel_id, created_at DESC);
```

⚠️ Os dois `CHECK` existentes são `status <> 'ready' OR ...`. Nenhuma coluna nova entra neles — `description` e `category_id` são opcionais mesmo em `ready`.

⚠️ Vídeos já existentes recebem `visibility = 'private'` pelo `DEFAULT`. Se a intenção for que os já-`ready` continuem visíveis, a migration precisa de um `UPDATE videos SET visibility='public' WHERE status='ready'`. **Decidir explicitamente** — é o tipo de detalhe que passa batido e some com conteúdo em produção.

Atualizar `src/videos/entities/video.entity.ts` com as colunas + a relação `@ManyToOne(() => Category)`.

### SI-B3 — `GET /videos/me` — listagem do painel

```
GET /videos/me?limit=20&offset=0&status=ready
→ 200 { items: OwnerVideoListItem[], total: number, limit, offset }
```

- `OwnerVideoListItem`: `publicId`, `videoId`, `title`, `status`, `visibility`, `duration_seconds`, `thumbnailUrl`, `created_at`, `failure_reason`
- Resolve o canal por `channels.findIdByUserId(user.sub)`; sem canal → lista vazia, não erro
- Ordena por `created_at DESC`, usa o índice do SI-B2
- ⚠️ **Conflito de rota:** `GET videos/me/:videoId` já existe. `@Get('me')` precisa ser declarado **antes** de `@Get(':publicId')` no controller, senão o Express casa `me` como `publicId`

### SI-B4 — `PATCH /videos/{videoId}` — edição

```
PATCH /videos/{videoId}
body: UpdateVideoDto { title?, description?, categoryId?, visibility? }
→ 200 OwnerVideo | 400 | 401 | 404 | 409
```

- `UpdateVideoDto` com `class-validator`: `title` 1..200 trimmed, `description` até 5000, `categoryId` UUID existente, `visibility` no enum
- Ownership via `findOwnedEntity()` — **sempre** `VIDEO_NOT_FOUND`, nunca 403
- `409 INVALID_VIDEO_STATE` ao tentar `visibility=public` num vídeo que não é `ready` (não se publica o que não processou)

### SI-B5 — `DELETE /videos/{videoId}`

```
DELETE /videos/{videoId} → 204 | 401 | 404
```

Conforme TD-04. Exige `deleteObject`/`deleteObjects` novos em `StorageService`.

### SI-B6 — Thumbnail customizada

Conforme TD-03. Se presigned: `POST /videos/{videoId}/thumbnail/upload` → URL presigned de `PUT`, mais confirmação que marca a flag de customizada.

### SI-B7 — Filtro de visibilidade nas rotas públicas

Conforme TD-02. Alterar `findReadyEntityByPublicId()` em `videos.service.ts` para filtrar também `visibility <> 'private'` **na mesma query** — nunca fetch-then-check, pelo mesmo motivo que o filtro de `ready` já está lá.

### SI-B8 — Canal: rotas de dono

```
GET   /channels/me                → 200 { id, name, nickname, description, videoCount }
PATCH /channels/me                → 200 | 400 | 401 | 409 NICKNAME_ALREADY_TAKEN
```

Novo `ChannelsController`. `ChannelsService` ganha `findByUserId()` e `update()`. Nickname passa por `sanitizeNickname()` de `nickname.util.ts`; colisão vira `409` (o `createChannel` hoje resolve colisão com sufixo aleatório — em edição manual isso seria errado, o usuário precisa saber).

### SI-B9 — Canal: rotas públicas

```
GET /channels/{nickname}          @Public() → 200 { name, nickname, description, videoCount }
GET /channels/{nickname}/videos   @Public() → 200 { items: PublicVideo[], total, limit, offset }
```

⚠️ A listagem filtra `status='ready' AND visibility='public'` — **exclui `unlisted`**, que é a razão de existir do unlisted.

---

## 7. Frontend — SIs detalhados

### SI-F1 — Regenerar tipos + `contracts.ts`

Pré-requisito §3.1, mais os aliases novos em `lib/api/contracts.ts` (único arquivo autorizado a importar `paths` de `types.gen.ts`): `OwnerVideo`, `OwnerVideoListItem`, `PublicVideo`, `Category`, `Channel`, `UpdateVideoDto`, `InitiateUploadResult`.

### SI-F2 — `proxy.ts` + sessão completa

Pré-requisitos §3.3 e §3.4.

### SI-F3 — Route handlers do BFF

Todos em `next-frontend/app/api/`, todos passando por `withRefresh` de `lib/auth/refresh.ts` e injetando `Authorization: Bearer ${session.accessToken}`:

```
videos/route.ts                            GET    → /videos/me
videos/[videoId]/route.ts                  GET PATCH DELETE
videos/[videoId]/reprocess/route.ts        POST
videos/uploads/route.ts                    POST   → initiate
videos/[videoId]/uploads/route.ts          DELETE → cancel
videos/[videoId]/uploads/complete/route.ts POST
categories/route.ts                        GET
channels/me/route.ts                       GET PATCH
```

### SI-F4 — `/studio` — o painel (lista)

RSC que busca server-side via `upstream`. Tabela/grid simples: thumbnail, título, status (badge), visibilidade, duração, data. Ações por linha: Editar, Excluir, Reprocessar (só em `error`). Estado vazio com CTA para `/studio/upload`.

### SI-F5 — `/studio/[videoId]` — form de edição

RSC de shell + form `"use client"` no padrão do `login-form.tsx` (react-hook-form + Zod espelhando o `UpdateVideoDto` 1:1). Campos: título, descrição, categoria (select alimentado por `/api/categories`), visibilidade (radio). Upload de thumbnail customizada. Botão de excluir com confirmação.

### SI-F6 — `/studio/upload` — a peça mais pesada

Componente client. Fluxo:

1. Usuário escolhe arquivo + título → `POST /api/videos/uploads`
2. Recebe `videoId`, `partSizeBytes`, `parts[{partNumber, url}]`
3. Fatia o `File` com `file.slice(start, end)` e dá `PUT` **direto na URL presigned** (não passa pelo BFF)
4. Lê o header `ETag` de cada resposta — **depende do CORS do §3.2**
5. `POST /api/videos/{videoId}/uploads/complete` com `[{partNumber, etag}]`
6. Faz poll de `GET /api/videos/{videoId}` até sair de `processing`

Concorrência, retry e cancelamento conforme TD-08. Barra de progresso agregando bytes enviados por parte.

⚠️ Sem o worker rodando o vídeo fica em `processing` para sempre. Para testar de verdade: `docker compose --profile live up -d`.

### SI-F7 — `/studio/channel` — edição do canal

Form simples: nome, nickname, descrição. Erro `409` do nickname mapeado inline no campo.

### SI-F8 — `/c/[nickname]` — página pública

RSC pública (sem gate). Cabeçalho do canal + grid de vídeos `ready`+`public`. `generateMetadata` para o título. `notFound()` em nickname inexistente.

### SI-F9 — Navegação

Não existe navbar (é Fase 07). Adicionar um header mínimo no `/studio` com link para o painel, o canal e sair — senão as telas ficam inalcançáveis entre si. Substituir a home placeholder de `app/page.tsx` por um redirect para `/studio`.

---

## 8. Mapa de dependências

```
SI-00 (pré-requisitos §3)
  ├─→ SI-B1 categories ─→ SI-B2 migration ─┬─→ SI-B3 GET /videos/me
  │                                         ├─→ SI-B4 PATCH
  │                                         ├─→ SI-B5 DELETE
  │                                         ├─→ SI-B6 thumbnail
  │                                         └─→ SI-B7 filtro público
  ├─→ SI-B8 canal dono ─→ SI-B9 canal público
  │
  └─→ (backend estável) ─→ SI-F1 tipos ─→ SI-F2 proxy ─→ SI-F3 BFF ─┬─→ SI-F4 /studio
                                                                     ├─→ SI-F5 edição
                                                                     ├─→ SI-F6 upload
                                                                     ├─→ SI-F7 canal
                                                                     └─→ SI-F8 público
                                                                          └─→ SI-F9 navegação
```

**Backend inteiro antes do SI-F1.** Regenerar os tipos com o contrato ainda mudando causa retrabalho em cascata em todo consumidor.

---

## 9. Testes

Sufixo é contrato — dita runner, localização e o que é permitido dentro.

**Backend** (`docker compose exec nestjs-api npm test -- --runInBand`)

| Sufixo | Para quê | Onde |
|---|---|---|
| `*.spec.ts` | lógica pura, colaboradores mockados | ao lado do fonte |
| `*.integration-spec.ts` | DB real, repositórios reais | ao lado do fonte |
| `*.e2e-spec.ts` | ciclo HTTP via supertest | `nestjs-project/test/` |

Cobrir no mínimo: ownership de cada endpoint novo (dono vê, terceiro leva `404` — **nunca** `403`), `409` de nickname, `409` de publicar não-`ready`, filtro de `unlisted` nas 4 rotas públicas, delete removendo objetos do storage.

⚠️ **Não deixar o worker rodando durante a suíte** — ele consome `video-processing` e várias suítes assertam em `getWaitingCount()`.

**Frontend**

| Sufixo | Para quê | Onde |
|---|---|---|
| `*.test.tsx` | client component isolado, `// @vitest-environment jsdom` | `__tests__/` ao lado |
| `*.integration.test.ts` | route handler chamado como função, MSW no upstream | `__tests__/` ao lado |
| `*.e2e-spec.ts` | fluxo em browser real | `next-frontend/tests/` |

⚠️ **RSC `async` não renderiza no Vitest** (React 19 / Next 16). `/studio`, `/c/[nickname]` e os gates só se provam em Playwright.

⚠️ E2E **nunca** faz `page.route()` de `/api/**` — o upstream é fakeado server-side pelo MSW do `instrumentation.ts`. Novos handlers de `videos`/`channels`/`categories` entram em `next-frontend/mocks/handlers/`, compartilhados entre Vitest e Playwright, com triggers reservados que não colidam com os de auth.

---

## 10. Definition of Done

Por `CLAUDE.md` → "Definition of Done (Technical)", **tudo** precisa passar:

```bash
# Backend
docker compose exec nestjs-api npm test -- --runInBand
docker compose exec nestjs-api npm run test:e2e
docker compose exec nestjs-api npx tsc --noEmit      # exit 0
docker compose exec nestjs-api npm run lint

# Frontend
docker compose exec next-frontend npm test
docker compose exec next-frontend npx tsc --noEmit   # exit 0
docker compose exec next-frontend npm run lint       # exit 0

# E2E — dev server no container com MSW, Playwright no HOST
docker compose exec -d next-frontend sh -c "MSW_ENABLED=true npm run dev"
npx playwright test
```

Mais:

- `openapi.json` e `types.gen.ts` regenerados e commitados **no mesmo PR**
- `CLAUDE.md` de ambos os subprojetos atualizados com os endpoints e rotas novos
- `docs/phases/phase-04-*/progress.md` fechado
- Merge em `dev` (**nunca** direto na `main`)

**Verificação manual de ponta a ponta** (com `docker compose --profile live up -d` para o worker consumir a fila): upload de um arquivo real → acompanha `processing` → vira `ready` → edita título/descrição/categoria → publica → abre `/c/[nickname]` numa aba anônima e vê o vídeo → marca como `unlisted` e confirma que sumiu da listagem mas o link direto ainda abre → exclui e confirma que os objetos sumiram do MinIO.

---

## 11. Riscos

| Risco | Impacto | Mitigação |
|---|---|---|
| **CORS do MinIO** (§3.2) | Bloqueia o SI-F6 inteiro; sem `ETag` exposto o `complete` é impossível | Resolver no SI-00 e validar com um `PUT` de teste antes de escrever UI |
| **`GET videos/me` vs `GET videos/:publicId`** | Rota nova capturada pela antiga, 404 silencioso | Ordem de declaração no controller + teste e2e explícito |
| **`visibility` default nos vídeos existentes** | Conteúdo já publicado some | Decidir o `UPDATE` de migração explicitamente no SI-B2 |
| **Filtro de unlisted incompleto** | Vaza vídeo unlisted em listagem, ou vira oráculo de existência | Alterar **só** `findReadyEntityByPublicId()`, o método compartilhado; teste cobrindo as 4 rotas públicas |
| **Upload de arquivo grande no browser** | 10GB derruba a aba se fatiar errado | Nunca ler o arquivo inteiro em memória — `file.slice()` por parte, streaming; testar com arquivo > 1GB |
| **Reprocess sobrescrevendo thumbnail customizada** | Usuário perde a thumb que subiu | Flag de customizada verificada pelo worker (TD-03) |
| **Editar nickname quebra links** | 404 em links compartilhados | TD-07 — aceito nesta fase, registrado como dívida |
| **Worker rodando durante a suíte** | Testes flaky | `docker compose up -d` (sem `--profile live`) ao testar |

---

## 12. Ordem de execução — resumo

1. **SI-00** — pré-requisitos §3 (openapi, CORS, sessão, proxy)
2. **`/research 04`** — fecha TD-01 a TD-08
3. **`/screen-inventory 04`** — se houver Figma; senão pular e registrar
4. **`/plan-context 04`** → **`/plan-validate 04`** → **`/plan-resolve 04`** (laço até `clean`)
5. **`/plan-build 04`** → **`/plan-test-specs 04`**
6. **`/implement 04`** — backend SI-B1..B9, depois frontend SI-F1..F9
7. **Fechamento** — DoD, docs, merge em `dev`
