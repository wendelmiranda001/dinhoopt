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

**Stack (versões atuais):** Electron 44.3.0 · Vite 8.3.0 · Biome 2.5.13 · Vitest 5.0.0 · TypeScript 7.0.2 · React 19.3.0 · NAudio 3.1.0 · ffmpeg 9.0.1 · electron-vite 6.0.0-beta.1 (intencional, beta mais novo que o 5.0.0 estável)

**Testes/Qualidade:**
- TS: ~6900 testes, 229 arquivos, 0 falhas — cobertura Stmts 93.7% / Branches 85.3% / Functions 93.7% / Lines 94.9%
- C#: ~1298 testes, 0 falhas (flakiness conhecida e documentada no ConsoleLogger/vstest, não é bug real)
- Biome: 0 erros, 0 warnings (`noExplicitAny` habilitado e limpo)

**Em andamento — A/V drift + bottleneck do feed (~46fps, FiveM + av1_nvenc 1080p60):**
- **Probe NVENC (`--probe-nvenc [W H FPS]`)** criado e validado: av1_nvenc sustenta 204–226 fps em TODOS os presets (p1–p7) com cadeia de produção (cq18/lookahead16/multipass fullres) — **encoder NÃO é o gargalo** (corrige diagnóstico anterior que culpava o NVENC).
- Log 2026-09-14: 25924 frames → ~46.3 fps de feed; **0 output-channel overflows / 1 input overflow** em 9min → o limite (~46fps) está na alimentação (captura→NV12→stdin), não no encodador.
- **Bug de PTS corrigido (av1_nvenc/IVF)**: `ProcessIvfFrames` usava PTS sintético por frame-index em vez do PTS real de captura (`_inputPtsQueue`, como a rota AnnexB) ⇒ drift A/V crescente ~0,23 s/s quando feed < 60fps. Fix espelha `EmitPacket` (dequeue real / extrapola / não-monotônico). 4 testes novos.
- **Instrumentação `FeedTelemetry` criada (TDD, 7 testes, 1459/1459 GREEN):** loga a cada ~5s o breakdown por estágio do feed — `fps good fail enqNull | wait=x ms copy=x ms convert=x ms total=x ms | queue=avg/max` (canal `FeedTelemetry` no JSONL). `wait` = WaitOne do WGC, `copy` = CopyResource p/ pool, `convert` = ConvertGpuNv12+enqueue, `total` = iteração inteira. `TryCaptureFrame` já media wait/copy (`WaitEndTicks`/`CopyEndTicks`) mas NADA disso ia pro log.
- **Diagnóstico concluído (sessão real FiveM, 2026-09-15):** `wait`=11,6ms dominante (69% do budget), `convert`=2,5ms (GPU **NÃO** saturada — 15% do budget), `copy`=0,1ms, `queue`=0 (encoder nunca engasga). Feed = 46,9fps ≈ cadência de entrega do WGC (game render ~47fps sob carga de captura+NVENC). Encoder (probe 204–226fps) e convert (2,5ms) **NÃO são gargalo** — preset adaptativo NVENC **despriorizado**. Fix de PTS IVF confirmado: exports com PTS-DRIFT ±10ms.

**DESCARTADA pelo usuário (2026-09-16) — Multi-Track Audio** (Item 5): commit `14d939b` trouxe a política pura `MultiTrackAudioPolicy.ResolveTracks` + `AudioTrackKind` (5/5 GREEN), mas o usuário **descartou a feature inteira** antes da implementação HW (AudioMixer multi-stream WASAPI, N encoders AAC, N streams ADTS→MKV) e o código morto foi **removido** (`commit <pending>`: `MultiTrackAudioPolicy.cs`, `AudioTrackKind.cs`, `AudioInputConfig.cs`, `MultiTrackAudioPolicyTests.cs`). Não reabrir sem novo pedido explícito.

**Rejeitado pelo usuário — não reabrir sem novo pedido explícito:**
AI auto-clipping (detecção de eventos), clip por comando de voz, gravação de sessão completa + bookmarks, compilação automática de highlights, compartilhamento/links instantâneos, cloud storage, app mobile, **Multi-Track Audio (Item 5)**.

## Histórico Detalhado de Sessões

O log sessão-a-sessão (causas-raiz de bugs específicos, números de teste, decisões técnicas pontuais) foi movido para `SESSION-HISTORY.md` para não poluir estas instruções. Consulte esse arquivo antes de reabrir uma investigação — é bem provável que o bug já tenha sido corrigido e documentado lá.
