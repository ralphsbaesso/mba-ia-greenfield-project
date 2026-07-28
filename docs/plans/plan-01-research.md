# Plano 01 — Research: Decisões Técnicas da Fase 03

> **Fase 03 — Upload e Processamento de Vídeos** do StreamTube.
> Este é o segundo de 5 planos (`docs/plans/plan-00` a `plan-04`). Cada plano é autocontido
> e pode ser executado em uma sessão diferente. Fonte da verdade do desafio: `docs/desafio.md`.
> **Pré-requisito:** Plano 00 (setup) concluído — `dev` criada, stack subindo, suíte verde, context7 ativo.

## Contexto do projeto (comum a todos os planos)

- **StreamTube**: plataforma de compartilhamento de vídeos. Monorepo com `nestjs-project/`
  (backend NestJS 11 + TypeORM + PostgreSQL 17) e `next-frontend/` (fora do escopo da Fase 03).
- **Fases 01 e 02 concluídas**: `auth/`, `users/`, `channels/`, `mail/`, `common/`, `config/`,
  `database/`, `swagger/`. Cada usuário tem um canal (1:1); os vídeos da Fase 03 pertencem a um canal.
- **Fase 03 (o desafio)**: módulo de vídeos + object storage (MinIO/S3) + fila + worker FFmpeg via
  Docker Compose. Upload de até 10GB sem travar a API, pré-cadastro como rascunho, processamento
  automático (duração/metadados/thumbnail), URL única, streaming e download.
- **Workflow obrigatório**: `research` → `plan-context` → `plan-validate` → `plan-resolve` →
  `plan-build` → (`plan-test-specs`) → `implement`. Cada estágio é uma skill do projeto (`.claude/skills/`).
- **Docker**: hosts sempre pelo service name do Compose (ex.: `db`, `minio`), nunca `localhost`.
  Comandos npm/npx sempre dentro do container.
- **Git Flow**: `feature/*` e `docs/*` saem de `dev` e voltam para `dev`. Nunca commitar na `main`.
- **Definition of Done**: suíte completa verde + `npx tsc --noEmit` (código 0) + `npm run lint`.
- **Docs de libs**: consultar via **context7 (MCP)** antes de implementar; seguir a versão instalada.
- **Rastreabilidade**: nada de requisito/decisão inventada — toda informação registrada deve ser
  rastreável ao `docs/project-plan.md`, ao `docs/desafio.md` ou ao código existente.

## Objetivo deste plano

Executar a etapa de **research** com a skill **`research`** do projeto e produzir o artefato:

```
docs/decisions/technical-decisions-phase-03-videos.md
```

no **formato dos documentos de decisão existentes** (por decisão: opções, trade-offs e recomendação).
Referência de formato: `docs/decisions/technical-decisions-phase-02-auth.md`
(estrutura: TDs numerados, cada um com o tópico, opções nomeadas, prós/contras e `**Recommendation:**`
+ `**Libraries:**` quando fixa libs).

Este documento alimenta toda a pipeline de planejamento (Plano 02). **Nenhum código é escrito aqui.**

## Como executar

1. Invocar a skill do projeto: `/research` (ou pedir explicitamente "rode a skill research para a fase 03").
2. Garantir que a skill receba o escopo abaixo (as 5 decisões em aberto).
3. Revisar criticamente a saída: research raso gera plano frouxo. Se vier superficial, refinar o
   prompt e iterar antes de aceitar.
4. Toda recomendação que fixa uma lib deve citar a lib e ser compatível com **NestJS 11** e Node
   do container — verificar via context7 durante o research (as versões serão pinadas depois, no
   `library-refs.md` do plan-resolve).

## As 5 decisões que o research PRECISA fechar

O desafio (`docs/desafio.md`, seção "Decisões que você precisa tomar") lista explicitamente:

### TD-A — Tecnologia de fila (a principal decisão de stack da fase)

O project-plan deixa a fila como "TBD". É a única decisão de stack genuinamente aberta.

- Opções mínimas a comparar: **BullMQ (Redis)**, **RabbitMQ (AMQP)** e ao menos uma alternativa
  (ex.: transporte nativo do NestJS microservices, pg-boss sobre o Postgres já existente).
- Critérios de comparação: integração com NestJS 11 (`@nestjs/bullmq` vs `@nestjs/microservices`),
  garantia de entrega/retry/backoff, DLQ (dead-letter) para falha de processamento, observabilidade,
  peso do container no Compose, simplicidade para um worker separado consumir, maturidade da lib.
- A decisão deve considerar que **o worker roda em container separado** e precisa consumir a fila
  e atualizar o banco.

### TD-B — Estratégia de upload de 10GB sem travar a API

**Reprova automática**: passar o arquivo de 10GB pela API de forma que trave o sistema.

- Opções a comparar: **upload direto ao storage via URL pré-assinada (presigned PUT)**,
  **multipart upload pré-assinado (S3 multipart: initiate/parts/complete)**, upload via API com
  streaming (descartar com justificativa), TUS/resumable (avaliar se vale a complexidade).
- Para 10GB, atenção: presigned PUT simples tem limite prático de 5GB por objeto no S3 —
  **multipart é praticamente obrigatório**; registrar isso no trade-off.
- Definir o fluxo completo: quem inicia o multipart (API), como as parts são enviadas (cliente →
  MinIO direto), como a API sabe que o upload terminou (endpoint de "complete" chamado pelo cliente
  vs. notificação de evento do MinIO) e como isso dispara o job na fila.
- O **pré-cadastro do vídeo como rascunho** acontece ao iniciar o upload — o research deve amarrar
  o momento do pré-cadastro ao fluxo escolhido.

### TD-C — Worker de vídeo: execução e processamento (FFmpeg/ffprobe)

- Como o worker roda: **container separado no Compose** (dado pela arquitetura-alvo,
  `docs/diagrams/software-arch.mermaid`) — decidir se é uma segunda aplicação Nest (standalone app
  consumindo a fila), um processo Node puro, ou o mesmo codebase com entrypoint distinto
  (ex.: `main.worker.ts` + mesmo Dockerfile com command diferente). Comparar trade-offs
  (reuso de entities/TypeORM, deploy, isolamento de dependências FFmpeg).
- Como extrai metadados: **ffprobe** (duração, resolução, codec, bitrate) — decidir a lib de binding
  (`fluent-ffmpeg`, execução direta de `ffprobe` via `child_process`, ou libs mais novas) e como o
  binário FFmpeg entra na imagem Docker do worker.
- Como gera o **thumbnail**: frame do vídeo via FFmpeg (definir instante, formato e dimensões) e
  upload do resultado para o storage.
- Fluxo de dados: worker baixa o arquivo do MinIO (ou processa via stream/URL pré-assinada?),
  processa, sobe thumbnail, atualiza o banco. Decidir também o acesso do worker ao banco
  (TypeORM com as mesmas entities vs. atualização via API interna).

### TD-D — URL única e estratégia de streaming

- **URL única por vídeo, sem conflito**: comparar UUID v4 (já usado nas PKs?), NanoID curto
  (estilo YouTube, ~11 chars), slug derivado do título + sufixo. Considerar índice único no banco,
  previsibilidade/enumeração e estética da URL.
- **Streaming sem download completo**: comparar (1) API fazendo proxy com suporte a
  `Range`/`206 Partial Content` lendo do MinIO por stream, (2) redirect 302 para URL pré-assinada
  do MinIO (o próprio MinIO honra Range), (3) URL pré-assinada devolvida no payload para o player
  consumir direto. Critérios: carga na API, controle de autorização (vídeos são públicos para
  visualização nesta fase? verificar project-plan/Fase 05 — acesso anônimo à visualização),
  simplicidade nos testes e2e.
- **Download**: mesmo trade-off, com `Content-Disposition: attachment`.

### TD-E — Ciclo de status do vídeo e tratamento de falha

- Máquina de estados mínima exigida: `draft` (rascunho, no pré-cadastro) → `processing` → `ready` / `error`.
  Avaliar estados intermediários (ex.: `uploading`, `uploaded`) e justificar incluir ou não.
- O que dispara cada transição (initiate upload, complete upload, job iniciado, job concluído, job falhou).
- Falha de processamento: retries (quantos, com que backoff — amarrado ao TD-A), o que fica
  registrado no banco (campo de erro?), DLQ, e se/como o usuário pode reprocessar.
- Casos de borda: upload iniciado e nunca concluído (rascunho órfão — TTL/limpeza?), job duplicado
  (idempotência do worker), arquivo corrompido/não-vídeo.

### Decisão já dada (registrar como constraint, não como decisão aberta)

- **Object storage = S3-compatível, MinIO em dev via Docker** (o desafio fixa isso).
  O que o research define é o **uso**: organização de buckets (um bucket `videos` + `thumbnails`?
  um bucket com prefixos?), convenção de chaves de storage (ex.: `videos/{channelId}/{videoId}/original.mp4`),
  política de acesso (privado + presigned), e o SDK (`@aws-sdk/client-s3` v3 + `@aws-sdk/s3-request-presigner`
  vs. SDK do MinIO) — comparar e recomendar.

## Formato do artefato de saída

`docs/decisions/technical-decisions-phase-03-videos.md`, seguindo o padrão dos docs existentes:

- Frontmatter/estrutura igual aos docs de decisão anteriores (verificar frontmatter de
  `technical-decisions-phase-02-auth.md` — campos como `related_phases`, status por TD).
- Um TD por decisão (TD-A…TD-E acima + a constraint de storage), cada um com:
  - Contexto/problema
  - Opções (2–4), cada uma com prós e contras honestos
  - `**Recommendation:**` com justificativa rastreável ao desafio/project-plan
  - `**Libraries:**` quando a decisão fixa libs (nome + major version)
- As libs esperadas ao final (a confirmar no research): SDK S3, lib de fila + integração NestJS,
  binding FFmpeg. Elas serão pinadas via context7 no `library-refs.md` durante o plan-resolve (Plano 02).

## Git

Trabalhar em branch a partir da `dev` (ex.: `docs/phase-03-research` ou já a
`feature/phase-03-videos` se preferir concentrar os artefatos da fase — decidir e manter consistente
nos planos seguintes). Commitar o documento de decisões ao final. **Nunca na `main`.**

## Critérios de conclusão deste plano

- [ ] `docs/decisions/technical-decisions-phase-03-videos.md` criado no formato dos docs existentes
- [ ] As 5 decisões (fila, upload 10GB, worker/FFmpeg, URL única/streaming, ciclo de status) com
      opções, trade-offs e recomendação justificada
- [ ] Uso do storage (buckets/chaves/presigned/SDK) registrado
- [ ] Nenhuma decisão "inventada": tudo rastreável a desafio/project-plan/arquitetura
- [ ] Saída revisada criticamente (sem research raso)
- [ ] Documento commitado em branch a partir da `dev`

## Próximo plano

`docs/plans/plan-02-planejamento.md` — Pipeline de planejamento
(`plan-context` → `plan-validate` → `plan-resolve` → `plan-build`) até o `validation.md` fechar em `clean`.
