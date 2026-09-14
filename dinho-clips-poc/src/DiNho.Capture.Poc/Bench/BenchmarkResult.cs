using System.Text.Json;
using System.Text.Json.Serialization;

namespace DiNho.Capture.Poc.Bench;

public sealed class BenchmarkResult
{
    [JsonPropertyName("timestamp")]
    public string Timestamp { get; set; } = DateTime.UtcNow.ToString("o");

    [JsonPropertyName("version")]
    public string Version { get; set; } = "1.0";

    [JsonPropertyName("gpuName")]
    public string? GpuName { get; set; }

    [JsonPropertyName("gpuDriver")]
    public string? GpuDriver { get; set; }

    [JsonPropertyName("adapter")]
    public string? Adapter { get; set; }

    [JsonPropertyName("captureBackend")]
    public string? CaptureBackend { get; set; }

    [JsonPropertyName("encoder")]
    public string? Encoder { get; set; }

    [JsonPropertyName("capture")]
    public CaptureBench? Capture { get; set; }

    [JsonPropertyName("encode")]
    public EncodeBench? Encode { get; set; }

    [JsonPropertyName("cpu")]
    public CpuBench? Cpu { get; set; }

    public string ToJson() =>
        JsonSerializer.Serialize(this, new JsonSerializerOptions { WriteIndented = true });

    public static string DefaultOutputPath()
    {
        var dir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.MyVideos), "DiNho Clips");
        Directory.CreateDirectory(dir);
        return Path.Combine(dir, $"bench-{DateTime.Now:yyyyMMdd-HHmmss}.json");
    }
}

public sealed class CaptureBench
{
    [JsonPropertyName("framesCaptured")]
    public int FramesCaptured { get; set; }

    [JsonPropertyName("framesTotal")]
    public int FramesTotal { get; set; }

    [JsonPropertyName("latencyMs")]
    public LatencyStats? LatencyMs { get; set; }

    [JsonPropertyName("waitMs")]
    public LatencyStats? WaitMs { get; set; }

    [JsonPropertyName("copyMs")]
    public LatencyStats? CopyMs { get; set; }

    [JsonPropertyName("p95TargetMs")]
    public double P95TargetMs { get; set; } = 16.0;

    [JsonPropertyName("p95Met")]
    public bool P95Met { get; set; }
}

public sealed class EncodeBench
{
    [JsonPropertyName("framesEncoded")]
    public int FramesEncoded { get; set; }

    [JsonPropertyName("avgUs")]
    public double AvgUs { get; set; }
}

public sealed class CpuBench
{
    [JsonPropertyName("avgCpuPercent")]
    public double AvgCpuPercent { get; set; }

    [JsonPropertyName("peakCpuPercent")]
    public double PeakCpuPercent { get; set; }

    [JsonPropertyName("samplingDurationSec")]
    public int SamplingDurationSec { get; set; }
}

public sealed class LatencyStats
{
    [JsonPropertyName("min")]
    public double Min { get; set; }

    [JsonPropertyName("p50")]
    public double P50 { get; set; }

    [JsonPropertyName("p95")]
    public double P95 { get; set; }

    [JsonPropertyName("p99")]
    public double P99 { get; set; }

    [JsonPropertyName("avg")]
    public double Avg { get; set; }

    [JsonPropertyName("max")]
    public double Max { get; set; }
}