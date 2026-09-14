using System.Buffers;
using System.Collections.Concurrent;
using System.Diagnostics;
using System.Threading.Channels;
using DiNho.Capture.Poc.Logging;
using Vortice.Direct3D11;
using Vortice.DXGI;
using Vortice.MediaFoundation;

namespace DiNho.Capture.Poc.Encoders;

internal sealed partial class FfmpegEncoder : IEncoder
{
    private Process? _process;
    private Stream? _stdin;
    private Stream? _stdout;
    private readonly Channel<EncodedPacket> _outputChannel;

    private int _width, _height, _frameRate;
    private int _cropX, _cropY, _cropW, _cropH;
    private bool _initialized;
    private volatile bool _disposed;
    private Thread? _readerThread;
    private CancellationTokenSource? _readerCts;
    private Thread? _stderrThread;
    private CancellationTokenSource? _stderrCts;
    private FrameWriter? _frameWriter;
    private string? _processFailedCause;
    private string? _codec;
    private readonly bool _useHardware;
    private int _bitrateKbps = 2000;

    // Cascading fallback chain — built once at first probe, consumed by TryFallbackCodec()
    private List<EncoderManager.FallbackEntry>? _fallbackChain;
    private int _currentFallbackIndex;
    private int _scaleDivisor = 1; // 1 = full res, 2 = half, 4 = quarter

    // Resolução de saída configurável pelo usuário (0 = mantém resolução de entrada).
    // O input rawvideo fica sempre na resolução da captura (_width/_height); o scale
    // acontece dentro do ffmpeg via -vf "scale=..." antes do encoder.
    private int _outputWidth;
    private int _outputHeight;
    private bool _stretchToFit;

    private GpuVideoConverter? _gpuConverter;
    private ID3D11Texture2D? _nv12Staging;
    private ID3D11Texture2D? _inputCopy;
    private int _inputCopyW, _inputCopyH, _stagingW, _stagingH;
    private Format _inputCopyFormat;

    // Dimensões da NV12 emitida (encoded dims). Sem crop, o scale acontece no GPU/CPU
    // (VideoProcessorBlt / DownscaleBgra) — a NV12 já sai na resolução final e o ffmpeg
    // recebe rawvideo direto nela, sem filtro scale. Com crop (código morto) mantém-se
    // _width/_height e o scale no vf. Setadas no StartFfmpeg; 0 = fallback para captura.
    private int _nv12W;
    private int _nv12H;

    private readonly Queue<EncodedPacket> _pendingOutputs = new();
    private bool _processFailed;
    private int _frameCount;
    private int _restartAttempts;
    private long _lastRestartTicks;
    private int _gpuConvertFails;
    private int _droppedPackets;
    private volatile bool _lastFrameBusyDrop;
    private int _gpuBusyDrops;

    // Absolute restart limiter: max 10 restarts in any 30-second window to prevent CLR crash from GC pressure
    private int _restartsInWindow;
    private long _restartWindowStartTicks;

    // CRF+VBV quality params (NVENC/AV1)
    private int _cq = 24;
    private int _maxrateKbps = 80000;
    private int _bufsizeKbps = 100000;
    private int _bframes = 0;
    private int _lookahead = 0;
    private string _nvencPreset = "p2";
    private string _amfPreset = "speed";
    private bool _multipass = false;

    // Buffers NV12 são pooled por frame (VideoPacketPool.Rent) — o writer thread ainda
    // pode estar escrevendo o frame anterior, então scratch único não é mais seguro.

    // Real PTS tracking — ConcurrentQueue because Enqueue (pipeline thread) and Dequeue (reader thread) are different threads
    private readonly ConcurrentQueue<TimeSpan> _inputPtsQueue = new();
    private long _lastRealPtsTicks = -1; // Last known real PTS for extrapolation when queue is drained

    // H.264 parser state
    private byte[]? _pendingBuf;   // AVCC frame assembly buffer (ParseAvcc → EmitPacket)
    private int _pendingLen;
    private bool _hadSlice;
    private bool _pendingTooLarge; // Set by ParseAvcc when pending exceeds 200KB — prevents false EmitPacket
    private long _outputFrameIndex;

    // Stdin write timeout: strict 200ms only in steady state (encoder proven working).
    // During warm-up (no packet emitted yet) use a generous timeout — ffmpeg opening the
    // HW encoder does not read stdin yet, and a strict timeout kills it before cold-start,
    // causing a kill-restart loop that cascades to CPU libx264 (observed on RTX 5050:
    // av1_nvenc cold-start can exceed 200ms, especially when the previous NVENC session
    // is still being released).
    internal const int StdinWriteTimeoutMs = 200;
    internal const int StdinWriteWarmupTimeoutMs = 10_000;

    // Raw AnnexB/AVCC accumulation buffer — handles pipe splits that land mid-NALU
    private byte[]? _rawBuf;
    private int _rawLen;
    private bool _hadRawSlice; // tracked in AnnexB path before conversion
    private bool _loggedParseAvcc; // first-call guard for ParseAvcc log
    private string? _userCodec; // original user codec preference, for fallback chain building
    private byte[]? _incompleteNalBuf;   // Incomplete NALU tail from ParseAvcc (Bug 1 fix)
    private int _incompleteNalLen;        // Length of incomplete NALU tail

    // Format latch — ffmpeg -f h264 with -bsf:v should output AnnexB, but sometimes
    // frames slip through in AVCC format. We detect once and latch.
    private enum PipeFormat { Unknown, AnnexB, Avcc, Ivf }
    private PipeFormat _pipeFormat;

    // Cached avcC (AVCDecoderConfigurationRecord) extracted from the first SPS/PPS encountered.
    // Needed by clip exporter when the rolling replay buffer has evicted the initial packet.
    private byte[]? _cachedVps;
    private byte[]? _cachedSps;
    private byte[]? _cachedPps;
    private byte[]? _cachedAvcc;
    private byte[]? _cachedHvcc;
    private bool _ivfHeaderParsed;
    private uint _ivfTimebaseDen;
    private uint _ivfTimebaseNum;

    public FfmpegEncoder(bool useHardware = true)
    {
        _useHardware = useHardware;

        // DropOldest mantém a dinâmica de gravação: quando o canal enche, o
        // pacote mais antigo é descartado e os frames mais recentes (o "agora",
        // que é o ponto de save do replay buffer) são preservados.
        //
        // O callback itemDropped é obrigatório: o descarte via DropOldest NÃO
        // chama Release() sozinho — sem este callback o byte[] do VideoPacketPool
        // vazaria (M1).
        _outputChannel = Channel.CreateBounded<EncodedPacket>(new BoundedChannelOptions(256)
        {
            FullMode = BoundedChannelFullMode.DropOldest
        }, itemDropped: pkt =>
        {
            pkt.Release();
            // M2: contabiliza drops para o operador. Loga no 1º drop e depois a cada
            // 100 — um ffmpeg lento (encoder < 1.0x) pode descartar centenas por
            // segundo, e logar todo drop inundaria o log. 100 = ~1.6s a 60fps.
            int drops = Interlocked.Increment(ref _droppedPackets);
            if (drops == 1 || drops % 100 == 0)
                Log.W("FfmpegEncoder", $"output channel overflow — {drops} packets dropped total (encoder output slower than capture)");
        });
    }
    public byte[]? AvccCache => _cachedAvcc;
    public byte[]? HvccCache => _cachedHvcc;
    private bool IsHevc => _codec is "hevc_nvenc" or "hevc_amf" or "hevc_qsv" or "libx265";
    private bool IsAv1 => _codec is "av1_nvenc" or "libsvtav1" or "av1_amf" or "av1_qsv";
    public string RawFormat => IsHevc ? "hevc" : IsAv1 ? "av1" : "h264";
    public void SetD3DManager(IMFDXGIDeviceManager? manager) { }

    public void SetCropRect(int x, int y, int w, int h)
    {
        _cropX = x; _cropY = y; _cropW = w; _cropH = h;
    }

    /// <summary>
    /// Define a resolução de saída desejada (ex.: 854×480, 1280×720, 1920×1080).
    /// O frame é redimensionado inteiro via filtro scale do ffmpeg — sem recorte.
    /// Valores ≤ 0 mantêm a resolução de entrada. Dimensões ímpares são arredondadas
    /// para baixo (par), exigência do NV12.
    /// </summary>
    public void SetOutputResolution(int width, int height)
    {
        _outputWidth = width > 0 ? width & ~1 : 0;
        _outputHeight = height > 0 ? height & ~1 : 0;
    }

    /// <summary>
    /// "Remover bordas pretas": quando true, o scale preenche o box alvo inteiro
    /// (deixa de preservar o aspect da captura — leve distorção). Sempre desliga
    /// o box-fit, mas o "nunca upscale" continua valendo.
    /// </summary>
    public void SetStretchToFit(bool stretchToFit)
    {
        _stretchToFit = stretchToFit;
    }

    /// <summary>Gate do NVENC weighted_pred: ffmpeg 9.0 (SDK 11.1+) rejeita weighted_pred quando
    /// bframes &gt; 0 ("invalid param (8): Weighted Prediction not supported with B-frames") —
    /// aplica apenas com bframes = 0 (preset Boa) para preservar o recurso sem restart loop.</summary>
    internal static string BuildWeightedPredArg(bool bframesZero) =>
        bframesZero ? " -weighted_pred 1" : "";

    /// <summary>Args do encoder no StartFfmpeg, por codec. Extraído como seam puro (sem estado)
    /// para permitir teste unitário da cadeia de tune de cada codec. AMF: CQP (QP = cq do front)
    /// + preset `speed` + vbaq + me_quarter_pel (só h264/hevc_amf — av1_amf não expõe
    /// me_quarter_pel). O preset antigo `quality` + preanalysis + lookahead 40 era pesado demais
    /// pra RDNA1 (VCN 1.0): encoder a ~0.55x speed → drift A/V crescente e clips com ~36fps em
    /// vez de 60. `-filler` não existe no ffmpeg 9 — a opção é `-filler_data` (boolean), válida
    /// nos 3 codecs AMF.</summary>
    internal static string BuildEncoderTuneArgs(string codec, double cq, int maxrateKbps, int bufsizeKbps,
        int bframes, int lookahead, string nvencPreset, string amfPreset = "speed", bool multipass = false)
    {
        // Fallback de CPU (libx264/libx265): CRF+VBV com preset fast. Sem -tune zerolatency
        // (bframes=0 garante ordem de saída = ordem de entrada p/ o PTS do pipeline) e sem
        // -threads 1 (usa todos os cores). CABAC/High profile recupera ~15% de eficiência.
        var cpuCq = Math.Clamp(cq, 1, 51);
        var qsvQp = Math.Clamp(cq - 4, 0, 51);
        var amfPresetNorm = NormalizeAmfPreset(amfPreset);
        return codec switch
        {
            "libx264" => $"-preset fast -crf {cpuCq} -maxrate {maxrateKbps}K -bufsize {bufsizeKbps}K -bf 0 -profile:v high",
            "libx265" => $"-preset fast -crf {cpuCq} -maxrate {maxrateKbps}K -bufsize {bufsizeKbps}K -bf 0 -x265-params no-open-gop=1:keyint=60:min-keyint=60",
            "h264_nvenc" => $"-preset {nvencPreset} -tune hq -rc vbr -b:v 0 -cq {cq} -maxrate {maxrateKbps}K -bufsize {bufsizeKbps}K -profile:v high -bf {bframes} -rc-lookahead {lookahead} -spatial-aq 1 -aq-strength 8 -temporal-aq 1 -multipass {(multipass ? "fullres" : "disabled")}{BuildWeightedPredArg(bframes == 0)} -nonref_p 1 -g 120 -keyint_min 120",
            "hevc_nvenc" => $"-preset {nvencPreset} -tune hq -rc vbr -b:v 0 -cq {cq} -maxrate {maxrateKbps}K -bufsize {bufsizeKbps}K -profile:v main10 -bf {bframes} -b_ref_mode middle -rc-lookahead {lookahead} -spatial-aq 1 -aq-strength 8 -temporal-aq 1 -multipass {(multipass ? "fullres" : "disabled")}{BuildWeightedPredArg(bframes == 0)} -nonref_p 1 -g 120 -keyint_min 120",
            "av1_nvenc" => $"-preset {nvencPreset} -tune hq -rc vbr -b:v 0 -cq {cq} -maxrate {maxrateKbps}K -bufsize {bufsizeKbps}K -bf {bframes} -rc-lookahead {lookahead} -spatial-aq 1 -aq-strength 8 -temporal-aq 1 -multipass {(multipass ? "fullres" : "disabled")} -nonref_p 1 -g 120 -keyint_min 120",
            // AMF: CQP (qualidade constante) com QP = cq do front direto — mesmo padrão OBS/AMD
            // (QP 16-23; cq 18/20/24 cai na faixa) e NVENC (-cq). Sem -b:v/-maxrate/-bufsize: CQP
            // não tem teto de bitrate (OBS não mostra bitrate em CQP). O antigo vbr_peak + QP
            // setado (issue obs-ffmpeg #12994) fazia o QP sobrepor o alvo; e sem -b:v o AMF
            // subalocava ~3 Mbps (borrado). GOP 120 = keyframe/2s @60fps (padrão recording
            // GPUOpen/OBS/NVENC). PA/preanalysis fora (RDNA1 VCN 1.0 overload).
            "h264_amf" => $"-quality {amfPresetNorm} -rc cqp -qp_i {cpuCq} -qp_p {cpuCq} -bf 0 -g 120 -filler_data 0 -enforce_hrd 0 -vbaq true -me_quarter_pel true",
            "hevc_amf" => $"-quality {amfPresetNorm} -rc cqp -qp_i {cpuCq} -qp_p {cpuCq} -bf 0 -g 120 -filler_data 0 -enforce_hrd 0 -vbaq true -me_quarter_pel true",
            "av1_amf" => $"-quality {amfPresetNorm} -rc cqp -qp_i {cpuCq} -qp_p {cpuCq} -bf 0 -g 120 -filler_data 0 -enforce_hrd 0 -vbaq true",
            // QSV: veryslow + global_quality + extbrc/rdo/adaptive/mbbrc. Sem -extra_hw_frames:
            // ffmpeg 9 rejeita extra_hw_frames como opção de encoder ("not a encoding option") —
            // é opção frame-level (valida p/ vf hwupload=...). QSV precisa de -init_hw_device qsv
            // (adicionado no StartFfmpeg/probe) para criar a sessão MFX; sem ele o ffmpeg 9 falha
            // com "Error creating a MFX session: -9" mesmo em máquina Intel.
            "h264_qsv" or "hevc_qsv" => $"-preset veryslow -global_quality {qsvQp} -bf 0 -g 60 -maxrate {maxrateKbps}K -bufsize {bufsizeKbps}K -extbrc 1 -look_ahead_depth 40 -rdo 1 -low_power 0 -adaptive_i 1 -adaptive_b 1 -b_strategy 1 -mbbrc 1 -async_depth 1",
            "av1_qsv" => $"-preset veryslow -global_quality {qsvQp} -bf 0 -g 60 -maxrate {maxrateKbps}K -bufsize {bufsizeKbps}K -extbrc 1 -look_ahead_depth 40 -adaptive_i 1 -adaptive_b 1 -b_strategy 1 -async_depth 1",
            // D3D12VA: só aceita frames no pixel format d3d12 (via hwupload no vf chain).
            // RC modes: 1=CQP, 2=CBR, 3=VBR, 4=QVBR. -bf 0 garante ordem de saída = entrada
            // (requisito do PTS pipeline). GOP 120 espelha NVENC/QSV.
            "h264_d3d12va" => $"-rc 1 -qp {Math.Clamp(cq, 0, 52)} -bf 0 -g 120",
            "hevc_d3d12va" => $"-rc 1 -qp {Math.Clamp(cq, 0, 52)} -bf 0 -g 120",
            "av1_d3d12va" => $"-rc 1 -qp {Math.Clamp(cq, 0, 52)} -bf 0 -g 120",
            _ => $"-preset fast -crf {cpuCq} -maxrate {maxrateKbps}K -bufsize {bufsizeKbps}K -bf 0 -profile:v high"
        };
    }

    /// <summary>Normaliza o preset AMF para um dos três valores válidos do ffmpeg 9
    /// (quality/balanced/speed). Case-insensitive com trim; inválido, vazio ou null → "speed"
    /// (preset default mais seguro — RDNA1 sustenta ~1.0x mesmo em resolução alta).</summary>
    internal static string NormalizeAmfPreset(string? preset)
    {
        if (string.IsNullOrWhiteSpace(preset)) return "speed";
        var p = preset.Trim().ToLowerInvariant();
        return p is "quality" or "balanced" or "speed" ? p : "speed";
    }

    /// <summary>Formato raw dos dados de vídeo na saída do ffmpeg, por codec — necessário para o
    /// mux (IVF p/ AV1 vs raw p/ H264/HEVC) e para o detector de formato no ReaderLoop.</summary>
    internal static string GetRawFormatForCodec(string codec) => codec switch
    {
        "hevc_nvenc" or "hevc_amf" or "hevc_qsv" or "hevc_d3d12va" or "libx265" => "hevc",
        "av1_nvenc" or "libsvtav1" or "av1_d3d12va" or "av1_amf" or "av1_qsv" => "av1",
        _ => "h264"
    };

    /// <summary>Resolução efetiva dos pacotes emitidos, determinada no StartFfmpeg a partir do
    /// scale aplicado (usuário + divisor) e do crop. Cobre tanto o scale do usuário quanto o
    /// cascading fallback — evita que o header do MKV (EncodedPacket.Width/Height) divirja do
    /// bitstream real.</summary>
    private int _encodedW;
    private int _encodedH;
    private int EncodedWidth => _encodedW > 0 ? _encodedW : _width;
    private int EncodedHeight => _encodedH > 0 ? _encodedH : _height;

    /// <summary>
    /// Calcula a resolução alvo do filtro scale combinando a resolução de saída do
    /// usuário com o scale do cascading fallback (1/N da entrada). Preserva o aspect
    /// ratio da entrada quando a resolução do usuário tem proporção diferente (ex.:
    /// captura 16:10/21:9 + preset 16:9) — ajusta dentro do box alvo sem esticar.
    /// Retorna null quando nenhum scale é necessário (saída == entrada).
    /// O divisor do fallback SÓ se aplica quando o usuário não definiu resolução
    /// explícita (nativo, outputW &lt;= 0). Se o usuário escolheu um alvo (ex.: 720p),
    /// esse alvo é o piso — o fallback troca o encoder, nunca degrada a resolução
    /// escolhida (filosofia OBS: output resolution é decisão do usuário).
    /// </summary>
    internal static (int Width, int Height)? ComputeScaleTarget(
        int inputW, int inputH, int outputW, int outputH, int scaleDivisor, bool stretchToFit = false)
    {
        int outW = outputW > 0 ? outputW : inputW;
        int outH = outputH > 0 ? outputH : inputH;
        if (scaleDivisor > 1 && outputW <= 0)
        {
            outW = Math.Min(outW, inputW / scaleDivisor);
            outH = Math.Min(outH, inputH / scaleDivisor);
        }
        // Nunca faz upscale — limita à resolução de entrada (mesma regra do EngineCoordinator)
        outW = Math.Min(outW, inputW);
        outH = Math.Min(outH, inputH);
        // "Remover bordas pretas" (stretchToFit): pula a preservação de aspect — o scale
        // preenche o box alvo inteiro (leve distorção). Upscale continua bloqueado acima.
        // Sem stretch, preserva o aspect ratio da captura quando o alvo do usuário tem
        // proporção distinta (ex.: 16:10/21:9 + preset 16:9) — ajusta dentro do box sem esticar.
        if (!stretchToFit && outW > 0 && outH > 0)
        {
            double inAr = (double)inputW / inputH;
            double outAr = (double)outW / outH;
            if (Math.Abs(inAr - outAr) > 0.01)
            {
                if (inAr > outAr) // entrada mais larga: limita por largura
                    outH = (int)Math.Round(outW / inAr);
                else // entrada mais estreita: limita por altura
                    outW = (int)Math.Round(outH * inAr);
            }
        }
        outW &= ~1;
        outH &= ~1;
        if (outW == inputW && outH == inputH)
            return null;
        return (outW, outH);
    }

    /// <summary>Resultado do ResolveOutput — quais dims o ffmpeg recebe (-s), quais a NV12
    /// produzida tem (Nv12W/H) e se o scale vai no filtro vf (ScaleW/H não-nulos = crop ativo).</summary>
    internal readonly record struct EncoderOutputResolve(
        int EncodedW, int EncodedH,
        int Nv12W, int Nv12H,
        int? ScaleW, int? ScaleH);

    /// <summary>
    /// Decisão central de resolução do O1: onde o downscale acontece.
    /// Sem crop (caminho normal): o scale do ComputeScaleTarget é aplicado NA CONVERSÃO
    /// (GPU VideoProcessorBlt / CPU DownscaleBgra) — a NV12 já sai em Nv12W×Nv12H e o ffmpeg
    /// recebe rawvideo direto nela via -s, SEM filtro scale no vf.
    /// Com crop (código morto hoje): a NV12 sai nas dims da captura (Nv12W=EncodedW base = input)
    /// e o scale vai no vf, sobre o frame cortado.
    /// </summary>
    internal static EncoderOutputResolve ResolveOutput(
        int inputW, int inputH, int cropW, int cropH,
        int outputW, int outputH, int scaleDivisor, bool stretchToFit = false)
    {
        bool hasCrop = cropW > 0 && cropH > 0;
        int baseW = hasCrop ? Math.Max(cropW, 320) : inputW;
        int baseH = hasCrop ? Math.Max(cropH, 240) : inputH;
        var scaleTarget = ComputeScaleTarget(baseW, baseH, outputW, outputH, scaleDivisor, stretchToFit);
        int encodedW = scaleTarget?.Width ?? baseW;
        int encodedH = scaleTarget?.Height ?? baseH;
        if (hasCrop)
            return new EncoderOutputResolve(encodedW, encodedH, inputW, inputH, scaleTarget?.Width, scaleTarget?.Height);
        return new EncoderOutputResolve(encodedW, encodedH, encodedW, encodedH, null, null);
    }

    /// <summary>
    /// Define parâmetros de qualidade CRF+VBV para NVENC/AV1.
    /// bitrateKbps ainda é usado como fallback para AMF/QSV/libx264.
    /// </summary>
    public void SetQualityParams(int cq, int maxrateKbps, int bufsizeKbps, int bframes = 2, int lookahead = 4, string preset = "p4", string? codec = null, bool multipass = false)
    {
        _cq = cq;
        _maxrateKbps = maxrateKbps;
        _bufsizeKbps = bufsizeKbps;
        _bframes = bframes;
        _lookahead = lookahead;
            _nvencPreset = preset;
        _multipass = multipass;
        if (!string.IsNullOrEmpty(codec) && codec != "auto")
        {
            _userCodec = codec;
            var resolved = ResolveCodec(codec);
            // A failed resolve must never leave an empty codec — null lets Initialize pick DetectBestCodec.
            _codec = string.IsNullOrWhiteSpace(resolved) ? null : resolved;
        }
    }

    public void Initialize(int width, int height, int frameRate, int bitrateKbps = 2000)
    {
        // NV12 requires even dimensions — round down to avoid libx264/NVENC "height not divisible by 2"
        _width = width & ~1;
        _height = height & ~1;
        _frameRate = frameRate;
        _bitrateKbps = bitrateKbps;
        if (string.IsNullOrWhiteSpace(_codec))
        {
            _codec = DetectBestCodec();
        }
        else
        {
            var vendorId = EncoderManager.DetectEncodingVendorId();
            _fallbackChain = EncoderManager.BuildFallbackChain(_userCodec ?? "auto", vendorId);
            _currentFallbackIndex = 0;
        }
        _amfPreset = EncoderManager.IsAmfCodec(_codec)
            ? EncoderManager.SelectAmfPreset(_codec, _width, _height, _frameRate)
            : "speed";
        Log.I("FfmpegEncoder", $"codec={_codec} bitrate={_bitrateKbps}Kbps cq={_cq} maxrate={_maxrateKbps}Kbps bufsize={_bufsizeKbps}Kbps res={width}x{height}@{frameRate}fps preset={_nvencPreset} amfPreset={_amfPreset} _useHardware={_useHardware}");
        StartFfmpeg();

        _readerCts = new CancellationTokenSource();
        _readerThread = new Thread(() => ReaderLoop(_readerCts.Token))
        {
            IsBackground = true,
            Name = "FfmpegReader"
        };
        _readerThread.Start();
        _initialized = true;

        Log.I("FfmpegEncoder", $"initialized (codec={_codec})");
    }

    // ── ffmpeg process ───────────────────────────────────────────────

    private void StartFfmpeg()
    {
        /* NVENC/AV1: CRF+VBV — -b:v 0 torna o CQ explícito (sem bitrate alvo implícito),
           maxrate/bufsize como segurança VBV.
           AMF/QSV/libx264: fallback com bitrateKbps alvo (esses codecs não têm CRF+VBV bom).
           Melhorias de qualidade sem alterar CQ/res:
             NVENC: spatial-aq 1 + temporal-aq 1 + multipass fullres + weighted_pred + nonref_p
                    (weighted_pred apenas em H264/HEVC e apenas com bframes=0 — ffmpeg 9.0
                     rejeita com "invalid param (8): Weighted Prediction not supported with
                     B-frames"; av1_nvenc rejeita weighted_pred sempre)
             AMF:   preanalysis + pa_taq_mode 2 + vbaq + scene change detection + me_quarter_pel
             QSV:   veryslow + extbrc + rdo 1 + adaptive_i/b + b_strategy + mbbrc
           Cor BT.709: tagging no output → NVENC escreve VUI → atom `colr` no MP4 (players corretos).
           GOP 120 (~2s a 60fps): OBS recomenda, ~10% menos bits que GOP 60. */
        var tune = BuildEncoderTuneArgs(_codec!, _cq, _maxrateKbps, _bufsizeKbps, _bframes, _lookahead, _nvencPreset, _amfPreset, _multipass);

        int cw = _cropW, ch = _cropH;
        bool hasCrop = cw > 0 && ch > 0;
        if (hasCrop)
        {
            cw = Math.Max(cw, 320);
            ch = Math.Max(ch, 240);
            Log.I("FfmpegEncoder", $"crop={cw}:{ch}:{_cropX}:{_cropY} src={_width}x{_height}");
        }

        // Build -vf filter chain: optional crop + optional scale (user output resolution + cascading fallback)
        // O scale é relativo à resolução PÓS-crop — se um crop estiver ativo, o "nunca upscale"
        // e o divisor do fallback aplicam-se ao frame cortado, não ao frame cheio.
        var vfParts = new List<string>();
        if (hasCrop)
            vfParts.Add($"crop={cw}:{ch}:{_cropX}:{_cropY}");

        // O1: sem crop, o downscale acontece na conversão (GPU VideoProcessorBlt ou CPU
        // DownscaleBgra) — a NV12 já sai em Nv12W×Nv12H e o ffmpeg recebe rawvideo direto
        // na resolução final via -s, sem filtro scale. Com crop (código morto hoje), a NV12
        // sai nas dims da captura e o scale fica no vf sobre o frame cortado.
        var resolve = ResolveOutput(_width, _height, hasCrop ? cw : 0, hasCrop ? ch : 0,
            _outputWidth, _outputHeight, _scaleDivisor, _stretchToFit);
        _encodedW = resolve.EncodedW;
        _encodedH = resolve.EncodedH;
        _nv12W = resolve.Nv12W;
        _nv12H = resolve.Nv12H;
        if (resolve.ScaleW.HasValue && resolve.ScaleH.HasValue)
        {
            vfParts.Add($"scale={resolve.ScaleW}:{resolve.ScaleH}");
            int baseW = hasCrop ? cw : _width;
            int baseH = hasCrop ? ch : _height;
            Log.I("FfmpegEncoder", $"output scale: {baseW}x{baseH} → {resolve.ScaleW}:{resolve.ScaleH} (user={( _outputWidth > 0 ? $"{_outputWidth}x{_outputHeight}" : "native" )}, fallback=1/{_scaleDivisor})");
        }
        // D3D12VA só aceita frames no pixel format d3d12 — hwupload sobe o frame NV12
        // para o device D3D12 antes do encoder (mesmo padrão validado no probe).
        var isD3d12va = _codec?.EndsWith("_d3d12va", StringComparison.Ordinal) == true;
        if (isD3d12va)
            vfParts.Add("hwupload=extra_hw_frames=16,format=d3d12");
        // QSV precisa de -init_hw_device qsv para criar a sessão MFX — sem isso o ffmpeg 9
        // falha com "Error creating a MFX session: -9" mesmo em máquina Intel. O encoder
        // QSV faz o upload internamente (aceita frames NV12 de sistema), não usa hwupload.
        var isQsv = _codec?.EndsWith("_qsv", StringComparison.Ordinal) == true;
        var cropFilter = vfParts.Count > 0
            ? $" -vf \"{string.Join(",", vfParts)}\""
            : "";

        var rawFmt = GetRawFormatForCodec(_codec!);

        // For AV1, use IVF container (explicit frame boundaries with 12-byte headers).
        // Raw AV1 OBU data is not parseable by our AnnexB/AVCC detector.
        // H264/HEVC use raw format with bitstream filter for AnnexB output.
        string outputFmt = rawFmt == "av1" ? "ivf" : rawFmt;

        // Apply bitstream filter to ensure clean AnnexB output (start-code delimited)
        // instead of AVCC (4-byte length prefix). The AnnexB path in ReaderLoop is
        // more robust against pipe splits and arbitrary offsets than the AVCC parser.
        // AV1 IVF format doesn't need a bsf.
        string bsfArg = rawFmt == "av1" ? "" : $" -bsf:v {rawFmt}_mp4toannexb";
        // Note: if the bsf occasionally fails (known ffmpeg quirk with random frames),
        // the AVCC fallback in ReaderLoop handles misdetected data via the 512KB pending
        // guard + format re-detect at NalParsing:335-345.

        _process = new Process
        {
            StartInfo = FfmpegPathResolver.CreateFfmpegStartInfo(
                            args: $"-y -loglevel info " +
                            (isD3d12va ? "-init_hw_device d3d12va=hw=0 " : "") +
                            (isQsv ? "-init_hw_device qsv " : "") +
                            $"-f rawvideo -pix_fmt nv12 -s {_nv12W}x{_nv12H} " +
                            $"-r {_frameRate} -i pipe:0 " +
                            $"-colorspace bt709 -color_primaries bt709 -color_trc bt709 " +
                            $"{cropFilter} -c:v {_codec} {tune} " +
                            $"-f {outputFmt}{bsfArg} pipe:1",
                            redirectInput: true,
                            redirectOutput: true,
                            redirectError: true)
        };
        Log.I("FfmpegEncoder", $"ffmpeg args: {_process.StartInfo.Arguments}");

        _process.Start();

        try { _process.PriorityClass = ProcessPriorityClass.Normal; } catch { }

        _stdin = _process.StandardInput.BaseStream;
        _stdout = new BufferedStream(_process.StandardOutput.BaseStream, 2 * 1024 * 1024);

        var stderrStream = _process.StandardError;
        _stderrCts?.Dispose();
        _stderrCts = new CancellationTokenSource();
        var stCt = _stderrCts.Token;
        _stderrThread = new Thread(() =>
        {
            try
            {
                while (!stCt.IsCancellationRequested)
                {
                    var line = stderrStream.ReadLine();
                    if (line == null) break;
                    if (line.Length > 0)
                        Log.D("ffmpeg", line);
                }
            }
            catch (OperationCanceledException) { }
            catch (IOException) { }
        })
        {
            IsBackground = true,
            Name = "FfmpegStderr"
        };
        _stderrThread.Start();

        // O3 (fase 1): thread dedicada para o stdin — a captura enfileira frames (nunca
        // bloqueia no pipe), o writer escreve em paralelo e enfileira o PTS só em sucesso.
        _frameWriter = new FrameWriter(
            () => _stdin,
            () => ComputeStdinWriteTimeout(_outputFrameIndex),
            OnFrameWrittenToStdin,
            OnStdinWriteFailed);
    }

    // ── Reader thread: H.264 output (moved to FfmpegEncoder.NalParsing.cs) ──

    // ── Encode frame ─────────────────────────────────────────────────

    internal enum StdinWriteResult { Ok, Timeout, Faulted }

    internal static StdinWriteResult TryWriteStdin(Stream stdin, byte[] data, int timeoutMs, out Exception? fault) =>
        TryWriteStdin(stdin, data, 0, data.Length, timeoutMs, out fault);

    /// <summary>
    /// Escreve dados no stdin do ffmpeg com timeout. Se o pipe encher (processo
    /// travado / CPU zero), retorna Timeout em vez de bloquear a thread de captura.
    /// A task em voo após o timeout é observada (só-faulted) para evitar unobserved
    /// task exception — o processo antigo será morto pelo restart.
    /// </summary>
    internal static StdinWriteResult TryWriteStdin(Stream stdin, byte[] data, int offset, int count, int timeoutMs, out Exception? fault)
    {
        fault = null;
        var writeTask = stdin.WriteAsync(data, offset, count);
        try
        {
            if (writeTask.Wait(TimeSpan.FromMilliseconds(timeoutMs)))
                return StdinWriteResult.Ok;
        }
        catch (AggregateException)
        {
            // Task.Wait(timeout) LANÇA AggregateException quando a task completa
            // com falha em vez de retornar true — trata como Faulted (teste
            // TryWriteStdin_FaultingStream_ReturnsFaultedWithException). Sem este
            // catch, a AggregateException escapava da EncodeFrame (o catch externo
            // só filtra IOException/ObjectDisposedException).
            if (writeTask.IsFaulted)
            {
                fault = writeTask.Exception?.GetBaseException();
                return StdinWriteResult.Faulted;
            }
            throw;
        }
        // A write pode falhar depois do timeout (ex.: restart dispõe o pipe).
        // Observa a task para evitar unobserved task exception; a falha é
        // irrelevante aqui porque o processo antigo será morto.
        _ = writeTask.ContinueWith(t => _ = t.Exception, TaskContinuationOptions.OnlyOnFaulted);
        return StdinWriteResult.Timeout;
    }

    /// <summary>
    /// Escolhe o timeout de escrita no stdin: warm-up (nenhum pacote emitido ainda)
    /// usa timeout generoso para o ffmpeg abrir o encoder HW; estado estável usa o
    /// timeout estrito de proteção contra travas. Um encoder que nunca emitiu pacote
    /// não pode ser considerado "travado" — só um que já provou funcionar.
    /// </summary>
    internal static int ComputeStdinWriteTimeout(long outputFrameIndex) =>
        outputFrameIndex == 0 ? StdinWriteWarmupTimeoutMs : StdinWriteTimeoutMs;

    /// <summary>
    /// Acessores dos drops por GPU busy (0x887A000A). O flag aponta se o ÚLTIMO frame
    /// caiu por busy (conversão NV12 no staging) — o pipeline usa para classificar o
    /// motivo do drop no log/status de forma honesta (busy ≠ encode error).
    /// </summary>
    public bool LastFrameBusyDrop => _lastFrameBusyDrop;

    public int GpuBusyDrops => Volatile.Read(ref _gpuBusyDrops);

    /// <summary>
    /// Reason do drop no pipeline: distingue busy transiente (retry no próximo frame)
    /// de falha real de encode. Chamado pelo EngineCoordinator quando EncodeFrame
    /// retorna null.
    /// </summary>
    internal static string BuildEncodeDropReason(bool isBusy) =>
        isBusy
            ? "GPU busy (0x887A000A) — frame dropped, retry next frame."
            : "Encoder não produziu frame (encode error).";

    public EncodedPacket? EncodeFrame(ID3D11Texture2D texture, TimeSpan pts)
    {
        if (!_initialized) throw new InvalidOperationException("not initialized");
        if (_disposed) return null;

        _lastFrameBusyDrop = false;

        if (_processFailed && !TryRestart())
            return null;

        // O3 (fase 1): NV12 pooled POR FRAME — o scratch único `_nv12Scratch` não serve:
        // o writer thread pode ainda estar escrevendo o frame anterior quando a captura
        // produz este. O buffer é devolvido ao pool pelo writer após a escrita/drop.
        var nv12Buf = VideoPacketPool.Rent(Nv12OutputSize);
        byte[]? nv12;
        try
        {
            nv12 = ConvertGpuNv12(texture, nv12Buf);
        }
        catch
        {
            VideoPacketPool.Return(nv12Buf);
            throw;
        }

        if (nv12 == null)
        {
            VideoPacketPool.Return(nv12Buf);
            return null;
        }

        // Enfileira no writer (nunca bloqueia). Fila cheia → drop-oldest do frame mais
        // antigo enfileirado + buffer devolvido; "agora" vence, como no replay buffer.
        // Timeout/Fault do pipe são reportados via OnStdinWriteFailed (mesmos causes do
        // caminho síncrono) e o restart continua acontecer no próximo EncodeFrame.
        var writer = _frameWriter;
        if (writer == null || !writer.TryEnqueue(nv12Buf, pts))
        {
            VideoPacketPool.Return(nv12Buf);
            return null;
        }

        while (_outputChannel.Reader.TryRead(out var pkt))
        {
            if (_pendingOutputs.Count < 32)
                _pendingOutputs.Enqueue(pkt);
            else
                pkt.Release();
        }

        if (_pendingOutputs.Count > 0)
            return _pendingOutputs.Dequeue();
        if (!_processFailed)
        {
            if (_frameCount % 300 == 1)
            {
                bool exited = _process?.HasExited == true;
                string exitInfo = exited ? $" exited={_process!.ExitCode}" : "";
                int first4 = _pendingBuf != null && _pendingLen >= 4 ? (_pendingBuf[0] << 24) | (_pendingBuf[1] << 16) | (_pendingBuf[2] << 8) | _pendingBuf[3] : 0;
                string noOutputMsg = $"no output packets after {_frameCount} frames written — ffmpeg exited={exited}{exitInfo}, pendingBytes={_pendingLen}, hadSlice={_hadSlice}, frameIndex={_outputFrameIndex}, pendingFirst4=0x{first4:X8}";
                if (_frameCount == 1)
                    Log.D("FfmpegEncoder", noOutputMsg); // cold-start: encoder ainda aquecendo, normal
                else
                    Log.W("FfmpegEncoder", noOutputMsg); // stall real: nenhum pacote após N frames
            }
        }
        return null;
    }

    /// <summary>Tamanho exato do buffer NV12 emitido (Y + UV) — usado para rent no pool.</summary>
    private int Nv12OutputSize => Nv12H * Nv12W + (Nv12H / 2) * Nv12W;

    /// <summary>Frames descartados por overflow da fila de entrada do writer (drop-oldest).</summary>
    public int InputQueueDroppedFrames => _frameWriter?.DroppedOverflow ?? 0;

    // ── O3 callbacks do FrameWriter (rodam na thread FfmpegInput) ──────────

    private void OnFrameWrittenToStdin(TimeSpan pts)
    {
        // Só enfileira o PTS depois que o Write foi bem-sucedido — se falhar, o
        // EmitPacket() nunca desenfileiraria e o PTS ficaria órfão (sync corrompido).
        _inputPtsQueue.Enqueue(pts);
        _frameCount++;
        _restartAttempts = 0;
    }

    private void OnStdinWriteFailed(string cause, Exception? fault)
    {
        _processFailed = true;
        _processFailedCause = cause;
        if (fault != null)
            Log.E("FfmpegEncoder", $"stdin: {fault.Message}");
        else if (cause == "encoder:stdin_timeout")
            Log.W("FfmpegEncoder", "stdin write timeout — encoder não consome input, restartando");
        LogProcessExit();
    }

    // ── Codec fallback chain ─────────────────────────────────────────

    private bool TryFallbackCodec()
    {
        if (_fallbackChain == null || _fallbackChain.Count == 0) return false;

        // Move to next entry in the chain
        _currentFallbackIndex++;
        if (_currentFallbackIndex >= _fallbackChain.Count)
        {
            Log.E("FfmpegEncoder", "cascading fallback exhausted — no more entries in chain");
            return false;
        }

        var entry = _fallbackChain[_currentFallbackIndex];
        var oldCodec = _codec;
        _codec = entry.Codec;
        _scaleDivisor = entry.ScaleDivisor;
        _restartAttempts = 0;
        _restartsInWindow = 0;

        Log.W("FfmpegEncoder", $"cascading fallback: {oldCodec} (1/{(_scaleDivisor > 1 ? _scaleDivisor.ToString() : "full")}) → {entry.Label}");
        return true;
    }

    // ── Watchdog: auto-restart on crash ──────────────────────────────

    private bool TryRestart()
    {
        if (_disposed) return false;

        long now = Stopwatch.GetTimestamp();

        // Absolute restart limiter: max 10 restarts in 30-second window
        const int MaxRestartsInWindow = 10;
        const int WindowDurationSec = 30;
        if (_restartsInWindow == 0)
            _restartWindowStartTicks = now;
        double windowElapsedSec = (now - _restartWindowStartTicks) / Stopwatch.Frequency;
        if (windowElapsedSec > WindowDurationSec)
        {
            _restartsInWindow = 0;
            _restartWindowStartTicks = now;
        }
        if (_restartsInWindow >= MaxRestartsInWindow)
        {
            if (!TryFallbackCodec())
            {
                Log.E("FfmpegEncoder", $"max restarts in {WindowDurationSec}s window reached ({MaxRestartsInWindow}), no codec fallback");
                return false;
            }
        }

        long elapsedSec = (now - _lastRestartTicks) / Stopwatch.Frequency;
        int delaySec = 1 << Math.Min(_restartAttempts, 4);

        if (_restartAttempts > 0 && elapsedSec < delaySec)
        {
            // M1: descarte o pacote mais antigo SEM vazar o byte[] do pool
            if (_outputChannel.Reader.TryRead(out var backoffPkt))
                backoffPkt.Release();
            return false;
        }

        if (_restartAttempts >= 5)
        {
            if (!TryFallbackCodec())
            {
                Log.E("FfmpegEncoder", "max restart attempts reached, no codec fallback");
                return false;
            }
        }

        _restartAttempts++;
        _restartsInWindow++;
        Log.W("FfmpegEncoder", $"restarting ffmpeg (attempt {_restartAttempts}, window={_restartsInWindow}/{MaxRestartsInWindow}, cause={_processFailedCause ?? "unknown"}, gpuFails={_gpuConvertFails})");
        StopFfmpeg();
        ResetState();

        try
        {
            StartFfmpeg();
            _readerCts = new CancellationTokenSource();
            _readerThread = new Thread(() => ReaderLoop(_readerCts.Token))
            {
                IsBackground = true,
                Name = "FfmpegReader"
            };
            _readerThread.Start();
            _processFailed = false;
            _lastRestartTicks = Stopwatch.GetTimestamp();
            Log.I("FfmpegEncoder", "restart OK");
            return true;
        }
        catch (Exception ex)
        {
            Log.E("FfmpegEncoder", $"restart failed: {ex.Message}");
            return false;
        }
    }

    private void StopFfmpeg()
    {
        // O3: aborta o writer do stdin (frames enfileirados voltam ao pool sem escrita —
        // o pipe está morrendo; nenhum PTS órfão para o processo antigo).
        _frameWriter?.Stop(abort: true, joinMs: 2000);
        _frameWriter = null;
        _readerCts?.Cancel();
        _stderrCts?.Cancel();
        try { _stdin?.Dispose(); } catch { }
        try { _stdout?.Dispose(); } catch { }

        if (_process is { HasExited: false })
        {
            try { _process.Kill(entireProcessTree: true); } catch { }
            _process.WaitForExit(2000);
        }

        _readerThread?.Join(1000);
        _stderrThread?.Join(500);
        _readerCts?.Dispose();
        _stderrCts?.Dispose();
        _process?.Dispose();
        _readerCts = null;
        _stderrCts = null;
        _readerThread = null;
        _stderrThread = null;
        _process = null;
        _stdin = null;
        _stdout = null;
    }

    private void ResetState()
    {
        _processFailed = false;
        _processFailedCause = null;
        _gpuConvertFails = 0;
        _gpuBusyDrops = 0;
        _lastFrameBusyDrop = false;
        _frameCount = 0;
        _outputFrameIndex = 0;
        _lastRealPtsTicks = -1;
        _hadSlice = false;
        _hadRawSlice = false;
        _pendingTooLarge = false;
        _loggedParseAvcc = false;
        _pipeFormat = PipeFormat.Unknown;
        if (_pendingBuf != null)
        {
            ArrayPool<byte>.Shared.Return(_pendingBuf);
            _pendingBuf = null;
        }
        // Return raw buffer if rented to avoid ArrayPool leaks
        if (_rawBuf != null)
        {
            ArrayPool<byte>.Shared.Return(_rawBuf);
            _rawBuf = null;
            _rawLen = 0;
        }
        _pendingLen = 0;
        while (_pendingOutputs.Count > 0)
            _pendingOutputs.Dequeue().Release();

        while (_inputPtsQueue.TryDequeue(out _)) { }

        while (_outputChannel.Reader.TryRead(out var pkt))
            pkt.Release();

        // Fresh GPU converter after each restart to avoid stale MFT state
        _gpuConverter?.Dispose();
        _gpuConverter = null;
        _gpuConverterFailedUntil = DateTime.MinValue;
        _nv12Staging?.Dispose();
        _nv12Staging = null;
        _inputCopy?.Dispose();
        _inputCopy = null;
        _cpuStaging?.Dispose();
        _cpuStaging = null;
        _cpuStagingW = 0;
        _cpuStagingH = 0;
        _ivfHeaderParsed = false;
        _ivfTimebaseDen = 0;
        _ivfTimebaseNum = 0;
    }

    // ── GPU NV12 conversion (moved to FfmpegEncoder.GpuConvert.cs) ──

    // ── Cleanup ──────────────────────────────────────────────────────

    private void LogProcessExit()
    {
        if (_process == null) return;
        try
        {
            if (_process.HasExited)
                Log.W("FfmpegEncoder", $"ffmpeg exited code={_process.ExitCode}");
        }
        catch { }
    }

    public void Flush()
    {
        // L2: não reiniciar ffmpeg se o encoder já foi encerrado (stop/dispose) ou
        // se o processo nunca chegou a iniciar. Respawning após dispose criaria um
        // processo órfão sem dono. Os pacotes ainda pendentes no channel são drenados
        // para _pendingOutputs (consumido pelo save), independente do estado do processo.
        bool canRestart = !_disposed && _process != null;

        // O3: drena os frames ainda enfileirados no writer ANTES de fechar o stdin —
        // frames pendentes do clip não podem ser perdidos no EOF.
        _frameWriter?.Stop(abort: false, joinMs: 5000);

        // Close stdin to signal EOF to ffmpeg (like the working PowerShell test)
        try { _stdin?.Dispose(); } catch { }

        // Wait for reader thread to finish (ffmpeg will close stdout after EOF on stdin)
        if (_readerThread?.IsAlive == true)
            _readerThread.Join(5000);

        // Emit any remaining packet
        if (_pendingLen > 0 && _hadSlice)
            EmitPacket();

        // Collect remaining packets from the channel
        while (_outputChannel.Reader.TryRead(out var pkt))
            _pendingOutputs.Enqueue(pkt);

        if (!canRestart)
            return;

        // Restart ffmpeg for next capture session
        StopFfmpeg();
        ResetState();
        StartFfmpeg();
        _readerCts = new CancellationTokenSource();
        _readerThread = new Thread(() => ReaderLoop(_readerCts.Token))
        {
            IsBackground = true,
            Name = "FfmpegReader"
        };
        _readerThread.Start();
    }

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;

        _frameWriter?.Stop(abort: true, joinMs: 1000);
        _frameWriter = null;
        _readerCts?.Cancel();
        _stderrCts?.Cancel();
        try { _stdin?.Dispose(); } catch { }

        if (_process is { HasExited: false })
        {
            try { _process.Kill(entireProcessTree: true); } catch { }
            _process.WaitForExit(2000);
        }

        _readerThread?.Join(1000);
        _stderrThread?.Join(500);
        _readerCts?.Dispose();
        _stderrCts?.Dispose();
        _process?.Dispose();
        _gpuConverter?.Dispose();
        _nv12Staging?.Dispose();
        _inputCopy?.Dispose();
        _cpuStaging?.Dispose();

        // Release pooled buffers and packets to prevent ArrayPool leaks
        if (_pendingBuf != null)
        {
            ArrayPool<byte>.Shared.Return(_pendingBuf);
            _pendingBuf = null;
        }
        if (_rawBuf != null)
        {
            ArrayPool<byte>.Shared.Return(_rawBuf);
            _rawBuf = null;
        }
        _pendingLen = 0;
        _rawLen = 0;

        while (_pendingOutputs.Count > 0)
            _pendingOutputs.Dequeue().Release();

        while (_inputPtsQueue.TryDequeue(out _)) { }

        while (_outputChannel.Reader.TryRead(out var pkt))
            pkt.Release();
    }
}
