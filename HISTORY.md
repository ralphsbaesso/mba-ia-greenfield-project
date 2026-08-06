# Histórico do Projeto

Timeline do StreamTube, do commit inicial até o fechamento da Fase 03.

**113 commits** entre **2026-03-15** e **2026-08-05**, em dois blocos de autoria:

| Bloco | Commits | Período | Autoria |
|---|---|---|---|
| Fundação + Fases 01 e 02 (backend e frontend) | 67 | 2026-03-15 → 2026-06-23 | repositório base ([Luiz Carlos](https://github.com/argentinaluiz)) |
| Fase 03 — Upload e Processamento de Vídeos | 45 | 2026-07-27 → 2026-08-03 | este fork |
| Merge de integração `dev` → `main` (PR #1) | 1 | 2026-08-05 | este fork |

Dos 45 commits da Fase 03, 40 são de trabalho e 5 são merges de integração das sub-branches para a `dev`.

---

## Panorama

```
2026-03  ●─ fundação: NestJS, Docker, CLAUDE.md, rules, primeiras skills
2026-04  ●─ workflow de IA (research → plan → implement) + Fase 01 + Fase 02 backend (SI-02.1 → SI-02.13)
2026-05  ●─ design system (Figma), Next.js, shadcn, OpenAPI, fundação de testes do frontend
2026-06  ●─ Fase 02 frontend concluída
2026-07  ●─ Fase 03: research → planejamento → infra → upload multipart → worker
2026-08  ●─ Fase 03: entrega, streaming, fechamento da DoD e merge na main
```

---

## 2026-03 — Fundação do repositório

O esqueleto do projeto e a primeira camada de instruções para IA.

| Data | Commit | O que entrou |
|---|---|---|
| 03-15 | `ec3d176` | Planejamento geral e diagrama de arquitetura (C4) |
| 03-15 | `34d5ace` `8658b7f` `a739286` | Projeto backend NestJS, `.gitignore` e Docker |
| 03-16 | `6d60f77` `f6e5b73` `0d06ee2` `45ae538` | `CLAUDE.md` global, `CLAUDE.md` do NestJS, rules e README |
| 03-19 | `f1656f2` `4658bdd` | Curadoria das skills de boas práticas (NestJS, TypeORM) |
| 03-30 → 03-31 | `0678a1a` `b0d012e` | Correção de inconsistências entre rules e skills; reforço de ativação |

## 2026-04 — Workflow de IA e Fases 01 / 02 (backend)

O mês em que o **workflow em pipeline** nasceu — e é ele que a Fase 03 seguiria depois.

**Ferramental**

| Data | Commit | O que entrou |
|---|---|---|
| 04-01 | `ce57bcd` | Skill geradora de guia de testes |
| 04-01 | `b5d3507` `15973d3` `aa378c5` | MCP: exemplo de servidor, Context7 e PostgreSQL |
| 04-04 | `dbb0da3` | Skill `research` |
| 04-08 | `b9d9878` `b630fa8` | Skills de planejamento e de implementação de fase |
| 04-08 | `a5f3d66` `45c9331` `0b82246` | Refinamento do workflow: decisões obscuras, resolução de contradições, diagramas de fluxo |

**Fases**

| Data | Commit | O que entrou |
|---|---|---|
| 04-08 | `8c9336d` | **Fase 01 — Configuração base** concluída |
| 04-08 | `dc572ce` `12f296e` | Planejamento da Fase 02 e alinhamento às convenções REST |
| 04-08 | `3557916` | SI-02.1 / SI-02.2 — dependências de auth e filtros globais de exceção |
| 04-08 | `2f1751e` | SI-02.3 — entidades `User` e `Channel` (canal 1:1 por usuário) |
| 04-30 | `809057e` | SI-02.4 — `RefreshToken` e `VerificationToken` |
| 04-30 | `4c61a65` | SI-02.5 — `MailModule` com Handlebars + Mailpit |
| 04-30 | `5dfc343` | SI-02.6 — registro de usuário com criação automática de canal |
| 04-30 | `0f89800` | SI-02.7 — confirmação de e-mail e reenvio |
| 04-30 | `33c3c24` | SI-02.8 — login com access + refresh token |
| 04-30 | `c927802` | SI-02.9 — guard JWT global, `@Public()` e `@CurrentUser()` |
| 04-30 | `9ad00f0` | SI-02.10 — rotação de refresh token com detecção de reuso por família |
| 04-30 | `9e1a38f` | SI-02.11 — logout com revogação |
| 04-30 | `102d781` | SI-02.12 — redefinição de senha via token |

## 2026-05 — Frontend: design system, Next.js e fundação de testes

| Data | Commit | O que entrou |
|---|---|---|
| 05-01 | `03d1f61` | SI-02.13 — rate limiting de 10 req/min nos endpoints de auth |
| 05-05 | `47b4659` `6e54d1d` | Correções pós-Fase 02 e aprendizados incorporados às rules |
| 05-08 | `6a11f17` `476b2d0` `f6a21e4` | MCP do Figma, doc do design system e criação do projeto Next.js |
| 05-09 | `5348ec5` `e34deb9` `4f9444a` | Figma MCP remoto e skills de auditoria/aplicação de tokens |
| 05-10 → 05-11 | `50c06d4` `aa5746b` `a70df72` `3812384` | shadcn instalado, `globals.css` ajustado, `Button` com o novo design e rules de design system |
| 05-12 | `9264685` `b268e5f` `041848e` | Novas skills e sub-agents do workflow; docs de fases retroalimentados no novo formato |
| 05-12 → 05-13 | `2953d69` `593f2df` | Documentação OpenAPI no NestJS e rules correspondentes |
| 05-13 | `4ace4db` `5176729` `e97733b` `38a3076` | Fundação de IA do Next.js e guias de teste |
| 05-13 | `21f954a` `5d6949f` `8e16170` | Config de env, tipagem via OpenAPI e fundação Vitest + MSW no frontend |

## 2026-06 — Fase 02 concluída ponta a ponta

| Data | Commit | O que entrou |
|---|---|---|
| 06-23 | `f52078c` | **Fase 02 — frontend** implementada (telas de auth + Route Handlers BFF) |
| 06-23 | `2c017d6` `2e9777e` `fbd1e72` | Quadro branco, README e arquivo do design system (`FC Tube.fig`) |

> Fim do repositório base. Tudo a partir daqui é a Fase 03.

---

## 2026-07 — Fase 03: preparação, research e planejamento

### Setup e saneamento da base (07-27 → 07-28)

Antes de planejar, a base precisava fechar verde — a Definition of Done é pré-requisito, não etapa final.

| Data | Commit | O que entrou |
|---|---|---|
| 07-27 | `80ce5c6` | Enunciado do desafio e planos de execução da fase |
| 07-27 | `daf122b` | MCP **Context7** para consulta de docs das libs novas |
| 07-27 | `a59d7b6` | `MAIL_FROM` com aspas no `.env.example` — o valor tinha `<>`, que o shell lia como redirecionamento |
| 07-27 | `f75d34f` | Limpeza de enum type no setup do spec de migrations |
| 07-27 | `c982db3` | **150 erros de lint zerados** — a DoD exige `npm run lint` limpo, e o baseline estava vermelho |
| 07-28 | `0ff0cba` | `jest/unbound-method` em vez de desligar a regra nos testes |

Merges de integração: `09b66c6` `9aeba2c` `def2917` `a7f7a0c` `28e9161`.

### Research → decisões técnicas (07-28 → 07-29)

| Data | Commit | O que entrou |
|---|---|---|
| 07-28 | `74c13da` | `technical-decisions-phase-03-videos.md` — **15 TDs** decididos |
| 07-29 | `e18baad` | Decisões ad-hoc de autorização e metadados de vídeo |

As cinco decisões que o desafio deixava em aberto:

| TD | Decisão |
|---|---|
| TD-04 | **Fila:** BullMQ sobre Redis |
| TD-05 | **Upload de 10GB:** multipart S3 com URL pré-assinada por parte — o arquivo nunca passa pela API |
| TD-07 / TD-09 | **Processamento:** `ffprobe` para metadados, `ffmpeg` para thumbnail, binários na imagem do worker |
| TD-11 | **Entrega:** redirect `302` para URL pré-assinada — o storage serve, a API só autoriza |
| TD-12 | **Ciclo de status:** `draft → processing → ready \| error`, com `error → processing` no reprocess |

### Planejamento (07-28 → 07-31)

| Data | Commit | O que entrou |
|---|---|---|
| 07-28 | `30117ec` | `context.md` — contexto consolidado da fase |
| 07-28 | `3700803` | `validation.md` — primeira rodada de validação |
| 07-29 | `35392d0` | Planejamento fechado com **`status: clean`** e `library-refs.md` |
| 07-30 | `bd80e26` | `phase-03-videos.md` — **17 SIs**, Technical Specs, Dependency Map e Deliverables |
| 07-31 | `f02ba88` | Planos de test spec dos endpoints de vídeo |

## 2026-07-31 → 08-01 — Implementação, SI a SI

Um commit por Step Implementation, na ordem do Dependency Map.

### Infraestrutura e persistência

| SI | Commit | O que entrou |
|---|---|---|
| SI-03.1 | `eedbe86` | MinIO e Redis no Compose (tag do MinIO pinada, `maxmemory-policy noeviction` no Redis) |
| SI-03.2 | `99a5e7a` | `StorageService` sobre S3/MinIO e o layout de chaves |
| SI-03.3 | `0c138d9` | Entidade `Video` + migration `CreateVideos`, com os `CHECK` state-scoped do contrato `ready` |
| SI-03.4 | `38d8f76` | Fila `video-processing` registrada no BullMQ |

### Upload sem passar pela API

| SI | Commit | O que entrou |
|---|---|---|
| SI-03.5 | `186cc47` | Initiate: pré-cadastro do rascunho + presign de cada parte |
| SI-03.6 | `08d26ca` | Complete: fecha o multipart e publica o job (`jobId` = id do vídeo, dedup na fila) |
| SI-03.7 | `c6a05d9` | Endpoints HTTP de upload |

### Worker de vídeo

| SI | Commit | O que entrou |
|---|---|---|
| SI-03.8 | `2c01920` | Entrypoint `src/worker.ts` e container próprio com `ffmpeg`/`ffprobe` |
| SI-03.9 | `6d39b34` | Download para arquivo temporário e sondagem com `ffprobe` |
| SI-03.10 | `48844ff` | Extração da thumbnail com `ffmpeg` |
| SI-03.11 | `d569dd9` | Processador do job: metadados + thumbnail + `ready` em **um único write** |
| SI-03.12 | `7600e8b` | Falhas com fail-fast e DLQ explícita (`video-processing-dlq`) |

### Leitura e entrega

| SI | Commit | O que entrou |
|---|---|---|
| SI-03.13 | `47d8a84` | Resolução do vídeo público (`ready`-only) e do vídeo do dono (qualquer estado) |
| SI-03.14 | `eb72caf` | Rotas de leitura pública e do dono |
| SI-03.15 | `429122f` | **Streaming, download e thumbnail** por redirect pré-assinado |
| SI-03.16 | `4012a8e` | Cancelamento do upload e limpeza agendada de rascunhos órfãos |
| SI-03.17 | `c7f721d` | Reprocessamento do vídeo em `error` |

## 2026-08-03 — Fechamento da Definition of Done

A suíte completa expôs o que a validação SI a SI não pegava.

| Commit | O que entrou |
|---|---|
| `e3fe800` | `Video` nos `ALL_ENTITIES` de 10 specs legados — a relação inversa em `Channel` quebrou suítes de `auth`/`users`/`channels` que declaravam suas próprias entidades |
| `e62ec55` | Serialização dos `DROP TABLE` no spec de migrations |
| `59b178d` | `maxWorkers: 1` no `jest-e2e.json` — as 5 suítes novas disputavam as mesmas tabelas; a garantia ficou na config, não no script |
| `ea07ff9` | `ffmpeg` na imagem de dev da API, para a suíte inteira fechar verde em um só container |
| `d189a3a` | `title` obrigatório no initiate e persistido (migration `AddVideoTitle`) — rascunho nunca é linha sem nome |
| `1f9c333` | `openapi:export` via `nest build` — o CLI plugin do Swagger é um transformer de AST, e rodar por `ts-node` gerava **todo** schema de DTO vazio |
| `42454a7` | Worker por **profile**: `video-worker` ocioso por padrão (testes estáveis), `video-worker-live` sob `--profile live` |
| `b7c5e47` `e4c6969` `7c511b7` | `CLAUDE.md` alinhados ao código entregue e bookkeeping dos artefatos da fase |

**Resultado:** `npx tsc --noEmit` exit 0 · `npm run lint` sem erros · 384 testes unitários, 191 de integração e 99 e2e verdes.

## 2026-08-05 — Integração

| Commit | O que entrou |
|---|---|
| `ebb911c` | Merge do PR #1 (`dev` → `main`) — 45 commits da Fase 03 |

---

## Fases

| Fase | Descrição | Status |
|---|---|---|
| 01 | Configuração base | ✅ Concluída |
| 02 | Cadastro, login e gerenciamento de conta | ✅ Concluída |
| **03** | **Upload e processamento de vídeos** | ✅ **Concluída** |
| 04 | Gerenciamento de vídeos e canal | ⏳ Planejada |
| 05 | Página de visualização do vídeo | ⏳ Planejada |
| 06 | Interações sociais | ⏳ Planejada |
| 07 | Página inicial, busca e finalização | ⏳ Planejada |

Artefatos de planejamento por fase em `docs/phases/`; decisões técnicas em `docs/decisions/`.
