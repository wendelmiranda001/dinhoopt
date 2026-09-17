using System.Diagnostics;

namespace DiNho.Capture.Poc.Audio;

public sealed class AudioBuffer
{
    public float[] Samples { get; }
    public int SampleRate { get; }
    public int Channels { get; }
    /// <summary>High-resolution monotonic timestamp (Stopwatch ticks) stamped at capture time.
    /// Used for A/V sync — both audio and video PTS derive from the same MasterClock which
    /// is also Stopwatch-based, eliminating DateTime/Stopwatch drift.</summary>
    public long CaptureTicks { get; init; } = Stopwatch.GetTimestamp();

    public AudioBuffer(float[] samples, int sampleRate, int channels)
    {
        Samples = samples;
        SampleRate = sampleRate;
        Channels = channels;
    }
}

public interface IAudioSource : IDisposable
{
    int SampleRate { get; }
    int Channels { get; }
    event Action<AudioBuffer> OnAudioData;
    void Start();
    void Stop();
}
