using System.Reflection;
using DiNho.Capture.Poc.Encoders;

namespace DiNho.Capture.Poc.Tests;

public sealed class EncoderManagerTests
{
    // ── ProbeEncoder ─────────────────────────────────────────────────

    [Fact]
    public void ProbeEncoder_libx264_ReturnsSuccess()
    {
        var result = EncoderManager.ProbeEncoder("libx264");
        Assert.True(result.Success, $"Probe should succeed for libx264: {result.Error}");
        Assert.True(result.OutputBytes > 0, "Should produce output bytes");
        Assert.False(result.IsNvencSessionLimit);
        Assert.Equal("libx264", result.Codec);
    }

    [Fact]
    public void ProbeEncoder_nonexistentCodec_ReturnsFailure()
    {
        var result = EncoderManager.ProbeEncoder("nonexistent_codec_xyz");
        Assert.False(result.Success);
        Assert.Equal(0, result.OutputBytes);
        Assert.NotNull(result.Error);
    }

    // ── BuildFallbackChain ──────────────────────────────────────────

    [Fact]
    public void BuildFallbackChain_auto_Nvidia_IncludesHWAndCPU()
    {
        var chain = EncoderManager.BuildFallbackChain("auto", 0x10DE);
        Assert.NotEmpty(chain);
        // Should contain NVENC entries + libx264
        Assert.Contains(chain, e => e.Codec.Contains("nvenc"));
        Assert.Contains(chain, e => e.Codec == "libx264");
    }

    [Fact]
    public void BuildFallbackChain_auto_Amd_IncludesAMF()
    {
        var chain = EncoderManager.BuildFallbackChain("auto", 0x1002);
        Assert.Contains(chain, e => e.Codec.Contains("amf"));
        Assert.Contains(chain, e => e.Codec == "libx264");
    }

    [Fact]
    public void BuildFallbackChain_auto_Intel_IncludesQSV()
    {
        var chain = EncoderManager.BuildFallbackChain("auto", 0x8086);
        Assert.Contains(chain, e => e.Codec.Contains("qsv"));
        Assert.Contains(chain, e => e.Codec == "libx264");
    }

    [Fact]
    public void BuildFallbackChain_auto_NoGPU_OnlyCPU()
    {
        var chain = EncoderManager.BuildFallbackChain("auto", 0);
        Assert.DoesNotContain(chain, e => e.Codec.Contains("nvenc"));
        Assert.DoesNotContain(chain, e => e.Codec.Contains("amf"));
        Assert.Contains(chain, e => e.Codec == "libx264");
    }

    [Fact]
    public void BuildFallbackChain_h264_Nvidia_IncludesNvenc()
    {
        var chain = EncoderManager.BuildFallbackChain("h264", 0x10DE);
        Assert.Contains(chain, e => e.Codec == "h264_nvenc");
    }

    [Fact]
    public void BuildFallbackChain_hevc_Nvidia_IncludesHevcNvenc()
    {
        var chain = EncoderManager.BuildFallbackChain("hevc", 0x10DE);
        Assert.Contains(chain, e => e.Codec == "hevc_nvenc");
    }

    [Fact]
    public void BuildFallbackChain_libx264_OnlySoftware()
    {
        var chain = EncoderManager.BuildFallbackChain("libx264", 0x10DE);
        Assert.DoesNotContain(chain, e => e.Codec.Contains("nvenc"));
        Assert.Contains(chain, e => e.Codec == "libx264");
    }

    // ── BuildFallbackChain — D3D12VA step (F3) ──────────────────────

    [Fact]
    public void BuildFallbackChain_auto_Nvidia_IncludesD3d12va()
    {
        var chain = EncoderManager.BuildFallbackChain("auto", 0x10DE);
        Assert.Contains(chain, e => e.Codec == "h264_d3d12va");
        // D3D12VA step must come AFTER vendor HW and BEFORE CPU
        var d3dIdx = chain.FindIndex(e => e.Codec == "h264_d3d12va");
        var nvencIdx = chain.FindIndex(e => e.Codec.Contains("nvenc"));
        var cpuIdx = chain.FindIndex(e => e.Codec == "libx264");
        Assert.True(d3dIdx > nvencIdx, "D3D12VA must come after vendor HW");
        Assert.True(d3dIdx < cpuIdx, "D3D12VA must come before CPU");
    }

    [Fact]
    public void BuildFallbackChain_hevc_Nvidia_IncludesHevcD3d12va()
    {
        var chain = EncoderManager.BuildFallbackChain("hevc", 0x10DE);
        Assert.Contains(chain, e => e.Codec == "hevc_d3d12va");
    }

    [Fact]
    public void BuildFallbackChain_av1_Nvidia_IncludesAv1D3d12va()
    {
        var chain = EncoderManager.BuildFallbackChain("av1", 0x10DE);
        Assert.Contains(chain, e => e.Codec == "av1_d3d12va");
    }

    [Fact]
    public void BuildFallbackChain_auto_Amd_IncludesD3d12va()
    {
        var chain = EncoderManager.BuildFallbackChain("auto", 0x1002);
        Assert.Contains(chain, e => e.Codec == "h264_d3d12va");
    }

    [Fact]
    public void BuildFallbackChain_libx264_DoesNotIncludeD3d12va()
    {
        // Software request explicit — no hardware steps, incl. D3D12VA
        var chain = EncoderManager.BuildFallbackChain("libx264", 0x10DE);
        Assert.DoesNotContain(chain, e => e.Codec.Contains("d3d12va"));
    }

    [Fact]
    public void BuildFallbackChain_auto_NoGPU_DoesNotIncludeD3d12va()
    {
        var chain = EncoderManager.BuildFallbackChain("auto", 0);
        Assert.DoesNotContain(chain, e => e.Codec.Contains("d3d12va"));
    }

    // ── BuildFallbackChain — Alavanca 4: AV1-first para "auto" ──────

    [Theory]
    [InlineData(0x10DE, "av1_nvenc", "h264_nvenc")]
    [InlineData(0x1002, "av1_amf", "h264_amf")]
    [InlineData(0x8086, "av1_qsv", "h264_qsv")]
    public void BuildFallbackChain_auto_Av1Capable_PutsAv1First(int vendorId, string av1Codec, string h264Codec)
    {
        var original = EncoderManager.Av1HwProbe;
        EncoderManager.Av1HwProbe = _ => true;
        try
        {
            var chain = EncoderManager.BuildFallbackChain("auto", vendorId);

            Assert.Equal(av1Codec, chain[0].Codec);
            Assert.Equal(1, chain[0].ScaleDivisor);

            var av1Idx = chain.FindIndex(e => e.Codec == av1Codec);
            var h264Idx = chain.FindIndex(e => e.Codec == h264Codec);
            var cpuIdx = chain.FindIndex(e => e.Codec == "libx264");
            Assert.True(h264Idx > av1Idx, "bloco h264 deve vir depois do bloco AV1");
            Assert.True(cpuIdx > h264Idx, "CPU deve vir depois dos dois blocos HW");

            // Ambos os blocos HW mantêm a escada completa de divisores
            Assert.Contains(chain, e => e.Codec == av1Codec && e.ScaleDivisor == 2);
            Assert.Contains(chain, e => e.Codec == av1Codec && e.ScaleDivisor == 4);
            Assert.Contains(chain, e => e.Codec == h264Codec && e.ScaleDivisor == 2);
            Assert.Contains(chain, e => e.Codec == h264Codec && e.ScaleDivisor == 4);
        }
        finally { EncoderManager.Av1HwProbe = original; }
    }

    [Fact]
    public void BuildFallbackChain_auto_NoAv1HW_KeepsH264First()
    {
        var original = EncoderManager.Av1HwProbe;
        EncoderManager.Av1HwProbe = _ => false;
        try
        {
            var chain = EncoderManager.BuildFallbackChain("auto", 0x10DE);

            Assert.Equal("h264_nvenc", chain[0].Codec);
            Assert.DoesNotContain(chain, e => e.Codec.StartsWith("av1_"));
            Assert.Equal("libx264", chain[^2].Codec);
            Assert.Equal("libx264", chain[^1].Codec);
        }
        finally { EncoderManager.Av1HwProbe = original; }
    }

    [Fact]
    public void ProbeEncoder_h264_d3d12va_DoesNotThrow()
    {
        // On this NVIDIA machine the D3D12VA probe fails (Encode failed: Unknown error
        // occurred) — that's the intended gate. The test just verifies the probe runs
        // with the d3d12va-specific args (init_hw_device + hwupload) without throwing.
        var result = EncoderManager.ProbeEncoder("h264_d3d12va");
        Assert.Equal("h264_d3d12va", result.Codec);
        Assert.IsType<bool>(result.Success);
    }

    [Fact]
    public void BuildFallbackChain_IncludesReducedResolutionSteps()
    {
        var chain = EncoderManager.BuildFallbackChain("auto", 0x10DE);
        // Should have full-res, 720p (scale 1/2), 480p (scale 1/4), CPU, CPU 720p
        Assert.Contains(chain, e => e.ScaleDivisor == 1);
        Assert.Contains(chain, e => e.ScaleDivisor == 2);
        Assert.Contains(chain, e => e.ScaleDivisor == 4);
    }

    [Fact]
    public void BuildFallbackChain_CPUFallback_LastResort()
    {
        var chain = EncoderManager.BuildFallbackChain("auto", 0x10DE);
        // Last entries should be CPU
        var lastEntries = chain.TakeLast(2).ToList();
        Assert.All(lastEntries, e => Assert.Equal("libx264", e.Codec));
    }

    // ── MapUserCodec ────────────────────────────────────────────────

    [Fact]
    public void MapUserCodec_libx264_AlwaysReturnsLibx264()
    {
        Assert.Equal("libx264", EncoderManager.MapUserCodec("libx264", 0x10DE));
        Assert.Equal("libx264", EncoderManager.MapUserCodec("libx264", 0));
    }

    [Fact]
    public void MapUserCodec_auto_ReturnsNull()
    {
        Assert.Null(EncoderManager.MapUserCodec("auto", 0x10DE));
    }

    [Fact]
    public void MapUserCodec_h264_Nvidia_ReturnsNvenc()
    {
        Assert.Equal("h264_nvenc", EncoderManager.MapUserCodec("h264", 0x10DE));
    }

    [Fact]
    public void MapUserCodec_h264_Amd_ReturnsAmf()
    {
        Assert.Equal("h264_amf", EncoderManager.MapUserCodec("h264", 0x1002));
    }

    [Fact]
    public void MapUserCodec_h264_Intel_ReturnsQsv()
    {
        Assert.Equal("h264_qsv", EncoderManager.MapUserCodec("h264", 0x8086));
    }

    [Fact]
    public void MapUserCodec_h264_UnknownVendor_ReturnsEmpty()
    {
        Assert.Equal("", EncoderManager.MapUserCodec("h264", 0x1234));
    }

    // ── GetPreferredCodec ───────────────────────────────────────────

    [Theory]
    [InlineData(0x10DE, "h264_nvenc")]
    [InlineData(0x1002, "h264_amf")]
    [InlineData(0x8086, "h264_qsv")]
    [InlineData(0, "")]
    [InlineData(0x1234, "")]
    public void GetPreferredCodec_ReturnsCorrectCodec(int vendorId, string expected)
    {
        Assert.Equal(expected, EncoderManager.GetPreferredCodec(vendorId));
    }

    // ── DetectAvailableEncoders ─────────────────────────────────────

    [Fact]
    public void DetectAvailableEncoders_ReturnsAtLeastSoftware()
    {
        var available = EncoderManager.DetectAvailableEncoders();
        Assert.NotEmpty(available);
        Assert.Contains(EncoderType.Ffmpeg, available);
    }

    // ── CheckFfmpegAvailable ────────────────────────────────────────

    [Fact]
    public void CheckFfmpegAvailable_ReturnsTrue()
    {
        Assert.True(EncoderManager.CheckFfmpegAvailable());
    }

    // ── GetGpuList ──────────────────────────────────────────────────

    [Fact]
    public void GetGpuList_ReturnsValidResult()
    {
        var list = EncoderManager.GetGpuList();
        // May be empty in CI environments without GPU — just ensure no exception
        Assert.NotNull(list);
    }

    // ── DetectAllGpuAdapters ────────────────────────────────────────

    [Fact]
    public void DetectAllGpuAdapters_ReturnsValidResult()
    {
        var adapters = EncoderManager.DetectAllGpuAdapters();
        // May be empty in CI environments without GPU — just ensure no exception
        Assert.NotNull(adapters);
        if (adapters.Count > 0)
            Assert.All(adapters, a => Assert.False(string.IsNullOrEmpty(a.Name)));
    }

    // ── GetNvencSessionInfo ─────────────────────────────────────────

    [Fact]
    public void GetNvencSessionInfo_ReturnsValidResult()
    {
        // This machine has RTX 5050 — nvidia-smi should be available
        var info = EncoderManager.GetNvencSessionInfo();
        // MaxSessions = -1 means nvidia-smi not available or probe failed — that's OK
        if (info.MaxSessions > 0)
        {
            Assert.True(info.SessionCount >= 0);
        }
    }

    // ── FallbackEntry ───────────────────────────────────────────────

    [Fact]
    public void FallbackEntry_DefaultScaleDivisor_IsOne()
    {
        var entry = new EncoderManager.FallbackEntry { Codec = "h264_nvenc", Label = "test" };
        Assert.Equal(1, entry.ScaleDivisor);
    }

    // ── ProbeResult ─────────────────────────────────────────────────

    [Fact]
    public void ProbeResult_RecordProperties_AreCorrect()
    {
        var result = new EncoderManager.ProbeResult
        {
            Codec = "libx264",
            Success = true,
            OutputBytes = 1234,
        };
        Assert.Equal("libx264", result.Codec);
        Assert.True(result.Success);
        Assert.Equal(1234, result.OutputBytes);
        Assert.Null(result.Error);
        Assert.False(result.IsNvencSessionLimit);
    }

    // ── SupportsAv1Hardware ─────────────────────────────────────────

    [Fact]
    public void SupportsAv1Hardware_Nvidia_ChecksFfmpeg()
    {
        // On RTX 5050, av1_nvenc should be available
        var result = EncoderManager.SupportsAv1Hardware(0x10DE);
        // We can't assert true/false without knowing the GPU — just ensure no exception
        Assert.IsType<bool>(result);
    }

    [Fact]
    public void SupportsAv1Hardware_UnknownVendor_ReturnsFalse()
    {
        Assert.False(EncoderManager.SupportsAv1Hardware(0x1234));
    }

    // ── ProbeEncoder with real codecs ───────────────────────────────

    [Fact]
    public void ProbeEncoder_h264_nvenc_SucceedsOnThisMachine()
    {
        var result = EncoderManager.ProbeEncoder("h264_nvenc");
        Assert.True(result.Success, $"NVENC probe failed: {result.Error}");
        Assert.True(result.OutputBytes > 0);
    }

    [Fact]
    public void ProbeEncoder_hevc_nvenc_SucceedsOnThisMachine()
    {
        var result = EncoderManager.ProbeEncoder("hevc_nvenc");
        Assert.True(result.Success, $"HEVC NVENC probe failed: {result.Error}");
        Assert.True(result.OutputBytes > 0);
    }

    // ── DetectAllGpuAdapters — Bug A regression (PointerUSize → long OverflowException) ──

    [Fact]
    public void DetectAllGpuAdapters_ReturnsAdapters_WhenGpuListHasAdapters()
    {
        // Regression: DetectAllGpuAdapters threw OverflowException converting
        // DedicatedVideoMemory (SharpGen PointerUSize) to long on 8.3GB VRAM, and the
        // silent catch returned an empty list even though GetGpuList found adapters.
        var gpuList = EncoderManager.GetGpuList();
        if (gpuList.Count == 0) return; // headless CI without GPU

        var adapters = EncoderManager.DetectAllGpuAdapters();
        Assert.NotEmpty(adapters);
        Assert.All(adapters, a => Assert.True(a.VideoMemoryBytes >= 0,
            $"VRAM {a.VideoMemoryBytes} must convert without overflow for {a.Name}"));
    }

    [Fact]
    public void DetectEncodingVendorId_NonZero_WhenGpuListHasSupportedVendor()
    {
        var gpuList = EncoderManager.GetGpuList();
        if (!gpuList.Any(g => g.VendorId is 0x10DE or 0x1002 or 0x8086)) return;

        // Before the fix this returned 0 because adapter enumeration threw internally.
        Assert.NotEqual(0, EncoderManager.DetectEncodingVendorId());
    }

    // ── MapUserCodec / SupportsAv1Hardware — AV1 with zero/unknown vendor ──

    [Fact]
    public void MapUserCodec_av1_ZeroVendor_ReturnsLibsvtav1()
    {
        Assert.Equal("libsvtav1", EncoderManager.MapUserCodec("av1", 0));
    }

    [Fact]
    public void MapUserCodec_av1_Nvidia_ReturnsAv1Nvenc()
    {
        Assert.Equal("av1_nvenc", EncoderManager.MapUserCodec("av1", 0x10DE));
    }

    [Fact]
    public void MapUserCodec_av1_Intel_ReturnsAv1Qsv()
    {
        // Lacuna Intel fechada: VendorAv1Codecs[0x8086] era "libsvtav1" (nunca usava av1_qsv).
        Assert.Equal("av1_qsv", EncoderManager.MapUserCodec("av1", 0x8086));
    }

    [Fact]
    public void MapUserCodec_av1_Amd_ReturnsAv1Amf()
    {
        Assert.Equal("av1_amf", EncoderManager.MapUserCodec("av1", 0x1002));
    }

    [Fact]
    public void SupportsAv1Hardware_VendorZero_ReturnsFalse()
    {
        Assert.False(EncoderManager.SupportsAv1Hardware(0));
    }

    // ── ResolveCodec — Bug B regression (must never return empty codec) ──

    [Theory]
    [InlineData("av1")]
    [InlineData("h264")]
    [InlineData("hevc")]
    public void ResolveCodec_NeverReturnsEmpty(string userCodec)
    {
        var enc = CreateUninitializedEncoder(hardware: true);
        string codec = InvokeResolveCodec(enc, userCodec);
        Assert.False(string.IsNullOrWhiteSpace(codec),
            $"ResolveCodec('{userCodec}') must never return empty — got '{codec}'");
    }

    [Fact]
    public void ResolveCodec_av1_WhenAv1Unsupported_FallsBackToNonEmpty()
    {
        // Simulate the exact failure: vendor unknown (0) → MapUserCodec gives libsvtav1
        // → no HW AV1 support → fallback must still be a real codec, never "".
        var enc = CreateUninitializedEncoder(hardware: true);
        var resolved = InvokeResolveCodec(enc, "av1");
        Assert.False(string.IsNullOrWhiteSpace(resolved),
            $"AV1 fallback must be non-empty — got '{resolved}'");
    }

    // ─── SelectAmfPreset (preset AMF adaptativo por máquina) ────────────

    [Fact]
    public void SelectAmfPreset_HighQualitySustains_ReturnsHighQuality_ProbesWithCaptureDims()
    {
        // GPU forte: preset high_quality sustenta ≥ 0.85× do fps alvo → fica high_quality.
        // O probe recebe a resolução/fps reais da captura, não dados sintéticos.
        EncoderManager.ResetAmfPresetCache();
        var calls = new System.Collections.Generic.List<(string codec, int w, int h, int fps, string preset)>();
        var old = EncoderManager.ProbeAmfSpeedProbe;
        try
        {
            EncoderManager.ProbeAmfSpeedProbe = (codec, w, h, fps, preset) =>
            {
                calls.Add((codec, w, h, fps, preset));
                return fps * 0.9;
            };
            Assert.Equal("high_quality", EncoderManager.SelectAmfPreset("h264_amf", 1920, 1080, 60));
            var first = Assert.Single(calls);
            Assert.Equal("h264_amf", first.codec);
            Assert.Equal(1920, first.w);
            Assert.Equal(1080, first.h);
            Assert.Equal(60, first.fps);
            Assert.Equal("high_quality", first.preset);
        }
        finally
        {
            EncoderManager.ProbeAmfSpeedProbe = old;
            EncoderManager.ResetAmfPresetCache();
        }
    }

    [Fact]
    public void SelectAmfPreset_HighQualitySlow_QualitySustains_ReturnsQuality()
    {
        // DGPU média: high_quality não sustenta (<0.85×) → quality sustenta → quality.
        EncoderManager.ResetAmfPresetCache();
        var presets = new System.Collections.Generic.List<string>();
        var old = EncoderManager.ProbeAmfSpeedProbe;
        try
        {
            EncoderManager.ProbeAmfSpeedProbe = (_, _, _, fps, preset) =>
            {
                presets.Add(preset);
                return preset == "high_quality" ? fps * 0.5 : fps * 0.95;
            };
            Assert.Equal("quality", EncoderManager.SelectAmfPreset("h264_amf", 1920, 1080, 60));
            Assert.Equal(new[] { "high_quality", "quality" }, presets);
        }
        finally
        {
            EncoderManager.ProbeAmfSpeedProbe = old;
            EncoderManager.ResetAmfPresetCache();
        }
    }

    [Fact]
    public void SelectAmfPreset_QualitySlow_BalancedSustains_ReturnsBalanced()
    {
        // Escada: high_quality e quality não sustentam (<0.85×) → balanced sustenta → balanced.
        EncoderManager.ResetAmfPresetCache();
        var presets = new System.Collections.Generic.List<string>();
        var old = EncoderManager.ProbeAmfSpeedProbe;
        try
        {
            EncoderManager.ProbeAmfSpeedProbe = (_, _, _, fps, preset) =>
            {
                presets.Add(preset);
                return preset is "high_quality" or "quality" ? fps * 0.5 : fps * 0.95;
            };
            Assert.Equal("balanced", EncoderManager.SelectAmfPreset("h264_amf", 1920, 1080, 60));
            Assert.Equal(new[] { "high_quality", "quality", "balanced" }, presets);
        }
        finally
        {
            EncoderManager.ProbeAmfSpeedProbe = old;
            EncoderManager.ResetAmfPresetCache();
        }
    }

    [Fact]
    public void SelectAmfPreset_AllSlow_ReturnsSpeed()
    {
        // GPU muito fraca (iGPU/VCN 1.0): nenhum preset sustenta → último degrau (speed).
        EncoderManager.ResetAmfPresetCache();
        var presets = new System.Collections.Generic.List<string>();
        var old = EncoderManager.ProbeAmfSpeedProbe;
        try
        {
            EncoderManager.ProbeAmfSpeedProbe = (_, _, _, fps, preset) =>
            {
                presets.Add(preset);
                return fps * 0.5;
            };
            Assert.Equal("speed", EncoderManager.SelectAmfPreset("h264_amf", 1920, 1080, 60));
            Assert.Equal(new[] { "high_quality", "quality", "balanced", "speed" }, presets);
        }
        finally
        {
            EncoderManager.ProbeAmfSpeedProbe = old;
            EncoderManager.ResetAmfPresetCache();
        }
    }

    [Fact]
    public void SelectAmfPreset_ProbeThrows_DegradesToSpeed()
    {
        // Exceção no probe = não sustenta → degrada; se todos falham, speed (fail-safe).
        EncoderManager.ResetAmfPresetCache();
        var presets = new System.Collections.Generic.List<string>();
        var old = EncoderManager.ProbeAmfSpeedProbe;
        try
        {
            EncoderManager.ProbeAmfSpeedProbe = (_, _, _, _, preset) =>
            {
                presets.Add(preset);
                throw new System.Exception("probe boom");
            };
            Assert.Equal("speed", EncoderManager.SelectAmfPreset("h264_amf", 1920, 1080, 60));
            Assert.Equal(new[] { "high_quality", "quality", "balanced", "speed" }, presets);
        }
        finally
        {
            EncoderManager.ProbeAmfSpeedProbe = old;
            EncoderManager.ResetAmfPresetCache();
        }
    }

    [Fact]
    public void SelectAmfPreset_ProbeReturnsNull_ReturnsSpeed()
    {
        // Probe sem medição (ffmpeg ausente/erro) → degrada até speed (preset mais leve, seguro).
        EncoderManager.ResetAmfPresetCache();
        var old = EncoderManager.ProbeAmfSpeedProbe;
        try
        {
            EncoderManager.ProbeAmfSpeedProbe = (_, _, _, _, _) => null;
            Assert.Equal("speed", EncoderManager.SelectAmfPreset("h264_amf", 1920, 1080, 60));
        }
        finally
        {
            EncoderManager.ProbeAmfSpeedProbe = old;
            EncoderManager.ResetAmfPresetCache();
        }
    }

    [Fact]
    public void SelectAmfPreset_NonAmfCodec_ReturnsSpeed_WithoutProbe()
    {
        // Codec não-AMF (NVENC/QSV/CPU) não passa pelo probe — retorna speed direto.
        EncoderManager.ResetAmfPresetCache();
        var count = 0;
        var old = EncoderManager.ProbeAmfSpeedProbe;
        try
        {
            EncoderManager.ProbeAmfSpeedProbe = (_, _, _, fps, _) => { count++; return fps * 0.9; };
            Assert.Equal("speed", EncoderManager.SelectAmfPreset("h264_nvenc", 1920, 1080, 60));
            Assert.Equal(0, count);
        }
        finally
        {
            EncoderManager.ProbeAmfSpeedProbe = old;
            EncoderManager.ResetAmfPresetCache();
        }
    }

    [Fact]
    public void SelectAmfPreset_CachesByCodecResolutionFps()
    {
        // Cache estático chaveado por codec|res|fps — 1 probe por combinação por sessão.
        EncoderManager.ResetAmfPresetCache();
        var count = 0;
        var old = EncoderManager.ProbeAmfSpeedProbe;
        try
        {
            EncoderManager.ProbeAmfSpeedProbe = (_, _, _, fps, _) => { count++; return fps * 0.9; };
            Assert.Equal("high_quality", EncoderManager.SelectAmfPreset("h264_amf", 1920, 1080, 60));
            Assert.Equal("high_quality", EncoderManager.SelectAmfPreset("h264_amf", 1920, 1080, 60));
            Assert.Equal(1, count);
            EncoderManager.SelectAmfPreset("h264_amf", 1280, 720, 60);
            Assert.Equal(2, count);
        }
        finally
        {
            EncoderManager.ProbeAmfSpeedProbe = old;
            EncoderManager.ResetAmfPresetCache();
        }
    }

    // ─── SelectAmfPreanalysis (PA/TAQ adaptativo, só GPU forte) ───────────

    [Fact]
    public void SelectAmfPreanalysis_QualitySustains_ReturnsTrue_ProbesWithPreset()
    {
        // DGPU forte (quality sustentado): preanalysis+TAQ habilitado, probe com o preset real.
        EncoderManager.ResetAmfPreanalysisCache();
        var calls = new System.Collections.Generic.List<(string codec, int w, int h, int fps, string preset)>();
        var old = EncoderManager.ProbeAmfPreanalysisProbe;
        try
        {
            EncoderManager.ProbeAmfPreanalysisProbe = (codec, w, h, fps, preset) =>
            {
                calls.Add((codec, w, h, fps, preset));
                return fps * 0.9;
            };
            Assert.True(EncoderManager.SelectAmfPreanalysis("h264_amf", 1920, 1080, 60, "quality"));
            var first = Assert.Single(calls);
            Assert.Equal("h264_amf", first.codec);
            Assert.Equal(1920, first.w);
            Assert.Equal(1080, first.h);
            Assert.Equal(60, first.fps);
            Assert.Equal("quality", first.preset);
        }
        finally
        {
            EncoderManager.ProbeAmfPreanalysisProbe = old;
            EncoderManager.ResetAmfPreanalysisCache();
        }
    }

    [Fact]
    public void SelectAmfPreanalysis_HighQualitySustains_ReturnsTrue()
    {
        // high_quality sustentado (topo da escada) → PA/TAQ ligado (GPU máxima).
        EncoderManager.ResetAmfPreanalysisCache();
        var old = EncoderManager.ProbeAmfPreanalysisProbe;
        try
        {
            EncoderManager.ProbeAmfPreanalysisProbe = (_, _, _, fps, _) => fps * 0.9;
            Assert.True(EncoderManager.SelectAmfPreanalysis("h264_amf", 1920, 1080, 60, "high_quality"));
        }
        finally
        {
            EncoderManager.ProbeAmfPreanalysisProbe = old;
            EncoderManager.ResetAmfPreanalysisCache();
        }
    }

    [Fact]
    public void SelectAmfPreanalysis_ProbeSlow_ReturnsFalse()
    {
        // PA/TAQ pesa — se o probe não sustenta ≥0.85×, mantém OFF (segurança).
        EncoderManager.ResetAmfPreanalysisCache();
        var old = EncoderManager.ProbeAmfPreanalysisProbe;
        try
        {
            EncoderManager.ProbeAmfPreanalysisProbe = (_, _, _, fps, _) => fps * 0.5;
            Assert.False(EncoderManager.SelectAmfPreanalysis("h264_amf", 1920, 1080, 60, "quality"));
        }
        finally
        {
            EncoderManager.ProbeAmfPreanalysisProbe = old;
            EncoderManager.ResetAmfPreanalysisCache();
        }
    }

    [Fact]
    public void SelectAmfPreanalysis_ProbeThrows_ReturnsFalse()
    {
        // Exceção no probe → PA/TAQ OFF (nunca derruba o encode por PA).
        EncoderManager.ResetAmfPreanalysisCache();
        var old = EncoderManager.ProbeAmfPreanalysisProbe;
        try
        {
            EncoderManager.ProbeAmfPreanalysisProbe = (_, _, _, _, _) => throw new System.Exception("pa boom");
            Assert.False(EncoderManager.SelectAmfPreanalysis("h264_amf", 1920, 1080, 60, "quality"));
        }
        finally
        {
            EncoderManager.ProbeAmfPreanalysisProbe = old;
            EncoderManager.ResetAmfPreanalysisCache();
        }
    }

    [Fact]
    public void SelectAmfPreanalysis_BalancedOrSpeed_ReturnsFalse_WithoutProbe()
    {
        // iGPU/VCN 1.0 degradou para balanced/speed → PA/TAQ OFF sem nem sondar.
        EncoderManager.ResetAmfPreanalysisCache();
        var count = 0;
        var old = EncoderManager.ProbeAmfPreanalysisProbe;
        try
        {
            EncoderManager.ProbeAmfPreanalysisProbe = (_, _, _, _, _) => { count++; return 0.0; };
            Assert.False(EncoderManager.SelectAmfPreanalysis("h264_amf", 1920, 1080, 60, "balanced"));
            Assert.False(EncoderManager.SelectAmfPreanalysis("h264_amf", 1920, 1080, 60, "speed"));
            Assert.Equal(0, count);
        }
        finally
        {
            EncoderManager.ProbeAmfPreanalysisProbe = old;
            EncoderManager.ResetAmfPreanalysisCache();
        }
    }

    [Fact]
    public void SelectAmfPreanalysis_NonAmfCodec_ReturnsFalse_WithoutProbe()
    {
        EncoderManager.ResetAmfPreanalysisCache();
        var count = 0;
        var old = EncoderManager.ProbeAmfPreanalysisProbe;
        try
        {
            EncoderManager.ProbeAmfPreanalysisProbe = (_, _, _, _, _) => { count++; return 0.0; };
            Assert.False(EncoderManager.SelectAmfPreanalysis("h264_nvenc", 1920, 1080, 60, "quality"));
            Assert.False(EncoderManager.SelectAmfPreanalysis("hevc_qsv", 1920, 1080, 60, "quality"));
            Assert.Equal(0, count);
        }
        finally
        {
            EncoderManager.ProbeAmfPreanalysisProbe = old;
            EncoderManager.ResetAmfPreanalysisCache();
        }
    }

    [Fact]
    public void SelectAmfPreanalysis_CachesByCodecResFpsPreset()
    {
        EncoderManager.ResetAmfPreanalysisCache();
        var count = 0;
        var old = EncoderManager.ProbeAmfPreanalysisProbe;
        try
        {
            EncoderManager.ProbeAmfPreanalysisProbe = (_, _, _, fps, _) => { count++; return fps * 0.9; };
            Assert.True(EncoderManager.SelectAmfPreanalysis("h264_amf", 1920, 1080, 60, "quality"));
            Assert.True(EncoderManager.SelectAmfPreanalysis("h264_amf", 1920, 1080, 60, "quality"));
            Assert.Equal(1, count);
            EncoderManager.SelectAmfPreanalysis("h264_amf", 1920, 1080, 60, "high_quality");
            Assert.Equal(2, count);
        }
        finally
        {
            EncoderManager.ProbeAmfPreanalysisProbe = old;
            EncoderManager.ResetAmfPreanalysisCache();
        }
    }

    // ─── SupportsSmartAccessVideo (SAV, APU+dGPU / múltiplos VCN) ────────

    [Fact]
    public void SupportsSmartAccessVideo_AmdMultiGpu_ProbeOk_ReturnsTrue()
    {
        // APU + dGPU AMD: adapter count ≥ 2 E probe real com -smart_access_video 1 → SAV liga.
        EncoderManager.ResetAmfSavCache();
        var oldAdapter = EncoderManager.AmdAdapterCountProbe;
        var oldProbe = EncoderManager.ProbeAmfSavProbe;
        try
        {
            EncoderManager.AmdAdapterCountProbe = () => 2;
            EncoderManager.ProbeAmfSavProbe = (_, _, _, _) => true;
            Assert.True(EncoderManager.SupportsSmartAccessVideo("h264_amf", 1920, 1080, 60));
        }
        finally
        {
            EncoderManager.AmdAdapterCountProbe = oldAdapter;
            EncoderManager.ProbeAmfSavProbe = oldProbe;
            EncoderManager.ResetAmfSavCache();
        }
    }

    [Fact]
    public void SupportsSmartAccessVideo_AmdMultiGpu_ProbeFails_ReturnsFalse()
    {
        // Dois adapters AMD mas probe real falha (driver/dGPU não suporta SAV) → OFF.
        EncoderManager.ResetAmfSavCache();
        var oldAdapter = EncoderManager.AmdAdapterCountProbe;
        var oldProbe = EncoderManager.ProbeAmfSavProbe;
        try
        {
            EncoderManager.AmdAdapterCountProbe = () => 2;
            EncoderManager.ProbeAmfSavProbe = (_, _, _, _) => false;
            Assert.False(EncoderManager.SupportsSmartAccessVideo("h264_amf", 1920, 1080, 60));
        }
        finally
        {
            EncoderManager.AmdAdapterCountProbe = oldAdapter;
            EncoderManager.ProbeAmfSavProbe = oldProbe;
            EncoderManager.ResetAmfSavCache();
        }
    }

    [Fact]
    public void SupportsSmartAccessVideo_SingleGpu_ReturnsFalse_WithoutProbe()
    {
        // Desktops dGPU-only / iGPU-only não têm 2 VCNs — SAV OFF sem custo de probe.
        EncoderManager.ResetAmfSavCache();
        var adapterCall = 0;
        var probeCall = 0;
        var oldAdapter = EncoderManager.AmdAdapterCountProbe;
        var oldProbe = EncoderManager.ProbeAmfSavProbe;
        try
        {
            EncoderManager.AmdAdapterCountProbe = () => { adapterCall++; return 1; };
            EncoderManager.ProbeAmfSavProbe = (_, _, _, _) => { probeCall++; return true; };
            Assert.False(EncoderManager.SupportsSmartAccessVideo("h264_amf", 1920, 1080, 60));
            Assert.Equal(1, adapterCall);
            Assert.Equal(0, probeCall);
        }
        finally
        {
            EncoderManager.AmdAdapterCountProbe = oldAdapter;
            EncoderManager.ProbeAmfSavProbe = oldProbe;
            EncoderManager.ResetAmfSavCache();
        }
    }

    [Fact]
    public void SupportsSmartAccessVideo_NonAmfCodec_ReturnsFalse_WithoutProbe()
    {
        EncoderManager.ResetAmfSavCache();
        var adapterCall = 0;
        var probeCall = 0;
        var oldAdapter = EncoderManager.AmdAdapterCountProbe;
        var oldProbe = EncoderManager.ProbeAmfSavProbe;
        try
        {
            EncoderManager.AmdAdapterCountProbe = () => { adapterCall++; return 2; };
            EncoderManager.ProbeAmfSavProbe = (_, _, _, _) => { probeCall++; return true; };
            Assert.False(EncoderManager.SupportsSmartAccessVideo("h264_nvenc", 1920, 1080, 60));
            Assert.Equal(0, adapterCall);
            Assert.Equal(0, probeCall);
        }
        finally
        {
            EncoderManager.AmdAdapterCountProbe = oldAdapter;
            EncoderManager.ProbeAmfSavProbe = oldProbe;
            EncoderManager.ResetAmfSavCache();
        }
    }

    [Fact]
    public void SupportsSmartAccessVideo_CachesPerCodecResFps()
    {
        EncoderManager.ResetAmfSavCache();
        var adapterCall = 0;
        var oldAdapter = EncoderManager.AmdAdapterCountProbe;
        var oldProbe = EncoderManager.ProbeAmfSavProbe;
        try
        {
            EncoderManager.AmdAdapterCountProbe = () => { adapterCall++; return 2; };
            EncoderManager.ProbeAmfSavProbe = (_, _, _, _) => true;
            Assert.True(EncoderManager.SupportsSmartAccessVideo("h264_amf", 1920, 1080, 60));
            Assert.True(EncoderManager.SupportsSmartAccessVideo("h264_amf", 1920, 1080, 60));
            Assert.Equal(1, adapterCall);
            EncoderManager.SupportsSmartAccessVideo("av1_amf", 1920, 1080, 60);
            Assert.Equal(2, adapterCall);
        }
        finally
        {
            EncoderManager.AmdAdapterCountProbe = oldAdapter;
            EncoderManager.ProbeAmfSavProbe = oldProbe;
            EncoderManager.ResetAmfSavCache();
        }
    }

    private static FfmpegEncoder CreateUninitializedEncoder(bool hardware)
    {
        var enc = (FfmpegEncoder)System.Runtime.CompilerServices.RuntimeHelpers
            .GetUninitializedObject(typeof(FfmpegEncoder));
        typeof(FfmpegEncoder).GetField("_useHardware",
            BindingFlags.NonPublic | BindingFlags.Instance)!.SetValue(enc, hardware);
        return enc;
    }

    private static string InvokeResolveCodec(FfmpegEncoder encoder, string codec)
    {
        var method = typeof(FfmpegEncoder).GetMethod("ResolveCodec",
            BindingFlags.NonPublic | BindingFlags.Instance);
        Assert.NotNull(method);
        return (string)method!.Invoke(encoder, [codec])!;
    }
}
