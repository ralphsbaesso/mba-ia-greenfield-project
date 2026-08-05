# StreamTube — Plataforma de Compartilhamento de Vídeos

Projeto da disciplina **Desenvolvimento de Aplicações de IA** do MBA de Engenharia de Software com IA da [Full Cycle](https://fullcycle.com.br).

Este é um projeto greenfield desenvolvido para demonstrar como construir uma aplicação do zero utilizando IA de forma adequada no processo de desenvolvimento.

## Professor

<a href="https://github.com/argentinaluiz">
    <img src="https://avatars.githubusercontent.com/u/4926329?v=4?s=100" width="100px;" alt=""/>
    <br />
    <sub>
        <b>Luiz Carlos</b>
    </sub>
</a>

---

## Quadro Branco

- [Quadro Branco](./whiteboard.png)

---

## 🎨 Design System (Figma)

- [FC Tube.fig](./FC%20Tube.fig) — arquivo-fonte do **design system** do projeto no Figma.

Contém os fundamentos visuais do StreamTube — tokens (cores, tipografia, espaçamento, raios), componentes e as telas da plataforma. É a referência de design para a implementação do frontend: os componentes em `next-frontend/components/ui` (shadcn) e os tokens em `next-frontend/app/globals.css` derivam deste arquivo. Abra-o no Figma (`Arquivo → Importar`) para consultar especificações e estados visuais.

---

## 📋 Pré-requisitos

- Docker e Docker Compose
- Node.js v25+ (para rodar os testes E2E do Playwright no host)
- npm

## 🏗️ Arquitetura

O projeto é um monorepo baseado em containers Docker. Cada subprojeto sobe sua própria stack via `docker compose`.

- **Frontend** (Next.js 16, App Router + React Server Components) — interface da plataforma. Segue o **modelo BFF**: o navegador nunca chama a API NestJS diretamente; todo tráfego passa por Route Handlers same-origin em `app/api/**`, que fazem proxy server-side para a API.
- **API** (NestJS 11) — regras de negócio, autenticação (JWT + refresh token rotation), envio de e-mails, acesso ao banco, presign de upload/entrega e publicação de jobs na fila.
- **Database** (PostgreSQL 17) — usuários, canais, tokens de autenticação e vídeos.
- **Email Service** (Mailpit) — captura os e-mails transacionais (confirmação de conta e recuperação de senha) em uma UI local.
- **Object Storage** (MinIO, API do S3) — arquivos de vídeo e thumbnails, em um bucket **privado**.
- **Message Queue** (BullMQ sobre Redis) — fila de processamento de vídeos.
- **Video Worker** (FFmpeg) — container separado que consome a fila, extrai metadados com `ffprobe` e gera a thumbnail com `ffmpeg`.

O diagrama de arquitetura completo (C4) está em `docs/diagrams/software-arch.mermaid`.

### Pipeline de vídeo

O upload é o único ponto em que a arquitetura foge do "tudo passa pela API" — e é o que permite o teto de 10 GB sem a API segurar os bytes:

```
draft ──initiate──▶ (linha criada, nenhum byte enviado)
  │
  └──complete──▶ processing ──worker──▶ ready
                      │
                      └──falha──▶ error ──reprocess──▶ processing
```

O cliente pede o upload à API, que cria a linha, abre um **multipart upload** no storage e devolve **uma URL pré-assinada por parte**. O cliente envia as partes direto ao storage (`PUT`) e só então chama o complete, que publica o job na fila. Reprodução e download são **redirects `302` para URLs pré-assinadas**: a API autoriza, o storage serve.

## 🚀 Como rodar

Os dois subprojetos têm stacks Docker **separadas**. Suba primeiro o backend, rode as migrations e depois o frontend.

### 1. Backend (NestJS + PostgreSQL + Mailpit + MinIO + Redis + worker)

```bash
cd nestjs-project

# Copie o .env de exemplo (apenas na primeira vez)
cp .env.example .env

# Sobe API, banco, Mailpit, MinIO (+ criação do bucket) e Redis
docker compose up -d

# Instala dependências (apenas na primeira vez)
docker compose exec nestjs-api npm install

# Cria o schema do banco (obrigatório — synchronize está desabilitado)
docker compose exec nestjs-api npm run migration:run

# Sobe o servidor de desenvolvimento em watch mode
docker compose exec -d nestjs-api npm run start:dev
```

Serviços disponíveis:

| Serviço | URL / Porta |
|---------|-------------|
| API NestJS | http://localhost:3000 |
| PostgreSQL | `localhost:5432` (db/user/senha: `streamtube`) |
| Mailpit (UI de e-mails) | http://localhost:8025 |
| MinIO (API S3) | `localhost:9000` (user/senha: `streamtube`) |
| MinIO (console web) | http://localhost:9001 |
| Redis | `localhost:6379` |
| Swagger (opcional) | http://localhost:3000/api/docs — habilite com `SWAGGER_ENABLED=true` |

#### Processando vídeos de verdade

Por convenção do projeto, o `docker compose up -d` sobe **containers, não processos** — então, por padrão, ninguém consome a fila e um upload ficaria em `processing` para sempre. Isso é deliberado: um worker vivo drena a fila `video-processing`, sobre a qual várias suítes de teste asseveram.

Para exercitar o pipeline completo, use o profile `live`:

```bash
docker compose --profile live up -d          # inclui o video-worker-live, consumindo a fila
docker compose exec nestjs-api npm run start:dev
```

Mesma imagem e mesmo código do serviço `video-worker`; a única diferença é rodar o entrypoint (`src/worker.ts`) em vez de ficar ocioso.

### 2. Frontend (Next.js)

```bash
cd next-frontend

# Garanta que o .env.local existe (veja .env.example)
# API_URL aponta para o backend; SESSION_PASSWORD protege a sessão (iron-session)

docker compose up -d
docker compose exec next-frontend npm install        # apenas na primeira vez
docker compose exec -d next-frontend npm run dev
```

A aplicação ficará disponível em **http://localhost:3001**.

> As stacks são separadas, então o frontend acessa o backend via `host.docker.internal:3000` (configurado em `next-frontend/.env.local` e no `extra_hosts` do compose).

## 🧪 Testes

### Backend (Jest)

```bash
cd nestjs-project
docker compose exec nestjs-api npm test -- --runInBand     # unitários + integração
docker compose exec nestjs-api npm run test:integration    # somente integração
docker compose exec nestjs-api npm run test:e2e            # end-to-end (HTTP via supertest)
docker compose exec nestjs-api npm run test:cov            # cobertura
```

Sufixos: `*.spec.ts` (unitário), `*.integration-spec.ts` (integração com banco real), `*.e2e-spec.ts` (end-to-end).

As suítes de integração e e2e compartilham um único banco de teste e truncam as mesmas tabelas — **precisam rodar em série**. O `test:e2e` já garante isso via `maxWorkers: 1` no `test/jest-e2e.json`; para `npm test`, passe `-- --runInBand`. Em paralelo, o resultado são violações de FK e contaminação entre suítes.

As suítes de `src/videos/processing/` invocam `ffprobe`/`ffmpeg` de verdade. Os binários estão nas imagens de dev **da API e do worker**, então a suíte fecha verde em qualquer um dos dois containers.

### Frontend (Vitest + Playwright)

```bash
cd next-frontend
docker compose exec next-frontend npm test            # unitários + integração (Vitest + MSW)
npx playwright test                                   # end-to-end (no host, com dev server em MSW_ENABLED=true)
```

Sufixos: `*.test.ts(x)` (unitário), `*.integration.test.ts(x)` (Route Handlers com MSW), `*.e2e-spec.ts` (Playwright). MSW intercepta as chamadas à API NestJS — os testes nunca batem no backend real.

## ✅ Funcionalidades implementadas

**Fase 01 — Configuração base**, **Fase 02 — Autenticação** (backend + frontend) e **Fase 03 — Upload e Processamento de Vídeos** (backend) estão concluídas.

### Autenticação (Fase 02)

Fluxo completo de **cadastro → confirmação por e-mail → login → recuperação de senha**, com canal criado automaticamente para cada usuário (a partir do prefixo do e-mail).

Endpoints da API (`nestjs-project`):

| Método & Rota | Descrição |
|---------------|-----------|
| `POST /auth/register` | Cadastro de usuário (cria usuário + canal) |
| `GET /auth/confirm-email?token=` | Confirmação de conta via link do e-mail |
| `POST /auth/resend-confirmation` | Reenvio do e-mail de confirmação |
| `POST /auth/login` | Login (retorna access + refresh token) |
| `POST /auth/refresh` | Rotação de refresh token (com family + grace period) |
| `POST /auth/logout` | Revoga os refresh tokens da sessão |
| `POST /auth/forgot-password` | Solicita e-mail de recuperação de senha |
| `POST /auth/reset-password` | Redefine a senha via token |
| `GET /auth/me` | Dados do usuário autenticado (protegido por JWT) |

Telas e Route Handlers BFF (`next-frontend`):

- `/(auth)/signup`, `/(auth)/login`, `/(auth)/forgot-password` — formulários com React Hook Form + Zod e validação inline.
- `app/api/auth/{signup,login,logout,forgot-password}` — proxy same-origin para a API.

Segurança: senhas com **Argon2**, **JWT** com `JwtAuthGuard` global (opt-out via `@Public()`), **rotação de refresh token** com detecção de reuso, **rate limiting** (`ThrottlerGuard`) nos endpoints de auth, e sessão no navegador via **iron-session** (cookies HTTP-only).

### Vídeos (Fase 03)

Upload de **até 10 GB** sem passar pela API, processamento assíncrono em fila e entrega por URL pré-assinada. Escopo de backend — a interface de vídeo entra nas fases seguintes.

Endpoints da API (`nestjs-project`):

| Método & Rota | Auth | Descrição |
|---------------|------|-----------|
| `POST /videos/uploads` | dono | Initiate: cria o rascunho (com título), abre o multipart e devolve uma URL pré-assinada por parte |
| `POST /videos/{videoId}/uploads/complete` | dono | Fecha o multipart e publica o job de processamento |
| `DELETE /videos/{videoId}/uploads` | dono | Cancela o upload (aborta o multipart e descarta o rascunho) |
| `GET /videos/me/{videoId}` | dono | Lê um vídeo próprio **em qualquer status** |
| `POST /videos/{videoId}/reprocess` | dono | Republica o job de um vídeo em `error` |
| `GET /videos/{publicId}` | público | Metadados públicos — somente `ready` |
| `GET /videos/{publicId}/stream` | público | `302` para URL pré-assinada de reprodução |
| `GET /videos/{publicId}/download` | público | `302` para o mesmo objeto, assinado como anexo |
| `GET /videos/{publicId}/thumbnail` | público | `302` para a thumbnail pré-assinada |

**Dois identificadores, de propósito:** as rotas do dono usam o `videoId` interno (UUID); as públicas usam o `public_id` — `randomBytes(9).toString('base64url')`, 12 caracteres e 72 bits de entropia, que é a **URL única** do vídeo.

**Processamento.** O worker baixa o objeto para um arquivo temporário, sonda com `ffprobe` (duração, resolução, codecs, container), gera a thumbnail com `ffmpeg` e grava metadados + status em **um único write**. Duas constraints `CHECK` garantem o contrato de `ready`: sem metadados completos e sem thumbnail, a linha não pode chegar a esse status.

**Resiliência.** `jobId` igual ao id do vídeo (chamar complete duas vezes deduplica na fila), 3 tentativas com backoff exponencial, uma DLQ explícita (`video-processing-dlq`) para jobs esgotados e uma limpeza horária que aborta o multipart de rascunhos com mais de 24h.

O contrato completo está em `nestjs-project/openapi.json` (regenerado com `npm run openapi:export`) e a documentação do módulo em `nestjs-project/CLAUDE.md`.

## 🛠️ Estrutura do Projeto

```
mba-ia-greenfield-project/
├── docs/
│   ├── project-plan.md                  # Planejamento geral do projeto
│   ├── desafio.md                       # Enunciado do desafio da Fase 03
│   ├── decisions/                       # Decisões técnicas (research) por fase
│   ├── phases/                          # Planos e implementação por fase
│   │   ├── phase-01-configuracao-base/
│   │   ├── phase-02-auth/               # Auth (backend)
│   │   ├── phase-02-auth-frontend/      # Auth (frontend)
│   │   └── phase-03-videos/             # Vídeos: contexto, validação, plano e progresso
│   └── diagrams/
│       └── software-arch.mermaid        # Diagrama de arquitetura (C4)
├── nestjs-project/                      # Backend API (NestJS 11)
│   ├── src/
│   │   ├── auth/                        # Cadastro, login, JWT, refresh, reset de senha
│   │   ├── users/                       # Entidade e serviço de usuários
│   │   ├── channels/                    # Canal 1:1 por usuário (nickname do e-mail)
│   │   ├── videos/                      # Vídeos: uploads/, processing/, delivery/ e leituras
│   │   ├── storage/                     # Cliente S3/MinIO, presign e layout de chaves
│   │   ├── mail/                        # Envio de e-mails (templates Handlebars)
│   │   ├── common/                      # Filtros, pipes e exceptions de domínio
│   │   ├── config/                      # Configs namespaced (Joi)
│   │   ├── database/                    # data-source, migrations e seeds
│   │   ├── main.ts                      # Entrypoint da API
│   │   └── worker.ts                    # Entrypoint do video worker
│   ├── test/                            # Testes e2e
│   ├── openapi.json                     # Contrato da API (npm run openapi:export)
│   ├── compose.yaml                     # Compose (API + Postgres + Mailpit + MinIO + Redis + worker)
│   ├── Dockerfile.dev
│   └── Dockerfile.worker.dev            # Imagem do worker (com ffmpeg/ffprobe)
├── next-frontend/                       # Frontend (Next.js 16, App Router)
│   ├── app/                             # Rotas, layouts, páginas e Route Handlers BFF
│   ├── components/                      # Componentes de auth, UI (shadcn) e ícones
│   ├── lib/                             # env, api (openapi-fetch), auth/session
│   ├── mocks/                           # MSW (handlers + server)
│   ├── tests/                           # E2E (Playwright)
│   ├── compose.yaml                     # Docker Compose (dev server)
│   └── Dockerfile.dev
├── CLAUDE.md                            # Instruções para IA
├── FC Tube.fig                          # Design system do projeto (Figma)
├── whiteboard.png                       # Quadro branco do projeto
├── HISTORY.md                           # Timeline dos commits do projeto
└── README.md
```

## 📚 Fases do Projeto

| Fase | Descrição | Status |
|------|-----------|--------|
| **01** | Configuração Base do Projeto | ✅ Concluída |
| **02** | Cadastro, Login e Gerenciamento de Conta | ✅ Concluída |
| **03** | Upload e Processamento de Vídeos | ✅ Concluída |
| **04** | Gerenciamento de Vídeos e Canal | ⏳ Planejada |
| **05** | Página de Visualização do Vídeo | ⏳ Planejada |
| **06** | Interações Sociais (Likes, Comentários, Inscrições) | ⏳ Planejada |
| **07** | Página Inicial, Busca e Finalização | ⏳ Planejada |

Detalhes completos em `docs/project-plan.md`.

## 📖 Stack Tecnológica

| Camada | Tecnologia |
|--------|------------|
| Frontend | Next.js 16, React 19, TypeScript, Tailwind CSS 4, shadcn/ui, React Hook Form + Zod, iron-session, openapi-fetch |
| Backend | NestJS 11, TypeScript, TypeORM, JWT, Argon2, Mailer (Handlebars) |
| Banco de Dados | PostgreSQL 17 |
| Object Storage | MinIO (API do S3), `@aws-sdk/client-s3` + `s3-request-presigner` |
| Fila | BullMQ 5 sobre Redis 7 (`@nestjs/bullmq`) |
| Processamento de vídeo | FFmpeg / ffprobe |
| E-mail (dev) | Mailpit |
| Containerização | Docker, Docker Compose |
| Testes | Jest, Supertest (backend); Vitest, MSW, Playwright (frontend) |
| Qualidade | ESLint, Prettier |
| Documentação da API | OpenAPI (`@nestjs/swagger`) |

---

## 🕓 Histórico

A evolução do projeto commit a commit — fundação, workflow de IA e as três fases entregues — está em **[HISTORY.md](./HISTORY.md)**.
</content>
