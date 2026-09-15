using System.Buffers;
using System.Diagnostics;
using DiNho.Capture.Poc.Encoders;
using DiNho.Capture.Poc.Logging;
using DiNho.Capture.Poc.Sync;

namespace DiNho.Capture.Poc.Audio;

public enum AudioStreamKind { Game, Mic, Mixed }

/// <summary>
/// Mistura áudio de jogo (loopback) com microfone opcional com noise suppression.
/// Emite pacotes PCM float32 via OnMixedAudio para o encoder AAC.
///
/// Fluxo:
///   [CppLoopbackSource | WasapiLoopbackSource] → OnLoopbackData → _loopbackQueue
///   [WasapiMicSource] → OnMicData → RnnoiseFilter (opcional) → _micQueue
///   TryMix: drena _loopbackQueue, mistura com mic proporcional, emite EncodedPacket
/// </summary>
public sealed class AudioMixer : IDisposable
{
    // Fontes
    private readonly IAudioSource? _loopbackSource;
    private readonly IAudioSource? _micSource;
    private readonly MasterClock _clock;

    // Filas internas — protegidas por _lock
    private readonly Queue<(AudioBuffer Buffer, TimeSpan Pts)> _loopbackQueue = new();
    private readonly Queue<(float[] Samples, int Offset, int Length, TimeSpan Pts)> _micQueue = new();
    private readonly Lock _lock = new();

    // Configuração (thread-safe via propriedades)
    private volatile bool _micEnabled;
    private int _sampleRate = 48000;
    private int _channels = 2;
    private RnnoiseFilter? _noiseFilter;
    private MaxineAfxFilter? _maxineFilter;
    private float _gameGain = 1.0f;
    private float _micGain = 1.0f;

    // Log throttle — separados por contexto
    private long _lastEmitLogTick;
    private long _lastSyncLogTick;
    private int _emittedPackets;
    private static readonly long LogThrottleTicks = Stopwatch.Frequency / 2; // 500ms

    // Capacidades das filas
    private const int MaxLoopbackQueue = 512;  // ~5s a 48kHz/960frames
    private const int MaxMicQueue = 256;        // ~2.5s

    // Noise gate — atenua mic quando nível cai abaixo do threshold
    private float _micGateEnvelope;
    private const float MicGateThreshold = 0.008f; // ~-42 dBFS
    private const float MicGateAttack = 0.4f;      // abertura rápida (~5ms)
    private const float MicGateRelease = 0.015f;   // fechamento suave (~130ms)
    private const float MicGateFloor = 0f;         // mudo quando gated

    // Propriedades públicas
    public float GameGain
    {
        get => _gameGain;
        set => _gameGain = Math.Clamp(value, 0f, 4f);
    }
    public float MicGain
    {
        get => _micGain;
        set => _micGain = Math.Clamp(value, 0f, 4f);
    }
    public bool MicEnabled
    {
        get => _micEnabled;
        set
        {
            if (_micEnabled == value) return;
            _micEnabled = value;
            lock (_lock)
            {
                _micQueue.Clear();
                if (!value) _loopbackQueue.Clear(); // descarta acúmulo ao desativar
            }
            Log.I("AudioMixer", $"Mic {(value ? "ativado" : "desativado")}");
        }
    }
    public bool NoiseSuppressionEnabled
    {
        get => _noiseFilter?.Active == true || _maxineFilter?.Active == true;
        set
        {
            if (value == (_noiseFilter?.Active == true || _maxineFilter?.Active == true)) return;
            
            // Dispose existing filters
            _noiseFilter?.Dispose();
            _maxineFilter?.Dispose();
            _noiseFilter = null;
            _maxineFilter = null;
            
            if (value)
            {
                // Try Maxine AFX first (RTX GPU), fallback to RNNoise
                var maxineFilter = new MaxineAfxFilter(_sampleRate, _channels);
                if (maxineFilter.IsMaxineAvailable)
                {
                    _maxineFilter = maxineFilter;
                    Log.I("AudioMixer", $"NoiseSuppression ON (Maxine AFX)");
                }
                else
                {
                    // Maxine not available, dispose and use RNNoise
                    maxineFilter.Dispose();
                    _noiseFilter = new RnnoiseFilter(_sampleRate, _channels);
                    Log.I("AudioMixer", $"NoiseSuppression ON (RNNoise fallback)");
                }
            }
            else
            {
                Log.I("AudioMixer", $"NoiseSuppression OFF");
            }
        }
    }
    public int SampleRate => _sampleRate;
    public int Channels => _channels;

    // Eventos
    public event Action<EncodedPacket>? OnMixedAudio;
    public event Action<float>? OnMicLevel;

    public AudioMixer(IAudioSource? loopbackSource, IAudioSource? micSource, MasterClock clock)
    {
        _loopbackSource = loopbackSource;
        _micSource = micSource;
        _clock = clock;

        if (_loopbackSource != null)
            _loopbackSource.OnAudioData += OnLoopbackData;
        if (_micSource != null)
            _micSource.OnAudioData += OnMicData;
    }

    public void Start()
    {
        _loopbackSource?.Start();
        _micSource?.Start();

        // Sem loopback (nenhum device de render) — deriva sample rate/canais do mic
        // quando disponível, senão defaults. TryMix só emite quando há dados de
        // loopback, então com ambos null a captura é SOMENTE VÍDEO.
        _sampleRate = _loopbackSource?.SampleRate ?? _micSource?.SampleRate ?? 48000;
        _channels = _loopbackSource?.Channels ?? _micSource?.Channels ?? 2;
        Log.I("AudioMixer",
            $"Iniciado: SR={_sampleRate} Ch={_channels} " +
            $"loopback={_loopbackSource?.GetType().Name ?? "none"} " +
            $"mic={_micSource?.GetType().Name ?? "none"}");
    }

    public void Stop()
    {
        _loopbackSource?.Stop();
        _micSource?.Stop();
        lock (_lock)
        {
            _loopbackQueue.Clear();
            _micQueue.Clear();
        }
    }

    private void OnLoopbackData(AudioBuffer buf)
    {
        // Use Stopwatch-based capture timestamp for A/V sync — same clock as video
        var pts = _clock.FromTimestamp(buf.CaptureTicks);

        lock (_lock)
        {
            if (_loopbackQueue.Count >= MaxLoopbackQueue)
                _loopbackQueue.Dequeue(); // descarta o mais antigo
            _loopbackQueue.Enqueue((buf, pts));
        }
        TryMix();
    }

    private void OnMicData(AudioBuffer buf)
    {
        // Nível do mic — sempre, independente de estar habilitado (para VU meter no UI)
        float peak = 0f;
        foreach (var s in buf.Samples)
        {
            var abs = MathF.Abs(s);
            if (abs > peak) peak = abs;
        }
        OnMicLevel?.Invoke(peak);

        if (!_micEnabled) return;

        // Capture local references to prevent use-after-dispose race:
        // NoiseSuppressionEnabled setter may dispose filters concurrently
        var maxine = _maxineFilter;
        var rnnoise = _noiseFilter;

        // Aplica noise suppression se ativo (Maxine AFX ou RNNoise)
        float[] samples;
        if (maxine?.Active == true)
            samples = maxine.Process(buf.Samples);
        else if (rnnoise?.Active == true)
            samples = rnnoise.Process(buf.Samples);
        else
            samples = buf.Samples;

        // Noise gate — retorna array NOVO para não corromper buffer original
        samples = ApplyMicGate(samples);

        var pts = _clock.FromTimestamp(buf.CaptureTicks);

        lock (_lock)
        {
            if (_micQueue.Count >= MaxMicQueue)
                _micQueue.Dequeue();
            _micQueue.Enqueue((samples, 0, samples.Length, pts));
        }
        TryMix();
    }

    private void TryMix()
    {
        (AudioBuffer Buffer, TimeSpan Pts) loopback;
        float[]? micOut = null;

        lock (_lock)
        {
            if (_loopbackQueue.Count == 0) return;
            loopback = _loopbackQueue.Dequeue();

            if (_micEnabled)
            {
                int needed = loopback.Buffer.Samples.Length;
                micOut = ArrayPool<float>.Shared.Rent(needed);
                int filled = 0;

                while (filled < needed && _micQueue.Count > 0)
                {
                    var (samples, offset, length, pts) = _micQueue.Peek();
                    int take = Math.Min(length - offset, needed - filled);
                    int consumed;

                    // Upmix mono mic para stereo loopback se necessário.
                    // Cada amostra mono vira um par (L,R) — o avanço da fila deve refletir
                    // quantas amostras foram REALMENTE escritas. O código antigo avançava
                    // newOffset = offset + take (inteiro), pulando ~metade do mic buffer
                    // sempre que a fila do mic excedia needed/2 (dropouts silenciosos).
                    if (_channels == 2 && loopback.Buffer.Channels == 2)
                    {
                        int written = UpmixMonoToStereo(samples, offset, take, micOut, filled, needed);
                        filled += written;
                        consumed = written / 2;
                    }
                    else
                    {
                        Array.Copy(samples, offset, micOut, filled, take);
                        filled += take;
                        consumed = take;
                    }

                    int newOffset = offset + consumed;
                    _micQueue.Dequeue();
                    if (newOffset < length)
                    {
                        // Reinsere o restante sem alocar novo array
                        _micQueue.Enqueue((samples, newOffset, length, pts));
                    }
                }

                // Silêncio para o restante se mic não tiver amostras suficientes
                if (filled < needed)
                    Array.Clear(micOut, filled, needed - filled);

                // Log de drift A/V do mic (throttled)
                var now = Stopwatch.GetTimestamp();
                if (now - _lastSyncLogTick >= LogThrottleTicks)
                {
                    _lastSyncLogTick = now;
                    if (_micQueue.Count > 0)
                    {
                        var (_, _, _, micPts) = _micQueue.Peek();
                        var drift = (micPts - loopback.Pts).TotalMilliseconds;
                        Log.D("AudioMixer",
                            $"MicDrift={drift:+0.0;-0.0}ms loopbackQ={_loopbackQueue.Count} micQ={_micQueue.Count}");
                    }
                }
            }
        }

        float[] outSamples;
        bool pooled = false;
        if (micOut != null)
        {
            try
            {
                outSamples = MixSamples(loopback.Buffer.Samples, micOut,
                    loopback.Buffer.Samples.Length, _gameGain, _micGain);
                pooled = true;
            }
            finally
            {
                ArrayPool<float>.Shared.Return(micOut);
            }
        }
        else
        {
            // Só jogo — sanitize NaN/Inf before sending to encoder
            if (_gameGain == 1.0f)
            {
                // Check for NaN/Inf — replace with silence to prevent encoder crash
                bool hasBad = false;
                for (int i = 0; i < loopback.Buffer.Samples.Length; i++)
                {
                    if (float.IsNaN(loopback.Buffer.Samples[i]) || float.IsInfinity(loopback.Buffer.Samples[i]))
                    {
                        hasBad = true;
                        break;
                    }
                }
                if (hasBad)
                {
                    // ArrayPool.Rent returns arrays LARGER than requested without zeroing extras.
                    int len = loopback.Buffer.Samples.Length;
                    outSamples = new float[len];
                    Array.Copy(loopback.Buffer.Samples, outSamples, len);
                    for (int i = 0; i < len; i++)
                        if (float.IsNaN(outSamples[i]) || float.IsInfinity(outSamples[i]))
                            outSamples[i] = 0f;
                    pooled = true;
                }
                else
                {
                    outSamples = loopback.Buffer.Samples;
                }
            }
            else
            {
                outSamples = ApplyGain(loopback.Buffer.Samples, _gameGain);
                pooled = true;
            }
        }

        EmitPacket(outSamples, loopback.Pts,
            micOut != null ? AudioStreamKind.Mixed : AudioStreamKind.Game, pooled, loopback.Buffer.Channels);
    }

    /// <summary>
    /// Mistura loopback + mic com ganhos independentes.
    /// Usa SoftClip (tanh) — curva C∞ suave sem aliasing.
    /// </summary>
    /// <summary>
    /// Wrapper preservado para compatibilidade com testes existentes.
    /// Converte mic per-frame para upmix stereo e delega a MixSamples.
    /// </summary>
    internal static float[] Mix(float[] loopbackSamples, int loopbackChannels,
                                 float[] micSamples, float gameGain = 1.0f, float micGain = 1.0f)
    {
        int frames = loopbackSamples.Length / loopbackChannels;
        var upmixed = new float[loopbackSamples.Length];
        for (int i = 0; i < upmixed.Length; i++)
        {
            int frame = i / loopbackChannels;
            upmixed[i] = frame < micSamples.Length ? micSamples[frame] : 0f;
        }
        return MixSamples(loopbackSamples, upmixed, loopbackSamples.Length, gameGain, micGain);
    }

    internal static float[] MixSamples(float[] game, float[] mic, int length,
                                        float gameGain, float micGain)
    {
        var result = new float[length];
        for (int i = 0; i < length; i++)
        {
            float g = i < game.Length ? game[i] : 0f;
            float m = i < mic.Length ? mic[i] : 0f;
            float mixed = g * gameGain + m * micGain;
            result[i] = float.IsNaN(mixed) ? 0f : SoftClip(mixed);
        }
        return result;
    }

    /// <summary>
    /// Espera-se capacity PAR (frames stereo) nesta chamada — cada amostra mono
    /// vira um par (L,R). Retorna quantos floats foram escritos em dest (= 2×consumed).
    /// O CÓDIGO DE CHAMADA deve avançar a fila do mic exatamente por consumed,
    /// não por take — caso contrário amostras do mic são puladas.
    /// </summary>
    internal static int UpmixMonoToStereo(float[] mic, int offset, int take,
        float[] dest, int start, int capacity)
    {
        if (take <= 0 || start >= capacity)
            return 0;
        int maxPairs = Math.Min(take, (capacity - start) / 2);
        for (int i = 0; i < maxPairs; i++)
        {
            float s = mic[offset + i];
            dest[start++] = s;
            dest[start++] = s;
        }
        return maxPairs * 2;
    }

    private static float[] ApplyGain(float[] samples, float gain)
    {
        var result = new float[samples.Length];
        for (int i = 0; i < samples.Length; i++)
        {
            float v = samples[i] * gain;
            result[i] = float.IsNaN(v) ? 0f : SoftClip(v);
        }
        return result;
    }

    internal static float SoftClip(float x)
    {
        // Tanh real (MathF.Tanh retorna o tanh matemático, não uma aproximação)
        // Para |x| < 0.5: quase linear (preserva dynamics)
        // Para |x| > 0.5: satura suavemente (sem harmônicos agressivos)
        return MathF.Tanh(x);
    }

    /// <summary>
    /// Noise gate no sinal do mic.
    /// Retorna array NOVO — nunca modifica o input in-place.
    /// Envelope follower por buffer (20ms) + ganho suave.
    /// </summary>
    private float[] ApplyMicGate(float[] input)
    {
        // Peak do buffer
        float peak = 0f;
        for (int i = 0; i < input.Length; i++)
        {
            var abs = MathF.Abs(input[i]);
            if (abs > peak) peak = abs;
        }

        // Envelope follower — attack rápido, release lento
        if (peak > _micGateEnvelope)
            _micGateEnvelope += MicGateAttack * (peak - _micGateEnvelope);
        else
            _micGateEnvelope += MicGateRelease * (peak - _micGateEnvelope);

        // Ganho do gate — rampa linear entre floor e 1.0
        float gateGain = _micGateEnvelope < MicGateThreshold
            ? MicGateFloor
            : MathF.Min(1f, _micGateEnvelope / (MicGateThreshold * 2f));

        // Gate totalmente aberto — retorna referência direta (sem cópia)
        if (gateGain >= 1f)
            return input;

        // Gate ativo — copia e aplica ganho (nunca modifica input)
        var output = new float[input.Length];
        for (int i = 0; i < input.Length; i++)
            output[i] = input[i] * gateGain;
        return output;
    }

    /// <summary>
    /// Duração de um lote de amostras. Honra os canais REAIS do buffer (o antigo
    /// usava _channels, que erra quando o loopback é mono e _channels ficou em 2).
    /// </summary>
    internal static TimeSpan CalcDuration(int sampleCount, int sampleRate, int channels)
    {
        int effCh = channels > 0 ? channels : 2;
        if (sampleCount <= 0 || sampleRate <= 0)
            return TimeSpan.Zero;
        return TimeSpan.FromSeconds(sampleCount / (double)(sampleRate * effCh));
    }

    private void EmitPacket(float[] samples, TimeSpan pts, AudioStreamKind kind, bool isPooled = false, int channels = 0)
    {
        _emittedPackets++;
        var duration = CalcDuration(samples.Length, _sampleRate, channels > 0 ? channels : _channels);
        var packet = new EncodedPacket(samples, MediaType.Audio, pts, duration, isPooled: isPooled);

        var now = Stopwatch.GetTimestamp();
        if (_emittedPackets <= 5 || now - _lastEmitLogTick >= LogThrottleTicks)
        {
            _lastEmitLogTick = now;
            Log.D("AudioMixer",
                $"EmitPacket #{_emittedPackets} kind={kind} " +
                $"samples={samples.Length} dur={duration.TotalSeconds:F4}s " +
                $"pts={pts.TotalSeconds:F3}s");
        }

        OnMixedAudio?.Invoke(packet);
    }

    public void Dispose()
    {
        Stop();
        if (_loopbackSource != null)
            _loopbackSource.OnAudioData -= OnLoopbackData;
        if (_micSource != null)
            _micSource.OnAudioData -= OnMicData;
        (_loopbackSource as IDisposable)?.Dispose();
        (_micSource as IDisposable)?.Dispose();
        _noiseFilter?.Dispose();
        _noiseFilter = null;
        _maxineFilter?.Dispose();
        _maxineFilter = null;
    }
}
