using DiNho.Capture.Poc.Encoders;
using DiNho.Capture.Poc.Logging;
using System.Diagnostics;
using System.Globalization;
using System.Text;

namespace DiNho.Capture.Poc.Export;

public sealed partial class ClipExporter : IDisposable
{
    private bool _disposed;

    public static string GenerateOutputPath(string? directory = null)
    {
        directory ??= Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.Desktop),
            "DiNhoClips");
        Directory.CreateDirectory(directory);
        return Path.Combine(directory, $"DiNho Optimizer {DateTime.Now:yyyy-MM-dd_HH-mm-ss}.mp4");
    }

    public string ExportToMp4(
        string outputPath,
        List<EncodedPacket> videoPackets,
        List<EncodedPacket> audioPackets,
        int width,
        int height,
        int frameRate,
        string rawFormat = "h264",
        byte[]? avccFallback = null,
        byte[]? hvccFallback = null)
    {
        if (videoPackets.Count == 0)
            throw new InvalidOperationException("No video packets to export");

        // Opção B: descarta prefixo não-ADTS (frames corrompidos do spill pré-fix A)
        // ANTES do parse de sample rate e do hasAudioTracks, para que audioPackets[0]
        // seja sempre ADTS válido quando houver áudio.
        audioPackets = TrimNonAdtsPrefix(audioPackets);

        // Parse audio sample rate from first ADTS packet (used for padding & CodecDelay)
        int audioSampleRate = 48000;
        int audioChannels = 2;
        if (audioPackets.Count > 0 && audioPackets[0].Data.Length > 4)
        {
            int sri = (audioPackets[0].Data[2] >> 2) & 0x0F;
            int[] rates = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000];
            audioSampleRate = sri < rates.Length ? rates[sri] : 48000;
            audioChannels = ((audioPackets[0].Data[2] & 0x01) << 2) | ((audioPackets[0].Data[3] >> 6) & 0x03);
            if (audioChannels < 1 || audioChannels > 7) audioChannels = 2;
        }

        // B3: serialização única no EngineCoordinator (anti-double-press via
        // _exportLock/_exportInProgress). Este lock próprio era redundante e
        // criava dupla camada de proteção com semânticas diferentes.
        try
        {
            var outputDir = Path.GetDirectoryName(Path.GetFullPath(outputPath))!;
            var drive = new DriveInfo(outputDir);
            if (drive.AvailableFreeSpace < 100_000_000)
                throw new InvalidOperationException(
                    $"Espaco insuficiente: {drive.AvailableFreeSpace / 1024 / 1024}MB");

            var mkvTemp = Path.Combine(Path.GetTempPath(), $"dhn_{Guid.NewGuid():N}.mkv");
            var adtsTemp = audioPackets.Count > 0
                ? Path.Combine(Path.GetTempPath(), $"dhn_{Guid.NewGuid():N}.adts")
                : null;

            try
            {
                // Clona os pacotes para o export poder ajustar Pts sem corromper o
                // anel vivo do ReplayBuffer (GetSegments retorna referências Retain'd).
                // Clones compartilham o byte[]; o caller libera os originais no finally.
                videoPackets = ClonePackets(videoPackets);
                audioPackets = ClonePackets(audioPackets);

                // SYNC-PROBE: PTS offset between audio and video BEFORE any processing
                if (videoPackets.Count > 0 && audioPackets.Count > 0)
                {
                    var vFirst = videoPackets[0].Pts;
                    var vLast = videoPackets[^1].Pts + videoPackets[^1].Duration;
                    var aFirst = audioPackets[0].Pts;
                    var aLast = audioPackets[^1].Pts + audioPackets[^1].Duration;
                    var startOffset = (aFirst - vFirst).TotalMilliseconds;
                    var endOffset = (aLast - vLast).TotalMilliseconds;
                    Log.I("SYNC-PROBE", $"ExportToMp4 RAW — Video: {vFirst.TotalSeconds:F3}s → {vLast.TotalSeconds:F3}s ({(vLast - vFirst).TotalSeconds:F2}s)  Audio: {aFirst.TotalSeconds:F3}s → {aLast.TotalSeconds:F3}s ({(aLast - aFirst).TotalSeconds:F2}s)  StartOffset={startOffset:F1}ms  EndOffset={endOffset:F1}ms");
                }

                double activeDurationSec = 0;
                double activeFps = frameRate;
                double trueVidDuration = 0;
                double audioDurationSec = 0;
                int gapsRemoved = 0;

                // Sync audio to video PTS intervals (handles alt-tab gaps)
                if (videoPackets.Count > 0 && audioPackets.Count > 0)
                {
                    var vFirst = videoPackets[0].Pts;
                    var vLast = videoPackets[^1].Pts;
                    var aFirst = audioPackets[0].Pts;
                    var aLast = audioPackets[^1].Pts;
                    Log.D("PTS", $"Pre-sync — Video: {vFirst.TotalSeconds:F3}s → {vLast.TotalSeconds:F3}s ({videoPackets.Count} frames)  Audio: {aFirst.TotalSeconds:F3}s → {aLast.TotalSeconds:F3}s ({audioPackets.Count} packets)");

                    // Re-âncora do áudio na timeline do vídeo — sem isso, um offset
                    // grande (encoder < 1.0x, observado ~480s) faz FilterAudioByIntervals
                    // descartar TODO o áudio (nenhum PTS de áudio cai nos intervalos do
                    // vídeo) → clip mudo. Alinha o "now" de cada stream (mesma janela
                    // de wall-clock) e deixa o sync fino (TrimVideoStart/NoSync) tratar
                    // o resíduo sub-2s.
                    var alignShift = AlignAudioToVideoPts(audioPackets, videoPackets);
                    if (alignShift != TimeSpan.Zero)
                        Log.I("PTS", $"AlignAudio: re-anchoring audio by {alignShift.TotalMilliseconds:F0}ms to video timeline");

                    int origAudioCount = audioPackets.Count;
                    var intervals = GetVideoIntervals(videoPackets, TimeSpan.FromMilliseconds(50));
                    audioPackets = FilterAudioByIntervals(audioPackets, intervals);
                    gapsRemoved = origAudioCount - audioPackets.Count;
                    // Note: gapsRemoved is number of audio packets removed = original - filtered.

                    int startTrimmed = audioPackets.Count;
                    audioPackets = TrimAudioStart(audioPackets, videoPackets[0].Pts);
                    int startTrimCount = startTrimmed - audioPackets.Count;

                    activeDurationSec = ComputeIntervalsDuration(intervals);
                    trueVidDuration = videoPackets.Count >= 2
                        ? (videoPackets[^1].Pts - videoPackets[0].Pts).TotalSeconds + videoPackets[^1].Duration.TotalSeconds
                        : 0;

                    activeFps = activeDurationSec > 0 ? videoPackets.Count / activeDurationSec : frameRate;
                    if (activeFps < 1 || activeFps > frameRate * 3) activeFps = frameRate;

                    var lastVideoPts = videoPackets[^1].Pts + videoPackets[^1].Duration;
                    audioPackets = TrimAudioEnd(audioPackets, lastVideoPts);

                    // Sync start: só trima vídeo se offset >2s (AAC vs NVENC speed);
                    // offsets 30ms-2s com áudio após vídeo: não faz nada (áudio começa
                    // naturalmente, vídeo sem áudio por ~300ms é menos perceptível que
                    // silêncio artificial — ITU-R BT.1359: humano tolera áudio atrasado
                    // até 125ms como "detectável", 185ms como "aceitável").
                    // Offsets com áudio antes do vídeo: PadAudioWithSilence (silêncio
                    // no início do áudio para alinhar).
                    if (audioPackets.Count > 0 && videoPackets.Count > 0)
                    {
                        var offsetMs = (audioPackets[0].Pts - videoPackets[0].Pts).TotalMilliseconds;
                        if (offsetMs > 2000)
                        {
                            var target = audioPackets[0].Pts;
                            int trimIdx = videoPackets.FindIndex(p => p.Pts + p.Duration > target);
                            if (trimIdx > 0)
                            {
                                int lastKey = videoPackets.FindLastIndex(trimIdx, p => p.IsKeyFrame);
                                if (lastKey >= 0 && lastKey < trimIdx)
                                {
                                    Log.I("PTS", $"TrimVideoStart: rolling back from {trimIdx} to {lastKey} (keyframe at {videoPackets[lastKey].Pts.TotalSeconds:F3}s)");
                                    trimIdx = lastKey;
                                }
                                Log.I("PTS", $"TrimVideoStart: {trimIdx}/{videoPackets.Count} frames ({videoPackets[0].Pts.TotalSeconds:F3}s → {videoPackets[trimIdx].Pts.TotalSeconds:F3}s) because audio starts at {target.TotalSeconds:F3}s");
                                videoPackets = videoPackets.GetRange(trimIdx, videoPackets.Count - trimIdx);
                            }
                        }
                        else if (offsetMs < -30)
                        {
                            // Áudio começa ANTES do vídeo — não adiciona silêncio.
                            // O mixer já iniciou antes do NVENC produzir o 1º frame;
                            // silêncio artificial causaria delay incorreto.
                            // Passar null para PadAudioWithSilence = sem âncora, sem padding.
                            Log.D("PTS", $"NoSilenceNeeded: audio starts {-offsetMs:F0}ms before video — passing null anchor");
                            var silenceAnchor = audioPackets.Count > 0
                                && audioPackets[0].Pts < videoPackets[0].Pts
                                ? (TimeSpan?)null
                                : videoPackets[0].Pts;
                            audioPackets = PadAudioWithSilence(audioPackets, audioSampleRate, audioChannels, silenceAnchor);
                        }
                        else if (offsetMs > 30 && offsetMs <= 2000)
                        {
                            // Áudio começa DEPOIS do vídeo com offset pequeno — não faz nada.
                            // O vídeo toca sem áudio por alguns ms, que é menos perceptível
                            // que silêncio artificial no início do clipe.
                            Log.D("PTS", $"NoSyncNeeded: audio starts {offsetMs:F0}ms after video — letting audio start naturally");
                        }
                    }

                    if (audioPackets.Count > 0)
                    {
                        var af = audioPackets[0].Pts;
                        var al = audioPackets[^1].Pts + audioPackets[^1].Duration;
                        audioDurationSec = (al - af).TotalSeconds;
                    }
                    if (activeDurationSec > 5 && audioDurationSec > 0 && audioDurationSec < activeDurationSec * 0.9)
                        Log.W("PTS", $"audio duration {audioDurationSec:F2}s is <90% of active video {activeDurationSec:F2}s — {audioPackets.Count} packets may be insufficient");

                    var expectedDuration = (videoPackets[^1].Pts - videoPackets[0].Pts).TotalSeconds + videoPackets[^1].Duration.TotalSeconds;
                    var durDiff = expectedDuration - activeDurationSec;
                    Log.I("PTS", $"Post-sync — expectedDuration={expectedDuration:F2}s activeDuration={activeDurationSec:F2}s diff={durDiff:F3}s gapsRemoved={gapsRemoved} audioFrames={audioPackets.Count} startTrimmed={startTrimCount}");

                    Log.D("PTS", $"Post-sync — Video: trueDuration={trueVidDuration:F2}s activeDuration={activeDurationSec:F2}s fps={activeFps:F1} frames={videoPackets.Count}  Audio: packets={audioPackets.Count} gapsRemoved={gapsRemoved} startTrimmed={startTrimCount}");

                    // Re-timestamp to contiguous timeline: closes alt-tab gaps in the
                    // Matroska/MP4 so the player doesn't encounter timestamp jumps.
                    ReTimestampToContiguous(videoPackets, audioPackets, intervals);
                }

                // Frame-by-frame PTS drift diagnostic
                if (videoPackets.Count > 0 && audioPackets.Count > 0)
                {
                    var driftLog = new System.Text.StringBuilder();
                    driftLog.Append("PTS-DRIFT | ");
                    var vidStart = videoPackets[0].Pts;
                    var audStart = audioPackets[0].Pts;
                    var step = Math.Max(1, videoPackets.Count / 20);
                    for (int i = 0; i < videoPackets.Count; i += step)
                    {
                        var vp = videoPackets[i];
                        var nearestAudio = audioPackets
                            .Select(a => new { Pkt = a, Delta = (a.Pts - vp.Pts).Duration() })
                            .OrderBy(a => a.Delta)
                            .FirstOrDefault();
                        var drift = nearestAudio != null
                            ? (nearestAudio.Pkt.Pts - vp.Pts).TotalMilliseconds
                            : 0;
                        if (i > 0) driftLog.Append(", ");
                        driftLog.Append($"@{((vp.Pts - vidStart).TotalSeconds):F1}s vPTS={vp.Pts.TotalMilliseconds:F0} aPTS={nearestAudio?.Pkt.Pts.TotalMilliseconds:F0} drift={drift:F1}ms");
                    }
                    Log.I("SYNC", driftLog.ToString());
                }

                // Write video to a Matroska temp file (preserves per-frame PTS via
                // SimpleBlocks). ffmpeg's -f matroska demuxer reads these timestamps,
                // so alt-tab gap closing (ReTimestampToContiguous) survives the mux.
                // Áudio NÃO entra no MKV (M4): é escrito no arquivo ADTS separado e
                // mapeado no mux via -f aac — o matroskadec não seta frame_size para
                // A_AAC, então a trilha MKV era só parsing desnecessário.
                // Option C: estimativa de tamanho para pre-alocar o arquivo temporário
                // (reduz fragmentação do disco e evita extensões dinâmicas de metadados).
                long mkvEstimatedSize = videoPackets.Count > 0
                    ? (long)(videoPackets.Average(p => (double)p.DataLength) * videoPackets.Count * 1.2)
                    : 0;
                WriteMatroskaFile(mkvTemp, videoPackets, rawFormat, avccFallback, hvccFallback, mkvEstimatedSize);
                var mkvLen = new FileInfo(mkvTemp).Length;
                var audioCount = audioPackets.Count(p => p.Type == MediaType.Audio);
                Log.I("Exporter", $"MKV temp: {mkvTemp} ({mkvLen / 1024} KB) videoFrames={videoPackets.Count} audioPackets={audioCount}");

                Log.D("Exporter", $"nominalFps={frameRate} activeFps={activeFps:F1} activeDuration={activeDurationSec:F3}s totalDuration={trueVidDuration:F3}s videoFrames={videoPackets.Count} audioPackets={audioPackets.Count} gapsRemoved={gapsRemoved} audioDurationSec={audioDurationSec:F3}s");

                bool hasAudioTracks = audioPackets.Count > 0 && IsAdts(audioPackets[0]);

                // Log ASC + first audio bytes before mux for diagnostics
                if (hasAudioTracks && audioPackets.Count > 0)
                {
                    var asc = BuildAudioSpecificConfig(audioPackets[0]);
                    if (asc != null)
                    {
                        var ascHex = BitConverter.ToString(asc).Replace("-", " ");
                        Log.I("Exporter", $"ASC bytes: {ascHex} (profile={(asc[0] >> 3) & 0x1F} sampleRateIdx={((asc[0] & 0x07) << 1) | ((asc[1] >> 7) & 0x01)} channels={(asc[1] >> 3) & 0x0F})");
                    }
                    // First audio frame: show ADTS header + first 16 bytes of raw AAC
                    var firstPkt = audioPackets[0];
                    int adtsHdrLen = (firstPkt.Data[1] & 0x01) == 1 ? 7 : 9;
                    var adtsHex = BitConverter.ToString(firstPkt.Data, 0, Math.Min(adtsHdrLen, firstPkt.DataLength)).Replace("-", " ");
                    int rawStart = Math.Min(adtsHdrLen, firstPkt.DataLength);
                    int rawLen = Math.Min(16, firstPkt.DataLength - rawStart);
                    var rawHex = rawLen > 0 ? BitConverter.ToString(firstPkt.Data, rawStart, rawLen).Replace("-", " ") : "(empty)";
                    Log.I("Exporter", $"First audio: adtsHdr={adtsHex} rawStart={rawHex} totalLen={firstPkt.DataLength}B");
                }

                // Write audio to a separate raw ADTS file.
                // ffmpeg's -f adts demuxer reads ADTS natively and correctly sets
                // frame_size from the ADTS header — bypasses the Matroska demuxer
                // which doesn't set frame_size for A_AAC (causing "codec frame size
                // is not set" and audio silently dropped from MP4 output).
                if (hasAudioTracks && adtsTemp != null)
                {
                    long adtsEstimatedSize = audioPackets.Count > 0
                        ? (long)(audioPackets.Average(p => (double)p.DataLength) * audioPackets.Count * 1.2)
                        : 0;
                    WriteAdtsFile(adtsTemp, audioPackets, adtsEstimatedSize);
                    var adtsLen = new FileInfo(adtsTemp).Length;
                    Log.I("Exporter", $"ADTS temp: {adtsTemp} ({adtsLen / 1024} KB) audioFrames={audioPackets.Count}");
                }

                // O offset de áudio intencional (áudio começando depois do vídeo) era
                // perdido no mux: o ADTS cru não tem PTS. Passa-o como -itsoffset.
                var audioOffset = ComputeAudioMuxOffset(videoPackets, audioPackets);
                if (audioOffset > TimeSpan.Zero)
                    Log.I("Exporter", $"Mux audio offset: {audioOffset.TotalMilliseconds:F0}ms (-itsoffset)");
                MuxWithFfmpegStreaming(outputPath, mkvTemp, hasAudioTracks, rawFormat, adtsTemp, audioOffset);

                // Pós-mux: verifica presença de áudio no MP4 E gera thumbnail em
                // UMA chamada ffmpeg (B4 — antes eram 2 processos de 217MB por save).
                // A dump de input do ffmpeg (stderr) já lista "Stream #0:..." com
                // "Audio:"/"Video:", então o probe dedicado é desnecessário.
                try { GenerateThumbnail(outputPath, expectedAudio: hasAudioTracks); }
                catch (Exception ex) { Log.W("Exporter", $"Thumbnail generation failed: {ex.Message}"); }
            }
            finally
            {
                try { File.Delete(mkvTemp); } catch { }
                if (adtsTemp != null) try { File.Delete(adtsTemp); } catch { }
            }

            return outputPath;
        }
        finally
        {
            // (B3) sem Monitor.Exit — serialização delegada ao EngineCoordinator
        }
    }

    private static void MuxWithFfmpegStreaming(
        string outputPath,
        string videoPath,
        bool hasAudioTracks,
        string rawFormat = "h264",
        string? adtsPath = null,
        TimeSpan audioOffset = default)
    {
        bool audioInput = hasAudioTracks && adtsPath != null && File.Exists(adtsPath);

        // M3: hasAudioTracks mas adtsPath é null/inexistente — o áudio foi
        // perdido antes do mux (falha ao escrever ADTS). O MKV agora NÃO
        // contém trilha de áudio (M4), então não há como recuperar. Em vez de
        // um dead-end silencioso, loga warning explícito para o operador.
        if (hasAudioTracks && !audioInput)
            Log.W("Exporter", $"Áudio disponível ({adtsPath ?? "null"}) mas arquivo ADTS não existe — exportando vídeo sem áudio!");

        var args = BuildMuxArgs(outputPath, videoPath, audioInput, audioOffset, adtsPath);
        Log.I("Exporter", $"ffmpeg mux: {args.Replace("\"", "'")}");

        // Option A: reduz prioridade do processo durante o mux pesado de leitura
        // (temp MKV + ADTS → MP4) para não starvationar o jogo/gravação.
        var savedPriority = Process.GetCurrentProcess().PriorityClass;
        try
        {
            Process.GetCurrentProcess().PriorityClass = ProcessPriorityClass.BelowNormal;

            using var proc = new Process { StartInfo = FfmpegPathResolver.CreateFfmpegStartInfo(args: args, redirectError: true) };

            var stderr = new StringBuilder();
            proc.ErrorDataReceived += (s, e) =>
            {
                if (e.Data != null)
                    lock (stderr) { stderr.AppendLine(e.Data); }
            };

            proc.Start();
            proc.BeginErrorReadLine();

            if (!proc.WaitForExit(300_000))
            {
                proc.Kill();
                throw new InvalidOperationException("ffmpeg nao terminou em 5min");
            }

            string finalStderr;
            lock (stderr) { finalStderr = stderr.ToString(); }

            if (proc.ExitCode != 0)
            {
                throw new InvalidOperationException(
                    $"ffmpeg exit code {proc.ExitCode}: {finalStderr.Trim()}");
            }

            if (!string.IsNullOrWhiteSpace(finalStderr))
                Log.I("Exporter", $"ffmpeg stderr: {finalStderr.Trim()}");
        }
        finally
        {
            try { Process.GetCurrentProcess().PriorityClass = savedPriority; } catch { }
        }
    }

    // Monta o comando ffmpeg do mux. Extraído para permitir testar a posição do
    // -itsoffset (opção de INPUT: precisa vir imediatamente antes do -f aac -i).
    internal static string BuildMuxArgs(
        string outputPath,
        string videoPath,
        bool hasAudio,
        TimeSpan audioOffset,
        string? adtsPath)
    {
        // O offset positivo atrasa o áudio para preservar o silêncio inicial
        // decidido pelo sync (NoSyncNeeded). Sem ele, o ADTS cru começa em 0 e o
        // áudio toca adiantado em relação ao vídeo.
        string offsetArg = hasAudio && audioOffset > TimeSpan.Zero
            ? $"-itsoffset {audioOffset.TotalSeconds.ToString("0.######", CultureInfo.InvariantCulture)} "
            : "";
        string audioIn = hasAudio ? $"{offsetArg}-f aac -i \"{adtsPath}\" " : "";
        string maps = hasAudio ? "-map 0:v:0 -map 1:a:0 " : "-map 0:v:0 ";
        string codecs = hasAudio ? "-c:v copy -c:a copy " : "-c:v copy ";

        return $"-y -loglevel warning " +
               $"-f matroska -i \"{videoPath}\" " +
               audioIn +
               $"-max_muxing_queue_size 4096 " +
               maps +
               codecs +
               $"-metadata title=\"DiNho Clip\" -metadata comment=\"Recorded with DiNho Clips\" " +
               $"-movflags +faststart \"{outputPath}\"";
    }

    // Menor PTS da lista. É a mesma base de re-baseline usada por
    // WriteMatroskaFile (o MKV começa em 0), então o offset do áudio precisa ser
    // medido contra ela.
    internal static TimeSpan ComputeMinPts(List<EncodedPacket> packets)
    {
        if (packets.Count == 0) return TimeSpan.Zero;
        var min = packets[0].Pts;
        for (int i = 1; i < packets.Count; i++)
            if (packets[i].Pts < min)
                min = packets[i].Pts;
        return min;
    }

    // Deslocamento de áudio desejado no mux = (início do áudio) − (início do MKV).
    // Negativo (áudio antes do vídeo) é clampado para 0 — não atrasamos o vídeo.
    internal static TimeSpan ComputeAudioMuxOffset(
        List<EncodedPacket> videoPackets, List<EncodedPacket> audioPackets)
    {
        if (videoPackets.Count == 0 || audioPackets.Count == 0) return TimeSpan.Zero;
        var offset = audioPackets[0].Pts - ComputeMinPts(videoPackets);
        return offset > TimeSpan.Zero ? offset : TimeSpan.Zero;
    }

    internal static bool IsAdts(EncodedPacket pkt) =>
        pkt.Data.Length >= 2 && pkt.Data[0] == 0xFF && (pkt.Data[1] & 0xF0) == 0xF0;

    /// <summary>
    /// Descarta um prefixo inicial de pacotes de áudio não-ADTS. Defesa (Opção B)
    /// contra frames corrompidos vindos do disk spill pré-fix A (Data=[]/DataLength=0):
    /// isola o primeiro pacote ADTS válido e mantém o suffixo a partir dele. Não
    /// dessincroniza A/V porque a âncora do sync é o FIM dos streams e o prefixo
    /// removido está no início. Retorna a lista original se já começa em ADTS.
    /// </summary>
    internal static List<EncodedPacket> TrimNonAdtsPrefix(List<EncodedPacket> audioPackets)
    {
        if (audioPackets.Count == 0) return audioPackets;
        int first = audioPackets.FindIndex(p => p.Type == MediaType.Audio && IsAdts(p));
        if (first == -1) return new List<EncodedPacket>();
        if (first == 0) return audioPackets;
        Log.W("Exporter", $"TrimNonAdtsPrefix: descartando {first} pacote(s) não-ADTS no início do áudio");
        return audioPackets.GetRange(first, audioPackets.Count - first);
    }

    internal static void WriteAdtsFile(string path, List<EncodedPacket> audioPackets, long estimatedSize = 0)
    {
        using var fs = new FileStream(path, FileMode.Create, FileAccess.Write,
            FileShare.Read, 256 * 1024, FileOptions.SequentialScan);
        if (estimatedSize > 0)
        {
            try { fs.SetLength(estimatedSize); } catch { }
        }
        foreach (var pkt in audioPackets)
        {
            if (pkt.Type != MediaType.Audio) continue;
            fs.Write(pkt.Data, 0, pkt.DataLength);
        }

        // G3: truncamento do padding zero (mesma razão do MKV — SetLength预留 ~20%)
        fs.SetLength(fs.Position);
    }

    internal static void GenerateThumbnail(string videoPath, bool expectedAudio = false)
    {
        var thumbPath = Path.ChangeExtension(videoPath, ".thumb.jpg");

        var sb = new StringBuilder();
        using var proc = new Process { StartInfo = FfmpegPathResolver.CreateFfmpegStartInfo(args: $"-y -loglevel info -i \"{videoPath}\" -vframes 1 -s 320x180 -f image2 \"{thumbPath}\"", redirectError: true) };
        proc.ErrorDataReceived += (s, e) => { if (e.Data != null) lock (sb) sb.AppendLine(e.Data); };

        proc.Start();
        proc.BeginErrorReadLine();

        bool timedOut = !proc.WaitForExit(30_000);
        if (timedOut)
            proc.Kill();

        // M14: o dump de input do ffmpeg (stderr) lista as streams ANTES do encode —
        // reaproveita como probe (B4) MESMO quando o thumbnail falha (exit != 0,
        // timeout). Antes o throw vinha primeiro e o aviso "MP4 probe FAILED" — que
        // diagnostica export corrompido sem áudio — era engolido pelo catch do caller.
        string stderr;
        lock (sb) { stderr = sb.ToString(); }

        var hasVideoStream = stderr.Contains("Video:");
        var hasAudioStream = stderr.Contains("Audio:");
        var streamCount = System.Text.RegularExpressions.Regex.Matches(stderr, "Stream #").Count;
        Log.I("Exporter", $"MP4 probe: streams={streamCount} video={hasVideoStream} audio={hasAudioStream}");
        if (expectedAudio && !hasAudioStream)
            Log.W("Exporter", $"MP4 probe FAILED: expected audio but none found!\n{stderr}");
        else if (hasAudioStream)
            Log.I("Exporter", "MP4 probe OK: audio stream present");

        if (timedOut)
            throw new InvalidOperationException($"ffmpeg thumbnail timed out:\n{stderr}");
        if (proc.ExitCode != 0)
            throw new InvalidOperationException($"ffmpeg thumbnail exit code {proc.ExitCode}:\n{stderr}");

        if (File.Exists(thumbPath))
            Log.I("Exporter", $"Thumbnail: {thumbPath} ({new FileInfo(thumbPath).Length / 1024} KB)");
    }

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
    }
}
