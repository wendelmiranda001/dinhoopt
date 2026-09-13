using System.IO;
using NAudio.Wave;

namespace DiNho.Capture.Poc.Audio;

/// <summary>
/// Plays short notification sounds via NAudio WaveOut.
/// All sounds are generated programmatically (no .wav files needed).
/// </summary>
public static class NotificationSound
{
    private const int SampleRate = 48000;

    /// <summary>
    /// Crystal Ping v5 — clip saved confirmation.
    /// 1336Hz (-2 semitones) → 1061Hz (-6 semitones), 0.70s total.
    /// </summary>
    public static void PlayClipSaved()
    {
        try
        {
            var samples = GenerateCrystalPingV5();
            PlaySamples(samples);
        }
        catch
        {
            // Notification sounds are cosmetic — never crash the caller
        }
    }

    private static float[] GenerateCrystalPingV5()
    {
        const double freq1 = 1336.0;
        const double freq2 = 1061.0;
        const double pingDuration = 0.32;
        const double gapDuration = 0.06;
        const double decayRate = 7.0;

        int pingSamples = (int)(SampleRate * pingDuration);
        int gapSamples = (int)(SampleRate * gapDuration);
        int totalSamples = pingSamples * 2 + gapSamples;
        var samples = new float[totalSamples];

        // Ping 1: 1336Hz
        for (int i = 0; i < pingSamples; i++)
        {
            double t = (double)i / SampleRate;
            double envelope = Math.Exp(-t * decayRate);
            samples[i] = (float)(0.5 * envelope * Math.Sin(2 * Math.PI * freq1 * t));
        }

        // Gap (silence) — already zeroed

        // Ping 2: 1061Hz
        int offset = pingSamples + gapSamples;
        for (int i = 0; i < pingSamples; i++)
        {
            double t = (double)i / SampleRate;
            double envelope = Math.Exp(-t * decayRate);
            samples[offset + i] = (float)(0.5 * envelope * Math.Sin(2 * Math.PI * freq2 * t));
        }

        return samples;
    }

    private static void PlaySamples(float[] samples)
    {
        // Convert to 16-bit PCM
        var pcm = new byte[samples.Length * 2];
        for (int i = 0; i < samples.Length; i++)
        {
            var clamped = Math.Clamp(samples[i], -1f, 1f);
            var val = (short)(clamped * 32767);
            pcm[i * 2] = (byte)(val & 0xFF);
            pcm[i * 2 + 1] = (byte)((val >> 8) & 0xFF);
        }

        // Write to WAV in memory
        var waveFormat = new WaveFormat(SampleRate, 16, 1);
        using var wavStream = new MemoryStream();
        using (var writer = new WaveFileWriter(wavStream, waveFormat))
        {
            writer.Write(pcm, 0, pcm.Length);
        }
        wavStream.Position = 0;

        using var reader = new WaveFileReader(wavStream);
        using var player = new WaveOut();
        player.Init(reader);
        player.Play();

        // Wait for playback to finish
        int durationMs = (int)(samples.Length * 1000.0 / SampleRate) + 50;
        Thread.Sleep(durationMs);
    }
}
