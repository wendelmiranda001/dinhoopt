using DiNho.Capture.Poc.Audio;
using DiNho.Capture.Poc.Encoders;
using DiNho.Capture.Poc.Sync;

namespace DiNho.Capture.Poc.Tests;

public sealed class AudioMixerTests
{
    [Fact]
    public void Mix_StereoLoopback_StereoMic_Sums()
    {
        var loopback = new float[] { 0.05f, 0.02f, 0.03f, -0.02f };
        var mic = new float[] { 0.05f, 0.03f, 0.02f, 0.01f };
        var result = AudioMixer.Mix(loopback, 2, mic, micGain: 4.0f);

        Assert.Equal(4, result.Length);
        Assert.Equal(0.2449f, result[0], 4);  // tanh(0.25)
        Assert.Equal(0.2165f, result[1], 4);  // tanh(0.22)
        Assert.Equal(0.1489f, result[2], 4);  // tanh(0.15)
        Assert.Equal(0.0997f, result[3], 4);  // tanh(0.10)
    }

    [Fact]
    public void Mix_StereoLoopback_MonoMic_Upmixes()
    {
        var loopback = new float[] { 0.05f, 0.02f, 0.03f, -0.02f };
        var mic = new float[] { 0.05f, 0.03f };
        var result = AudioMixer.Mix(loopback, 2, mic, micGain: 4.0f);

        Assert.Equal(4, result.Length);
        Assert.Equal(0.2449f, result[0], 4);  // tanh(0.05 + 0.05*4)
        Assert.Equal(0.2165f, result[1], 4);  // tanh(0.02 + 0.05*4)
        Assert.Equal(0.1489f, result[2], 4);  // tanh(0.03 + 0.03*4)
        Assert.Equal(0.0997f, result[3], 4);  // tanh(-0.02 + 0.03*4)
    }

    [Fact]
    public void Mix_ClampsToRange()
    {
        var loopback = new float[] { 0.9f };
        var mic = new float[] { 0.8f };
        var result = AudioMixer.Mix(loopback, 1, mic);

        Assert.Single(result);
        Assert.Equal(0.9354f, result[0], 4); // tanh(1.7)
    }

    [Fact]
    public void Mix_ShorterMic_Loops()
    {
        var loopback = new float[] { 0.05f, 0.1f, 0.15f };
        var mic = new float[] { 0.04f };
        var result = AudioMixer.Mix(loopback, 1, mic, micGain: 4.0f);

        Assert.Equal(3, result.Length);
        Assert.Equal(0.2070f, result[0], 3); // tanh(0.05 + 0.04*4)
        Assert.Equal(0.0997f, result[1], 3); // tanh(0.10)
        Assert.Equal(0.1489f, result[2], 3); // tanh(0.15)
    }

    // --- New tests ---

    [Fact]
    public void Mix_NaNInLoopback_IsFiltered()
    {
        var loopback = new float[] { 0.1f, float.NaN, 0.3f };
        var mic = new float[] { 0.05f, 0.05f, 0.05f };
        var result = AudioMixer.Mix(loopback, 1, mic, micGain: 1.0f);

        Assert.Equal(3, result.Length);
        Assert.Equal(0.1489f, result[0], 3); // tanh(0.15)
        Assert.Equal(0.0f, result[1], 3);    // NaN in loopback → 0
        Assert.Equal(0.3364f, result[2], 3); // tanh(0.35)
    }

    [Fact]
    public void Mix_NaNInMic_IsFiltered()
    {
        var loopback = new float[] { 0.1f, 0.2f };
        var mic = new float[] { 0.05f, float.NaN };
        var result = AudioMixer.Mix(loopback, 1, mic, micGain: 1.0f);

        Assert.Equal(2, result.Length);
        Assert.Equal(0.1489f, result[0], 3); // tanh(0.15)
        Assert.Equal(0.0f, result[1], 3);    // NaN in mic → 0
    }

    [Fact]
    public void Mix_GainScaling_AppliedToMicOnly()
    {
        var loopback = new float[] { 0.1f, 0.1f };
        var mic = new float[] { 0.1f, 0.1f };

        var resultLow = AudioMixer.Mix(loopback, 1, mic, micGain: 0.5f);
        var resultHigh = AudioMixer.Mix(loopback, 1, mic, micGain: 2.0f);

        Assert.Equal(0.1489f, resultLow[0], 3);  // tanh(0.15)
        Assert.Equal(0.2913f, resultHigh[0], 3); // tanh(0.3)
    }

    [Fact]
    public void Mix_ZeroGain_MicSilent()
    {
        var loopback = new float[] { 0.2f, 0.3f };
        var mic = new float[] { 0.9f, 0.9f };
        var result = AudioMixer.Mix(loopback, 1, mic, micGain: 0.0f);

        Assert.Equal(2, result.Length);
        Assert.Equal(0.1974f, result[0], 3); // tanh(0.2)
        Assert.Equal(0.2913f, result[1], 3); // tanh(0.3)
    }

    [Fact]
    public void Mix_EmptyLoopback_ReturnsEmpty()
    {
        var result = AudioMixer.Mix([], 2, [0.1f, 0.2f], micGain: 1.0f);
        Assert.Empty(result);
    }

    [Fact]
    public void Mix_AllNaNs_ProducesSilence()
    {
        var loopback = new float[] { float.NaN, float.NaN };
        var mic = new float[] { float.NaN, float.NaN };
        var result = AudioMixer.Mix(loopback, 1, mic, micGain: 1.0f);

        Assert.Equal(2, result.Length);
        Assert.Equal(0.0f, result[0], 3);
        Assert.Equal(0.0f, result[1], 3);
    }

    // --- Resiliência sem loopback (SOMENTE VÍDEO / loopback indisponível) ---
    // Regressão do HIGH do code review 7edd3b0: ctor/Start/Stop/Dispose
    // dereferenciavam _loopbackSource incondicionalmente → NRE quando
    // CreateLoopbackSource retorna null (nenhum device de render).

    private sealed class FakeAudioSource : IAudioSource
    {
        public int SampleRate { get; }
        public int Channels { get; }
        public event Action<AudioBuffer>? OnAudioData;
        public FakeAudioSource(int sampleRate = 48000, int channels = 2)
        {
            SampleRate = sampleRate;
            Channels = channels;
        }
        public void Start() {
            OnAudioData = _ => { };
        }
        public void Stop() { }
        public void Dispose() { }
    }

    [Fact]
    public void Ctor_AllSourcesNull_DoesNotThrow()
    {
        using var clock = new MasterClock();
        using var mixer = new AudioMixer(null, null, clock);
        Assert.NotNull(mixer);
    }

    [Fact]
    public void Ctor_LoopbackNull_MicPresent_DoesNotThrow()
    {
        using var clock = new MasterClock();
        using var mic = new FakeAudioSource(44100, 1);
        using var mixer = new AudioMixer(null, mic, clock);
        Assert.NotNull(mixer);
    }

    [Fact]
    public void Start_AllSourcesNull_DoesNotThrow()
    {
        using var clock = new MasterClock();
        using var mixer = new AudioMixer(null, null, clock);
        mixer.Start();
    }

    [Fact]
    public void Start_LoopbackNull_UsesMicSampleRate()
    {
        using var clock = new MasterClock();
        using var mic = new FakeAudioSource(44100, 1);
        using var mixer = new AudioMixer(null, mic, clock);
        mixer.Start();
        Assert.Equal(44100, mixer.SampleRate);
        Assert.Equal(1, mixer.Channels);
    }

    [Fact]
    public void Start_LoopbackNull_UsesDefaultSampleRateWhenNoMic()
    {
        using var clock = new MasterClock();
        using var mixer = new AudioMixer(null, null, clock);
        mixer.Start();
        Assert.Equal(48000, mixer.SampleRate);
        Assert.Equal(2, mixer.Channels);
    }

    [Fact]
    public void Stop_AllSourcesNull_DoesNotThrow()
    {
        using var clock = new MasterClock();
        using var mixer = new AudioMixer(null, null, clock);
        mixer.Start();
        mixer.Stop();
    }

    [Fact]
    public void Dispose_AllSourcesNull_DoesNotThrow()
    {
        using var clock = new MasterClock();
        var mixer = new AudioMixer(null, null, clock);
        mixer.Dispose();
    }

    [Fact]
    public void Dispose_LoopbackNull_MicPresent_DoesNotThrow()
    {
        using var clock = new MasterClock();
        using var mic = new FakeAudioSource(44100, 1);
        var mixer = new AudioMixer(null, mic, clock);
        mixer.Dispose();
    }

    // ── 4.1 UpmixMonoToStereo: avanço da fila do mic = amostras consumidas ──

    [Fact]
    public void UpmixMonoToStereo_WritesPairs_ReturnsTwoPerSample()
    {
        var mic = new float[] { 0.1f, 0.2f, 0.3f, 0.4f };
        var dest = new float[8];
        int written = AudioMixer.UpmixMonoToStereo(mic, 0, 4, dest, 0, 8);

        Assert.Equal(8, written); // consumiu 4 amostras mono
        Assert.Equal(new float[] { 0.1f, 0.1f, 0.2f, 0.2f, 0.3f, 0.3f, 0.4f, 0.4f }, dest);
    }

    [Fact]
    public void UpmixMonoToStereo_MicLongerThanDest_WritesOnlyCapacity()
    {
        var mic = new float[16];
        for (int i = 0; i < 16; i++) mic[i] = i + 1;
        var dest = new float[4];
        int written = AudioMixer.UpmixMonoToStereo(mic, 0, 16, dest, 0, 4);

        Assert.Equal(4, written); // consumiu só 2 — o que cabe em 4 slots
        Assert.Equal(1f, dest[0]);
        Assert.Equal(1f, dest[1]);
        Assert.Equal(2f, dest[2]);
        Assert.Equal(2f, dest[3]);
    }

    [Fact]
    public void UpmixMonoToStereo_RespectsOffset()
    {
        var mic = new float[] { 0.9f, 0.1f, 0.2f };
        var dest = new float[6];
        int written = AudioMixer.UpmixMonoToStereo(mic, 1, 2, dest, 2, 6);

        Assert.Equal(4, written);
        Assert.Equal(new float[] { 0f, 0f, 0.1f, 0.1f, 0.2f, 0.2f }, dest);
    }

    [Fact]
    public void UpmixMonoToStereo_NoSpaceOrNoTake_ReturnsZero()
    {
        var dest = new float[2];
        Assert.Equal(0, AudioMixer.UpmixMonoToStereo(new[] { 1f }, 0, 1, dest, 2, 2));
        Assert.Equal(0, AudioMixer.UpmixMonoToStereo(new[] { 1f }, 0, 0, dest, 0, 2));
    }

    // Regressão 4.1: mic com MUITO mais amostras que o dest — o antigo avançava
    // newOffset pelo take inteiro, pulando amostras que jamais seriam tocadas.

    [Fact]
    public void TryMix_UpmixConsumesExactlyWhatFits_NoMicSamplesLost()
    {
        using var clock = new MasterClock();
        using var loop = new RaisingSource(48000, 2);
        using var micSource = new RaisingSource(48000, 1);
        using var mixer = new AudioMixer(loop, micSource, clock);
        EncodedPacket? captured = null;
        mixer.OnMixedAudio += p => captured = p;

        mixer.Start();
        mixer.MicEnabled = true;

        // loopback stereo: 8 floats = 4 frames
        var stereo = new float[8];
        // mic mono com 8 amostras — deveria escrever 4 pares (consumir 4 amostras) e
        // RE-ENFILEIRAR as 4 restantes (PTS do próximo frame do loopback preenche)
        var monoMic = new float[8];
        for (int i = 0; i < 8; i++) monoMic[i] = i + 1;

        micSource.Raise(new AudioBuffer(monoMic, 48000, 1));
        loop.Raise(new AudioBuffer(stereo, 48000, 2));

        Assert.NotNull(captured);
        Assert.Equal(8, captured!.PcmSamples!.Length);
    }

    // ── 4.6 CalcDuration: canais REAIS do buffer, não _channels ──

    [Fact]
    public void CalcDuration_MonoIsHalfOfStereo()
    {
        Assert.Equal(TimeSpan.FromMilliseconds(20), AudioMixer.CalcDuration(960, 48000, 1));
        Assert.Equal(TimeSpan.FromMilliseconds(10), AudioMixer.CalcDuration(960, 48000, 2));
    }

    [Fact]
    public void CalcDuration_InvalidArgs_ReturnsZeroOrStereoFallback()
    {
        Assert.Equal(TimeSpan.Zero, AudioMixer.CalcDuration(0, 48000, 2));
        Assert.Equal(TimeSpan.Zero, AudioMixer.CalcDuration(100, 0, 2));
        Assert.Equal(AudioMixer.CalcDuration(960, 48000, 2), AudioMixer.CalcDuration(960, 48000, 0));
    }

    [Fact]
    public void EmitPacket_DurationUsesActualBufferChannels_NotSourceChannels()
    {
        using var clock = new MasterClock();
        // Source declara stereo (2) mas entrega buffer MONO — cenário do achado 4.6.
        using var loop = new RaisingSource(48000, 2);
        using var mixer = new AudioMixer(loop, null, clock);
        EncodedPacket? captured = null;
        mixer.OnMixedAudio += p => captured = p;

        mixer.Start();
        loop.Raise(new AudioBuffer(new float[960], 48000, 1)); // 960 mono = 20ms

        Assert.NotNull(captured);
        // Antes usava _channels=2 → 10ms (errado). Agora lê buffer.Channels=1 → 20ms.
        Assert.Equal(TimeSpan.FromMilliseconds(20), captured.Duration);
    }

    private sealed class RaisingSource : IAudioSource
    {
        public int SampleRate { get; }
        public int Channels { get; }
        public RaisingSource(int sampleRate, int channels)
        {
            SampleRate = sampleRate;
            Channels = channels;
        }
        public event Action<AudioBuffer>? OnAudioData;
        public void Raise(AudioBuffer buffer) => OnAudioData?.Invoke(buffer);
        public void Start() { }
        public void Stop() { }
        public void Dispose() { }
    }
}
