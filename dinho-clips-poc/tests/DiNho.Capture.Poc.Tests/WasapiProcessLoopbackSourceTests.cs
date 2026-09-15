using DiNho.Capture.Poc.Audio;

namespace DiNho.Capture.Poc.Tests;

public class WasapiProcessLoopbackSourceTests
{
    // ── ConvertFloatBytes (conversão pura) ──────────────────────────

    [Fact]
    public void ConvertFloatBytes_RoundTripsFloatValues()
    {
        var floats = new float[] { 0.25f, -0.5f, 1.0f, -1.0f, 0.0f };
        var bytes = new byte[floats.Length * 4];
        System.Buffer.BlockCopy(floats, 0, bytes, 0, bytes.Length);

        var result = WasapiProcessLoopbackSource.ConvertFloatBytes(bytes);

        Assert.Equal(floats.Length, result.Length);
        for (int i = 0; i < floats.Length; i++)
            Assert.Equal(floats[i], result[i]);
    }

    [Fact]
    public void ConvertFloatBytes_EmptyInput_ReturnsEmpty()
    {
        var result = WasapiProcessLoopbackSource.ConvertFloatBytes(ReadOnlySpan<byte>.Empty);
        Assert.Empty(result);
    }

    [Fact]
    public void ConvertFloatBytes_TruncatedTail_IgnoresIncompleteSample()
    {
        // 2 samples completos (8 bytes) + 3 bytes órfãos → só 2 samples
        var bytes = new byte[11];
        var floats = new float[] { 0.75f, -0.75f };
        System.Buffer.BlockCopy(floats, 0, bytes, 0, 8);

        var result = WasapiProcessLoopbackSource.ConvertFloatBytes(bytes);

        Assert.Equal(2, result.Length);
        Assert.Equal(0.75f, result[0]);
        Assert.Equal(-0.75f, result[1]);
    }

    [Fact]
    public void ConvertFloatBytes_SingleSample_Works()
    {
        var bytes = new byte[] { 0x00, 0x00, 0x00, 0xBF }; // -0.5f LE

        var result = WasapiProcessLoopbackSource.ConvertFloatBytes(bytes);

        Assert.Single(result);
        Assert.Equal(-0.5f, result[0]);
    }

    // ── 4.2: Start/Stop/Dispose com factory substituída — recorder null → no-crash ──

    [Fact]
    public void Start_NullRecorderFactory_DoesNotCrashOrCapture()
    {
        var original = WasapiProcessLoopbackSource.RecorderFactory;
        try
        {
            WasapiProcessLoopbackSource.RecorderFactory = (_, _, _) => null!;
            using var source = new WasapiProcessLoopbackSource(12345);
            source.Start();   // guard: recorder null → loga e não inicia
            source.Stop();    // _running false → no-op
            source.Dispose(); // sem recorder registrado → no-op
        }
        finally
        {
            WasapiProcessLoopbackSource.RecorderFactory = original;
        }
    }
}
