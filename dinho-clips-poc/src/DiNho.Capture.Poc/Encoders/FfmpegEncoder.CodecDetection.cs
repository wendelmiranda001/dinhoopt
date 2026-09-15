using System.Diagnostics;

namespace DiNho.Capture.Poc.Encoders;

internal partial class FfmpegEncoder
{
    // Cache estático de detecção (melhor codec + suporte por encoder). G3: passa a ter
    // VALIDADE LIMITADA (TTL) — antes o cache nunca expirava: se uma sessão caiu para
    // libx264 (ex.: limite de sessões NVENC), TODAS as sessões seguintes ficavam presas em
    // CPU mesmo com a GPU liberada. Após o TTL o probe roda de novo e o HW volta a ser usado.
    private static readonly Dictionary<string, bool> _encoderCache = new();
    private static readonly Dictionary<string, long> _encoderCacheTicks = new();
    private static string? _bestCodecCache;
    private static long _bestCodecCacheTicks;
    private static readonly Lock _cacheLock = new();

    /// <summary>Validade do cache de detecção (mutable para testes).</summary>
    internal static long CodecCacheTtlMs = 60_000;

    /// <summary>Limpa os caches estáticos. Uso em testes (estado estático vaza entre testes).</summary>
    internal static void ResetEncoderCachesForTest()
    {
        lock (_cacheLock)
        {
            _bestCodecCache = null;
            _bestCodecCacheTicks = 0;
            _encoderCache.Clear();
            _encoderCacheTicks.Clear();
        }
    }

    /// <summary>Grava o melhor codec detectado (seam de teste + uso interno).</summary>
    internal static void CacheBest(string codec)
    {
        lock (_cacheLock)
        {
            _bestCodecCache = codec;
            _bestCodecCacheTicks = Environment.TickCount64;
        }
    }

    /// <summary>Lê o melhor codec cacheado se ainda dentro do TTL. false = re-probe.</summary>
    internal static bool TryGetCachedBestCodec(out string codec)
    {
        lock (_cacheLock)
        {
            if (_bestCodecCache != null && (Environment.TickCount64 - _bestCodecCacheTicks) < CodecCacheTtlMs)
            {
                codec = _bestCodecCache;
                return true;
            }
        }
        codec = "";
        return false;
    }

    private static bool TryGetCachedEncoder(string enc, out bool supported)
    {
        lock (_cacheLock)
        {
            if (_encoderCache.TryGetValue(enc, out supported)
                && (Environment.TickCount64 - _encoderCacheTicks[enc]) < CodecCacheTtlMs)
            {
                return true;
            }
        }
        supported = false;
        return false;
    }

    private static void CacheEncoder(string enc, bool supported)
    {
        lock (_cacheLock)
        {
            _encoderCache[enc] = supported;
            _encoderCacheTicks[enc] = Environment.TickCount64;
        }
    }

    private string DetectBestCodec()
    {
        if (!_useHardware) return "libx264";
        if (TryGetCachedBestCodec(out var cached)) return cached;

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

    private static bool CheckFfmpegEncoderCached(string enc)
    {
        if (TryGetCachedEncoder(enc, out var cached)) return cached;
        var result = CheckFfmpegEncoder(enc);
        CacheEncoder(enc, result);
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
