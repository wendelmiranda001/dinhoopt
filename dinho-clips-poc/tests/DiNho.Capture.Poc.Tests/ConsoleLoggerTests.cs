using DiNho.Capture.Poc.Logging;

namespace DiNho.Capture.Poc.Tests;

public class ConsoleLoggerTests
{
    private sealed class FakeTextWriter : TextWriter
    {
        public readonly List<string> Lines = [];
        public int FlushCount { get; private set; }

        public override void WriteLine(string? value) => Lines.Add(value ?? "");
        public override void Flush() => FlushCount++;
        public override System.Text.Encoding Encoding => System.Text.Encoding.UTF8;
    }

    // ── W6.8: buffered logger ──────────────────────────────────────

    [Fact]
    public void BufferedWrite_LogsAppearOnDispose()
    {
        var writer = new FakeTextWriter();
        using var logger = new ConsoleLogger(writer, writeTimestamps: false);

        logger.Info("src", "line-1");
        logger.Info("src", "line-2");

        // Before dispose, nothing flushed yet (< threshold)
        Assert.Equal(0, writer.FlushCount);

        logger.Dispose();
        Assert.Equal(1, writer.FlushCount);
        Assert.Equal(2, writer.Lines.Count);
        Assert.Contains("[src] line-1", writer.Lines[0]);
        Assert.Contains("[src] line-2", writer.Lines[1]);
    }

    [Fact]
    public void FlushThreshold_FlushesAutomaticallyAt64()
    {
        var writer = new FakeTextWriter();
        var logger = new ConsoleLogger(writer, writeTimestamps: false);

        // First 63 lines should NOT flush
        for (int i = 0; i < 63; i++)
            logger.Info("src", $"msg-{i}");

        Assert.Equal(0, writer.FlushCount);
        Assert.Empty(writer.Lines);

        // 64th line triggers flush
        logger.Info("src", "msg-63");
        Assert.Equal(1, writer.FlushCount);
        Assert.Equal(64, writer.Lines.Count);

        logger.Dispose();
    }

    [Fact]
    public void Dispose_AlwaysFlushes_ResidualLines()
    {
        var writer = new FakeTextWriter();
        var logger = new ConsoleLogger(writer, writeTimestamps: false);

        // 10 lines — below threshold
        for (int i = 0; i < 10; i++)
            logger.Info("src", $"line-{i}");

        logger.Dispose();
        Assert.Equal(1, writer.FlushCount);
        Assert.Equal(10, writer.Lines.Count);
    }

    [Fact]
    public void Log_AfterDispose_DoesNotThrow()
    {
        var writer = new FakeTextWriter();
        var logger = new ConsoleLogger(writer);
        logger.Dispose();

        // Should be safe — no-op
        var ex = Record.Exception(() => logger.Info("src", "late"));
        Assert.Null(ex);
    }
}
