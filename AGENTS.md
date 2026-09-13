# DiNho Optimizer — Agent Instructions

## Project Overview

DiNho Optimizer is an Electron desktop application for Windows system optimization, built with TypeScript, React, and Electron Vite. It provides system cleaning, registry optimization, malware scanning, privacy protection, driver management, and more.

## Tech Stack

- **Runtime:** Electron (main + renderer process)
- **Language:** TypeScript (strict mode)
- **UI:** React + Tailwind CSS + shadcn/ui
- **Build:** Electron Vite
- **State:** Zustand
- **Testing:** Vitest + Playwright (E2E)
- **Package Manager:** npm

## Core Principles

1. **Test-Driven** — Write tests before implementation, 80%+ coverage required
2. **Security-First** — Validate all inputs, sanitize paths, never mutate
3. **Immutability** — Create new objects, never mutate existing state
4. **Agent-First** — Delegate complex tasks to specialized agents
5. **Plan Before Execute** — Plan complex features before writing code

## Agent Orchestration

Use agents proactively without explicit user prompt:
- Complex feature requests → **planner**
- Code just written/modified → **code-reviewer**
- Bug fix or new feature → **tdd-guide**
- Architectural decision → **architect**
- Security-sensitive code → **security-reviewer**
- Build/type errors → **build-error-resolver**
- E2E critical flows → **e2e-runner**

Use parallel execution for independent operations.

## Security Guidelines

**Before ANY commit:**
- No hardcoded secrets (API keys, passwords, tokens)
- All user inputs validated
- SQL injection prevention (parameterized queries)
- XSS prevention (sanitized HTML)
- CSRF protection enabled
- Error messages don't leak sensitive data

**If security issue found:** STOP → use security-reviewer agent → fix CRITICAL issues

## Coding Style

- Many small files over few large ones (200–400 lines typical, 800 max)
- Functions small (<50 lines), files focused (<800 lines)
- No deep nesting (>4 levels)
- Proper error handling — never silently swallow errors
- File organization by feature/domain, not by type

## Running Dev (Windows)

The app requires admin privileges (`requestedExecutionLevel: requireAdministrator`). `npm run dev` auto-elevates itself: the un-elevated instance detects `!isAdmin()` and relaunches the **whole `npm run dev` command** elevated via UAC (`Start-Process cmd.exe -ArgumentList '/c cd /d <project> && npm run dev' -Verb RunAs`), then exits. Accept the UAC prompt and the app opens elevated with the renderer on `localhost:5173`.

```powershell
cd C:\Users\WENDEL\Desktop\001
npm run dev   # prompts UAC once, then runs elevated
```

**Why relaunch the whole command (not just electron.exe):** in dev `app.getPath('exe')` is the bare `electron.exe` (no entry point), and electron-vite kills the Vite dev server when the electron child exits (`ps.on('close', process.exit)`). Re-running `npm run dev` elevated starts a fresh electron-vite + elevated electron, which binds the port the original instance just released. Production builds elevate correctly via the manifest + runtime auto-elevation (`src/main/index.ts`).

## Testing Requirements

**Minimum coverage: 80%**
- Unit tests — individual functions, utilities
- Integration tests — IPC handlers, stores
- E2E tests — critical user flows

## Git Workflow

Commit format: `<type>: <description>` — Types: feat, fix, refactor, docs, test, chore, perf

---

## Current Status (consolidado — 2026-08-23)

**Stack (versões atuais):** Electron 43.4.1 · Vite 8.2.2 · Biome 2.5.10 · Vitest 4.1.11 · TypeScript 7 · React 19.2 · NAudio 3.0.1 · ffmpeg 9.0 · electron-vite 6.0.0-beta.1 (intencional, beta mais novo que o 5.0.0 estável)

**Testes/Qualidade:**
- TS: ~6900 testes, 229 arquivos, 0 falhas — cobertura Stmts 93.7% / Branches 85.3% / Functions 93.7% / Lines 94.9%
- C#: ~1298 testes, 0 falhas (flakiness conhecida e documentada no ConsoleLogger/vstest, não é bug real)
- Biome: 0 erros, 0 warnings (`noExplicitAny` habilitado e limpo)

**Em andamento — G3 Plan (varredura de bugs no backend `src/main/`):**
- Escopo: IPC handlers, services, CLI, rules, platform, constants, `index.ts` — 8 tipos de verificação por arquivo (error handling, input validation, race conditions, resource leaks, dead code, type safety, consistency, test coverage). Achados registrados em `docs/G3-SCAN-LOG.md`, severidade CRITICAL/HIGH/MEDIUM/LOW.
- Status por sessão:
  | # | Escopo | Status |
  |---|--------|--------|
  | 1 | `src/main/ipc/*.ipc.ts` (raiz) | ✅ Concluída e commitada |
  | 2 | `src/main/ipc/{debloater,windows-tweaks,game-mode}/` | ⏳ Fixes prontos no working tree, commit pendente |
  | 3 | `src/main/ipc/{registry-cleaner,driver-manager}/` + restantes | ⏳ Não iniciada |
  | 4 | `src/main/services/malware-scanner/` | ✅ Concluída e commitada (`0b556db`) |
  | 5 | `src/main/services/privacy-shield/` | ✅ Concluída e commitada (`906903b`) |
  | 6 | `src/main/services/registry-cleaner/` | ✅ Concluída e commitada (`1bf7398` + `17115e5`) |
  | 7 | `src/main/services/` raiz parte 1 (schedulers, updater, perf, disk, memory) | ✅ Concluída e commitada (`bc89550`) |
  | 8 | `src/main/services/` raiz parte 2 (settings, stores, misc) | ✅ Concluída e commitada (`96cac67`) |
  | 9 | `src/main/cli/` (router + 14+ commands) | ✅ Concluída e commitada (`7e53c06`) |
  | 10 | `src/main/{rules,platform,constants,index.ts}` + triagem/closeout | ✅ Concluída e commitada |
- G3 completa (S4–S10): suíte final 238 files, 2 failed pré-existentes (environment-cleaner.ipc.test.ts:536, startup-manager.ipc.test.ts:697) | 6988 passed | 1 skipped; Biome 0 erros. Detalhes em `SESSION-HISTORY.md` (2026-09-13).

**Planejado, não iniciado — Multi-Track Audio** (registrado 2026-07-23, esforço estimado ~1-2 semanas):
Gravar tracks de áudio independentes no clipe (jogo, Discord, mic) para edição pós-gravação. Já existe: captura por PID (`CppLoopbackSource`), captura geral (`WasapiLoopbackSource`), captura de mic (`WasapiMicSource`), enumeração/filtro de sessões de áudio, `AudioMixer`+`FfmpegAacEncoder` (só para 1 stream). Falta: múltiplos mixers/encoders em paralelo, `ClipExporter` aceitando N streams de áudio, UI de seleção de tracks, separação no player/editor.

**Rejeitado pelo usuário — não reabrir sem novo pedido explícito:**
AI auto-clipping (detecção de eventos), clip por comando de voz, gravação de sessão completa + bookmarks, compilação automática de highlights, compartilhamento/links instantâneos, cloud storage, app mobile.

## Histórico Detalhado de Sessões

O log sessão-a-sessão (causas-raiz de bugs específicos, números de teste, decisões técnicas pontuais) foi movido para `SESSION-HISTORY.md` para não poluir estas instruções. Consulte esse arquivo antes de reabrir uma investigação — é bem provável que o bug já tenha sido corrigido e documentado lá.
