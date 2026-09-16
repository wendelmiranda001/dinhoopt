# DiNho Clips — Status do Projeto

## Fase 0 — Motor de Captura (MVP)

### Concluído
- Especificação arquitetural completa (`dinho-clips-spec-v2.md`) — 17 seções
- Todos os módulos Fase 0 + Fase 1 + Fase 2 (hardening parcial) escritos
- ~4.700 linhas em 37 arquivos
- **Otimizações de performance aplicadas:**
  - GPU→GPU NV12 via D3D11 Video Processor (zero CPU no hot path)
  - Staging textures cacheadas nos encoders (zero alocação por frame no caminho GPU)
  - `ArrayPool<byte>` em todos buffers temporários
  - Debug logging removido de todos os hot paths
  - Pipeline loop com timing QPC mais preciso, mode check a cada 2s
  - ReplayBuffer: LINQ removido (`SkipWhile`/`ToList`), loops manuais com capacidade pré-alocada
  - AudioMixer: double-copy eliminado no `EmitPacket`
  - GpuVideoConverter: output texture NV12 cacheada (reutilizada entre frames)
  - Bitrate default: 20000 Kbps (20 Mbps)
- **Benchmark JSON estruturado** (`--bench-json`) com:
  - Latência split (wait/copy) por frame
  - CPU% sampling (30s a 1Hz)
- Capture pipeline: DXGI + WGC com fallback automático (seção 4 da spec)
- MasterClock (QPC), ReplayBuffer (LRU por duração), ConfigManager
- PipelineWatchdog com níveis Green/Yellow/Red
- IPC protocol (Named Pipes) com envelope v1
- Hotkeys: F8 salvar clip, F9 iniciar/parar captura, F10 mutar microfone
- Staggered shutdown: threads finalizam em ordem, 5s timeout no total

### Testes (48/48 passam — xUnit)
- MasterClockTests (5), ReplayBufferTests (7), ConfigManagerTests (4)
- AudioMixerTests (4), PipelineWatchdogTests (10), WasapiSourceTests (7)
- **FfmpegEncoderTests (11)** — CheckKeyFrame (6), audio float→s16 (4), EncodedPacket (1)

## Fase 1 — Encoder + Export

### Alteração crítica: MF → ffmpeg
Os encoders MF (H264Encoder, SoftwareH264Encoder, SinkWriterEncoder) foram **removidos** — falham com `MF_E_UNSUPPORTED_D3D_TYPE` e "divide by zero" no Windows 10 build 26200 (pré-release).

Substituídos por **FfmpegEncoder** (único encoder, subprocesso ffmpeg):

| Encoder | Status |
|---------|--------|
| `FfmpegEncoder` (NVENC via ffmpeg, `h264_nvenc`) | ✅ Funcional |
| `FfmpegEncoder` (AMF via ffmpeg, `h264_amf`) | 🔬 Detectado por ffmpeg, não testado em HW real |
| `FfmpegEncoder` (QSV via ffmpeg, `h264_qsv`) | 🔬 Detectado por ffmpeg, não testado em HW real |
| `FfmpegEncoder` (libx264 CPU) | ✅ Funcional (fallback final) |
| `GpuVideoConverter` (NV12 GPU) | ✅ GPU-only (sem fallback CPU no hot path) |
| EncoderManager (seleção automática) | ✅ Detecta HW disponível via `ffmpeg -encoders` |
| `ClipExporter` (remux MP4 via ffmpeg) | ✅ Funcional |

### Fallback runtime
Quando um codec HW falha em execução, `TryRestart()` tenta 5x com backoff exponencial (1s, 2s, 4s, 8s, 16s) e então avança automaticamente para o próximo codec na cadeia:
`h264_nvenc` → `h264_amf` → `h264_qsv` → `libx264`

Uma vez em `libx264`, não há fallback adicional — o encoder tenta 5x e falha definitivamente.

### Otimizações PC fraco (seção 10 da spec: CPU < 2%)
- GPU→GPU NV12 via D3D11 Video Processor (zero CPU no hot path de conversão)
- ffmpeg em prioridade **BelowNormal** — não compete com o jogo
- `-threads` livre no libx264 — usa todos os cores (fallback de CPU mantém qualidade)
- `-preset veryfast -crf N -maxrate X -bufsize Y -bf 0 -profile:v high` — fallback de CPU com qualidade decente (2026-07-31: era `ultrafast`/baseline/threads 1, que gerava clips borrados)
- `EncodeFrame` bloqueia apenas no `stdin.Write` (sub-milissegundo com HW)
- `ArrayPool` sem leaks no hot path
- `-movflags +faststart` nos exports — streaming-ready
- Export usa `-c copy` (remux sem re-encode) + AAC via ffmpeg
- Watchdog com auto-restart do ffmpeg: backoff exponencial + fallback de codec
- `_restartAttempts` resetado em cada `EncodeFrame` bem-sucedido

### AAC contínuo (live encoding)
- `FfmpegAacEncoder` — subprocesso ffmpeg para PCM→AAC em tempo real
- Criado em `StartCapture`, despejado em `StopCapture` (flush + drain)
- `OnAudioPacket` envia PCM ao encoder e drena AAC para o ReplayBuffer
- `ClipExporter` detecta ADTS (`IsAdts`) e usa `-c:a copy` no remux (sem re-encode)
- Fallback automático para PCM→S16LE se áudio não for AAC
- Economia: ~23MB → ~1MB no buffer de 60s de áudio

## Fase 2 — Hardening ✅
- PipelineWatchdog, ConfigManager validation, IPC envelope, error hardening
- **Bugfixes (22 Jun 2026):**
  - AudioMixer: `_loopback.Start()` moved before `SampleRate`/`Channels` read (DivideByZero fix)
  - Pipeline timing: `Math.Max(1, ...)` guard in `Task.Delay(remainingMs - 1)`
  - StopCapture race: `_pipelineLock` in `StartCapture`/`StopCapture`, pipeline loop uses local `cap`/`enc` refs
  - GpuVideoConverter NRE: `_device.ImmediateContext` removido (ponteiro nativo zerava entre frames)
  - ParseAnnexB split-NAL: dados entre `_stdout.Read()` dentro de uma NAL unit não são mais perdidos

## Fase 2.5 — Hardening Avançado (22 Jun 2026)

### TDR / Device Lost Recovery
- `DxgiCaptureSource.CheckDeviceLost()` detecta `DeviceRemovedReason` da D3D11 API
- Pipeline loop sinaliza `_deviceLost` → `ReinitializePipelineAsync()` recria `_sharedDevice` + `_dxgiManager` + capture + encoder
- Cobre: TDR (driver crash), monitor desconectado, DXGI_ERROR_DEVICE_REMOVED/HUNG

### Detecção HW por VendorId
- `EncoderManager.DetectGpuVendorId()` lê VendorId da DXGI (`0x10DE` NVIDIA, `0x1002` AMD, `0x8086` Intel)
- `DetectBestCodec()` tenta o codec do vendor primeiro antes do fallback chain
- Evita tentativas falhas em hardware misto (ex: NVIDIA + Intel iGPU)

### WindowClass + Known Games
- `GameInfo.WindowClass` via `GetClassName` (P/Invoke)
- `KnownGames.LookupWindowClass` → `GameDatabase.GetDisplayName` (games.json + fallback `HardcodedMap`): mapeia classes como `grcWindow` (FiveM), `WINDOW` (Roblox), `SDL_app` (CS2), `UnrealWindow`, `UnityWndClass`, `FORTNITE`
- Exibido no `ToString()`: `FiveM (FiveM) [FSX]`

### RAM Monitoring
- `EngineStatusSnapshot.MemoryMB` amostra `Process.WorkingSet64` a cada status update
- `ReplayBufferBytes` exposto via IPC para monitoramento de memória do buffer

### Auto Cleanup
- Timer a cada 5 minutos verifica disco de saída
- Se ocupação > 90%, deleta clips `.mp4` mais antigos (pulando `.favorite` markers) até ficar abaixo de 85%
- Executa em background, sem bloquear pipeline

### Favorites
- `EncodedPacket.IsFavorite` field disponível para metadata
- Auto Cleanup pula arquivos com sidecar `.favorite`

## Fase 3 — UI Electron ✅

Clips integrado como **módulo** do DiNho Optimizer (`src/` do app Electron). A POC C# (`dinho-clips-poc/`) é a referência da engine; o produto roda dentro do app principal.

### Main process
- **IPC** (`src/main/ipc/clips.ipc.ts`) — 30+ handlers: engine start/stop, captura, saveClip, listar, durações, delete/rename/open, thumbnail, config get/set, output dir, processos, sessões de áudio, mics, GPUs, favoritos, trim, merge, open external, publish gofile (+ cancel/progress)
- **Engine bridge** (`clips-engine.ts`, `clips-engine-connection.ts`, `clips-pipe.ts`) — spawn da engine C#, named pipe, status sync, reconfig em reconnect, fallback de câmera de mic (PowerShell WinRT)
- **Serviços** (`src/main/services/`) — `clips-config-manager`, `clips-config-store`, `clips-enhance` (AMD AMF + sharpness), `clips-publish` (Gofile), `thumbnail-generator`, `ffmpeg-path`, `game-detector`, `trim-history-store`
- **Preview** (`clip-video-protocol.ts`) — scheme `clip-video://` com HTTP Range manual (seek funcional; contorna bug do file loader do Chromium)

### Renderer (React)
- `ClipsPage.tsx` (rota `/clips` em `App.tsx`)
- Componentes (`src/renderer/src/components/clips/`): `ClipsGrid`, `ClipsStatusBar`, `ClipsConfigPanel` (audio/game/quality), `ClipEditorModal` (trim/merge), `PublishModal`, `RenameDialog`, `useClipsState` + `useClipsActions`
- Preload API completa (`src/preload/clips.ts`) com listeners de status, clip salvo, RAM pressure, durations ready
- Dashboard: card `GameClipsCard` com polling de status

## Próximos Passos
1. ✅ ClipExporter com ffmpeg (remux + AAC)
2. ✅ Watchdog de recuperação do ffmpeg (auto-restart com backoff + fallback de codec)
3. ✅ Bugfixes: AudioMixer DivideByZero, Pipeline timing -1ms, StopCapture race, GpuVideoConverter NRE, ParseAnnexB split-NAL
4. ✅ Validação com GPU real: `--bench-json` (NVENC 2.4ms/frame)
5. ✅ Áudio AAC contínuo (live encoding via FfmpegAacEncoder, remux `-c:a copy`)
6. ✅ Fallback runtime entre codecs HW (NVENC → AMF → QSV → libx264)
7. ✅ Latência split (wait/copy) + CPU% metric no benchmark
8. ✅ TDR/Device Lost recovery (DXGI_ERROR_DEVICE_REMOVED/HUNG)
9. ✅ Detecção HW por VendorId (NVENC, AMF, QSV automático)
10. ✅ WindowClass + lookup table de jogos conhecidos
11. ✅ RAM monitoring (WorkingSet no EngineStatus)
12. ✅ Auto Cleanup (deleta clips antigos quando disco > 90%)
13. ✅ Favorites flag (`IsFavorite` no EncodedPacket)
14. ✅ Validar AMF e QSV em hardware real — AMF RX 5700 XT (11 ago: preset adaptativo `3c2dd0c`, qp/GOP `0c7addf`, cqp `ba47d00`, pós-crash `cd27259`); QSV real no encode `b26a351`
15. ✅ UI Electron (preload API, ClipsPage, IPC bridge) — integrado em `src/`

### PROCESS_LOOPBACK (22 Jun 2026)

O sistema de seleção de áudio foi migrado de **mute-based** para **PROCESS_LOOPBACK API** (`ActivateAudioInterfaceAsync` com `AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK`):

- `ProcessAudioSource` — captura loopback de um único PID via COM `IAudioClient`/`IAudioCaptureClient` com `[ComImport]` interfaces. Sem vtable manual. Sem dependência extra.
- `MultiSourceLoopback` — implementa `IAudioSource` agregando N `ProcessAudioSource`. Mixer thread interna soma os samples per-processo em chunks de 20ms e emite um stream único.
- `AudioSessionManager` simplificado — só enumera sessões (via NAudio). `ApplySelection`/`Restore` removidos.
- `AudioMixer` refatorado — aceita `IAudioSource` injetado em vez de criar `WasapiLoopbackSource` internamente.
- `EngineCoordinator.CreateAudioMixer()` — factory que decide entre `MultiSourceLoopback` (PIDs selecionadas) ou `WasapiLoopbackSource` (captura completa).

**Benefício**: apps não selecionados NÃO são mutados. O usuário ouve tudo normalmente. Apenas o clip contém os PIDs selecionados.

## Resultados Benchmark (22 Jun 2026)

### Capture Latency Split (DXGI Desktop Duplication)

| Métrica | Total | Espera (wait) | Cópia (copy) |
|---------|-------|---------------|--------------|
| p50 | 7,01 ms | 6,82 ms | **0,23 ms** |
| p95 | 41,62 ms | 41,38 ms | **0,34 ms** |
| p99 | 56,82 ms | 56,45 ms | **0,50 ms** |
| Média | 14,83 ms | 14,61 ms | **0,23 ms** |

> ✅ **Hipótese confirmada:** 99% da latência é `AcquireNextFrame` bloqueado aguardando mudanças no desktop idle. A cópia GPU (`CopyResource`) é sub-milissegundo — **não há gargalo no pipeline de captura**.

### Encode (NVENC via ffmpeg)

| Métrica | Valor |
|---------|-------|
| Frames encodedos | 30 |
| Tempo encode médio | 2966 µs/frame (2,97 ms) |

### CPU Usage (30s active capture simulation)

| Métrica | Valor |
|---------|-------|
| Média | 0,16% |
| Pico | 3,12% |
| Duração | 30s |

### Resumo

| Métrica | Valor |
|---------|-------|
| GPU | NVIDIA GeForce RTX 5050 (driver 32.0.16.1062) |
| Capture backend | DXGI Desktop Duplication |
| Frames capturados | 300/300 (100%) |
| Meta p95 < 16ms | ✗ (DXGI wait em idle, não cópia) |
| Encoder | FfmpegEncoder (h264_nvenc) |
| CPU média | 0,16% — essencialmente zero |

## Bugfixes (22 Jun 2026)
- `-flags +aud` removido para HW encoders (nvenc não suporta) — `StartFfmpeg()` usa `aud` só para libx264
- Watchdog: `_restartAttempts` incrementado só no `TryRestart()` e resetado apenas no `EncodeFrame` bem-sucedido (evita loop infinito com argumentos inválidos)
- AudioMixer: `_loopback.Start()` movido antes de ler `SampleRate`/`Channels` (DivideByZero fix)
- Pipeline timing: `Math.Max(1, ...)` guard em `Task.Delay(remainingMs - 1)`
- StopCapture race: lock `_pipelineLock`, locals `cap`/`enc` no pipeline loop
- **GpuVideoConverter NRE fix:** `ID3D11Device.ImmediateContext` crashava com NRE porque o wrapper do device do primeiro frame perdia o ponteiro nativo. Removido `_device` e todo sync extra do converter — `Convert()` agora só executa `VideoProcessorBlt` e retorna; sincronização GPU fica a cargo do `CopyResource`+`Map` do caller.
- **ParseAnnexB split-NAL fix:** bytes entre duas chamadas `_stdout.Read()` que caíam dentro de uma NAL unit eram perdidos. Adicionada lógica `AppendPending` para dados antes do primeiro start code no chunk, preservando cauda de NAL entre leituras.
