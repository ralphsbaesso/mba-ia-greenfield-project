# StreamTube

Plataforma de compartilhamento de vídeos. Usuários publicam vídeos em seu canal; qualquer visitante assiste sem precisar de conta.

O upload aguenta arquivos de **até 10 GB** sem que um único byte passe pela API: o cliente recebe URLs pré-assinadas e envia as partes direto ao object storage. Um worker separado consome a fila, extrai metadados com `ffprobe`, gera a thumbnail com `ffmpeg` e publica o vídeo.

```
 Frontend ──REST──▶ API ──jobs──▶ Redis / BullMQ ──▶ Video Worker
    │                │                                    │
    │                ├───────▶ PostgreSQL ◀───────────────┤
    │                │                                    │
    └────────────────┴──▶ Object Storage (MinIO/S3) ◀──────┘
         partes do upload · streaming por URL assinada
```

## Sobre este fork

Fork de [`devfullcycle/mba-ia-greenfield-project`](https://github.com/devfullcycle/mba-ia-greenfield-project), projeto-base de um curso da Full Cycle sobre desenvolvimento assistido por IA. O repositório upstream entrega as Fases 01 e 02 (configuração base e autenticação, backend e frontend).

**O que este fork acrescenta:** a Fase 03 completa — módulo de vídeos, object storage, fila de processamento, worker de FFmpeg e a infraestrutura correspondente no Docker Compose. Nada do upstream foi reescrito; a fase foi somada seguindo os padrões que já existiam.

O histórico commit a commit está em [HISTORY.md](./HISTORY.md).

## Estado atual

| Capacidade | Backend | Frontend |
|---|---|---|
| Cadastro, confirmação por e-mail, login, recuperação de senha | ✅ | ✅ |
| Canal automático por usuário (1:1) | ✅ | — |
| Upload de vídeo até 10 GB, processamento, streaming e download | ✅ | ⏳ |
| Gerenciamento de vídeos e canal | ⏳ | ⏳ |
| Interações sociais (likes, comentários, inscrições) | ⏳ | ⏳ |

A Fase 03 é de backend por definição de escopo: a API, o worker e a infraestrutura estão prontos e testados, mas ainda não existe interface de vídeo no frontend.

## Stack

| Camada | Tecnologia |
|---|---|
| Frontend | Next.js 16 (App Router + RSC), React 19, TypeScript, Tailwind CSS 4, shadcn/ui, React Hook Form + Zod, iron-session, openapi-fetch |
| Backend | NestJS 11, TypeScript, TypeORM, JWT, Argon2, Handlebars (e-mails) |
| Banco | PostgreSQL 17 |
| Object storage | MinIO (API do S3), `@aws-sdk/client-s3` + `s3-request-presigner` |
| Fila | BullMQ 5 sobre Redis 7 (`@nestjs/bullmq`) |
| Processamento de vídeo | FFmpeg / ffprobe |
| E-mail (dev) | Mailpit |
| Testes | Jest + Supertest (backend); Vitest + MSW + Playwright (frontend) |
| Contrato da API | OpenAPI (`@nestjs/swagger`) |
| Infra local | Docker Compose |

## Arquitetura

Monorepo com dois subprojetos, cada um com sua própria stack Docker.

- **Frontend** (`next-frontend/`) — segue o modelo **BFF**: o navegador nunca chama a API NestJS diretamente. Todo tráfego passa por Route Handlers same-origin em `app/api/**`, que fazem proxy server-side. A sessão vive em cookie HTTP-only via iron-session.
- **API** (`nestjs-project/`) — regras de negócio, autenticação, envio de e-mails, acesso ao banco, presign de upload e entrega, publicação de jobs.
- **Video Worker** (`nestjs-project/src/worker.ts`) — segundo entrypoint sobre o mesmo código-fonte, em container próprio com os binários de FFmpeg. Consome fila; não serve HTTP.
- **PostgreSQL** — usuários, canais, tokens de autenticação e vídeos.
- **Object Storage** — um bucket **privado**; o acesso é sempre por URL pré-assinada com validade curta.
- **Redis / BullMQ** — filas de processamento e de manutenção.

Diagrama C4 completo em [`docs/diagrams/software-arch.mermaid`](./docs/diagrams/software-arch.mermaid).

### Pipeline de vídeo

O upload é o único ponto em que a arquitetura foge do "tudo passa pela API" — e é o que viabiliza o teto de 10 GB.

```
draft ──initiate──▶ (linha criada, nenhum byte enviado)
  │
  └──complete──▶ processing ──worker──▶ ready
                      │
                      └──falha──▶ error ──reprocess──▶ processing
```

1. **initiate** — a API cria a linha do vídeo como rascunho, abre um multipart upload no storage e devolve **uma URL pré-assinada por parte**.
2. O cliente envia as partes direto ao storage (`PUT`), em paralelo se quiser.
3. **complete** — a API fecha o multipart e publica o job na fila.
4. O **worker** baixa o objeto para disco temporário, sonda com `ffprobe`, gera a thumbnail com `ffmpeg` e grava metadados + status `ready` em **um único write**.
5. Em caso de falha, o status vira `error` com o motivo registrado, e o dono pode reprocessar.

Só vídeos `ready` aparecem nas rotas públicas. Reprodução e download são **redirects `302` para URLs pré-assinadas**: a API autoriza, o storage serve os bytes.

Rascunhos abandonados são varridos por uma limpeza agendada, que também aborta o multipart no storage.

## Rodando localmente

**Pré-requisitos:** Docker e Docker Compose. Node.js 25+ apenas se você for rodar o Playwright no host.

As duas stacks são independentes — suba o backend primeiro.

### Backend

```bash
cd nestjs-project

cp .env.example .env                                  # o .env não é versionado

# API, PostgreSQL, Mailpit, MinIO (+ criação do bucket) e Redis
docker compose up -d

docker compose exec nestjs-api npm install             # primeira vez
docker compose exec nestjs-api npm run migration:run   # synchronize está desabilitado
docker compose exec -d nestjs-api npm run start:dev
```

| Serviço | Endereço |
|---|---|
| API | http://localhost:3000 |
| Swagger UI | http://localhost:3000/api/docs (requer `SWAGGER_ENABLED=true`) |
| Mailpit (e-mails capturados) | http://localhost:8025 |
| MinIO — console web | http://localhost:9001 |
| MinIO — API S3 | `localhost:9000` |
| PostgreSQL | `localhost:5432` |
| Redis | `localhost:6379` |

Credenciais de desenvolvimento (banco e MinIO): `streamtube` / `streamtube`.

#### Ativando o processamento de vídeo

Por convenção do projeto, `docker compose up -d` sobe **containers, não processos**. Por padrão, então, ninguém consome a fila e um upload ficaria em `processing` indefinidamente. Isso é deliberado: um worker vivo drena a fila `video-processing`, sobre a qual várias suítes de teste asseveram.

Para exercitar o pipeline de verdade, use o profile `live`:

```bash
docker compose --profile live up -d          # sobe o video-worker-live, consumindo a fila
docker compose exec nestjs-api npm run start:dev
```

Mesma imagem e mesmo código do serviço `video-worker`; a única diferença é executar o entrypoint em vez de ficar ocioso.

### Frontend

O `next-frontend` valida suas variáveis em `lib/env.ts` e **falha em runtime sem elas**. O `.env.local` não é versionado e o subprojeto não traz um exemplo — crie o arquivo antes de subir:

```bash
cd next-frontend

cat > .env.local <<'ENV'
API_URL=http://host.docker.internal:3000
SESSION_PASSWORD=troque-por-32-caracteres-aleatorios-ou-mais
ENV

docker compose up -d
docker compose exec next-frontend npm install     # primeira vez
docker compose exec -d next-frontend npm run dev
```

Disponível em **http://localhost:3001**.

`SESSION_PASSWORD` precisa de no mínimo 32 caracteres (é a chave da iron-session). `host.docker.internal` resolve porque o compose do frontend declara `extra_hosts: host-gateway` — as stacks estão em redes Docker distintas. Se um dia forem unificadas, o valor passa a ser `http://nestjs-api:3000`.

## API

Contrato completo e versionado em [`nestjs-project/openapi.json`](./nestjs-project/openapi.json), regenerado com `npm run openapi:export`.

### Autenticação

| Método & Rota | Descrição |
|---|---|
| `POST /auth/register` | Cadastro (cria usuário + canal) |
| `GET /auth/confirm-email?token=` | Confirmação de conta via link do e-mail |
| `POST /auth/resend-confirmation` | Reenvio do e-mail de confirmação |
| `POST /auth/login` | Login (access + refresh token) |
| `POST /auth/refresh` | Rotação de refresh token (família + grace period) |
| `POST /auth/logout` | Revoga os refresh tokens da sessão |
| `POST /auth/forgot-password` | Solicita e-mail de recuperação |
| `POST /auth/reset-password` | Redefine a senha via token |
| `GET /auth/me` | Dados do usuário autenticado |

Senhas com **Argon2**. `JwtAuthGuard` global, com opt-out por `@Public()`. Rotação de refresh token com detecção de reuso por família. Rate limiting de 10 req/min nos endpoints de auth.

### Vídeos

| Método & Rota | Acesso | Descrição |
|---|---|---|
| `POST /videos/uploads` | dono | Initiate: cria o rascunho (com título), abre o multipart, devolve uma URL pré-assinada por parte |
| `POST /videos/{videoId}/uploads/complete` | dono | Fecha o multipart e publica o job de processamento |
| `DELETE /videos/{videoId}/uploads` | dono | Cancela: aborta o multipart e descarta o rascunho |
| `GET /videos/me/{videoId}` | dono | Lê um vídeo próprio em **qualquer** status |
| `POST /videos/{videoId}/reprocess` | dono | Republica o job de um vídeo em `error` |
| `GET /videos/{publicId}` | público | Metadados — somente `ready` |
| `GET /videos/{publicId}/stream` | público | `302` para URL pré-assinada de reprodução |
| `GET /videos/{publicId}/download` | público | `302` para o mesmo objeto, assinado como anexo |
| `GET /videos/{publicId}/thumbnail` | público | `302` para a thumbnail pré-assinada |

**Dois identificadores, de propósito.** Rotas do dono usam o `videoId` interno (UUID); rotas públicas usam o `public_id` — `randomBytes(9).toString('base64url')`, 12 caracteres e 72 bits de entropia. É ele a **URL única** do vídeo, e nunca expõe a chave primária.

**Garantias no banco.** Duas constraints `CHECK` protegem o contrato de `ready`: sem metadados completos (duração, resolução, codecs, container, tamanho) e sem thumbnail, a linha não alcança esse status. Ambas são *state-scoped*, porque o initiate insere a linha antes de qualquer byte existir.

**Resiliência.** O `jobId` é o id do vídeo, então chamar complete duas vezes deduplica na própria fila. Três tentativas com backoff exponencial e, esgotadas, o job vai para uma DLQ explícita (`video-processing-dlq`) em vez de ser descartado — BullMQ não tem dead-letter queue nativa. Uma limpeza horária aborta o multipart de rascunhos com mais de 24h.

## Testes

### Backend

```bash
cd nestjs-project
docker compose exec nestjs-api npm test -- --runInBand     # unitários + integração
docker compose exec nestjs-api npm run test:integration    # somente integração
docker compose exec nestjs-api npm run test:e2e            # end-to-end (HTTP via supertest)
docker compose exec nestjs-api npm run test:cov            # cobertura
```

Sufixos: `*.spec.ts` (unitário, colaboradores mockados), `*.integration-spec.ts` (banco e serviços reais), `*.e2e-spec.ts` (ciclo HTTP completo).

As suítes de integração e e2e compartilham um banco e truncam as mesmas tabelas — **precisam rodar em série**. O `test:e2e` já garante isso via `maxWorkers: 1` na sua config; para `npm test`, passe `-- --runInBand`. Em paralelo o resultado são violações de FK e contaminação entre suítes.

As suítes de `src/videos/processing/` invocam `ffprobe` e `ffmpeg` de verdade — nada de mock onde a infra do Compose dá para exercitar o real. Os binários estão nas imagens de dev da API e do worker, então a suíte fecha verde em qualquer um dos dois containers.

### Frontend

```bash
cd next-frontend
docker compose exec next-frontend npm test     # unitários + integração (Vitest + MSW)
npx playwright test                            # e2e no host, com MSW_ENABLED=true
```

Sufixos: `*.test.ts(x)`, `*.integration.test.ts(x)` (Route Handlers com MSW) e `*.e2e-spec.ts` (Playwright). O MSW intercepta as chamadas à API — os testes do frontend não dependem do backend rodando.

## Desenvolvimento assistido por IA

O repositório é construído por um pipeline de planejamento em que cada estágio produz um artefato versionado, e é assim que a Fase 03 foi entregue:

```
research ──▶ context ──▶ validate ──▶ resolve ──▶ build ──▶ implement
    │           │           │            │           │          │
 decisões    contexto    veredito    libs fixadas  plano     código +
 técnicas    da fase    clean/dirty                com SIs   progresso
```

- **Decisões técnicas** (`docs/decisions/`) — cada decisão em aberto registrada com opções, trade-offs e escolha. A Fase 03 fechou 15, entre elas a tecnologia de fila, a estratégia de upload de 10 GB e o modelo de entrega.
- **Artefatos da fase** (`docs/phases/`) — contexto, validação, libs fixadas, o plano quebrado em *Step Implementations* com Data Model, API Contracts, Authorization Matrix, Error Catalog e Events/Messages, e o registro de progresso.
- **Instruções e ferramental** (`CLAUDE.md`, `nestjs-project/CLAUDE.md`, `.claude/`) — regras, skills e sub-agents que orientam o trabalho e mantêm a documentação alinhada ao código.

A Fase 03 saiu em 17 Step Implementations, cada uma com sua suíte verde antes de avançar.

**Definition of Done** — nenhuma mudança é considerada pronta sem: suíte relevante verde, suíte completa verde, `npx tsc --noEmit` em código 0 e `npm run lint` limpo.

## Estrutura do repositório

```
.
├── docs/
│   ├── project-plan.md              # Planejamento geral, fase a fase
│   ├── decisions/                   # Decisões técnicas com trade-offs
│   ├── phases/                      # Contexto, plano e progresso por fase
│   └── diagrams/                    # Diagrama de arquitetura (C4)
├── nestjs-project/                  # Backend
│   ├── src/
│   │   ├── auth/                    # Cadastro, login, JWT, refresh, reset de senha
│   │   ├── users/                   # Usuários
│   │   ├── channels/                # Canal 1:1 por usuário
│   │   ├── videos/                  # uploads/, processing/, delivery/ e leituras
│   │   ├── storage/                 # Cliente S3/MinIO, presign, layout de chaves
│   │   ├── mail/                    # E-mails transacionais (Handlebars)
│   │   ├── common/                  # Filtros, pipes e exceptions de domínio
│   │   ├── config/                  # Configuração validada com Joi
│   │   ├── database/                # data-source, migrations e seeds
│   │   ├── main.ts                  # Entrypoint da API
│   │   └── worker.ts                # Entrypoint do video worker
│   ├── test/                        # Suítes e2e
│   ├── openapi.json                 # Contrato da API
│   ├── compose.yaml                 # API, Postgres, Mailpit, MinIO, Redis, worker
│   ├── Dockerfile.dev
│   └── Dockerfile.worker.dev        # Imagem do worker (com FFmpeg)
├── next-frontend/                   # Frontend
│   ├── app/                         # Rotas, layouts e Route Handlers do BFF
│   ├── components/                  # Componentes de auth, UI (shadcn) e ícones
│   ├── lib/                         # env, cliente da API, sessão
│   ├── mocks/                       # MSW (handlers + server)
│   ├── tests/                       # E2E (Playwright)
│   └── compose.yaml
├── .claude/                         # Skills, sub-agents e rules do workflow
├── CLAUDE.md                        # Instruções de projeto para a IA
├── HISTORY.md                       # Timeline dos commits
└── README.md
```

## Roadmap

| Fase | Descrição | Status |
|---|---|---|
| 01 | Configuração base do projeto | ✅ Concluída |
| 02 | Cadastro, login e gerenciamento de conta | ✅ Concluída |
| 03 | Upload e processamento de vídeos | ✅ Concluída |
| 04 | Gerenciamento de vídeos e canal | ⏳ Planejada |
| 05 | Página de visualização do vídeo | ⏳ Planejada |
| 06 | Interações sociais (likes, comentários, inscrições) | ⏳ Planejada |
| 07 | Página inicial, busca e finalização | ⏳ Planejada |

Escopo detalhado de cada fase em [`docs/project-plan.md`](./docs/project-plan.md).

## Referências de design

- [`FC Tube.fig`](./FC%20Tube.fig) — design system no Figma: tokens (cores, tipografia, espaçamento, raios), componentes e telas da plataforma. Os componentes em `next-frontend/components/ui` e os tokens em `next-frontend/app/globals.css` derivam dele.
- [`whiteboard.svg`](./whiteboard.svg) — quadro branco com o desenho inicial do produto e da arquitetura.

## Histórico

A evolução do projeto commit a commit — fundação, workflow de IA e as três fases entregues — está em **[HISTORY.md](./HISTORY.md)**.
