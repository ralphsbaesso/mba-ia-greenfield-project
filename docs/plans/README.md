# Planos de Execução — Fase 03 (Upload e Processamento de Vídeos)

Sequência de planos para entregar a Fase 03 do StreamTube conforme `docs/desafio.md`.
Cada plano é **autocontido** (repete o contexto essencial do projeto) e foi pensado para ser
executado em sessões diferentes, na ordem abaixo. Cada um termina com os critérios de conclusão
que liberam o próximo.

| # | Plano | Etapa | Produto |
|---|-------|-------|---------|
| 00 | [plan-00-setup.md](plan-00-setup.md) | Setup e pré-requisitos | Branch `dev`, stack no ar, suíte baseline verde, context7 ativo |
| 01 | [plan-01-research.md](plan-01-research.md) | Research (skill `research`) | `docs/decisions/technical-decisions-phase-03-videos.md` |
| 02 | [plan-02-planejamento.md](plan-02-planejamento.md) | Pipeline de planejamento (`plan-context` → `plan-validate` → `plan-resolve` → `plan-build`) | `docs/phases/phase-03-videos/` com `context.md`, `validation.md` (`clean`), `library-refs.md`, `phase-03-videos.md` |
| 03 | [plan-03-implementacao.md](plan-03-implementacao.md) | Implementação SI a SI (skill `implement`) | Módulo `videos/`, infra no Compose (MinIO/fila/worker), migration, testes, `progress.md` |
| 04 | [plan-04-fechamento.md](plan-04-fechamento.md) | Fechamento | Definition of Done do zero, `CLAUDE.md` atualizado, Critérios de Aceite revisados, merge na `dev` + push |

## Regras que valem em todos os planos

- **Workflow obrigatório**: research → planejamento → implementação, com os artefatos de cada etapa.
  Pular etapa é reprova automática.
- **Git Flow**: branches saem de `dev` e voltam para `dev`. **Nunca commitar direto na `main`.**
- **Docker**: hosts pelo service name do Compose (nunca `localhost`); comandos npm/npx dentro do
  container (`docker compose exec nestjs-api ...`).
- **Definition of Done**: suíte completa verde + `npx tsc --noEmit` (código 0) + `npm run lint`.
- **Libs**: doc oficial via context7 (MCP) antes de implementar; versões pinadas em `library-refs.md`.
- **Rastreabilidade**: nada inventado — toda decisão/afirmação rastreável ao desafio, ao
  `docs/project-plan.md` ou ao código.
