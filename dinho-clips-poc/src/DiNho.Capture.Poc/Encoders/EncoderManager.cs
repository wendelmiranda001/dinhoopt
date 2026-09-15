using System.Diagnostics;
using DiNho.Capture.Poc.Logging;
using Vortice.Direct3D11;
using Vortice.DXGI;

namespace DiNho.Capture.Poc.Encoders;

public enum EncoderType { Ffmpeg, FfmpegHw, None }

/// <summary>Helper to resolve ffmpeg.exe path from multiple candidates.</summary>
internal static class FfmpegPathResolver
{
    private static string? _cachedPath;
    private static string? _cachedDir;

    /// <summary>Get the directory containing ffmpeg.exe (for DLL resolution).</summary>
    public static string GetFfmpegDir() => _cachedDir ?? Path.GetDirectoryName(GetFfmpegPath()) ?? "";

    public static string GetFfmpegPath()
    {
        if (_cachedPath != null)
            return _cachedPath;

        // Candidate paths in priority order:
        //   1. Same dir as engine exe (packaged app)
        //   2. Release publish dir (dev: published standalone)
        //   3. Staging dir (dev: npm run dev, engine in bin/Debug)
        //   4. Fallback to PATH
        var baseDir = AppContext.BaseDirectory;
        var candidates = new[]
        {
            // Packaged: ffmpeg.exe next to DiNho.Capture.Poc.exe
            Path.Combine(baseDir, "ffmpeg.exe"),
            // Dev: Release publish (engine published with -o)
            Path.Combine(baseDir, "..", "..", "..", "bin", "Release", "net10.0-windows10.0.26100.0", "publish", "ffmpeg.exe"),
            // Dev: electron staging dir (6 levels up from bin/Debug/net10/.../ to solution root)
            Path.Combine(baseDir, "..", "..", "..", "..", "..", "..", "resources", "clips-engine-staging", "ffmpeg.exe"),
            // Packaged: resources/clips-engine/ (electron-builder layout)
            Path.Combine(baseDir, "..", "clips-engine", "ffmpeg.exe"),
            "ffmpeg", // fallback to PATH
        };

        foreach (var candidate in candidates)
        {
            try
            {
                var probe = new ProcessStartInfo(candidate)
                {
                    Arguments = "-version",
                    RedirectStandardOutput = true,
                    // Redireciona e drena ambos os pipes: sem leitor, o buffer do
                    // pipe (4KB) pode encher e, com handle herdado do host de teste,
                    // o output vaza para o console do vstest (crasha o testhost).
                    RedirectStandardError = true,
                    UseShellExecute = false,
                    CreateNoWindow = true,
                    WorkingDirectory = Path.GetDirectoryName(candidate) ?? ""
                };
                using var p = Process.Start(probe);
                if (p != null)
                {
                    var exited = p.WaitForExit(2000);
                    if (!exited)
                    {
                        try { p.Kill(entireProcessTree: true); } catch { }
                        exited = p.WaitForExit(2000);
                    }
                    if (exited)
                    {
                        var outLen = p.StandardOutput.ReadToEnd().Length;
                        _ = p.StandardError.ReadToEnd();
                        if (p.ExitCode == 0 && outLen > 0)
                        {
                            _cachedPath = candidate;
                            _cachedDir = Path.GetDirectoryName(candidate) ?? "";
                            Log.D("FfmpegPathResolver", $"Found ffmpeg at: {candidate}");
                            return candidate;
                        }
                    }
                }
            }
            catch { }
        }

        Log.W("FfmpegPathResolver", "ffmpeg.exe not found in any candidate path");
        return "ffmpeg"; // final fallback, will likely fail
    }

    /// <summary>Create a ProcessStartInfo for ffmpeg with correct WorkingDirectory (for DLL resolution).</summary>
    public static ProcessStartInfo CreateFfmpegStartInfo(
        string? args = null,
        bool redirectInput = false,
        bool redirectOutput = false,
        bool redirectError = false)
    {
        return new ProcessStartInfo(GetFfmpegPath())
        {
            Arguments = args ?? "",
            UseShellExecute = false,
            CreateNoWindow = true,
            WorkingDirectory = GetFfmpegDir(),
            RedirectStandardInput = redirectInput,
            RedirectStandardOutput = redirectOutput,
            RedirectStandardError = redirectError,
        };
    }
}

public sealed class EncoderManager : IDisposable
{
    // ── Vendor → codec maps ──────────────────────────────────────────

    /// <summary>Vendor → H264 encoder map.</summary>
    public static readonly Dictionary<int, string> VendorCodecs = new()
    {
        [0x10DE] = "h264_nvenc", // NVIDIA
        [0x1002] = "h264_amf",   // AMD
        [0x8086] = "h264_qsv",   // Intel
    };

    /// <summary>Vendor → HEVC encoder map.</summary>
    public static readonly Dictionary<int, string> VendorHevcCodecs = new()
    {
        [0x10DE] = "hevc_nvenc",
        [0x1002] = "hevc_amf",
        [0x8086] = "hevc_qsv",
    };

    /// <summary>Vendor → AV1 encoder map. Intel Arc (Alchemist+) expõe av1_qsv via MFX;
    /// o probe gate decide se o hardware real suporta (iGPU antiga sem AV1 cai p/ libsvtav1).</summary>
    public static readonly Dictionary<int, string> VendorAv1Codecs = new()
    {
        [0x10DE] = "av1_nvenc",
        [0x1002] = "av1_amf",
        [0x8086] = "av1_qsv",
    };

    // ── Probe result ─────────────────────────────────────────────────

    public record ProbeResult
    {
        public required string Codec { get; init; }
        public required bool Success { get; init; }
        public required int OutputBytes { get; init; }
        public string? Error { get; init; }
        public bool IsNvencSessionLimit { get; init; }
    }

    // ── Fallback chain entry ─────────────────────────────────────────

    public record FallbackEntry
    {
        public required string Codec { get; init; }
        public int ScaleDivisor { get; init; } = 1;
        public required string Label { get; init; }
    }

    // ── GPU adapter info ─────────────────────────────────────────────

    public record GpuAdapterInfo
    {
        public int Index { get; init; }
        public string Name { get; init; } = "";
        public int VendorId { get; init; }
        public long VideoMemoryBytes { get; init; }
    }

    // ── NVENC session info ───────────────────────────────────────────

    public record NvencSessionInfo
    {
        public int SessionCount { get; init; }
        public int MaxSessions { get; init; }
        public bool IsLimitReached { get; init; }
    }

    // ── GPU detection ────────────────────────────────────────────────

    public static int DetectGpuVendorId() => DetectEncodingVendorId();

    /// <summary>Return list of GPU adapter names and vendor IDs for the UI dropdown.</summary>
    public static List<(int Index, string Name, int VendorId)> GetGpuList()
    {
        var list = new List<(int, string, int)>();
        try
        {
            using var factory = DXGI.CreateDXGIFactory1<IDXGIFactory1>();
            for (uint i = 0; factory.EnumAdapters1(i, out var adapter).Success; i++)
            {
                using (adapter)
                {
                    var desc = adapter.Description1;
                    list.Add(((int)i, desc.Description.TrimEnd('\0'), (int)desc.VendorId));
                }
            }
        }
        catch { }
        return list;
    }

    /// <summary>Enumerate all DXGI adapters with full info including VRAM size.</summary>
    public static List<GpuAdapterInfo> DetectAllGpuAdapters()
    {
        var adapters = new List<GpuAdapterInfo>();
        try
        {
            using var factory = DXGI.CreateDXGIFactory1<IDXGIFactory1>();
            for (uint i = 0; factory.EnumAdapters1(i, out var adapter).Success; i++)
            {
                using (adapter)
                {
                    var desc = adapter.Description1;
                    adapters.Add(new GpuAdapterInfo
                    {
                        Index = (int)i,
                        Name = desc.Description.TrimEnd('\0'),
                        VendorId = (int)desc.VendorId,
                        VideoMemoryBytes = (long)(ulong)desc.DedicatedVideoMemory,
                    });
                }
            }
        }
        catch (Exception ex)
        {
            Logging.Log.W("EncoderManager", $"GPU adapter enumeration failed: {ex.Message}");
        }
        return adapters;
    }

    /// <summary>Detect the primary encoding vendor from the list of available adapters.
    /// For hybrid laptops (iGPU + dGPU), picks the first discrete GPU with encoding support.
    /// Falls back to first adapter if no discrete GPU found.</summary>
    public static int DetectEncodingVendorId()
    {
        var adapters = DetectAllGpuAdapters();

        // Prefer discrete GPU (NVIDIA > AMD > Intel) — these have dedicated encoders
        var discrete = adapters
            .Where(a => a.VendorId is 0x10DE or 0x1002)
            .OrderByDescending(a => a.VendorId == 0x10DE ? 2 : 1) // NVIDIA first
            .ThenByDescending(a => a.VideoMemoryBytes)
            .FirstOrDefault();
        if (discrete != null) return discrete.VendorId;

        // Fallback to any supported vendor
        return adapters.FirstOrDefault(a => a.VendorId is 0x10DE or 0x1002 or 0x8086)?.VendorId ?? 0;
    }

    public static string GetPreferredCodec(int vendorId)
    {
        if (vendorId == 0) return "";
        return VendorCodecs.TryGetValue(vendorId, out var codec) ? codec : "";
    }

    /// <summary>Map user-facing codec name (auto/h264/hevc/av1/libx264/libx265) to a concrete
    /// ffmpeg encoder name using the detected GPU vendor. Returns null if the mapping fails
    /// (caller should fall back to DetectBestCodec).</summary>
    public static string? MapUserCodec(string userCodec, int vendorId)
    {
        return userCodec.ToLowerInvariant() switch
        {
            "h264" => GetPreferredCodec(vendorId),
            "hevc" => vendorId == 0 ? "libx265" :
                      VendorHevcCodecs.TryGetValue(vendorId, out var h) ? h : "libx265",
            "av1" => vendorId == 0 ? "libsvtav1" :
                      VendorAv1Codecs.TryGetValue(vendorId, out var a) ? a : "libsvtav1",
            "libx264" => "libx264",
            "libx265" => "libx265",
            _ => null, // "auto" → caller uses DetectBestCodec
        };
    }

    // ── Active encoder probe ─────────────────────────────────────────

    /// <summary>
    /// Real test-encode: pipes 5 dummy NV12 frames through the specified encoder
    /// and checks if ffmpeg exits cleanly with non-zero output.
    /// This is the ONLY reliable way to know if an encoder actually works on this system.
    /// </summary>
    public static ProbeResult ProbeEncoder(string codec, int width = 320, int height = 240, int fps = 30)
    {
        var args = BuildProbeArgs(codec, width, height, fps);
        var outputBytes = 0;
        string? errorMsg = null;
        var isNvencSessionLimit = false;

        try
        {
            using var process = new Process
            {
                StartInfo = FfmpegPathResolver.CreateFfmpegStartInfo(args: args, redirectInput: true, redirectOutput: true, redirectError: true)
            };

            process.Start();
            try { process.PriorityClass = ProcessPriorityClass.Idle; } catch { }

            var frameSize = width * height * 3 / 2; // NV12
            var frameCount = 5;

            // Pipe dummy frames
            try
            {
                var stdin = process.StandardInput.BaseStream;
                for (int i = 0; i < frameCount; i++)
                {
                    var dummy = new byte[frameSize];
                    // Fill with slight variation per frame (gray gradient)
                    var val = (byte)(80 + i * 20);
                    for (int p = 0; p < dummy.Length; p += 3)
                    {
                        dummy[p] = val;     // Y
                        dummy[p + 1] = 128; // U
                        dummy[p + 2] = 128; // V
                    }
                    stdin.Write(dummy, 0, dummy.Length);
                    stdin.Flush();
                }
                stdin.Close();
            }
            catch { /* pipe broken = encoder rejected input, handled by exit code */ }

            // Collect output size
            var stdoutTask = Task.Run(() =>
            {
                var buf = new byte[64 * 1024];
                int total = 0, n;
                while ((n = process.StandardOutput.BaseStream.Read(buf, 0, buf.Length)) > 0)
                    total += n;
                return total;
            });

            // Read stderr for diagnostics (NVENC session limit detection)
            var stderrLines = new List<string>();
            var stderrTask = Task.Run(() =>
            {
                string? line;
                while ((line = process.StandardError.ReadLine()) != null)
                {
                    lock (stderrLines) stderrLines.Add(line);
                    // Detect NVENC-specific failure messages
                    if (line.Contains("session", StringComparison.OrdinalIgnoreCase) &&
                        (line.Contains("limit", StringComparison.OrdinalIgnoreCase) ||
                         line.Contains("busy", StringComparison.OrdinalIgnoreCase) ||
                         line.Contains("overflow", StringComparison.OrdinalIgnoreCase)))
                        isNvencSessionLimit = true;
                    // Also detect via exit code pattern: NVENC returns 8 for resource exhaustion
                    if (line.Contains("Cannot load nvEncodeAPI64.dll", StringComparison.OrdinalIgnoreCase) ||
                        line.Contains("No NVENC capable devices found", StringComparison.OrdinalIgnoreCase))
                        isNvencSessionLimit = true;
                }
            });

            if (!process.WaitForExit(10000))
            {
                try { process.Kill(entireProcessTree: true); } catch { }
                process.WaitForExit(3000);
            }
            Task.WaitAll(new[] { stdoutTask, stderrTask }, 5000);

            outputBytes = stdoutTask.Result;

            if (process.ExitCode != 0 && outputBytes == 0)
            {
                lock (stderrLines)
                {
                    var relevantErrors = stderrLines
                        .Where(l => l.Contains("error", StringComparison.OrdinalIgnoreCase) ||
                                    l.Contains("failed", StringComparison.OrdinalIgnoreCase) ||
                                    l.Contains("invalid", StringComparison.OrdinalIgnoreCase))
                        .Take(3)
                        .ToList();
                    if (relevantErrors.Count > 0)
                        errorMsg = string.Join(" | ", relevantErrors);
                }
            }

            var success = process.ExitCode == 0 && outputBytes > 0;
            return new ProbeResult
            {
                Codec = codec,
                Success = success,
                OutputBytes = outputBytes,
                Error = success ? null : errorMsg ?? $"exit={process.ExitCode}",
                IsNvencSessionLimit = isNvencSessionLimit,
            };
        }
        catch (Exception ex)
        {
            return new ProbeResult
            {
                Codec = codec,
                Success = false,
                OutputBytes = 0,
                Error = ex.Message,
            };
        }
    }

    // ── AMF preset adaptativo ────────────────────────────────────────

    /// <summary>Delegado de probe trocável nos testes. Retorna achievedFps (double?) do encode
    /// de teste na resolução/fps alvo, ou null quando o probe falha (sem encoder disponível).
    /// Exceções são permitidas — degradam para "speed".</summary>
    internal static Func<string, int, int, int, string, double?> ProbeAmfSpeedProbe = ProbeAmfSpeed;

    private static readonly Lock AmfPresetCacheLock = new();
    private static Dictionary<string, string>? _amfPresetCache;

    /// <summary>Limpa o cache de preset AMF (usado nos testes entre cenários).</summary>
    internal static void ResetAmfPresetCache()
    {
        lock (AmfPresetCacheLock) _amfPresetCache = null;
    }

    internal static bool IsAmfCodec(string codec) =>
        codec is "h264_amf" or "hevc_amf" or "av1_amf";

    /// <summary>Seleciona o preset AMF por máquina: tenta high_quality, degrada para quality,
    /// balanced e speed quando o encode real não sustenta ≥85% do fps alvo na resolução da
    /// captura. AMD forte (RDNA2+/VCN 2.0+ dGPU) sustenta high_quality/quality; RDNA1 (RX 5700 XT,
    /// VCN 1.0) e iGPU fraca degradam automático até o degrau que a máquina segura — usuário de
    /// alto desempenho ganha qualidade perceptiva, usuário de iGPU nunca perde fps.
    /// Cache por codec|res|fps — um probe por combinação por sessão.</summary>
    internal static string SelectAmfPreset(string codec, int width, int height, int fps)
    {
        if (!IsAmfCodec(codec)) return "speed";
        var key = $"{codec}|{width}x{height}@{fps}";
        lock (AmfPresetCacheLock)
        {
            if (_amfPresetCache != null && _amfPresetCache.TryGetValue(key, out var cached))
                return cached;
        }

        var result = "speed";
        foreach (var preset in new[] { "high_quality", "quality", "balanced", "speed" })
        {
            double? achieved;
            try { achieved = ProbeAmfSpeedProbe(codec, width, height, fps, preset); }
            catch { continue; }
            if (achieved == null) continue;
            if (achieved >= fps * 0.85) { result = preset; break; }
        }

        lock (AmfPresetCacheLock)
        {
            _amfPresetCache ??= new Dictionary<string, string>();
            _amfPresetCache[key] = result;
        }
        return result;
    }

    /// <summary>Probe real do preset AMF: codifica 5 frames dummy NV12 na resolução/fps alvo com o
    /// preset dado e mede achievedFps = frames entregues / tempo real decorrido. O preset
    /// `-quality` em h264_amf/hevc_amf/av1_amf define o equilíbrio quality/speed.</summary>
    internal static double? ProbeAmfSpeed(string codec, int width, int height, int fps, string preset)
        => RunAmfThroughputProbe(codec, width, height, fps, preset, extraArgs: "");

    /// <summary>Seam trocável nos testes para o probe real do preanalysis/TAQ da cadência AMF.
    /// Devolve achievedFps de um encode real com -preanalysis + pa_taq_mode 2 habilitados, ou
    /// null se falhar. Exceções são permitidas — desligam o PA.</summary>
    internal static Func<string, int, int, int, string, double?> ProbeAmfPreanalysisProbe = ProbeAmfPreanalysis;

    /// <summary>Probe real do preanalysis/TAQ: mesmo encode dummy do ProbeAmfSpeed, mas com a
    /// cadeia PA ligada (mede o custo real da pré-análise num frame NV12 na resolução alvo).
    /// Só é usado em GPUs que JÁ sustentaram quality/high_quality — iGPU/VCN 1.0 nunca paga esse custo.</summary>
    internal static double? ProbeAmfPreanalysis(string codec, int width, int height, int fps, string preset)
        => RunAmfThroughputProbe(codec, width, height, fps, preset,
            extraArgs: " -preanalysis true -pa_lookahead_buffer_depth 40 -pa_taq_mode 2");

    /// <summary>Probe real de suporte a Smart Access Video (multi-VCN): encode dummy com
    /// -smart_access_video 1. true = o driver/hardware aceitou a opção (AMF_OK);
    /// false = sem SAV (iGPU-only, dGPU-only, driver antigo) → o pipeline nunca recebe a flag.</summary>
    internal static bool ProbeAmfSav(string codec, int width, int height, int fps)
        => RunAmfThroughputProbe(codec, width, height, fps, "speed", " -smart_access_video 1") != null;

    /// <summary>Probe comum: roda o encode dummy NV12 5 frames com o preset + extraArgs dados e
    /// devolve achievedFps (double?) calculado do tempo líquido do encode, ou null quando o
    /// ffmpeg sai com exit != 0 (codec/opção inválida no driver real).</summary>
    internal static double? RunAmfThroughputProbe(string codec, int width, int height, int fps, string preset, string extraArgs)
    {
        var presetNorm = FfmpegEncoder.NormalizeAmfPreset(preset);
        var outputFmt = codec.Contains("av1", StringComparison.Ordinal) ? "ivf" : "h264";
        var args = $"-y -loglevel error -f rawvideo -pix_fmt nv12 -s {width}x{height} " +
                   $"-r {fps} -i pipe:0 -c:v {codec} -quality {presetNorm} -rc vbr_peak " +
                   $"-bf 0 -g 60 -frames:v 5{extraArgs} -f {outputFmt} pipe:1";
        try
        {
            using var process = new Process
            {
                StartInfo = FfmpegPathResolver.CreateFfmpegStartInfo(args: args, redirectInput: true, redirectOutput: true, redirectError: true)
            };
            process.Start();
            try { process.PriorityClass = ProcessPriorityClass.Idle; } catch { }

            var frameSize = width * height * 3 / 2; // NV12
            const int frameCount = 5;
            var sw = System.Diagnostics.Stopwatch.StartNew();
            try
            {
                var stdin = process.StandardInput.BaseStream;
                for (int i = 0; i < frameCount; i++)
                {
                    var dummy = new byte[frameSize];
                    var val = (byte)(80 + i * 20);
                    for (int p = 0; p < dummy.Length; p += 3)
                    {
                        dummy[p] = val;     // Y
                        dummy[p + 1] = 128; // U
                        dummy[p + 2] = 128; // V
                    }
                    stdin.Write(dummy, 0, dummy.Length);
                }
                stdin.Close();
            }
            catch { /* encoder rejeitou input → exit code trata */ }

            var drainTask = Task.Run(() =>
            {
                var buf = new byte[64 * 1024];
                int n;
                while ((n = process.StandardOutput.BaseStream.Read(buf, 0, buf.Length)) > 0) { }
            });
            var stderrTask = Task.Run(() => { while (process.StandardError.ReadLine() != null) { } });

            if (!process.WaitForExit(15000))
            {
                try { process.Kill(entireProcessTree: true); } catch { }
                process.WaitForExit(3000);
            }
            Task.WaitAll(new[] { drainTask, stderrTask }, 5000);
            sw.Stop();

            if (process.ExitCode != 0) return null;
            return Math.Round(frameCount * 1000.0 / Math.Max(1, sw.ElapsedMilliseconds), 2);
        }
        catch
        {
            return null;
        }
    }

    // ── NVENC preset adaptativo ─────────────────────────────────────

    /// <summary>Delegado de probe trocável nos testes. Retorna achievedFps (double?) do encode
    /// de teste na resolução/fps alvo com o preset NVENC dado, ou null quando o probe falha.
    /// Exceções são permitidas — degradam para o preset mais rápido (p1).</summary>
    internal static Func<string, int, int, int, string, double?> ProbeNvencSpeedProbe = ProbeNvencSpeed;

    private static readonly Lock NvencPresetCacheLock = new();
    private static Dictionary<string, string>? _nvencPresetCache;

    /// <summary>Limpa o cache de preset NVENC (usado nos testes entre cenários).</summary>
    internal static void ResetNvencPresetCache()
    {
        lock (NvencPresetCacheLock) _nvencPresetCache = null;
    }

    internal static bool IsNvencCodec(string codec) =>
        codec is "h264_nvenc" or "hevc_nvenc" or "av1_nvenc";

    /// <summary>Seleciona o preset NVENC por máquina: tenta p7 (melhor qualidade), degrada até p1
    /// (mais rápido) quando o encode real não sustenta ≥85% do fps alvo na resolução da captura.
    /// Espelho do SelectAmfPreset — RTX 5050 sustenta só ~46fps em av1_nvenc p5 1080p60 (drift A/V
    /// crescente): o probe acha o degrau mais pesado que a máquina segura, preservando o fps.
    /// Cache por codec|res|fps — um probe por combinação por sessão.</summary>
    internal static string SelectNvencPreset(string codec, int width, int height, int fps)
    {
        if (!IsNvencCodec(codec)) return "p4";
        var key = $"{codec}|{width}x{height}@{fps}";
        lock (NvencPresetCacheLock)
        {
            if (_nvencPresetCache != null && _nvencPresetCache.TryGetValue(key, out var cached))
                return cached;
        }

        var result = "p1";
        foreach (var preset in new[] { "p7", "p6", "p5", "p4", "p3", "p2", "p1" })
        {
            double? achieved;
            try { achieved = ProbeNvencSpeedProbe(codec, width, height, fps, preset); }
            catch { continue; }
            if (achieved == null) continue;
            if (achieved >= fps * 0.85) { result = preset; break; }
        }

        lock (NvencPresetCacheLock)
        {
            _nvencPresetCache ??= new Dictionary<string, string>();
            _nvencPresetCache[key] = result;
        }
        return result;
    }

    /// <summary>Probe real do preset NVENC: codifica frames dummy NV12 na resolução/fps alvo com o
    /// preset dado e mede achievedFps = frames entregues / tempo real decorrido. O encode usa a MESMA
    /// cadeia de tune do pipeline de produção (cq=18 maxrate=55000 bufsize=110000 bf=0 lookahead=16
    /// multipass fullres — mesma config observada na RTX 5050), então o número medido reflete o
    /// throughput real que o pipeline teria, não um cenário idealizado. O STEADY-STATE é medido com
    /// warmup antes (frames de aquecimento amortizam spawn + init da sessão NVENC + primeira pass do
    /// multipass) e janela cronometrada depois — um probe de 5 frames mede só startup (~0.6s) e dá
    /// ~7fps em TODO preset (ruído), inutilizável para comparar p1..p7.</summary>
    internal static double? ProbeNvencSpeed(string codec, int width, int height, int fps, string preset)
        => RunNvencThroughputProbe(codec, width, height, fps, preset, extraArgs: "");

    /// <summary>Probe comum de throughput NVENC: roda o encode dummy NV12 com warmup + janela
    /// cronometrada (steady-state) e devolve achievedFps (double?) ou null quando o ffmpeg sai com
    /// exit != 0 (preset/opção inválida no driver real). Os parâmetros de qualidade reproduzem a
    /// config de produção do MachineProfile Strong observada no drift A/V.
    ///
    /// Medição: o writer roda em background e escreve o mais rápido que o ffmpeg consome — o pipe
    /// (64KB) atua como backpressure natural, então o instante em que cada frame é aceito pelo stdin
    /// espelha o throughput real do encoder após o warmup (fila saturada). A medida é a taxa de
    /// escrita dos últimos `measureFrames` frames (janela pós-warmup), compatível para comparar
    /// presets; AV1 = mesma cadeia multipass fullres do pipeline. Sem draft em background o pipe de
    /// stdout enche e o ffmpeg trava o stdin → deadlock (por isso o drain é concorrente e há kill
    /// guard + timeout — nunca deixa o probe pendurar).</summary>
    internal static double? RunNvencThroughputProbe(string codec, int width, int height, int fps, string preset, string extraArgs)
    {
        var tune = FfmpegEncoder.BuildEncoderTuneArgs(
            codec, cq: 18, maxrateKbps: 55000, bufsizeKbps: 110000,
            bframes: 0, lookahead: 16, nvencPreset: preset, multipass: true);
        var rawFmt = FfmpegEncoder.GetRawFormatForCodec(codec);
        var outputFmt = rawFmt == "av1" ? "ivf" : rawFmt;
        const int warmupFrames = 30;
        const int measureFrames = 90;
        var args = $"-y -loglevel error -f rawvideo -pix_fmt nv12 -s {width}x{height} " +
                   $"-r {fps} -i pipe:0 " +
                   $"-colorspace bt709 -color_primaries bt709 -color_trc bt709 " +
                   $"-c:v {codec} {tune} -frames:v {warmupFrames + measureFrames}{extraArgs} -f {outputFmt} pipe:1";
        try
        {
            using var process = new Process
            {
                StartInfo = FfmpegPathResolver.CreateFfmpegStartInfo(args: args, redirectInput: true, redirectOutput: true, redirectError: true)
            };
            process.Start();
            try { process.PriorityClass = ProcessPriorityClass.Idle; } catch { }

            var frameSize = width * height * 3 / 2; // NV12
            // Padrão content-like (gradiente de faixa com movimento por frame): mantém o encoder
            // ocupado e diferencia presets — gray puro NVENC codifica em ~300fps e achata o ranking.
            var frame = new byte[frameSize];
            var sw = System.Diagnostics.Stopwatch.StartNew();
            var writeTimes = new double[warmupFrames + measureFrames];
            var written = 0;

            // Drain de stdout/stderr em background — sem isso o pipe (64KB) enche, o ffmpeg bloqueia
            // o stdin e o writer pendura (deadlock).
            var drainTask = Task.Run(() =>
            {
                var buf = new byte[64 * 1024];
                int n;
                try { while ((n = process.StandardOutput.BaseStream.Read(buf, 0, buf.Length)) > 0) { } }
                catch { /* pipe fechado pelo kill */ }
            });
            var stderrTask = Task.Run(() =>
            {
                try { while (process.StandardError.ReadLine() != null) { } }
                catch { /* pipe fechado pelo kill */ }
            });

            // Writer em background: escreve frames o mais rápido que o ffmpeg consome; o bloqueio do
            // Write no pipe cheio = encoder ocupado (backpressure natural = throughput real).
            var writerTask = Task.Run(() =>
            {
                try
                {
                    var stdin = process.StandardInput.BaseStream;
                    for (int i = 0; i < warmupFrames + measureFrames; i++)
                    {
                        for (int row = 0; row < height; row++)
                        {
                            byte val = (byte)(16 + ((row + i * 3) % (height / 2)) * 255 / (height / 2));
                            Array.Fill(frame, val, row * width, width);
                        }
                        var t0 = sw.ElapsedMilliseconds;
                        stdin.Write(frame, 0, frameSize);
                        var t1 = sw.ElapsedMilliseconds;
                        writeTimes[i] = (t0 + t1) / 2.0; // meio do write = frame efetivamente aceito
                        written = i + 1;
                    }
                    try { stdin.Close(); } catch { }
                }
                catch { /* ffmpeg morto pelo kill guard → pipe partido */ }
            });

            bool killed = false;
            if (!process.WaitForExit(30_000))
            {
                killed = true;
                try { process.Kill(entireProcessTree: true); } catch { }
                process.WaitForExit(3000);
            }
            Task.WaitAll(new[] { writerTask, drainTask, stderrTask }, 8000);
            sw.Stop();

            if (!killed && process.ExitCode != 0) return null;
            // Taxa na janela pós-warmup: últimos `measureFrames` escritos concluídos. Se o encoder
            // parou antes (kill), só conta os frames que de fato passaram pelo pipe.
            int end = written;
            int startIdx = Math.Max(0, end - measureFrames);
            if (end - startIdx < 2 || writeTimes[end - 1] <= writeTimes[startIdx]) return null;
            return Math.Round((end - startIdx) * 1000.0 / (writeTimes[end - 1] - writeTimes[startIdx]), 2);
        }
        catch
        {
            return null;
        }
    }

    // ── AMF preanalysis/TAQ adaptativo ───────────────────────────────

    private static readonly Lock AmfPreanalysisCacheLock = new();
    private static Dictionary<string, bool>? _amfPreanalysisCache;

    /// <summary>Limpa o cache de preanalysis/TAQ (usado nos testes entre cenários).</summary>
    internal static void ResetAmfPreanalysisCache()
    {
        lock (AmfPreanalysisCacheLock) _amfPreanalysisCache = null;
    }

    /// <summary>Decide se o preanalysis/TAQ da AMF entra no encode. PRÉ-REQUISITO: a GPU já
    /// sustentou quality/high_quality no SelectAmfPreset (iGPU/VCN 1.0 degrada p/ balanced/speed e
    /// NUNCA paga o custo do PA). Com isso garantido, o PA ainda é sondado de verdade: se o encode
    /// com a cadeia PA não sustenta ≥85% do fps alvo, fica OFF (o PA pesa ~5-10% no VCN; se a
    /// máquina não aguenta no degrau escolhido, prioriza o fps). Cache por codec|res|fps|preset.</summary>
    internal static bool SelectAmfPreanalysis(string codec, int width, int height, int fps, string preset)
    {
        if (!IsAmfCodec(codec)) return false;
        if (preset is not ("quality" or "high_quality")) return false;
        var key = $"{codec}|{width}x{height}@{fps}|preset={preset}";
        lock (AmfPreanalysisCacheLock)
        {
            if (_amfPreanalysisCache != null && _amfPreanalysisCache.TryGetValue(key, out var cached))
                return cached;
        }

        var enabled = false;
        try
        {
            double? achieved = ProbeAmfPreanalysisProbe(codec, width, height, fps, preset);
            enabled = achieved != null && achieved >= fps * 0.85;
        }
        catch { /* PA nunca derruba o encode — falha = OFF */ }

        lock (AmfPreanalysisCacheLock)
        {
            _amfPreanalysisCache ??= new Dictionary<string, bool>();
            _amfPreanalysisCache[key] = enabled;
        }
        return enabled;
    }

    // ── AMD Smart Access Video (multi-VCN) ───────────────────────────

    /// <summary>Seam trocável nos testes — número de GPUs AMD presentes (0x1002).</summary>
    internal static Func<int> AmdAdapterCountProbe = CountAmdAdapters;

    /// <summary>Seam trocável nos testes — probe real do -smart_access_video (true = aceito).</summary>
    internal static Func<string, int, int, int, bool> ProbeAmfSavProbe = ProbeAmfSav;

    private static readonly Lock AmfSavCacheLock = new();
    private static Dictionary<string, bool>? _amfSavCache;

    /// <summary>Limpa o cache de Smart Access Video (usado nos testes entre cenários).</summary>
    internal static void ResetAmfSavCache()
    {
        lock (AmfSavCacheLock) _amfSavCache = null;
    }

    private static int CountAmdAdapters() => GetGpuList().Count(g => g.VendorId == 0x1002);

    /// <summary>Decide se o Smart Access Video entra no encode AMF. Exige APU/dGPU AMD dupla
    /// (≥2 adapters 0x1002 = 2 VCNs) E o probe real com a flag aceito pelo driver. Desktops
    /// dGPU-only e iGPU-only (1 adapter) → false sem custo de probe. Sempre false p/ não-AMF.
    /// Cache por codec|res|fps.</summary>
    internal static bool SupportsSmartAccessVideo(string codec, int width, int height, int fps)
    {
        if (!IsAmfCodec(codec)) return false;
        var key = $"{codec}|{width}x{height}@{fps}";
        lock (AmfSavCacheLock)
        {
            if (_amfSavCache != null && _amfSavCache.TryGetValue(key, out var cached))
                return cached;
        }

        var supported = false;
        try
        {
            if (AmdAdapterCountProbe() >= 2)
                supported = ProbeAmfSavProbe(codec, width, height, fps);
        }
        catch { /* driver indisponível = sem SAV */ }

        lock (AmfSavCacheLock)
        {
            _amfSavCache ??= new Dictionary<string, bool>();
            _amfSavCache[key] = supported;
        }
        return supported;
    }

    private static string BuildProbeArgs(string codec, int width, int height, int fps)
    {
        var isD3d12va = codec.EndsWith("_d3d12va", StringComparison.Ordinal);
        var isQsv = codec.EndsWith("_qsv", StringComparison.Ordinal);
        var tune = codec switch
        {
            "libx264" => "-preset veryfast -tune zerolatency -threads 1",
            "libx265" => "-preset veryfast -tune zerolatency -threads 1",
            "h264_nvenc" => "-preset p1 -tune ll",
            "hevc_nvenc" => "-preset p1 -tune ll",
            "av1_nvenc" => "-preset p1 -tune ll",
            "h264_amf" => "-quality speed",
            "hevc_amf" => "-quality speed",
            "h264_qsv" => "-preset fastest",
            "hevc_qsv" => "-preset fastest",
            "av1_qsv" => "-preset fastest",
            "av1_amf" => "-quality speed",
            "h264_d3d12va" or "hevc_d3d12va" or "av1_d3d12va" => "-rc 1 -qp 22",
            _ => "-preset veryfast",
        };

        var rawFmt = codec switch
        {
            "hevc_nvenc" or "hevc_amf" or "hevc_qsv" or "hevc_d3d12va" or "libx265" => "hevc",
            "av1_nvenc" or "libsvtav1" or "av1_amf" or "av1_d3d12va" or "av1_qsv" => "av1",
            _ => "h264"
        };

        // Use -f ivf for AV1 (same as actual encoding path) — raw AV1
        // OBU data is not frame-delimited without IVF headers.
        string outputFmt = rawFmt == "av1" ? "ivf" : rawFmt;

        // D3D12VA só aceita frames no pixel format d3d12 — exige hwupload com
        // format=d3d12. -init_hw_device d3d12va=hw=0 cria o device D3D12 antes do input.
        // RC modes D3D12VA: 1=CQP, 2=CBR, 3=VBR, 4=QVBR (CQP com -qp = qualidade).
        // QSV exige -init_hw_device qsv para criar a sessão MFX; sem ele o ffmpeg 9
        // falha com "Error creating a MFX session: -9" mesmo em máquina Intel.
        var hwDeviceArg = (isD3d12va ? "-init_hw_device d3d12va=hw=0 " : "") + (isQsv ? "-init_hw_device qsv " : "");
        var vfArg = isD3d12va ? "-vf \"hwupload=extra_hw_frames=16,format=d3d12\" " : "";

        return $"-y -loglevel error {hwDeviceArg}" +
               $"-f rawvideo -pix_fmt nv12 -s {width}x{height} " +
               $"-r {fps} -i pipe:0 " +
               $"{vfArg}-c:v {codec} {tune} -frames:v 5 " +
               $"-f {outputFmt} pipe:1";
    }

    // ── NVENC session limit detection ────────────────────────────────

    /// <summary>Detect NVENC session count and limit. Uses NVIDIA SMI if available.</summary>
    public static NvencSessionInfo GetNvencSessionInfo()
    {
        try
        {
            using var process = new Process
            {
                StartInfo = new ProcessStartInfo("nvidia-smi")
                {
                    Arguments = "--query-gpu=encoder_stats.sessionCount,encoder_stats.maxSessionCount --format=csv,noheader,nounits",
                    RedirectStandardOutput = true,
                    RedirectStandardError = true,
                    UseShellExecute = false,
                    CreateNoWindow = true,
                }
            };
            process.Start();
            var outputTask = process.StandardOutput.ReadToEndAsync();
            // G3: stderr redirecionado (não pode poluir o console do app em modo GUI).
            var errTask = process.StandardError.ReadToEndAsync();
            if (!process.WaitForExit(3000))
            {
                try { process.Kill(entireProcessTree: true); } catch { }
                process.WaitForExit(2000);
            }
            var output = outputTask.Result;
            _ = errTask.Result;

            if (process.ExitCode == 0 && !string.IsNullOrWhiteSpace(output))
            {
                var parts = output.Trim().Split(',');
                if (parts.Length >= 2 &&
                    int.TryParse(parts[0].Trim(), out var count) &&
                    int.TryParse(parts[1].Trim(), out var max))
                {
                    return new NvencSessionInfo
                    {
                        SessionCount = count,
                        MaxSessions = max,
                        IsLimitReached = count >= max,
                    };
                }
            }
        }
        catch { /* nvidia-smi not available */ }

        // Fallback: try probing with the most common encoder to check session availability
        var probe = ProbeEncoder("h264_nvenc");
        if (probe.IsNvencSessionLimit)
        {
            return new NvencSessionInfo
            {
                SessionCount = -1,
                MaxSessions = -1,
                IsLimitReached = true,
            };
        }

        return new NvencSessionInfo { SessionCount = -1, MaxSessions = -1, IsLimitReached = false };
    }

    // ── AV1 capability gate ──────────────────────────────────────────

    /// <summary>Seam para testes — troque para evitar probe real do ffmpeg (-encoders).</summary>
    internal static Func<int, bool> Av1HwProbe = SupportsAv1Hardware;

    /// <summary>Check if a given GPU vendor supports AV1 hardware encoding.
    /// RTX 40+, RDNA3+, Arc Alchemist+.</summary>
    public static bool SupportsAv1Hardware(int vendorId)
    {
        return vendorId switch
        {
            0x10DE => DetectNvidiaGeneration() >= 89, // Ada Lovelace = compute capability 8.9 (RTX 40+)
            0x1002 => DetectAmdGeneration() >= 3,      // RDNA3+ (simplified: check if av1_amf exists)
            0x8086 => CheckFfmpegEncoder("av1_qsv"),  // Arc Alchemist+ tem av1_qsv; HD/UHD antiga não
            _ => false,
        };
    }

    private static int DetectNvidiaGeneration()
    {
        try
        {
            using var factory = DXGI.CreateDXGIFactory1<IDXGIFactory1>();
            for (uint i = 0; factory.EnumAdapters1(i, out var adapter).Success; i++)
            {
                using (adapter)
                {
                    var desc = adapter.Description1;
                    if (desc.VendorId == 0x10DE)
                    {
                        // Adapter LUID → CUDA device → compute capability
                        // Simplified: use VRAM as proxy. 8GB+ = likely RTX 20+ (Turing, sm_75)
                        // 12GB+ = likely RTX 30+ (Ampere, sm_86)
                        // 16GB+ = likely RTX 40+ (Ada, sm_89) — but 4060 has 8GB
                        // Better: just check if av1_nvenc encoder exists in ffmpeg
                        return CheckFfmpegEncoder("av1_nvenc") ? 89 : 75;
                    }
                }
            }
        }
        catch { }
        return 0;
    }

    private static int DetectAmdGeneration()
    {
        // Simplified: if av1_amf is in ffmpeg encoders, the driver supports it
        return CheckFfmpegEncoder("av1_amf") ? 3 : 0;
    }

    // ── Cascading fallback chain builder ─────────────────────────────

    /// <summary>
    /// Build a cascading fallback chain for the given user codec preference.
    /// Chain order: hardware native → reduced resolution (1/2, 1/4) → D3D12VA → CPU fast.
    /// Each entry includes the codec and optional resolution scale divisor.
    /// The scale divisor only takes effect when the user did NOT choose an explicit
    /// output resolution (native); a user-chosen target is the floor and is preserved.
    /// The D3D12VA step (F3) is hardware-agnostic and probe-gated — it's inserted
    /// between vendor HW and CPU when a GPU is present and no software codec was
    /// explicitly requested. Probe failure falls through to CPU.
    /// For "auto" on an AV1-capable GPU, a second HW block for the vendor's AV1
    /// encoder precedes the preferred-codec block (better quality at same bitrate);
    /// both blocks are gated by real ffmpeg probes, so machines without AV1 HW
    /// never receive AV1 steps.
    /// </summary>
    public static List<FallbackEntry> BuildFallbackChain(string userCodec, int vendorId)
    {
        var chain = new List<FallbackEntry>();

        // Determine the hardware codec for this vendor
        var requested = userCodec.ToLowerInvariant();
        var hwCodec = requested switch
        {
            "h264" => GetPreferredCodec(vendorId),
            "hevc" => VendorHevcCodecs.TryGetValue(vendorId, out var h) ? h : "",
            "av1" => Av1HwProbe(vendorId) ?
                     (VendorAv1Codecs.TryGetValue(vendorId, out var a) ? a : "") : "",
            "libx264" => "",
            "libx265" => "",
            "auto" => GetPreferredCodec(vendorId),
            _ => "",
        };

        // Auto + AV1-capable GPU: AV1 HW block first (quality lever), then the
        // preferred codec's block. Probe-gated — no AV1 HW means av1Primary stays null.
        string? av1Primary = null;
        if (requested == "auto" && Av1HwProbe(vendorId) &&
            VendorAv1Codecs.TryGetValue(vendorId, out var av1Auto))
        {
            av1Primary = av1Auto;
        }

        AddHwBlock(chain, av1Primary);
        AddHwBlock(chain, hwCodec);

        // D3D12VA fallback — hardware-agnostic (Windows 10+, qualquer vendor).
        // Usa a API D3D12 em vez dos SDKs de vendor (NVENC/AMF/QSV). Útil quando o
        // encoder de vendor falha (ex.: limite de sessões NVENC, driver desatualizado)
        // mas o hardware ainda suporta encode via D3D12. O probe gate decide: se o
        // encoder d3d12va falhar no probe real (ex.: NVIDIA RTX com "Encode failed:
        // Unknown error occurred"), a cadeia cai para o CPU. Só entra quando há GPU
        // detectada e o usuário não pediu explicitamente um codec de software.
        var isSoftwareRequest = userCodec.ToLowerInvariant() is "libx264" or "libx265";
        if (vendorId != 0 && !isSoftwareRequest)
        {
            var d3d12Codec = userCodec.ToLowerInvariant() switch
            {
                "hevc" => "hevc_d3d12va",
                "av1" => "av1_d3d12va",
                _ => "h264_d3d12va", // auto, h264
            };
            chain.Add(new FallbackEntry { Codec = d3d12Codec, Label = $"D3D12VA ({d3d12Codec})" });
        }

        // CPU fallback
        var cpuCodec = userCodec.ToLowerInvariant() switch
        {
            "hevc" or "libx265" => "libx265",
            _ => "libx264",
        };
        chain.Add(new FallbackEntry { Codec = cpuCodec, Label = $"CPU ({cpuCodec})" });

        // CPU at half resolution (last resort)
        chain.Add(new FallbackEntry
        {
            Codec = cpuCodec,
            ScaleDivisor = 2,
            Label = $"CPU 1/2 ({cpuCodec})",
        });

        return chain;
    }

    /// <summary>
    /// Append a 3-step hardware block (native → 1/2 → 1/4) for the given codec.
    /// No-op when codec is null/empty (no HW available or software request).
    /// </summary>
    private static void AddHwBlock(List<FallbackEntry> chain, string? codec)
    {
        if (string.IsNullOrEmpty(codec)) return;
        chain.Add(new FallbackEntry { Codec = codec, Label = $"HW native ({codec})" });
        chain.Add(new FallbackEntry { Codec = codec, ScaleDivisor = 2, Label = $"HW 1/2 ({codec})" });
        chain.Add(new FallbackEntry { Codec = codec, ScaleDivisor = 4, Label = $"HW 1/4 ({codec})" });
    }

    // ── Existing methods (kept for backward compatibility) ───────────

    public static List<EncoderType> DetectAvailableEncoders()
    {
        var result = new List<EncoderType>();

        if (CheckFfmpegAvailable())
        {
            var hasHw = CheckFfmpegEncoder("h264_nvenc") ||
                        CheckFfmpegEncoder("h264_amf") ||
                        CheckFfmpegEncoder("h264_qsv");

            if (hasHw) result.Add(EncoderType.FfmpegHw);
            result.Add(EncoderType.Ffmpeg);
        }

        if (result.Count == 0)
            result.Add(EncoderType.None);

        return result;
    }

    internal static bool CheckFfmpegAvailable()
    {
        try
        {
            using var proc = new Process
            {
                StartInfo = FfmpegPathResolver.CreateFfmpegStartInfo(args: "-version", redirectOutput: true, redirectError: true)
            };
            proc.Start();
            // Leitura CONCORRENTE: -encoders/-version podem encher o pipe de stdout
            // (4KB) antes de sair — ler um pipe até EOF antes do outro dá deadlock.
            var encOutTask = proc.StandardOutput.ReadToEndAsync();
            var encErrTask = proc.StandardError.ReadToEndAsync();
            if (!proc.WaitForExit(2000))
            {
                try { proc.Kill(entireProcessTree: true); } catch { }
                proc.WaitForExit(2000);
            }
            _ = encOutTask.Result;
            _ = encErrTask.Result;
            return proc.ExitCode == 0;
        }
        catch { return false; }
    }

    internal static bool CheckFfmpegEncoder(string enc)
    {
        // G3: implementação canônica única (FfmpegEncoder) — a duplicata aqui retornava true
        // para string VAZIA (o.Contains("") == true) e não tinha guard de whitespace.
        if (string.IsNullOrWhiteSpace(enc))
            return false;
        return FfmpegEncoder.CheckFfmpegEncoder(enc);
    }

    public static IEncoder CreateBestEncoder(bool forceSoftware = false, ID3D11Device? sharedDevice = null, int bitrateKbps = 2000)
    {
        var available = DetectAvailableEncoders();

        foreach (var type in available)
        {
            if (type == EncoderType.None) continue;
            try { return CreateEncoder(type, sharedDevice, bitrateKbps); }
            catch { continue; }
        }

        throw new InvalidOperationException("No encoder available");
    }

    public static IEncoder CreateEncoder(EncoderType type, ID3D11Device? sharedDevice = null, int bitrateKbps = 2000)
    {
        return type switch
        {
            EncoderType.Ffmpeg => new FfmpegEncoder(useHardware: false),
            EncoderType.FfmpegHw => new FfmpegEncoder(useHardware: true),
            _ => throw new ArgumentOutOfRangeException(nameof(type)),
        };
    }

    public void Dispose() { }
}
