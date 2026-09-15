using System.Diagnostics;
using DiNho.Capture.Poc.Encoders;

namespace DiNho.Capture.Poc.Tests;

/// <summary>
/// Testes do FfmpegAacEncoder sem depender de um processo ffmpeg real.
/// Usam o construtor interno (seam) que injeta o stdin + timeout.
///
/// Regressões cobertas:
///  - B (race): EncodeAudio é chamado por 2 threads WASAPI (loopback + mic) quando
///    o mic está ativo. O _pcmBuf compartilhado + _stdin.Write sem lock produziam
///    batches corrompidos no AAC.
///  - C (bloqueio): _stdin.Write síncrono sem timeout travava a thread WASAPI
///    indefinidamente quando o pipe do ffmpeg enchia.
/// </summary>
public sealed class FfmpegAacEncoderTests
{
    [Fact]
    public void EncodeAudio_Healthy_WritesExactBytes()
    {
        using var ms = new MemoryStream();
        var encoder = new FfmpegAacEncoder(ms, writeTimeoutMs: 500);

        var samples = new float[480];
        for (int i = 0; i < samples.Length; i++) samples[i] = 0.5f;
        encoder.EncodeAudio(samples);
        encoder.EncodeAudio(samples);

        Assert.Equal(480 * 4 * 2, ms.Length);
        var data = ms.ToArray();
        for (int i = 0; i < data.Length; i += 4)
            Assert.Equal(0.5f, BitConverter.ToSingle(data, i));
    }

    [Fact]
    public async Task EncodeAudio_ConcurrentWriters_SerializeWrites()
    {
        var spy = new ConcurrentSpyStream();
        var encoder = new FfmpegAacEncoder(spy, writeTimeoutMs: 500);

        var samplesA = new float[960];
        for (int i = 0; i < samplesA.Length; i++) samplesA[i] = 0.25f;
        var samplesB = new float[480];
        for (int i = 0; i < samplesB.Length; i++) samplesB[i] = 0.75f;

        const int iterations = 2000;
        using var gate = new ManualResetEventSlim(false);

        var t1 = Task.Run(() =>
        {
            gate.Wait();
            for (int i = 0; i < iterations; i++) encoder.EncodeAudio(samplesA);
        });
        var t2 = Task.Run(() =>
        {
            gate.Wait();
            for (int i = 0; i < iterations; i++) encoder.EncodeAudio(samplesB);
        });

        gate.Set();
        await Task.WhenAll(t1, t2);

        Assert.False(spy.SawConcurrentWrite,
            "Dois writers nunca devem escrever no stdin do AAC simultaneamente (race do _pcmBuf).");
        Assert.Equal((long)(iterations * 960 + iterations * 480) * 4, spy.TotalBytesWritten);

        encoder.Dispose();
    }

    [Fact]
    public async Task EncodeAudio_StuckPipe_ReturnsWithinTimeout_AndMarksUnhealthy()
    {
        var encoder = new FfmpegAacEncoder(new StuckPipeStream(), writeTimeoutMs: 100);

        var sw = Stopwatch.StartNew();
        await Task.Run(() => encoder.EncodeAudio(new float[480]))
            .WaitAsync(TimeSpan.FromSeconds(3));
        sw.Stop();

        Assert.True(sw.ElapsedMilliseconds < 2000,
            $"EncodeAudio deve respeitar o timeout de escrita; levou {sw.ElapsedMilliseconds}ms (pipe travado).");
        Assert.False(encoder.IsHealthy,
            "Pipe travado por mais que o timeout deve marcar o encoder UNHEALTHY (auto-recovery do engine).");
    }

    [Fact]
    public void EncodeAudio_FaultingStream_MarksUnhealthy()
    {
        var encoder = new FfmpegAacEncoder(new FaultingStream(), writeTimeoutMs: 500);
        encoder.EncodeAudio(new float[480]);
        Assert.False(encoder.IsHealthy);
    }

    [Fact]
    public void EncodeAudio_DoesNotMutateCallerBuffer()
    {
        using var ms = new MemoryStream();
        var encoder = new FfmpegAacEncoder(ms, writeTimeoutMs: 500);

        var samples = new[] { 0.5f, float.NaN, 2.0f, -2.0f, float.PositiveInfinity, -0.25f };
        var before = (float[])samples.Clone();

        encoder.EncodeAudio(new float[384]);
        encoder.EncodeAudio(samples);

        // Sanitização NaN/Inf/clamp não pode gravar no buffer do chamador
        // (AudioMixer reutiliza o buffer PCM entre batches).
        for (int i = 0; i < samples.Length; i++)
        {
            bool same = float.IsNaN(before[i]) ? float.IsNaN(samples[i])
                : float.IsInfinity(before[i])
                    ? float.IsInfinity(samples[i]) && Math.Sign(before[i]) == Math.Sign(samples[i])
                    : before[i] == samples[i];
            Assert.True(same, $"índice {i} foi mutado pelo EncodeAudio (before={before[i]}, after={samples[i]})");
        }
    }

    [Fact]
    public void ComputeAacWriteTimeout_Warmup_ReturnsGenerousTimeout()
    {
        Assert.Equal(FfmpegAacEncoder.StdinWriteWarmupTimeoutMs, FfmpegAacEncoder.ComputeAacWriteTimeout(0));
        Assert.True(FfmpegAacEncoder.StdinWriteWarmupTimeoutMs > FfmpegAacEncoder.StdinWriteTimeoutMs);
    }

    [Fact]
    public void ComputeAacWriteTimeout_Steady_ReturnsStrictTimeout()
    {
        Assert.Equal(FfmpegAacEncoder.StdinWriteTimeoutMs, FfmpegAacEncoder.ComputeAacWriteTimeout(1));
        Assert.Equal(FfmpegAacEncoder.StdinWriteTimeoutMs, FfmpegAacEncoder.ComputeAacWriteTimeout(9001));
    }

    [Fact]
    public void ClassifyStdoutClosed_ExitCodeZero_IsCleanShutdown()
    {
        // stopCapture intencional fecha o stdin do ffmpeg AAC -> ele sai com exitCode=0.
        // Isso é desligamento limpo, NÃO falha: não deve logar Error nem marcar UNHEALTHY.
        var (logAsError, markUnhealthy) = FfmpegAacEncoder.ClassifyStdoutClosed(0);

        Assert.False(logAsError, "exitCode=0 (stdin EOF no stop) é shutdown normal — não é erro.");
        Assert.False(markUnhealthy, "exitCode=0 não deve marcar o encoder UNHEALTHY (falso-positivo de log).");
    }

    [Theory]
    [InlineData(-1)]
    [InlineData(1)]
    [InlineData(2)]
    [InlineData(255)]
    public void ClassifyStdoutClosed_NonZeroExit_IsRealFailure(int exitCode)
    {
        // exitCode != 0 (crash, kill, erro do ffmpeg) = falha real — Error + UNHEALTHY (fail-closed).
        var (logAsError, markUnhealthy) = FfmpegAacEncoder.ClassifyStdoutClosed(exitCode);

        Assert.True(logAsError, $"exitCode={exitCode} não é shutdown limpo — deve logar Error.");
        Assert.True(markUnhealthy, $"exitCode={exitCode} deve marcar UNHEALTHY (watchdog reinit).");
    }

    // ─── Streams de teste ────────────────────────────────────────────

    /// <summary>
    /// Detecta escrita concorrente: marca SawConcurrentWrite quando duas
    /// escritas estão em voo ao mesmo tempo (o sintoma da race do _pcmBuf).
    /// </summary>
    private sealed class ConcurrentSpyStream : Stream
    {
        private int _activeWrites;
        private long _bytesWritten;
        public bool SawConcurrentWrite { get; private set; }
        public long TotalBytesWritten => Interlocked.Read(ref _bytesWritten);

        public override bool CanRead => false;
        public override bool CanSeek => false;
        public override bool CanWrite => true;
        public override long Length => TotalBytesWritten;
        public override long Position { get => TotalBytesWritten; set => throw new NotSupportedException(); }

        public override void Flush() { }
        public override int Read(byte[] buffer, int offset, int count) => throw new NotSupportedException();
        public override long Seek(long offset, SeekOrigin origin) => throw new NotSupportedException();
        public override void SetLength(long value) => throw new NotSupportedException();

        public override void Write(byte[] buffer, int offset, int count)
        {
            int active = Interlocked.Increment(ref _activeWrites);
            if (active > 1) SawConcurrentWrite = true;
            try
            {
                // Amplifica a janela de overlap para o teste RED detectar com
                // segurança — sem o lock, 2 threads ficam aqui simultaneamente.
                Thread.SpinWait(100);
                Interlocked.Add(ref _bytesWritten, count);
            }
            finally
            {
                Interlocked.Decrement(ref _activeWrites);
            }
        }

        public override async Task WriteAsync(byte[] buffer, int offset, int count, CancellationToken cancellationToken)
        {
            int active = Interlocked.Increment(ref _activeWrites);
            if (active > 1) SawConcurrentWrite = true;
            try
            {
                await Task.Yield();
                Interlocked.Add(ref _bytesWritten, count);
            }
            finally
            {
                Interlocked.Decrement(ref _activeWrites);
            }
        }
    }

    /// <summary>
    /// Pipe "travado": a escrita síncrona bloqueia (simula pipe cheio), e a
    /// escrita assíncrona nunca completa. Sob o código antigo (Write síncrono
    /// sem timeout) EncodeAudio fica preso; sob o novo (TryWriteStdin) ele
    /// retorna em ~timeoutMs e marca unhealthy.
    /// </summary>
    private sealed class StuckPipeStream : Stream
    {
        private readonly ManualResetEventSlim _block = new(false);

        public override bool CanRead => false;
        public override bool CanSeek => false;
        public override bool CanWrite => true;
        public override long Length => throw new NotSupportedException();
        public override long Position { get => throw new NotSupportedException(); set => throw new NotSupportedException(); }

        public override void Flush() { }
        public override int Read(byte[] buffer, int offset, int count) => throw new NotSupportedException();
        public override long Seek(long offset, SeekOrigin origin) => throw new NotSupportedException();
        public override void SetLength(long value) => throw new NotSupportedException();

        public override void Write(byte[] buffer, int offset, int count) =>
            _block.Wait(TimeSpan.FromSeconds(5));

        public override Task WriteAsync(byte[] buffer, int offset, int count, CancellationToken cancellationToken) =>
            new TaskCompletionSource<byte[]>(TaskCreationOptions.RunContinuationsAsynchronously).Task;
    }

    private sealed class FaultingStream : Stream
    {
        public override bool CanRead => false;
        public override bool CanSeek => false;
        public override bool CanWrite => true;
        public override long Length => throw new NotSupportedException();
        public override long Position { get => throw new NotSupportedException(); set => throw new NotSupportedException(); }

        public override void Flush() { }
        public override int Read(byte[] buffer, int offset, int count) => throw new NotSupportedException();
        public override long Seek(long offset, SeekOrigin origin) => throw new NotSupportedException();
        public override void SetLength(long value) => throw new NotSupportedException();

        public override void Write(byte[] buffer, int offset, int count) =>
            throw new IOException("pipe closed");

        public override Task WriteAsync(byte[] buffer, int offset, int count, CancellationToken cancellationToken) =>
            Task.FromException<byte[]>(new IOException("pipe closed"));
    }
}
