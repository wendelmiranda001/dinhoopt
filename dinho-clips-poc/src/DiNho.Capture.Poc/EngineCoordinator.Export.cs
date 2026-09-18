using DiNho.Capture.Poc.Encoders;
using DiNho.Capture.Poc.Ipc;
using DiNho.Capture.Poc.Logging;
using DiNho.Capture.Poc.Memory;
using DiNho.Capture.Poc.Status;
using System.Diagnostics;

namespace DiNho.Capture.Poc;

public sealed partial class EngineCoordinator
{
    private const long ExportStallThresholdMs = 10_000;

    /// <summary>
    /// Roda o export num thread dedicada com prioridade BelowNormal. O mux do ffmpeg
    /// e a clonagem de pacotes são CPU/GC-hungry; em Task.Run (threadpool, prioridade
    /// normal) eles competiam com o pipeline de captura — drops observados durante mux
    /// de clips grandes (2.6GB, sessão AMD 2026-09-18 01:03). Prioridade menor garante
    /// que o pthread de captura (timing-sensitive) preempta o export.
    /// </summary>
    internal static async Task RunExportOnDedicatedThreadAsync(Action work)
    {
        var tcs = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var thread = new Thread(() =>
        {
            try
            {
                work();
                tcs.SetResult();
            }
            catch (Exception ex)
            {
                tcs.SetException(ex);
            }
        })
        {
            IsBackground = true,
            Name = "ExportWorker",
            Priority = ThreadPriority.BelowNormal,
        };
        thread.Start();
        await tcs.Task;
    }

    private async Task SaveClipAsync(int? customDurationSeconds = null)
    {
        // Anti-double-press (spec 14.1)
        lock (_exportLock)
        {
            if (_exportInProgress)
            {
                Log.I("EngineCoordinator", "Export já em andamento, ignorando duplicado");
                return;
            }
            _exportInProgress = true;
        }

        // Feedback sonoro imediato — botão do front e atalho passam por aqui.
        // Dispara antes do export/espera pós-clip para resposta instantânea.
        ClipSavedSound();

        List<EncodedPacket>? video = null, audio = null;

        try
        {
            // Post-clip buffer: espera N segundos para incluir o momento após o trigger
            Log.I("ENGINE-DEBUG", $"SaveClip: customDuration={(customDurationSeconds.HasValue ? customDurationSeconds.ToString() : "null")} " +
                $"ReplayTimeSeconds={_config.Config.ReplayTimeSeconds}s " +
                $"BufferMaxDuration={_buffer.MaxDuration.TotalSeconds:F0}s " +
                $"BufferActual={_buffer.Stats().duration.TotalSeconds:F0}s " +
                $"PostClip={_config.Config.PostClipDurationSeconds}s");
            var replaySec = Math.Min(
                customDurationSeconds ?? _config.Config.ReplayTimeSeconds,
                (int)_buffer.MaxDuration.TotalSeconds);
            var postClipSec = Math.Max(0, _config.Config.PostClipDurationSeconds);
            var totalSec = replaySec + postClipSec;

            Log.I("EngineCoordinator", $"Exportando clip ({replaySec}s + {postClipSec}s post)...");

            // Verifica espaço em disco (spec 14.1)
            var outputDir = GetOutputDirectory();
            var driveInfo = new DriveInfo(outputDir);
            if (driveInfo.AvailableFreeSpace < 100_000_000) // 100MB mínimo
            {
                Log.E("EngineCoordinator", "Espaço em disco insuficiente para export");
                return;
            }

            // Diagnóstico do AAC encoder antes de congelar o buffer
            _aacEncoder?.LogStats();

            // Diagnóstico completo do buffer antes do save
            {
                var d = _buffer.StatsDetailed();
                var r = _buffer.PeekVideoPtsRange();
                string profileInfo = _activeProfile != null
                    ? $"profile={_activeProfile.Level} replaySec={_activeProfile.ReplaySeconds}s maxBufMB={_activeProfile.MaxBufferBytes / (1024*1024)}"
                    : "profile=none";
                Log.I("BUF-DIAG",
                    $"Stats: video={d.videoCount} audio={d.audioCount} " +
                    $"vidBytes={d.videoBytes} audBytes={d.audioBytes} " +
                    $"vidDur={d.videoDuration.TotalSeconds:F1}s audDur={d.audioDuration.TotalSeconds:F1}s " +
                    $"maxBytes={_buffer.MaxBytes} maxDur={_buffer.MaxDuration.TotalSeconds:F0}s " +
                    $"PTS_range={r.firstPts.TotalSeconds:F1}s→{r.lastPts.TotalSeconds:F1}s ({r.span.TotalSeconds:F1}s) " +
                    $"{profileInfo}");
            }

            // Post-clip buffer: espera N segundos para incluir o momento após o trigger
            if (postClipSec > 0)
            {
                var originalMax = _buffer.MaxDuration;
                _buffer.MaxDuration = TimeSpan.FromSeconds(totalSec);
                Log.I("EngineCoordinator", $"Aguardando {postClipSec}s pós-clip (total={totalSec}s)...");
                await Task.Delay(TimeSpan.FromSeconds(postClipSec));
                Log.I("EngineCoordinator", $"Coletando buffer ({totalSec}s)...");

                (video, audio) = _buffer.GetSegments(TimeSpan.FromSeconds(totalSec));
                _buffer.MaxDuration = originalMax;
            }
            else
            {
                (video, audio) = _buffer.GetSegments(TimeSpan.FromSeconds(replaySec));
            }
            Log.I("AudioDiag", $"SaveClip: video={video.Count} frames, audio={audio.Count} packets");
            if (video.Count > 0 && audio.Count > 0)
            {
                var vFirst = video[0].Pts;
                var vLast = video[^1].Pts + video[^1].Duration;
                var aFirst = audio[0].Pts;
                var aLast = audio[^1].Pts + audio[^1].Duration;
                var startOffset = (aFirst - vFirst).TotalMilliseconds;
                var endOffset = (aLast - vLast).TotalMilliseconds;
                Log.I("SYNC-PROBE", $"Video: {vFirst.TotalSeconds:F3}s → {vLast.TotalSeconds:F3}s ({(vLast - vFirst).TotalSeconds:F2}s)  Audio: {aFirst.TotalSeconds:F3}s → {aLast.TotalSeconds:F3}s ({(aLast - aFirst).TotalSeconds:F2}s)  StartOffset={startOffset:F1}ms  EndOffset={endOffset:F1}ms");
                var syncMaxAge = TimeSpan.FromSeconds(customDurationSeconds ?? _config.Config.ReplayTimeSeconds);
                var videoRef = video[^1].Pts;
                var audioRef = audio[^1].Pts;
                var videoWinStart = videoRef - syncMaxAge;
                var audioWinStart = audioRef - syncMaxAge;
                var videoWinSize = (videoRef - (videoWinStart > TimeSpan.Zero ? videoWinStart : video[0].Pts)).TotalSeconds;
                var audioWinSize = (audioRef - (audioWinStart > TimeSpan.Zero ? audioWinStart : audio[0].Pts)).TotalSeconds;
                Log.I("SYNC-MEASURE", $"maxAge={syncMaxAge.TotalSeconds:F0}s  videoRef={videoRef.TotalSeconds:F3}s  audioRef={audioRef.TotalSeconds:F3}s  refGap={(audioRef - videoRef).TotalSeconds:F2}s  videoWin={videoWinSize:F1}s  audioWin={audioWinSize:F1}s");
            }
            if (video.Count == 0)
            {
                Log.I("EngineCoordinator", "Nada para exportar (buffer vazio)");
                return;
            }

            var fileName = $"DiNho Optimizer {DateTime.Now:yyyy-MM-dd_HH-mm-ss}.mp4";
            var outputPath = Path.Combine(outputDir, fileName);
            Log.I("EngineCoordinator", $"═══════ SAVE START ═══════  → {outputPath}");

            var ffEncoder = _encoder as FfmpegEncoder;
            var cachedAvcc = ffEncoder?.AvccCache;
            var cachedHvcc = ffEncoder?.HvccCache;
            var exportSw = Stopwatch.StartNew();
            await RunExportOnDedicatedThreadAsync(() =>
            {
                var result = _exporter.ExportToMp4(
                    outputPath,
                    video,
                    audio,
                    _outputWidth > 0 ? _outputWidth : _captureWidth,
                    _outputHeight > 0 ? _outputHeight : _captureHeight,
                    _config.Config.Fps,
                    rawFormat: ffEncoder?.RawFormat ?? "h264",
                    avccFallback: cachedAvcc,
                    hvccFallback: cachedHvcc);

                var fileInfo = new FileInfo(result);
                Log.I("EngineCoordinator", $"Clip salvo: {result} ({fileInfo.Length / 1024} KB)");
                Log.I("EngineCoordinator", $"═══════ SAVE OK ═══════");
                _status.Update(s => s.LastClipSize = fileInfo.Length);
            });
            exportSw.Stop();
            if (exportSw.ElapsedMilliseconds > ExportStallThresholdMs)
                _watchdog.ReportExportStall();
        }
        catch (Exception ex)
        {
            Log.E("EngineCoordinator", $"═══ EXPORT FAILED ═══  {ex.GetType().Name}: {ex.Message}");
            if (ex.InnerException != null)
                Log.E("EngineCoordinator", $"Inner: {ex.InnerException.GetType().Name}: {ex.InnerException.Message}");
        }
        finally
        {
            // Libera retain dos pacotes — TrimExcess pode já ter Release()'d alguns,
            // então este Release() extra é o que efetivamente retorna ao pool.
            // Em finally para cobrir exceções do export (H1) e o early-return de buffer vazio.
            if (video != null)
                foreach (var pkt in video) pkt.Release();
            if (audio != null)
                foreach (var pkt in audio) pkt.Release();
            lock (_exportLock)
            {
                _exportInProgress = false;
            }
            // Trim pós-save em thread de fundo: devolve RAM sem perder a "quente" do pool.
            _ = Task.Run(PostSaveTrim);
        }
    }

    /// <summary>
    /// Trim pós-save: reduz o idle do pool para ≤ 1/4 do MaxIdleBytes —
    /// devolve RAM (working set preso no pico histórico) sem esvaziar o pool
    /// por completo. Barato e lock-protected; usar em thread de fundo.
    /// </summary>
    internal static void PostSaveTrim()
    {
        try
        {
            var limit = VideoPacketPool.MaxIdleBytes / 4;
            VideoPacketPool.TrimIdleBytes(limit);
            Log.I("EngineCoordinator", $"PostSaveTrim: pool idle reduzido para ≤ {limit / (1024 * 1024)} MB");
            WorkingSetTrimmer.Trim();
        }
        catch (Exception ex)
        {
            Log.W("EngineCoordinator", $"PostSaveTrim falhou: {ex.Message}");
        }
    }

    private string GetOutputDirectory()
    {
        if (!string.IsNullOrEmpty(_config.Config.OutputDirectory))
            return _config.Config.OutputDirectory;

        // Default: %USERPROFILE%\Videos\DiNho Clips (alinhado com a UI do app)
        var videos = Environment.GetFolderPath(Environment.SpecialFolder.MyVideos);
        var dir = Path.Combine(videos, "DiNho Clips");
        Directory.CreateDirectory(dir);
        return dir;
    }

    private void RunAutoCleanup()
    {
        try
        {
            if (!_config.Config.AutoCleanupEnabled)
                return;

            var dir = GetOutputDirectory();
            var thresholdBytes = (long)_config.Config.AutoCleanupThresholdGB * 1024L * 1024L * 1024L;

            // Coleta nomes de clips favoritados (extrai nome do marker: .NomeClip.favorite → NomeClip)
            var favoriteNames = new HashSet<string>(
                Directory.GetFiles(dir, "*.favorite")
                    .Select(p => Path.GetFileNameWithoutExtension(p).TrimStart('.')),
                StringComparer.OrdinalIgnoreCase);

            var files = Directory.GetFiles(dir, "*.mp4")
                .Select(f => new FileInfo(f))
                .Where(f => !favoriteNames.Contains(Path.GetFileNameWithoutExtension(f.Name)))
                .OrderBy(f => f.CreationTime)
                .ToList();

            long totalBytes = files.Sum(f => f.Length);
            if (totalBytes <= thresholdBytes)
                return;

            long targetBytes = (long)(_config.Config.AutoCleanupThresholdGB * 0.9) * 1024L * 1024L * 1024L; // Limpa até 90% do limite
            int count = 0;
            long deleted = 0;
            foreach (var file in files)
            {
                if (totalBytes - deleted <= targetBytes)
                    break;
                try
                {
                    file.Delete();
                    deleted += file.Length;
                    count++;
                }
                catch { }
            }

            if (deleted > 0)
                Log.W("Cleanup", $"Removidos {count} clips ({deleted / (1024 * 1024)} MB) — limite={_config.Config.AutoCleanupThresholdGB}GB");
        }
        catch { }
    }

    private EngineStatusMessage GetStatusMessage()
    {
        var s = _status.Current;
        return new EngineStatusMessage
        {
            Value = new EngineStatusValue
            {
                CaptureBackend = s.CaptureBackend,
                Encoder = s.Encoder,
                DiskSpaceOk = CheckDiskSpace(),
                LastCrashRecovered = s.LastCrashRecovered,
                Game = _gameDetector.CurrentGame.IsValid && !NonGameProcesses.Contains(_gameDetector.CurrentGame.ProcessName) ? _gameDetector.CurrentGame.ToString() : null,
                Recording = _recording,
                UptimeSeconds = (long)_clock.Now.TotalSeconds,
                AudioFallback = _audioFallback,
                MicLevel = s.MicLevel,
                LastFrameMs = s.LastFrameMs,
                LastClipSize = s.LastClipSize,
                ActivePipelines = s.ActivePipelines,
                WatchdogOk = s.WatchdogOk,
                MemoryMB = s.MemoryMB,
                ReplayBufferBytes = s.ReplayBufferBytes,
                OutputDirectory = _config.Config.OutputDirectory,
                DroppedFrames = s.DroppedFrames,
                GpuBusyDrops = s.GpuBusyDrops,
                CalibrationTier = s.CalibrationTier,
            }
        };
    }

    private static bool CheckDiskSpace()
    {
        try
        {
            var desktop = Environment.GetFolderPath(Environment.SpecialFolder.Desktop);
            var drive = new DriveInfo(desktop);
            return drive.AvailableFreeSpace > 100_000_000;
        }
        catch
        {
            return true;
        }
    }

    private void BroadcastStatus(EngineStatusMessage msg)
    {
        OnStatusChanged?.Invoke(msg.Value);
    }
}
