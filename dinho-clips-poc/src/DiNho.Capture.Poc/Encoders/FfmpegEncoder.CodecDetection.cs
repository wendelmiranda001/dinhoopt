using System.Diagnostics;

namespace DiNho.Capture.Poc.Encoders;

internal partial class FfmpegEncoder
{
    private static readonly Dictionary<string, bool> _encoderCache = new();
    private static string? _bestCodecCache;
    private static readonly Lock _cacheLock = new();

    private string DetectBestCodec()
    {
        if (!_useHardware) return "libx264";
        lock (_cacheLock)
        {
            if (_bestCodecCache != null) return _bestCodecCache;
        }

        var vendorId = EncoderManager.DetectEncodingVendorId();
        var userCodec = _codec ?? "auto";
        _fallbackChain = EncoderManager.BuildFallbackChain(userCodec, vendorId);
        _currentFallbackIndex = 0;

        if (vendorId == 0x10DE)
        {
            var nvencInfo = EncoderManager.GetNvencSessionInfo();
            if (nvencInfo.IsLimitReached)
            {
                Logging.Log.E("FfmpegEncoder", $"NVENC session limit reached ({nvencInfo.SessionCount}/{nvencInfo.MaxSessions}) — falling back to CPU");
                _fallbackChain.RemoveAll(e => e.Codec.Contains("nvenc"));
            }
        }

        foreach (var entry in _fallbackChain)
        {
            if (entry.ScaleDivisor > 1)
            {
                if (entry.Codec == "libx264" || EncoderManager.CheckFfmpegEncoder(entry.Codec))
                {
                    _currentFallbackIndex = _fallbackChain.IndexOf(entry);
                    _scaleDivisor = entry.ScaleDivisor;
                    CacheBest(entry.Codec);
                    Logging.Log.I("FfmpegEncoder", $"selected {entry.Label} (scale=1/{_scaleDivisor})");
                    return entry.Codec;
                }
                continue;
            }

            var probe = EncoderManager.ProbeEncoder(entry.Codec);
            if (probe.Success)
            {
                _currentFallbackIndex = _fallbackChain.IndexOf(entry);
                CacheBest(entry.Codec);
                Logging.Log.I("FfmpegEncoder", $"probed OK: {entry.Label} ({probe.OutputBytes}B output)");
                return entry.Codec;
            }

            Logging.Log.W("FfmpegEncoder", $"probe FAILED: {entry.Label} — {probe.Error}");
            if (probe.IsNvencSessionLimit)
            {
                Logging.Log.E("FfmpegEncoder", "NVENC session limit detected — removing all NVENC from fallback chain");
                _fallbackChain.RemoveAll(e => e.Codec.Contains("nvenc"));
            }
        }

        CacheBest("libx264");
        return "libx264";
    }

    private string ResolveCodec(string preferred)
    {
        if (!_useHardware) return preferred switch
        {
            "libx265" => "libx265",
            _ => "libx264"
        };

        var vendorId = EncoderManager.DetectEncodingVendorId();
        var result = EncoderManager.MapUserCodec(preferred, vendorId);

        if (result != null && result.Contains("av1") && !EncoderManager.SupportsAv1Hardware(vendorId))
        {
            Logging.Log.W("FfmpegEncoder", $"AV1 requested but GPU vendor 0x{vendorId:X4} doesn't support HW AV1 — falling back to H264");
            var fallback = EncoderManager.GetPreferredCodec(vendorId);
            if (!string.IsNullOrEmpty(fallback)) return fallback;
            Logging.Log.W("FfmpegEncoder", $"GPU vendor 0x{vendorId:X4} unknown — falling back to DetectBestCodec");
            return DetectBestCodec();
        }

        if (result != null)
        {
            // Probe with real encoding instead of just checking encoder name —
            // some encoders exist in ffmpeg's list but fail at runtime (NVENC
            // session limit, driver mismatch, GPU unsupported features).
            var probe = EncoderManager.ProbeEncoder(result);
            if (probe.Success)
                return result;
            Logging.Log.W("FfmpegEncoder", $"probe FAILED for {result} ({probe.Error}) — falling back to DetectBestCodec");
        }

        return DetectBestCodec();
    }

    private static void CacheBest(string codec)
    {
        lock (_cacheLock) { _bestCodecCache ??= codec; }
    }

    private static bool CheckFfmpegEncoderCached(string enc)
    {
        lock (_cacheLock)
        {
            if (_encoderCache.TryGetValue(enc, out var cached)) return cached;
        }
        var result = CheckFfmpegEncoder(enc);
        lock (_cacheLock) { _encoderCache[enc] = result; }
        return result;
    }

    internal static bool CheckFfmpegEncoder(string enc)
    {
        if (string.IsNullOrWhiteSpace(enc))
            return false;
        try
        {
            using var p = new Process
            {
                StartInfo = FfmpegPathResolver.CreateFfmpegStartInfo(args: "-encoders", redirectOutput: true, redirectError: true)
            };
            p.Start();
            // Leitura concorrente — evita deadlock de pipe (-encoders enche o stdout).
            var outTask = p.StandardOutput.ReadToEndAsync();
            var errTask = p.StandardError.ReadToEndAsync();
            if (!p.WaitForExit(2000))
            {
                try { p.Kill(entireProcessTree: true); } catch { }
                p.WaitForExit(2000);
            }
            var o = outTask.Result;
            _ = errTask.Result;
            return o.Contains(enc, StringComparison.OrdinalIgnoreCase);
        }
        catch { return false; }
    }
}
