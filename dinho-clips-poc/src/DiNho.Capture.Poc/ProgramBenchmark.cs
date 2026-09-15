using System.Diagnostics;
using System.Runtime.InteropServices;
using Vortice.Direct3D;
using Vortice.Direct3D11;
using Vortice.DXGI;
using Vortice.MediaFoundation;
using DiNho.Capture.Poc.Bench;
using DiNho.Capture.Poc.Capture;
using DiNho.Capture.Poc.Sync;
using DiNho.Capture.Poc.Buffer;
using DiNho.Capture.Poc.Encoders;
using DiNho.Capture.Poc.Export;
using Windows.Win32;
using Windows.Win32.Foundation;

namespace DiNho.Capture.Poc;

internal static class ProgramBenchmark
{
    private const int FramesBenchmark = 300;
    private const int CaptureTimeoutMs = 500;

    internal static void TestEncoders()
    {
        Console.WriteLine("=== Available Encoders ===\n");

        var avail = EncoderManager.DetectAvailableEncoders();
        foreach (var enc in avail)
            Console.WriteLine($"  {enc}");

        Console.WriteLine();
        Console.WriteLine("Testing encoder initialization...\n");

        foreach (var type in avail)
        {
            Console.Write($"  {type}... ");
            try
            {
                using var enc = EncoderManager.CreateEncoder(type);
                enc.Initialize(640, 480, 30);
                enc.Flush();
                Console.WriteLine("OK");
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine($"FAILED: {ex.Message}");
            }
        }
    }

    /// <summary>
    /// CLI --probe-nvenc: mede achievedFps real de cada preset NVENC (p7→p1) na resolução/fps
    /// alvo (default 1920x1080@60, override via args). Usa a MESMA cadeia de tune de produção
    /// (cq18/lookahead16/multipass fullres) — o número medido é o throughput que o pipeline teria.
    /// Diagnóstico do drift A/V: av1_nvenc p5 sustentava só ~46fps (0.76x) → vídeo atrasava.
    /// </summary>
    internal static void ProbeNvencPresets(string widthArg, string heightArg, string fpsArg)
    {
        int.TryParse(widthArg, out var w);
        int.TryParse(heightArg, out var h);
        int.TryParse(fpsArg, out var fps);
        int width = w > 0 ? w : 1920;
        int height = h > 0 ? h : 1080;
        int targetFps = fps > 0 ? fps : 60;

        Console.WriteLine("=== NVENC Throughput Probe ===");
        Console.WriteLine($"Resolução: {width}x{height}@{targetFps}fps | cadeia = produção (cq18/lookahead16/multipass fullres)");
        Console.WriteLine();

        foreach (var codec in new[] { "av1_nvenc", "hevc_nvenc", "h264_nvenc" })
        {
            if (!EncoderManager.CheckFfmpegEncoder(codec))
            {
                Console.WriteLine($"  {codec}: ffmpeg sem suporte — pulado");
                Console.WriteLine();
                continue;
            }
            Console.WriteLine($"-- {codec} --");
            double? best = null;
            string? bestPreset = null;
            foreach (var preset in new[] { "p7", "p6", "p5", "p4", "p3", "p2", "p1" })
            {
                double? achieved;
                try { achieved = EncoderManager.ProbeNvencSpeed(codec, width, height, targetFps, preset); }
                catch { achieved = null; }
                string ok = achieved.HasValue && achieved >= targetFps * 0.85 ? "  ✓ sustenta" : "";
                Console.WriteLine($"    {preset}: {(achieved.HasValue ? $"{achieved.Value:0.00} fps" : "falhou")}{ok}");
                if (achieved.HasValue && (!best.HasValue || achieved > best))
                {
                    best = achieved;
                    bestPreset = preset;
                }
            }
            Console.WriteLine($"  → melhor preset que sustenta ≥{targetFps * 0.85:F0}fps: {bestPreset} ({best:0.00})");
            Console.WriteLine();
        }
    }

    internal static void ShowHelp()
    {
        Console.WriteLine("DiNho Clips Engine v1.0.0");
        Console.WriteLine();
        Console.WriteLine("Uso:");
        Console.WriteLine("  DiNho.Capture.Poc                  Inicia o engine (modo produção)");
        Console.WriteLine($"  DiNho.Capture.Poc --test           Executa testes de Fase 0 + Fase 1");
        Console.WriteLine("  DiNho.Capture.Poc --bench           Benchmark de captura + encode");
        Console.WriteLine("  DiNho.Capture.Poc --bench-json      Benchmark com saída em JSON (Desktop\\DiNhoClips\\bench-*.json)");
        Console.WriteLine("  DiNho.Capture.Poc --force-software    Força encoder CPU (sem GPU)");
        Console.WriteLine("  DiNho.Capture.Poc --duration <seg>    Tempo limite de gravação (ex.: --duration 300)");
        Console.WriteLine("  DiNho.Capture.Poc --encoders          Lista e testa encoders disponíveis (ffmpeg)");
        Console.WriteLine("  DiNho.Capture.Poc --probe-nvenc [W H FPS]  Mede achievedFps real de cada preset NVENC");
        Console.WriteLine("  DiNho.Capture.Poc --help              Mostra esta ajuda");
        Console.WriteLine();
        Console.WriteLine("Hotkeys (padrão):");
        Console.WriteLine("  F8   Salvar clip");
        Console.WriteLine("  F9   Iniciar/Parar captura");
        Console.WriteLine("  F10  Mutar microfone");
        Console.WriteLine();
        Console.WriteLine("IPC:");
        Console.WriteLine("  Named pipe: \\\\.\\pipe\\dinho-clips-engine");
        Console.WriteLine("  Protocolo v1.0 (JSON)");
    }

    internal static async Task ValidateCaptureAsync()
    {
        Console.WriteLine("=== Validação de Captura ===\n");

        // HWND do foreground
        var hwnd = (IntPtr)PInvoke.GetForegroundWindow();
        var title = GetWindowText(hwnd);
        Console.WriteLine($"Foreground window: HWND=0x{hwnd:X8}  Title=\"{title}\"");
        Console.WriteLine();

        // Se não há jogo detectado, usa o foreground diretamente
        using var detector = new GameDetection.GameDetector();
        detector.Start();
        await Task.Delay(500);
        var game = detector.CurrentGame;
        Console.WriteLine($"GameDetector: valid={game.IsValid} process=\"{game.ProcessName}\" hwnd=0x{game.Hwnd:X8} mode={game.DisplayMode}");
        detector.Stop();
        Console.WriteLine();

        // Validar DXGI output mapping
        Console.WriteLine("--- DXGI Outputs x Monitores ---");
        using var device = CreateD3D11Device();
        using var dxgiDevice = device.QueryInterface<IDXGIDevice>();
        using var adapter = dxgiDevice.GetAdapter();

        var primaryMonitor = MonitorHelper.GetPrimaryMonitorHandle();
        Console.WriteLine($"  HMONITOR primário: 0x{primaryMonitor:X8}");

        var gameMonitor = game.IsValid && game.Hwnd != IntPtr.Zero
            ? MonitorHelper.GetMonitorFromWindowHandle(game.Hwnd)
            : MonitorHelper.GetMonitorFromWindowHandle(hwnd);
        Console.WriteLine($"  HMONITOR do jogo:  0x{gameMonitor:X8}");

        for (uint i = 0; adapter.EnumOutputs(i, out var output).Success; i++)
        {
            using (output)
            {
                using var output1 = output.QueryInterface<IDXGIOutput1>();
                var desc = output1.Description;
                var bounds = desc.DesktopCoordinates;
                var midX = (bounds.Left + bounds.Right) / 2;
                var midY = (bounds.Top + bounds.Bottom) / 2;
                var outputMonitor = MonitorHelper.MonitorFromPoint(midX, midY);
                var isMatch = outputMonitor == gameMonitor ? " ← JOGO" :
                              outputMonitor == primaryMonitor ? " ← PRIMÁRIO" : "";
                Console.WriteLine($"  Output[{i}]: {bounds.Right - bounds.Left}x{bounds.Bottom - bounds.Top} @({bounds.Left},{bounds.Top}) HMONITOR=0x{outputMonitor:X8}{isMatch}");
            }
        }
        Console.WriteLine();

        // Validar WGC window capture
        Console.WriteLine("--- WGC TryCreateFromWindowId ---");
        try
        {
            var targetHwnd = game.IsValid && game.Hwnd != IntPtr.Zero ? game.Hwnd : hwnd;
            var captureItem = Capture.GraphicsCaptureItemHelper.CreateForWindow(targetHwnd);
            if (captureItem != null)
            {
                Console.WriteLine($"  ✓ GraphicsCaptureItem criado: {captureItem.Size.Width}x{captureItem.Size.Height}");
                Console.WriteLine($"  Nome: {captureItem.DisplayName}");
            }
            else
            {
                Console.WriteLine("  ✗ TryCreateFromWindowId retornou null");
            }
        }
        catch (Exception ex)
        {
            Console.WriteLine($"  ✗ WGC falhou: {ex.GetType().Name}: {ex.Message}");
        }

        Console.WriteLine("\n=== Validação concluída ===");
    }

    private static ID3D11Device CreateD3D11Device()
    {
        var creationFlags = DeviceCreationFlags.BgraSupport;
        var result = D3D11.D3D11CreateDevice(
            null, DriverType.Hardware, creationFlags,
            new[] { FeatureLevel.Level_11_1, FeatureLevel.Level_11_0 },
            out ID3D11Device device, out _, out _);
        if (result.Failure || device is null)
            throw new InvalidOperationException($"Falha ao criar D3D11 device: {result}");
        return device;
    }

    private static unsafe string GetWindowText(IntPtr hwnd)
    {
        int len = PInvoke.GetWindowTextLength((HWND)hwnd);
        if (len == 0) return string.Empty;
        char* buf = stackalloc char[len + 1];
        PInvoke.GetWindowText((HWND)hwnd, buf, len + 1);
        return new string(buf);
    }

    // GetForegroundWindow and GetWindowText — generated by CsWin32 (NativeMethods.txt)

    internal static async Task RunBenchmarkAsync(bool benchJson)
    {
        Console.WriteLine("=== DiNho Clips — Benchmark Pipeline GPU ===");
        Console.WriteLine();

        var result = new BenchmarkResult();
        var gpuName = Program.CheckGpuDriver();
        result.GpuName = gpuName;

        MediaFactory.MFStartup(false);

        try
        {
            var adapters = ListAdapters();
            var best = PickBestAdapter(adapters);
            foreach (var adapter in adapters)
            {
                if (!ReferenceEquals(adapter, best)) adapter.Dispose();
            }
            if (best == null)
            {
                Console.Error.WriteLine("  Nenhum adaptador D3D11 disponível");
                return;
            }

            var creationFlags = DeviceCreationFlags.BgraSupport;
            D3D11.D3D11CreateDevice(
                best, DriverType.Unknown, creationFlags,
                new[] { FeatureLevel.Level_11_1, FeatureLevel.Level_11_0 },
                out ID3D11Device device, out var featureLevel, out _).CheckError();

            best.Dispose();

            using (device)
            {
                using var dxgiDevice = device.QueryInterface<IDXGIDevice>();
                using var chosen = dxgiDevice.GetAdapter();
                var desc = chosen.Description;
                result.Adapter = desc.Description;
                Console.WriteLine($"  Device: {desc.Description} (FL {featureLevel})");

                ICaptureSource capture;
                WgcCaptureSource? wgc = null;
                WindowsMessagePump? pump = null;
                try
                {
                    Console.WriteLine("  (TEMP WGC-FIRST SMOKE)");
                    wgc = new WgcCaptureSource();
                    pump = new WindowsMessagePump();
                    pump.Invoke(() => { wgc.Initialize(); wgc.StartFramePump(); });
                    capture = wgc;
                    result.CaptureBackend = "WGC";
                    Console.WriteLine($"  Captura: Windows Graphics Capture");
                }
                catch (Exception ex)
                {
                    wgc?.Dispose();
                    pump?.Dispose();
                    Console.WriteLine($"  WGC falhou: {ex.Message}, tentando DXGI...");
                    var dxgi = new DxgiCaptureSource();
                    dxgi.Initialize(device);
                    capture = dxgi;
                    result.CaptureBackend = "DXGI";
                    Console.WriteLine($"  Captura: DXGI Desktop Duplication (fallback)");
                }

                using (capture)
                {
                    // Warmup
                    for (int i = 0; i < 5; i++)
                    {
                        capture.TryCaptureFrame(500);
                        await Task.Delay(16);
                    }

                    // Capture benchmark
                    const int captureFrames = 300;
                    var totalLatencies = new List<double>(captureFrames);
                    var waitLatencies = new List<double>(captureFrames);
                    var copyLatencies = new List<double>(captureFrames);
                    int captureSuccess = 0;

                    for (int i = 0; i < captureFrames; i++)
                    {
                        var frame = capture.TryCaptureFrame(500);

                        if (frame.Success)
                        {
                            totalLatencies.Add((frame.CaptureEndTicks - frame.CaptureStartTicks) * 1000.0 / Stopwatch.Frequency);
                            waitLatencies.Add((frame.WaitEndTicks - frame.CaptureStartTicks) * 1000.0 / Stopwatch.Frequency);
                            copyLatencies.Add((frame.CopyEndTicks - frame.WaitEndTicks) * 1000.0 / Stopwatch.Frequency);
                            captureSuccess++;
                        }
                        await Task.Delay(1);
                    }

                    totalLatencies.Sort();
                    waitLatencies.Sort();
                    copyLatencies.Sort();

                    static LatencyStats ComputeStats(List<double> sorted)
                    {
                        return sorted.Count > 0 ? new LatencyStats
                        {
                            Min = sorted.Min(),
                            P50 = sorted[(int)(sorted.Count * 0.50)],
                            P95 = sorted[(int)(sorted.Count * 0.95)],
                            P99 = sorted[(int)(sorted.Count * 0.99)],
                            Avg = sorted.Average(),
                            Max = sorted.Max()
                        } : new LatencyStats();
                    }

                    result.Capture = new CaptureBench
                    {
                        FramesCaptured = captureSuccess,
                        FramesTotal = captureFrames,
                        LatencyMs = ComputeStats(totalLatencies),
                        WaitMs = ComputeStats(waitLatencies),
                        CopyMs = ComputeStats(copyLatencies),
                        P95Met = totalLatencies.Count > 0 && totalLatencies[(int)(totalLatencies.Count * 0.95)] < 16.0
                    };

                    Console.WriteLine($"  Captura: {result.Capture.FramesCaptured}/{result.Capture.FramesTotal} frames");
                    Console.WriteLine($"  Latência total (ms): p50={result.Capture.LatencyMs.P50:F2}  p95={result.Capture.LatencyMs.P95:F2}  p99={result.Capture.LatencyMs.P99:F2}");
                    Console.WriteLine($"  Espera (ms):          p50={result.Capture.WaitMs.P50:F2}  p95={result.Capture.WaitMs.P95:F2}");
                    Console.WriteLine($"  Cópia (ms):           p50={result.Capture.CopyMs.P50:F2}  p95={result.Capture.CopyMs.P95:F2}");
                    Console.WriteLine($"  Meta p95 < 16ms: {(result.Capture.P95Met ? "✓" : "✗")}");

                    // Encoder benchmark
                    Console.WriteLine($"  Enumerando encoders HW H.264 disponíveis...");
                    var avail = EncoderManager.DetectAvailableEncoders();
                    foreach (var enc in avail)
                        Console.WriteLine($"    - {enc}");

                    Console.WriteLine($"  Criando encoder via EncoderManager...");
                    using var encoder = EncoderManager.CreateBestEncoder(sharedDevice: device);
                    encoder.Initialize(1920, 1080, 60);
                    result.Encoder = encoder.GetType().Name;
                    Console.WriteLine($"  Encoder: {result.Encoder}");

                    const int maxEncodeFrames = 100;
                    var gpuTimings = new List<long>(maxEncodeFrames);
                    var pts = TimeSpan.Zero;
                    int encodedCount = 0;

                    for (int i = 0; i < maxEncodeFrames && encodedCount < 30; i++)
                    {
                        var frame = capture.TryCaptureFrame(500);
                        if (!frame.Success || frame.Texture == null) continue;

                        var sw = Stopwatch.StartNew();
                        var packet = encoder.EncodeFrame(frame.Texture, pts);
                        sw.Stop();

                        if (packet != null)
                        {
                            gpuTimings.Add(sw.ElapsedTicks);
                            encodedCount++;
                            pts += TimeSpan.FromTicks(166_667);
                        }
                    }

                    result.Encode = new EncodeBench
                    {
                        FramesEncoded = encodedCount,
                        AvgUs = encodedCount > 0 ? gpuTimings.Average() * 1_000_000 / Stopwatch.Frequency : 0
                    };

                    Console.WriteLine($"  Encode: {encodedCount} frames, média {result.Encode.AvgUs:F1} us/frame");

                    // CPU benchmark: sample process CPU during ~30s of active capture
                    Console.WriteLine($"  Amostrando CPU por 30s (simulando gravação ativa)...");
                    var proc = Process.GetCurrentProcess();
                    var cpuSamples = new List<double>(60);
                    var prevCpuTime = proc.TotalProcessorTime;
                    var prevWall = DateTime.UtcNow;

                    for (int s = 0; s < 30; s++)
                    {
                        await Task.Delay(1000);
                        var curCpuTime = proc.TotalProcessorTime;
                        var curWall = DateTime.UtcNow;
                        var cpuDelta = (curCpuTime - prevCpuTime).TotalSeconds;
                        var wallDelta = (curWall - prevWall).TotalSeconds;
                        var cpuPct = wallDelta > 0 ? cpuDelta / wallDelta * 100 : 0;
                        cpuSamples.Add(cpuPct);
                        prevCpuTime = curCpuTime;
                        prevWall = curWall;
                    }

                    result.Cpu = new CpuBench
                    {
                        AvgCpuPercent = cpuSamples.Average(),
                        PeakCpuPercent = cpuSamples.Max(),
                        SamplingDurationSec = 30
                    };

                    Console.WriteLine($"  CPU: média={result.Cpu.AvgCpuPercent:F1}%  pico={result.Cpu.PeakCpuPercent:F1}%");
                }

                pump?.Dispose();
            }
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"  Benchmark falhou: {ex.GetType().Name}: {ex.Message}");
        }
        finally
        {
            MediaFactory.MFShutdown();
        }

        if (benchJson)
        {
            var path = BenchmarkResult.DefaultOutputPath();
            var dir = Path.GetDirectoryName(path);
            if (dir != null) Directory.CreateDirectory(dir);
            File.WriteAllText(path, result.ToJson());
            Console.WriteLine($"  Resultados salvos em: {path}");
        }

        Console.WriteLine();
    }

    private static List<IDXGIAdapter1> ListAdapters()
    {
        var list = new List<IDXGIAdapter1>();
        using var factory = DXGI.CreateDXGIFactory1<IDXGIFactory1>();
        for (uint i = 0; ; i++)
        {
            var result = factory.EnumAdapters1(i, out var adapter);
            if (result.Failure || adapter == null) break;
            var desc = adapter.Description;
            Console.WriteLine($"  Adapter #{i}: {desc.Description} (VID={desc.VendorId:X4}, DEV={desc.DeviceId:X4})");
            list.Add(adapter);
        }
        return list;
    }

    private static IDXGIAdapter1? PickBestAdapter(List<IDXGIAdapter1> adapters)
    {
        var preferred = adapters.FirstOrDefault(a =>
        {
            var d = a.Description;
            return d.VendorId == 0x10DE || // NVIDIA
                   d.VendorId == 0x1002 || // AMD
                   d.VendorId == 0x8086;   // Intel
        });
        if (preferred != null)
        {
            Console.WriteLine($"  Adapter selecionado: {preferred.Description.Description}");
            return preferred;
        }
        var fallback = adapters.FirstOrDefault(a => a.Description.VendorId != 0x1414);
        return fallback;
    }

    internal static async Task RunTestsAsync()
    {
        Console.WriteLine("=== DiNho Clips — Fase 0: Benchmark de Captura ===");
        Console.WriteLine();

        await TestCaptureLatencyBenchmark();

        Console.WriteLine("=== Fase 1: Núcleo do Engine ===");
        Console.WriteLine();

        TestMasterClock();
        TestReplayBuffer();
        await TestEncoderInitAsync();
        TestAudioCapture();
        TestExporter();

        Console.WriteLine("=== Fase 1 concluída ===");
    }

    private static async Task TestCaptureLatencyBenchmark()
    {
        Console.WriteLine("--- Fase 0: Latência WGC Desktop Duplication (TEMP WGC-FIRST SMOKE) ---");

        ICaptureSource? capture = new WgcCaptureSource();
        WindowsMessagePump? pump = null;

        try
        {
            pump = new WindowsMessagePump();
            pump.Invoke(() =>
            {
                capture.Initialize();
                ((WgcCaptureSource)capture).StartFramePump();
                Console.WriteLine($"  [{capture.Name}] Inicializado.");
            });
        }
        catch (Exception ex)
        {
            Console.WriteLine($"  WGC indisponível: {ex.Message}");
            try
            {
                capture = new DxgiCaptureSource();
                capture.Initialize();
                Console.WriteLine($"  [{capture.Name}] Inicializado.");
            }
            catch (Exception ex2)
            {
                Console.WriteLine($"  DXGI indisponível: {ex2.Message}");
                Console.WriteLine("  Pulando benchmark de captura.");
                capture?.Dispose();
                pump?.Dispose();
                return;
            }
        }

        for (int i = 0; i < 5; i++)
        {
            capture.TryCaptureFrame(CaptureTimeoutMs);
            await Task.Delay(1);
        }

        var latencies = new List<double>(FramesBenchmark);
        var successCount = 0;

        var totalLat2 = new List<double>(FramesBenchmark);
        var waitLat2 = new List<double>(FramesBenchmark);
        var copyLat2 = new List<double>(FramesBenchmark);

        for (int i = 0; i < FramesBenchmark; i++)
        {
            var frame = capture.TryCaptureFrame(CaptureTimeoutMs);

            if (frame.Success)
            {
                totalLat2.Add((frame.CaptureEndTicks - frame.CaptureStartTicks) * 1000.0 / Stopwatch.Frequency);
                waitLat2.Add((frame.WaitEndTicks - frame.CaptureStartTicks) * 1000.0 / Stopwatch.Frequency);
                copyLat2.Add((frame.CopyEndTicks - frame.WaitEndTicks) * 1000.0 / Stopwatch.Frequency);
                successCount++;
            }
            await Task.Delay(1);
        }

        capture.Dispose();
        pump?.Dispose();

        if (totalLat2.Count == 0)
        {
            Console.WriteLine($"  Nenhum frame capturado em {FramesBenchmark} tentativas.");
            Console.WriteLine();
            return;
        }

        totalLat2.Sort();
        waitLat2.Sort();
        copyLat2.Sort();

        static (double p50, double p95, double p99, double avg, double min, double max) Compute(
            List<double> sorted) => (
            sorted[(int)(sorted.Count * 0.50)],
            sorted[(int)(sorted.Count * 0.95)],
            sorted[(int)(sorted.Count * 0.99)],
            sorted.Average(),
            sorted.Min(),
            sorted.Max());

        var (tp50, tp95, tp99, tavg, tmin, tmax) = Compute(totalLat2);
        var (wp50, wp95, _, _, wmin, _) = Compute(waitLat2);
        var (cp50, cp95, _, _, cmin, _) = Compute(copyLat2);

        Console.WriteLine($"  Frames: {successCount}/{FramesBenchmark}");
        Console.WriteLine($"  Latência total (ms): min={tmin:F2}  p50={tp50:F2}  p95={tp95:F2}  p99={tp99:F2}  avg={tavg:F2}  max={tmax:F2}");
        Console.WriteLine($"  Espera (ms):         min={wmin:F2}  p50={wp50:F2}  p95={wp95:F2}");
        Console.WriteLine($"  Cópia (ms):          min={cmin:F2}  p50={cp50:F2}  p95={cp95:F2}");
        Console.WriteLine($"  Meta Fase 0: p95 < 16ms {(tp95 < 16 ? "✓ ATINGIDA" : "✗ NÃO ATINGIDA")}");
        Console.WriteLine();
    }

    private static void TestMasterClock()
    {
        Console.WriteLine("--- Teste: MasterClock ---");
        var clock = new MasterClock();
        Thread.Sleep(100);
        var elapsed = clock.Now;
        Console.WriteLine($"  Elapsed (100ms sleep): {elapsed.TotalMilliseconds:F1} ms");
        Console.WriteLine($"  NowHns: {clock.NowHns} hns");
        clock.Dispose();
        Console.WriteLine();
    }

    private static void TestReplayBuffer()
    {
        Console.WriteLine("--- Teste: ReplayBuffer ---");
        var buffer = new ReplayBuffer(TimeSpan.FromSeconds(5));

        for (int i = 0; i < 10; i++)
        {
            var pts = TimeSpan.FromMilliseconds(i * 33.33);
            var packet = new EncodedPacket(
                new byte[] { 0, 0, 0, 1, (byte)(i == 0 ? 0x67 : 0x41) },
                MediaType.Video,
                pts,
                TimeSpan.FromTicks(333_333),
                i == 0);
            buffer.AddVideo(packet);
        }

        var stats = buffer.Stats();
        Console.WriteLine($"  Pacotes de vídeo: {stats.videoCount}");
        Console.WriteLine($"  Duração total: {stats.duration.TotalSeconds:F2}s");

        var (video, audio) = buffer.GetSegments();
        Console.WriteLine($"  Pacotes no snapshot: {video.Count} vídeo, {audio.Count} áudio");

        for (int i = 10; i < 500; i++)
        {
            var pts = TimeSpan.FromMilliseconds(i * 33.33);
            var packet = new EncodedPacket(
                new byte[] { 0, 0, 0, 1, 0x41 },
                MediaType.Video,
                pts,
                TimeSpan.FromTicks(333_333),
                false);
            buffer.AddVideo(packet);
        }

        stats = buffer.Stats();
        Console.WriteLine($"  Após overflow (500 pacotes ~16s): {stats.videoCount} pacotes, duração={stats.duration.TotalSeconds:F1}s (esperado ~5s)");

        buffer.Dispose();
        Console.WriteLine();
    }

    private static Task TestEncoderInitAsync()
    {
        Console.WriteLine("--- Teste: Encoder (inicialização) ---");

        try
        {
            using var encoder = EncoderManager.CreateBestEncoder();
            encoder.Initialize(640, 480, 30);
            Console.WriteLine($"  {encoder.GetType().Name}: Inicializado (640x480 @ 30fps).");
            Console.WriteLine("  (encode com textura real requer GPU)");
        }
        catch (Exception ex)
        {
            Console.WriteLine($"  Encoder: {ex.GetType().Name}: {ex.Message}");
        }

        Console.WriteLine();
        return Task.CompletedTask;
    }

    private static void TestAudioCapture()
    {
        Console.WriteLine("--- Teste: WASAPI Loopback Audio ---");

        try
        {
            using var audio = new Audio.WasapiLoopbackSource();
            var received = 0;

            audio.OnAudioData += buf =>
            {
                if (Interlocked.Exchange(ref received, 1) == 0)
                    Console.WriteLine($"  Primeiro buffer: {buf.Samples.Length} samples, {buf.SampleRate}Hz, {buf.Channels}ch");
            };

            audio.Start();
            Console.WriteLine("  WASAPI loopback iniciado (aguardando áudio por 1s)...");
            Thread.Sleep(1000);
            audio.Stop();

            Console.WriteLine($"  Áudio recebido: {(received > 0 ? "SIM" : "NÃO (silêncio?)")}");
        }
        catch (Exception ex)
        {
            Console.WriteLine($"  WASAPI indisponível: {ex.Message}");
        }

        Console.WriteLine();
    }

    private static void TestExporter()
    {
        Console.WriteLine("--- Teste: ClipExporter (sintético) ---");

        try
        {
            var videoPackets = new List<EncodedPacket>();
            var audioPackets = new List<EncodedPacket>();

            // Gerar H.264 válido via ffmpeg
            var tempRaw = Path.GetTempFileName() + ".h264";
            var psi = new ProcessStartInfo
            {
                FileName = "ffmpeg",
                Arguments = $"-y -f lavfi -i color=c=black:s=640x480:d=0.5 -c:v libx264 -preset veryfast -frames:v 15 -f h264 \"{tempRaw}\"",
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardError = true,
            };
            using var proc = Process.Start(psi)!;
            proc.WaitForExit(10000);
            var rawData = File.ReadAllBytes(tempRaw);
            File.Delete(tempRaw);

            // Dividir em NAL units e criar pacotes
            var nalStart = FindNalStart(rawData, 0);
            var nalIndex = 0;
            while (nalStart >= 0)
            {
                var nextStart = FindNalStart(rawData, nalStart + 4);
                var nalLen = (nextStart >= 0 ? nextStart : rawData.Length) - nalStart;
                var nalData = rawData.AsSpan(nalStart, nalLen).ToArray();
                var nalType = nalData[4] & 0x1F;
                var isKeyframe = nalType == 7; // SPS = IDR
                var pts = TimeSpan.FromTicks(nalIndex * 333_333);

                videoPackets.Add(new EncodedPacket(
                    nalData, MediaType.Video, pts,
                    TimeSpan.FromTicks(333_333), isKeyframe, 640, 480));

                nalIndex++;
                nalStart = nextStart;
            }

            if (videoPackets.Count > 0)
            {
                using var exporter = new ClipExporter();
                var outputPath = ClipExporter.GenerateOutputPath(Path.GetTempPath());
                var result = exporter.ExportToMp4(outputPath, videoPackets, [], 640, 480, 30);
                Console.WriteLine($"  Exportado: {result} ({new FileInfo(result).Length / 1024} KB)");
            }
            else
            {
                Console.WriteLine("  Nenhum NAL encontrado no H.264 gerado.");
            }
        }
        catch (Exception ex)
        {
            Console.WriteLine($"  Export FALHOU: {ex.GetType().Name}: {ex.Message}");
        }

        Console.WriteLine();
    }

    private static int FindNalStart(byte[] data, int offset)
    {
        for (int i = offset; i < data.Length - 3; i++)
        {
            if (data[i] == 0 && data[i + 1] == 0 && data[i + 2] == 0 && data[i + 3] == 1)
                return i;
        }
        return -1;
    }
}
