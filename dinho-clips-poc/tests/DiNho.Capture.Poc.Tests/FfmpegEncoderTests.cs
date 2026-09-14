using DiNho.Capture.Poc.Encoders;
using System.Diagnostics;
using System.Reflection;
using System.Threading.Channels;
using Vortice.Direct3D11;
using Vortice.DXGI;

namespace DiNho.Capture.Poc.Tests;

public sealed class FfmpegEncoderTests
{
    // ─── Reflection helpers (campos privados de FfmpegEncoder) ─────────

    private static T GetField<T>(FfmpegEncoder encoder, string name)
    {
        var field = typeof(FfmpegEncoder).GetField(name, BindingFlags.NonPublic | BindingFlags.Instance);
        Assert.NotNull(field);
        return (T)field!.GetValue(encoder)!;
    }

    private static void SetField(FfmpegEncoder encoder, string name, object? value)
    {
        var field = typeof(FfmpegEncoder).GetField(name, BindingFlags.NonPublic | BindingFlags.Instance);
        Assert.NotNull(field);
        field!.SetValue(encoder, value);
    }

    // ─── M2: drops do _outputChannel ──────────────────────────────────

    [Fact]
    public void OutputChannel_WhenOverflowed_IncrementsDroppedPackets()
    {
        using var enc = new FfmpegEncoder();
        var channel = GetField<Channel<EncodedPacket>>(enc, "_outputChannel");
        Assert.NotNull(channel);

        // Capacidade 256 (DropOldest). Escrever 300 → 44 drops chamando itemDropped.
        for (int i = 0; i < 300; i++)
        {
            var pkt = new EncodedPacket(new byte[] { (byte)i }, MediaType.Video,
                TimeSpan.FromMilliseconds(i), TimeSpan.FromMilliseconds(16), isKeyFrame: false);
            Assert.True(channel.Writer.TryWrite(pkt));
        }

        Assert.Equal(44, GetField<int>(enc, "_droppedPackets"));
    }

    [Fact]
    public void OutputChannel_NoOverflow_ZeroDropped()
    {
        using var enc = new FfmpegEncoder();
        var channel = GetField<Channel<EncodedPacket>>(enc, "_outputChannel");
        for (int i = 0; i < 100; i++)
        {
            var pkt = new EncodedPacket(new byte[] { (byte)i }, MediaType.Video,
                TimeSpan.FromMilliseconds(i), TimeSpan.FromMilliseconds(16), isKeyFrame: false);
            Assert.True(channel.Writer.TryWrite(pkt));
        }
        Assert.Equal(0, GetField<int>(enc, "_droppedPackets"));
    }

    [Fact]
    public void OutputChannel_DroppedPacket_RetainsNewest()
    {
        // DropOldest: ao encher, o MAIS ANTIGO é descartado — os frames recentes
        // (ponto de save do replay buffer) sobrevivem.
        using var enc = new FfmpegEncoder();
        var channel = GetField<Channel<EncodedPacket>>(enc, "_outputChannel");

        for (int i = 0; i < 300; i++)
        {
            var pkt = new EncodedPacket(new byte[] { (byte)(i & 0xFF) }, MediaType.Video,
                TimeSpan.FromMilliseconds(i), TimeSpan.FromMilliseconds(16), isKeyFrame: false);
            Assert.True(channel.Writer.TryWrite(pkt));
        }

        var remaining = new List<EncodedPacket>();
        while (channel.Reader.TryRead(out var pkt))
        {
            remaining.Add(pkt);
            pkt.Release();
        }

        Assert.Equal(256, remaining.Count);
        // O pacote 0 (mais antigo) foi dropado; o 299 (mais novo) sobreviveu.
        Assert.True(remaining.All(p => p.Pts > TimeSpan.Zero));
        Assert.Contains(remaining, p => p.Pts == TimeSpan.FromMilliseconds(299));
    }

    // ─── L2: guard no Flush() ─────────────────────────────────────────

    [Fact]
    public void Flush_WhenDisposed_DoesNotRestartFfmpeg()
    {
        using var enc = new FfmpegEncoder();
        SetField(enc, "_disposed", true);
        SetField(enc, "_process", null);

        enc.Flush();

        // Sem respawn: _process continua nulo (StartFfmpeg não é chamado).
        Assert.Null(GetField<object?>(enc, "_process"));
    }

    [Fact]
    public void Flush_WhenProcessNull_DoesNotRestartFfmpeg()
    {
        using var enc = new FfmpegEncoder();
        SetField(enc, "_process", null);

        enc.Flush();

        Assert.Null(GetField<object?>(enc, "_process"));
    }

    [Fact]
    public void Flush_WhenDisposed_StillDrainsPendingOutputs()
    {
        // Mesmo sem reiniciar ffmpeg, os pacotes do channel são drenados para
        // _pendingOutputs (consumido pelo save) — o guard só impede o respawn.
        using var enc = new FfmpegEncoder();
        SetField(enc, "_disposed", true);
        var channel = GetField<Channel<EncodedPacket>>(enc, "_outputChannel");
        var pkt = new EncodedPacket(new byte[] { 0x01 }, MediaType.Video,
            TimeSpan.FromMilliseconds(1), TimeSpan.FromMilliseconds(16), isKeyFrame: true);
        channel.Writer.TryWrite(pkt);

        enc.Flush();

        var pending = GetField<Queue<EncodedPacket>>(enc, "_pendingOutputs");
        Assert.Single(pending);
        while (pending.Count > 0) pending.Dequeue().Release();
    }

    [Theory]
    [InlineData("h264_nvenc")]
    [InlineData("h264_amf")]
    [InlineData("libx264")]
    public void CheckFfmpegEncoder_FindsKnownEncoders(string encoder)
    {
        var result = FfmpegEncoder.CheckFfmpegEncoder(encoder);
        Assert.True(result, $"Expected ffmpeg to have {encoder} available");
    }

    [Theory]
    [InlineData("nonexistent_codec_xyz")]
    [InlineData("")]
    [InlineData("  ")]
    public void CheckFfmpegEncoder_ReturnsFalseForUnknown(string encoder)
    {
        var result = FfmpegEncoder.CheckFfmpegEncoder(encoder);
        Assert.False(result);
    }

    // ─── IsAnnexB ───────────────────────────────────────────────────────

    [Fact]
    public void IsAnnexB_StartCode_00_00_01_ReturnsTrue()
    {
        var buf = new byte[] { 0x00, 0x00, 0x01, 0x67 };
        Assert.True(FfmpegEncoder.IsAnnexB(buf, buf.Length));
    }

    [Fact]
    public void IsAnnexB_StartCode_00_00_00_01_ReturnsTrue()
    {
        var buf = new byte[] { 0x00, 0x00, 0x00, 0x01, 0x67 };
        Assert.True(FfmpegEncoder.IsAnnexB(buf, buf.Length));
    }

    [Fact]
    public void IsAnnexB_AvccFormat_ReturnsFalse()
    {
        var buf = new byte[] { 0x00, 0x00, 0x00, 0x19, 0x67 };
        Assert.False(FfmpegEncoder.IsAnnexB(buf, buf.Length));
    }

    [Fact]
    public void IsAnnexB_TooShort_ReturnsFalse()
    {
        var buf = new byte[] { 0x00, 0x00 };
        Assert.False(FfmpegEncoder.IsAnnexB(buf, buf.Length));
    }

    [Fact]
    public void IsAnnexB_DataWithoutStartCode_ReturnsFalse()
    {
        var buf = new byte[] { 0x67, 0x68, 0x69 };
        Assert.False(FfmpegEncoder.IsAnnexB(buf, buf.Length));
    }

    // ─── ScanForStartCode ───────────────────────────────────────────────

    [Fact]
    public void ScanForStartCode_FindsCodeAtBeginning()
    {
        var buf = new byte[] { 0x00, 0x00, 0x01, 0x67, 0x68, 0x69 };
        Assert.True(FfmpegEncoder.ScanForStartCode(buf, buf.Length, out var pos));
        Assert.Equal(0, pos);
    }

    [Fact]
    public void ScanForStartCode_FindsCodeAtOffset()
    {
        var buf = new byte[] { 0x67, 0x00, 0x00, 0x01, 0x68 };
        Assert.True(FfmpegEncoder.ScanForStartCode(buf, buf.Length, out var pos));
        Assert.Equal(1, pos);
    }

    [Fact]
    public void ScanForStartCode_FindsFourByteCode()
    {
        var buf = new byte[] { 0x00, 0x00, 0x00, 0x01, 0x67 };
        Assert.True(FfmpegEncoder.ScanForStartCode(buf, buf.Length, out var pos));
        Assert.Equal(0, pos);
    }

    [Fact]
    public void ScanForStartCode_NoCode_ReturnsFalse()
    {
        var buf = new byte[] { 0xAA, 0xBB, 0xCC, 0x01 };
        Assert.False(FfmpegEncoder.ScanForStartCode(buf, buf.Length, out _));
    }

    [Fact]
    public void ScanForStartCode_EmptyBuffer_ReturnsFalse()
    {
        Assert.False(FfmpegEncoder.ScanForStartCode([], 0, out _));
    }

    [Fact]
    public void ScanForStartCode_TooShort_ReturnsFalse()
    {
        var buf = new byte[] { 0x00, 0x01 };
        Assert.False(FfmpegEncoder.ScanForStartCode(buf, buf.Length, out _));
    }

    [Fact]
    public void ScanForStartCode_FirstOfMultipleCodes()
    {
        var buf = new byte[] { 0x41, 0x00, 0x00, 0x01, 0x67, 0x00, 0x00, 0x01, 0x68 };
        Assert.True(FfmpegEncoder.ScanForStartCode(buf, buf.Length, out var pos));
        Assert.Equal(1, pos);
    }

    // ─── ConvertAnnexBToAvcc ────────────────────────────────────────────
    //
    // ConvertAnnexBToAvcc processes data incrementally. It scans for AnnexB
    // start codes and writes AVCC (4-byte length-prefixed) NALUs into the
    // same buffer. A NALU is only written when there is data BETWEEN two
    // start codes — the first start code opens it, the next closes it.
    // The last "orphaned" NALU body (after the final start code) is NOT
    // written; instead `consumed` tells the caller where to preserve
    // orphaned data for the next call.

    [Fact]
    public void ConvertAnnexBToAvcc_SingleStartCode_NoNaluWritten()
    {
        // One start code, one NALU body, but no following start code → orphaned
        var buf = new byte[] { 0x00, 0x00, 0x01, 0x67, 0x68 };
        var result = FfmpegEncoder.ConvertAnnexBToAvcc(buf, buf.Length, out var consumed);
        Assert.Equal(0, result); // no NALU between two start codes
        Assert.Equal(3, consumed); // orphaned body starts after the SC
    }

    [Fact]
    public void ConvertAnnexBToAvcc_MultipleNalus_FirstWritten()
    {
        // Two NALUs: first delimited by start codes on both sides → written
        // Second: no following start code → orphaned
        var buf = new byte[]
        {
            0x00, 0x00, 0x01, 0x67, 0xAA, // SC + SPS body (2B)
            0x00, 0x00, 0x01, 0x68, 0xBB  // SC + PPS body (2B, orphaned)
        };
        var result = FfmpegEncoder.ConvertAnnexBToAvcc(buf, buf.Length, out var consumed);
        // AVCC: [len=2][0x67, 0xAA] = 6 bytes
        Assert.Equal(6, result);
        Assert.Equal(8, consumed); // bytes 0-7 consumed, orphaned tail at 8

        // Verify length prefix
        Assert.Equal(0x00, buf[0]);
        Assert.Equal(0x00, buf[1]);
        Assert.Equal(0x00, buf[2]);
        Assert.Equal(0x02, buf[3]);
        Assert.Equal(0x67, buf[4]);
        Assert.Equal(0xAA, buf[5]);
    }

    [Fact]
    public void ConvertAnnexBToAvcc_EmptyBuffer_ReturnsZero()
    {
        var result = FfmpegEncoder.ConvertAnnexBToAvcc([], 0, out var consumed);
        Assert.Equal(0, result);
        Assert.Equal(0, consumed);
    }

    [Fact]
    public void ConvertAnnexBToAvcc_OnlyStartCode_NoNaluBody_ReturnsZero()
    {
        var buf = new byte[] { 0x00, 0x00, 0x01 };
        var result = FfmpegEncoder.ConvertAnnexBToAvcc(buf, buf.Length, out var consumed);
        Assert.Equal(0, result);
        Assert.Equal(3, consumed);
    }

    [Fact]
    public void ConvertAnnexBToAvcc_OrphanedTail_Processed()
    {
        // Orphaned tail before start code IS processed (foundFirstSc=true when
        // first SC is not at position 0). Data DE AD before SC is a continuation
        // from a previous call's last NALU.
        var buf = new byte[] { 0xDE, 0xAD, 0x00, 0x00, 0x01, 0x67 };
        var result = FfmpegEncoder.ConvertAnnexBToAvcc(buf, buf.Length, out var consumed);
        Assert.Equal(6, result); // AVCC: [len=2][DE,AD] = 6 bytes
        Assert.Equal(5, consumed); // orphaned 0x67 at position 5
    }

    [Fact]
    public void ConvertAnnexBToAvcc_IncompleteTail_Orphaned()
    {
        // Start code + body, but body extends to end without following SC
        var buf = new byte[] { 0x00, 0x00, 0x01, 0x67, 0xDE };
        var result = FfmpegEncoder.ConvertAnnexBToAvcc(buf, buf.Length, out var consumed);
        Assert.Equal(0, result); // no NALU delimited by two SCs
        Assert.Equal(3, consumed);
    }

    [Fact]
    public void ConvertAnnexBToAvcc_FourByteStartCode_Orphaned()
    {
        var buf = new byte[] { 0x00, 0x00, 0x00, 0x01, 0x67, 0x68 };
        var result = FfmpegEncoder.ConvertAnnexBToAvcc(buf, buf.Length, out var consumed);
        Assert.Equal(0, result);
        Assert.Equal(4, consumed); // 4-byte SC consumed
    }

    [Fact]
    public void ConvertAnnexBToAvcc_OnlyGarbage_NoStartCode_ReturnsZero()
    {
        var buf = new byte[] { 0x67, 0x68, 0x69 };
        var result = FfmpegEncoder.ConvertAnnexBToAvcc(buf, buf.Length, out var consumed);
        Assert.Equal(0, result);
        Assert.Equal(0, consumed); // no start code found
    }

    [Fact]
    public void ConvertAnnexBToAvcc_KeyframeSequence_FirstTwoWritten()
    {
        // SPS + PPS are delimited by following start codes → written
        // IDR slice is orphaned (no following SC)
        var buf = new byte[]
        {
            0x00, 0x00, 0x01, 0x67, 0x64, 0x00, 0x1E, // SC + SPS (4B body)
            0x00, 0x00, 0x01, 0x68, 0xEB,             // SC + PPS (2B body)
            0x00, 0x00, 0x01, 0x65, 0x88, 0x84        // SC + IDR (3B body, orphaned)
        };
        var result = FfmpegEncoder.ConvertAnnexBToAvcc(buf, buf.Length, out var consumed);
        // SPS: [len=4][4B] = 8, PPS: [len=2][2B] = 6, total = 14
        Assert.Equal(14, result);
        Assert.Equal(15, consumed); // orphaned IDR body (0x65,0x88,0x84) starts at position 15
    }

    [Fact]
    public void ConvertAnnexBToAvcc_ThreeDelimited_SuccessiveNalus()
    {
        // Three NALUs each followed by a start code for the NEXT one.
        // First two are written, third is orphaned.
        var buf = new byte[]
        {
            0x00, 0x00, 0x01, 0x41,
            0x00, 0x00, 0x01, 0x42,
            0x00, 0x00, 0x01, 0x43
        };
        var result = FfmpegEncoder.ConvertAnnexBToAvcc(buf, buf.Length, out var consumed);
        // First NALU: [len=1][0x41] = 5
        // Second NALU: [len=1][0x42] = 5
        // Total: 10
        Assert.Equal(10, result);
        Assert.Equal(11, consumed); // orphaned 0x43 at position 11
    }

    [Fact]
    public void ConvertAnnexBToAvcc_LargeNaluWrittenThenSmallNalu()
    {
        // First NALU has 100 bytes body; second NALU 1 byte body (orphaned)
        var buf = new byte[106];
        buf[0] = 0x00; buf[1] = 0x00; buf[2] = 0x01; // SC for first NALU
        for (int i = 3; i < 103; i++) buf[i] = (byte)(i - 3); // 100-byte NALU body
        buf[103] = 0x00; buf[104] = 0x00; buf[105] = 0x01; // SC for second NALU

        var result = FfmpegEncoder.ConvertAnnexBToAvcc(buf, buf.Length, out var consumed);
        // First NALU: [len=100][100B] = 104 bytes
        Assert.Equal(104, result);
        Assert.Equal(106, consumed); // second SC at 103 + 3 = 106
        Assert.Equal(0x64, buf[3]); // length = 100 = 0x64
    }

    [Fact]
    public void ConvertAnnexBToAvcc_OrphanedTail_DataBeforeFirstScProcessed()
    {
        // Data before first start code is orphaned from a previous pipe read —
        // now processed correctly as continuation NALU.
        var buf = new byte[] { 0xDE, 0xAD, 0x00, 0x00, 0x01, 0x67 };
        var result = FfmpegEncoder.ConvertAnnexBToAvcc(buf, buf.Length, out var consumed);
        Assert.Equal(6, result); // AVCC: [len=2][DE,AD] = 6 bytes
        Assert.Equal(5, consumed); // orphaned 0x67 at position 5
    }

    [Fact]
    public void ConvertAnnexBToAvcc_OrphanedThenCompleteNalu_OrphanProcessed()
    {
        // Orphan tail from call1 (0x67, 0xAA) IS processed now.
        // The second NALU after the SC is orphaned (no following SC).
        var combined = new byte[] { 0x67, 0xAA, 0x00, 0x00, 0x01, 0x68, 0xBB };
        var result = FfmpegEncoder.ConvertAnnexBToAvcc(combined, combined.Length, out var consumed);
        // Orphan (0x67, 0xAA) written as AVCC: [len=2][0x67,0xAA] = 6 bytes.
        // NALU (0x68, 0xBB) is orphaned — no following SC.
        Assert.Equal(6, result);
        Assert.Equal(5, consumed);
    }

    // ─── ComputeScaleTarget ─────────────────────────────────────────────

    [Fact]
    public void ComputeScaleTarget_NoUserOutput_NoFallback_ReturnsNull()
    {
        var result = FfmpegEncoder.ComputeScaleTarget(1920, 1080, 0, 0, 1);
        Assert.Null(result);
    }

    [Fact]
    public void ComputeScaleTarget_UserOutputDownscalesCapture()
    {
        var result = FfmpegEncoder.ComputeScaleTarget(1920, 1080, 1280, 720, 1);
        Assert.NotNull(result);
        Assert.Equal((1280, 720), result!.Value);
    }

    [Fact]
    public void ComputeScaleTarget_UserOutputEqualInput_ReturnsNull()
    {
        var result = FfmpegEncoder.ComputeScaleTarget(1280, 720, 1280, 720, 1);
        Assert.Null(result);
    }

    [Fact]
    public void ComputeScaleTarget_OddOutputRoundedDownToEven()
    {
        var result = FfmpegEncoder.ComputeScaleTarget(1920, 1080, 855, 481, 1);
        Assert.NotNull(result);
        Assert.Equal((854, 480), result!.Value);
    }

    [Fact]
    public void ComputeScaleTarget_UserOutputLargerThanInput_NoUpscale()
    {
        // Jogo rodando em 720p com preset 1080p — nunca faz upscale.
        var result = FfmpegEncoder.ComputeScaleTarget(1280, 720, 1920, 1080, 1);
        Assert.Null(result);
    }

    [Fact]
    public void ComputeScaleTarget_FallbackDivisor_DoesNotReduceBelowUserOutput()
    {
        // Cascading fallback 1/2 + user 720p num capture 1920×1080 → mantém 1280×720.
        // O alvo explícito do usuário é o piso — fallback troca encoder, nunca a resolução.
        var result = FfmpegEncoder.ComputeScaleTarget(1920, 1080, 1280, 720, 2);
        Assert.NotNull(result);
        Assert.Equal((1280, 720), result!.Value);
    }

    [Fact]
    public void ComputeScaleTarget_FallbackDivisor_AppliesWhenNative()
    {
        // Sem resolução explícita do usuário (nativo) + fallback 1/2 → reduz para 960×540.
        var result = FfmpegEncoder.ComputeScaleTarget(1920, 1080, 0, 0, 2);
        Assert.NotNull(result);
        Assert.Equal((960, 540), result!.Value);
    }

    [Fact]
    public void ComputeScaleTarget_FallbackOnly_Downscales()
    {
        var result = FfmpegEncoder.ComputeScaleTarget(1920, 1080, 0, 0, 4);
        Assert.NotNull(result);
        Assert.Equal((480, 270), result!.Value);
    }

    [Fact]
    public void ComputeScaleTarget_FallbackDivisorMakesInputOdd_EvenResult()
    {
        // Input 1280×721 (impar) sem output do usuário → arredonda altura para par (1280×720).
        var result = FfmpegEncoder.ComputeScaleTarget(1280, 721, 0, 0, 1);
        Assert.NotNull(result);
        Assert.Equal((1280, 720), result!.Value);
    }

    [Fact]
    public void ComputeScaleTarget_PreservesAspect_16by10Source()
    {
        // Captura 2560×1600 (16:10) + preset 1920×1080 (16:9) → 1728×1080 (16:10), sem esticar.
        var result = FfmpegEncoder.ComputeScaleTarget(2560, 1600, 1920, 1080, 1);
        Assert.NotNull(result);
        Assert.Equal((1728, 1080), result!.Value);
    }

    [Fact]
    public void ComputeScaleTarget_PreservesAspect_21by9Source()
    {
        // Captura 3440×1440 (21:9) + preset 1920×1080 (16:9) → 1920×804 (21:9), sem esticar.
        var result = FfmpegEncoder.ComputeScaleTarget(3440, 1440, 1920, 1080, 1);
        Assert.NotNull(result);
        Assert.Equal((1920, 804), result!.Value);
    }

    [Fact]
    public void ComputeScaleTarget_PreservesAspect_WithFallbackDivisor()
    {
        // Captura 2560×1600 + preset 1280×720 + fallback 1/2 → ajustado para 1152×720 (16:10),
        // encaixado no box 1280×720 sem esticar.
        var result = FfmpegEncoder.ComputeScaleTarget(2560, 1600, 1280, 720, 2);
        Assert.NotNull(result);
        Assert.Equal((1152, 720), result!.Value);
    }

    [Fact]
    public void ComputeScaleTarget_StretchToFit_21by9Source_Fills16by9Box()
    {
        // "Remover bordas pretas": captura 3440×1440 (21:9) + preset 1920×1080 (16:9)
        // → preenche o box inteiro (1920×1080, esticado) em vez de 1920×804.
        var result = FfmpegEncoder.ComputeScaleTarget(3440, 1440, 1920, 1080, 1, stretchToFit: true);
        Assert.NotNull(result);
        Assert.Equal((1920, 1080), result!.Value);
    }

    [Fact]
    public void ComputeScaleTarget_StretchToFit_16by10Source_Fills16by9Box()
    {
        // Captura 2560×1600 (16:10) + preset 1920×1080 (16:9) → 1920×1080 (esticado).
        var result = FfmpegEncoder.ComputeScaleTarget(2560, 1600, 1920, 1080, 1, stretchToFit: true);
        Assert.NotNull(result);
        Assert.Equal((1920, 1080), result!.Value);
    }

    [Fact]
    public void ComputeScaleTarget_StretchToFit_16by9Source_Unchanged()
    {
        // Fonte já é 16:9 → stretch não muda nada (mesmo result de sempre).
        var result = FfmpegEncoder.ComputeScaleTarget(1920, 1080, 1280, 720, 1, stretchToFit: true);
        Assert.NotNull(result);
        Assert.Equal((1280, 720), result!.Value);
    }

    [Fact]
    public void ComputeScaleTarget_StretchToFit_Native_ReturnsNull()
    {
        // Sem resolução explícita (nativo) → stretch é no-op (0×0 vira a entrada).
        var result = FfmpegEncoder.ComputeScaleTarget(2560, 1600, 0, 0, 1, stretchToFit: true);
        Assert.Null(result);
    }

    [Fact]
    public void ComputeScaleTarget_StretchToFit_StillNeverUpscales()
    {
        // "Remover bordas pretas" NÃO habilita upscale — captura menor que o alvo permanece.
        var result = FfmpegEncoder.ComputeScaleTarget(1280, 720, 1920, 1080, 1, stretchToFit: true);
        Assert.Null(result);
    }

    // ─── ResolveOutput (O1 — onde o downscale acontece: conversão vs vf) ─

    [Fact]
    public void ResolveOutput_NoCrop_User720p_MovesScaleToNv12_NoScaleInVf()
    {
        // O1: captura 1920×1080 + user 720p, sem crop → a NV12 JÁ sai em 1280×720
        // (downscale na conversão) e o ffmpeg recebe rawvideo nessa resolução (-s),
        // SEM filtro scale no vf (ScaleW/H = null).
        var r = FfmpegEncoder.ResolveOutput(1920, 1080, 0, 0, 1280, 720, 1);
        Assert.Equal((1280, 720), (r.EncodedW, r.EncodedH));
        Assert.Equal((1280, 720), (r.Nv12W, r.Nv12H));
        Assert.Null(r.ScaleW);
        Assert.Null(r.ScaleH);
    }

    [Fact]
    public void ResolveOutput_NoCrop_Native_NoScaleAnywhere()
    {
        // Sem crop e sem resolução do usuário (nativo) → nada muda: encoded == capture,
        // NV12 == capture, sem scale.
        var r = FfmpegEncoder.ResolveOutput(1920, 1080, 0, 0, 0, 0, 1);
        Assert.Equal((1920, 1080), (r.EncodedW, r.EncodedH));
        Assert.Equal((1920, 1080), (r.Nv12W, r.Nv12H));
        Assert.Null(r.ScaleW);
    }

    [Fact]
    public void ResolveOutput_NoCrop_FallbackDivisor_DownscaleInNv12()
    {
        // Nativo + fallback 1/2 → 960×540 na NV12 (conversão), sem scale no vf.
        var r = FfmpegEncoder.ResolveOutput(1920, 1080, 0, 0, 0, 0, 2);
        Assert.Equal((960, 540), (r.EncodedW, r.EncodedH));
        Assert.Equal((960, 540), (r.Nv12W, r.Nv12H));
        Assert.Null(r.ScaleW);
    }

    [Fact]
    public void ResolveOutput_NoCrop_User720p_FallbackKeepsUserFloor()
    {
        // User 720p é o piso — fallback 1/2 NÃO degrada a resolução escolhida (OBS philosophy).
        var r = FfmpegEncoder.ResolveOutput(1920, 1080, 0, 0, 1280, 720, 2);
        Assert.Equal((1280, 720), (r.EncodedW, r.EncodedH));
        Assert.Equal((1280, 720), (r.Nv12W, r.Nv12H));
        Assert.Null(r.ScaleW);
    }

    [Fact]
    public void ResolveOutput_CropActive_KeepsNv12AtCapture_ScaleInVf()
    {
        // Crop (código morto hoje) → NV12 sai nas dims da captura (ffmpeg faz crop+scale no vf).
        // Crop 1600×900 na captura 1920×1080 + user 720p → scale 1280×720 vai no vf.
        var r = FfmpegEncoder.ResolveOutput(1920, 1080, 1600, 900, 1280, 720, 1);
        Assert.Equal((1280, 720), (r.EncodedW, r.EncodedH));
        Assert.Equal((1920, 1080), (r.Nv12W, r.Nv12H));
        Assert.Equal(1280, r.ScaleW);
        Assert.Equal(720, r.ScaleH);
    }

    [Fact]
    public void ResolveOutput_CropActive_NoUserOutput_ScaleInVfNull()
    {
        // Crop sem resolução do usuário → scale não é necessário (crop define a saída).
        var r = FfmpegEncoder.ResolveOutput(1920, 1080, 1280, 720, 0, 0, 1);
        Assert.Equal((1280, 720), (r.EncodedW, r.EncodedH));
        Assert.Equal((1920, 1080), (r.Nv12W, r.Nv12H));
        Assert.Null(r.ScaleW);
    }

    [Fact]
    public void ResolveOutput_CropClampedTo320x240()
    {
        // Crop menor que 320×240 é elevado ao mínimo (mesma regra do StartFfmpeg).
        var r = FfmpegEncoder.ResolveOutput(1920, 1080, 100, 100, 0, 0, 1);
        Assert.Equal((320, 240), (r.EncodedW, r.EncodedH));
        Assert.Equal((1920, 1080), (r.Nv12W, r.Nv12H));
    }

    // ─── BuildWeightedPredArg ─────────────────────────────────────────────

    [Fact]
    public void BuildWeightedPredArg_BframesZero_ReturnsWeightedPred()
    {
        // Preset Boa (bf 0): weighted_pred é válido e aplicado.
        Assert.Equal(" -weighted_pred 1", FfmpegEncoder.BuildWeightedPredArg(true));
    }

    [Fact]
    public void BuildWeightedPredArg_BframesNonZero_ReturnsEmpty()
    {
        // ffmpeg 9.0 rejeita weighted_pred com B-frames ("invalid param (8)") — omitido.
        Assert.Equal("", FfmpegEncoder.BuildWeightedPredArg(false));
    }

    // ─── Multipass (NVENC only) ──────────────────────────────────────────

    [Theory]
    [InlineData("h264_nvenc")]
    [InlineData("hevc_nvenc")]
    [InlineData("av1_nvenc")]
    public void BuildEncoderTuneArgs_NvencMultipassTrue_EmitsFullRes(string codec)
    {
        var args = FfmpegEncoder.BuildEncoderTuneArgs(codec, 22, 40000, 80000, 2, 16, "p5", "speed", multipass: true);
        Assert.Contains("-multipass fullres", args);
        Assert.DoesNotContain("-multipass disabled", args);
    }

    [Theory]
    [InlineData("h264_nvenc")]
    [InlineData("hevc_nvenc")]
    [InlineData("av1_nvenc")]
    public void BuildEncoderTuneArgs_NvencMultipassFalse_EmitsDisabled(string codec)
    {
        var args = FfmpegEncoder.BuildEncoderTuneArgs(codec, 22, 40000, 80000, 2, 16, "p5", "speed", multipass: false);
        Assert.Contains("-multipass disabled", args);
    }

    // ─── BuildEncoderTuneArgs ───────────────────────────────────────────

    [Theory]
    [InlineData("av1_amf")]
    [InlineData("h264_amf")]
    [InlineData("hevc_amf")]
    public void BuildEncoderTuneArgs_AmfCodecs_UseAmfArgs(string codec)
    {
        var args = FfmpegEncoder.BuildEncoderTuneArgs(codec, 22, 40000, 80000, 2, 32, "p4");
        Assert.Contains("-quality speed", args);
        Assert.Contains("-rc cqp", args);
        Assert.DoesNotContain("-crf", args);
        Assert.DoesNotContain("-preset veryfast", args);
        Assert.DoesNotContain("-profile:v high", args);
    }

    [Fact]
    public void BuildEncoderTuneArgs_Av1Amf_DoesNotUseCpuFallbackArgs()
    {
        // Bug: av1_amf caía no default libx264 → -crf/-bf 0/-profile:v high inválidos p/ AMF.
        var args = FfmpegEncoder.BuildEncoderTuneArgs("av1_amf", 22, 40000, 80000, 2, 32, "p4");
        Assert.DoesNotContain("-crf", args);
        Assert.DoesNotContain("-preset veryfast", args);
        Assert.DoesNotContain("-profile:v high", args);
        Assert.Contains("-quality speed", args);
    }

    [Theory]
    [InlineData("libx264")]
    [InlineData("libx265")]
    public void BuildEncoderTuneArgs_CpuFallback_UsesFastPreset(string codec)
    {
        // Alavanca 6: preset de CPU sobe de veryfast para fast (melhora retenção de
        // detalhe em movimento; realtime ainda folgado em máquinas modernas).
        var args = FfmpegEncoder.BuildEncoderTuneArgs(codec, 22, 40000, 80000, 2, 32, "p4");
        Assert.Contains("-preset fast ", args);
        Assert.DoesNotContain("veryfast", args);
        Assert.Contains("-bf 0", args);
        Assert.Contains("-crf", args);
        Assert.DoesNotContain("zerolatency", args);
    }

    [Fact]
    public void BuildEncoderTuneArgs_UnknownCodec_DefaultBranchUsesFastPreset()
    {
        var args = FfmpegEncoder.BuildEncoderTuneArgs("mpeg2video", 22, 40000, 80000, 2, 32, "p4");
        Assert.Contains("-preset fast ", args);
        Assert.DoesNotContain("veryfast", args);
        Assert.Contains("-bf 0", args);
        Assert.Contains("-profile:v high", args);
    }

    [Fact]
    public void BuildEncoderTuneArgs_Av1Amf_NoMeQuarterPel()
    {
        // av1_amf não expõe -me_quarter_pel (só h264/hevc_amf) — passá-lo causa erro de opção.
        var args = FfmpegEncoder.BuildEncoderTuneArgs("av1_amf", 22, 40000, 80000, 2, 32, "p4");
        Assert.DoesNotContain("me_quarter_pel", args);
    }

    [Fact]
    public void BuildEncoderTuneArgs_H264Amf_KeepsMeQuarterPel()
    {
        var args = FfmpegEncoder.BuildEncoderTuneArgs("h264_amf", 22, 40000, 80000, 2, 32, "p4");
        Assert.Contains("me_quarter_pel true", args);
    }

    [Theory]
    [InlineData("av1_amf")]
    [InlineData("h264_amf")]
    [InlineData("hevc_amf")]
    public void BuildEncoderTuneArgs_AmfCodecs_UsesFillerData_NotFiller(string codec)
    {
        // Bug (2026-08-11): -filler 0 não existe no ffmpeg 9 — o encoder AMF abortava com
        // "Unrecognized option 'filler'" a cada restart (exit code, restart loop). Opção real: -filler_data.
        var args = FfmpegEncoder.BuildEncoderTuneArgs(codec, 22, 40000, 80000, 2, 32, "p4");
        Assert.Contains("-filler_data 0", args);
        Assert.DoesNotContain(" -filler ", args);
    }

    [Fact]
    public void BuildEncoderTuneArgs_AmfCodecs_AllOptionsExistInFfmpeg9()
    {
        // Se qualquer opção AMF aqui não existir no ffmpeg 9, o encoder aborta com "Unrecognized option".
        foreach (var codec in new[] { "av1_amf", "h264_amf", "hevc_amf" })
        {
            var args = FfmpegEncoder.BuildEncoderTuneArgs(codec, 22, 40000, 80000, 2, 32, "p4");
            Assert.Contains("-quality speed", args);
            Assert.Contains("-rc cqp", args);
            Assert.Contains("-qp_i 22", args);
            Assert.Contains("-qp_p 22", args);
            Assert.DoesNotContain("-b:v ", args);
            Assert.DoesNotContain("-maxrate ", args);
            Assert.DoesNotContain("-bufsize ", args);
            Assert.Contains("-bf 0", args);
            Assert.Contains("-g 120", args);
            Assert.Contains("-filler_data 0", args);
            Assert.Contains("-enforce_hrd 0", args);
            Assert.Contains("-vbaq true", args);
        }
    }

    [Theory]
    [InlineData("av1_amf")]
    [InlineData("h264_amf")]
    [InlineData("hevc_amf")]
    public void BuildEncoderTuneArgs_AmfCodecs_SetsQpInCqpMode(string codec)
    {
        // CQP (RateControlMethod.CQP): QP fixo É o alvo de qualidade — o oposto do bug obs-ffmpeg
        // #12994 (QP + RC de bitrate = QP sobrepõe o alvo). Em CQP o QP é o parâmetro controlado
        // (mesma semântica do NVENC -cq / OBS QP 16-23). Sem -b:v/-maxrate/-bufsize (sem alvo).
        var args = FfmpegEncoder.BuildEncoderTuneArgs(codec, 22, 40000, 80000, 2, 32, "p4");
        Assert.Contains("-rc cqp", args);
        Assert.Contains("-qp_i 22", args);
        Assert.Contains("-qp_p 22", args);
        Assert.DoesNotContain("-b:v ", args);
        Assert.DoesNotContain("-maxrate ", args);
        Assert.DoesNotContain("-bufsize ", args);
    }

    [Theory]
    [InlineData("av1_amf")]
    [InlineData("h264_amf")]
    [InlineData("hevc_amf")]
    public void BuildEncoderTuneArgs_AmfCodecs_CqpUsesCqDirectly(string codec)
    {
        // CQ do front (18/20/24) vira QP CQP sem offset — o -4 era só do QSV (global_quality),
        // que tem escala própria. AMF CQP segue OBS/NVENC: QP = cq do usuário.
        var args = FfmpegEncoder.BuildEncoderTuneArgs(codec, 24, 40000, 80000, 2, 32, "p4");
        Assert.Contains("-qp_i 24", args);
        Assert.Contains("-qp_p 24", args);
    }

    [Theory]
    [InlineData("av1_amf")]
    [InlineData("h264_amf")]
    [InlineData("hevc_amf")]
    public void BuildEncoderTuneArgs_AmfCodecs_UsesGop2Seconds(string codec)
    {
        // GOP 120 = keyframe/2s @60fps — padrão de gravação AMF (GPUOpen), OBS e NVENC. Menos
        // I-frames (~10% mais compressão) com seek/trim ainda em intervalos de 2s.
        var args = FfmpegEncoder.BuildEncoderTuneArgs(codec, 22, 40000, 80000, 2, 32, "p4");
        Assert.Contains("-g 120", args);
        Assert.DoesNotContain("-g 60", args);
    }

    [Theory]
    [InlineData("av1_amf")]
    [InlineData("h264_amf")]
    [InlineData("hevc_amf")]
    public void BuildEncoderTuneArgs_AmfCodecs_DoesNotIncludeBitrateTarget(string codec)
    {
        // CQP é qualidade constante sem teto de bitrate — OBS não mostra bitrate em CQP. Sem
        // -b:v/-maxrate/-bufsize nos 3 codecs AMF (o antigo bug da RX 5700 XT de subalocar a ~3
        // Mbps era do vbr_peak; CQP com QP = cq do front elimina a dependência do alvo).
        var args = FfmpegEncoder.BuildEncoderTuneArgs(codec, 22, 40000, 80000, 2, 32, "p4");
        Assert.DoesNotContain("-b:v ", args);
        Assert.DoesNotContain("-maxrate ", args);
        Assert.DoesNotContain("-bufsize ", args);
    }

    [Fact]
    public void BuildEncoderTuneArgs_AmfCodecs_DoesNotIncludePreanalysisChain()
    {
        // Preset quality (default antigo) + preanalysis + lookahead 40 era pesado demais pra RDNA1
        // (VCN 1.0): encoder AMF rodava a ~0.55x speed → drift A/V crescente ~1.6-1.9s e clips com
        // activeFps=36 em vez de 60. Agora usa -quality speed (preset rápido) sem a cadeia preanalysis.
        foreach (var codec in new[] { "av1_amf", "h264_amf", "hevc_amf" })
        {
            var args = FfmpegEncoder.BuildEncoderTuneArgs(codec, 22, 40000, 80000, 2, 32, "p4");
            Assert.DoesNotContain("preanalysis", args);
            Assert.DoesNotContain("pa_taq_mode", args);
            Assert.DoesNotContain("pa_lookahead_buffer_depth", args);
            Assert.DoesNotContain("pa_paq_mode", args);
            Assert.DoesNotContain("pa_adaptive_mini_gop", args);
            Assert.DoesNotContain("pa_scene_change_detection", args);
            Assert.DoesNotContain("high_motion_quality_boost", args);
        }
    }

    // ─── AMF adaptive preset (param amfPreset no seam) ──────────────────

    [Theory]
    [InlineData("av1_amf")]
    [InlineData("h264_amf")]
    [InlineData("hevc_amf")]
    public void BuildEncoderTuneArgs_AmfCodecs_UseCustomAmfPreset(string codec)
    {
        // Preset adaptativo (SelectAmfPreset) escolhido por machine: GPU forte fica quality,
        // GPU fraca degrada para balanced/speed. O seam deve injetar o preset escolhido.
        var args = FfmpegEncoder.BuildEncoderTuneArgs(codec, 22, 40000, 80000, 2, 32, "p4", "balanced");
        Assert.Contains("-quality balanced", args);
    }

    [Theory]
    [InlineData("av1_amf")]
    [InlineData("h264_amf")]
    [InlineData("hevc_amf")]
    public void BuildEncoderTuneArgs_AmfCodecs_DefaultPresetIsSpeed(string codec)
    {
        // Chamadas sem o param amfPreset (testes pré-existentes / fallback de produção)
        // mantêm -quality speed — preset leve nunca causa restart loop nem lentidão.
        var args = FfmpegEncoder.BuildEncoderTuneArgs(codec, 22, 40000, 80000, 2, 32, "p4");
        Assert.Contains("-quality speed", args);
    }

    [Fact]
    public void BuildEncoderTuneArgs_AmfCodecs_NormalizesInvalidPresetToSpeed()
    {
        // Preset inválido nunca chega ao ffmpeg — o seam normaliza para speed.
        var args = FfmpegEncoder.BuildEncoderTuneArgs("h264_amf", 22, 40000, 80000, 2, 32, "p4", "ultra");
        Assert.Contains("-quality speed", args);
        Assert.DoesNotContain("-quality ultra", args);
    }

    [Theory]
    [InlineData("quality", "quality")]
    [InlineData("balanced", "balanced")]
    [InlineData("speed", "speed")]
    [InlineData("QUALITY", "quality")]
    [InlineData(" Balanced ", "balanced")]
    [InlineData("ultra", "speed")]
    [InlineData("", "speed")]
    [InlineData(null, "speed")]
    public void NormalizeAmfPreset_ReturnsNormalizedOrSpeed(string? input, string expected)
    {
        Assert.Equal(expected, FfmpegEncoder.NormalizeAmfPreset(input));
    }

    // ─── QSV (Intel) ────────────────────────────────────────────────────

    [Theory]
    [InlineData("h264_qsv")]
    [InlineData("hevc_qsv")]
    [InlineData("av1_qsv")]
    public void BuildEncoderTuneArgs_QsvCodecs_UseQsvArgs(string codec)
    {
        var args = FfmpegEncoder.BuildEncoderTuneArgs(codec, 22, 40000, 80000, 2, 32, "p4");
        Assert.Contains("-preset veryslow", args);
        Assert.Contains("-global_quality", args);
        Assert.Contains("-extbrc 1", args);
        Assert.Contains("-maxrate 40000K", args);
        Assert.DoesNotContain("-crf", args);
        Assert.DoesNotContain("-profile:v high", args);
    }

    [Theory]
    [InlineData("h264_qsv")]
    [InlineData("hevc_qsv")]
    public void BuildEncoderTuneArgs_H264HevcQsv_UseRdoMbbrc(string codec)
    {
        var args = FfmpegEncoder.BuildEncoderTuneArgs(codec, 22, 40000, 80000, 2, 32, "p4");
        Assert.Contains("-rdo 1", args);
        Assert.Contains("-mbbrc 1", args);
    }

    [Fact]
    public void BuildEncoderTuneArgs_Qsv_DoesNotIncludeExtraHwFrames()
    {
        // ffmpeg 9 rejeita -extra_hw_frames como opção de encoder ("not a encoding option").
        var args = FfmpegEncoder.BuildEncoderTuneArgs("h264_qsv", 22, 40000, 80000, 2, 32, "p4");
        Assert.DoesNotContain("extra_hw_frames", args);
    }

    // ─── GetRawFormatForCodec ───────────────────────────────────────────

    [Theory]
    [InlineData("av1_amf", "av1")]
    [InlineData("av1_nvenc", "av1")]
    [InlineData("libsvtav1", "av1")]
    [InlineData("av1_d3d12va", "av1")]
    [InlineData("av1_qsv", "av1")]
    [InlineData("hevc_amf", "hevc")]
    [InlineData("h264_amf", "h264")]
    [InlineData("h264_qsv", "h264")]
    [InlineData("hevc_qsv", "hevc")]
    [InlineData("libx264", "h264")]
    public void GetRawFormatForCodec_ReturnsExpected(string codec, string expected)
    {
        Assert.Equal(expected, FfmpegEncoder.GetRawFormatForCodec(codec));
    }

    // ─── IsAv1Keyframe ──────────────────────────────────────────────────

    [Fact]
    public void IsAv1Keyframe_FrameHeaderObu_KeyFrame_ReturnsTrue()
    {
        // OBU FRAME_HEADER (type 3) com frame_type == 0 (KEY_FRAME).
        // Primeiro byte do payload (AV1 §5.9.1, MSB→LSB):
        //   frame_marker(2)=01 | version(1)=0 | show_existing_frame(1)=0 |
        //   frame_type(2)=00 | show_frame(1) | error_resilient_mode(1) → 0x40
        var payload = new byte[] { 0x40 };
        var data = BuildAv1Obu(3, payload);
        Assert.True(FfmpegEncoder.IsAv1Keyframe(data, data.Length));
    }

    [Fact]
    public void IsAv1Keyframe_FrameObu_KeyFrame_ReturnsTrue()
    {
        // OBU FRAME (type 6) com frame_type == 0 (KEY_FRAME) → 0x40.
        var payload = new byte[] { 0x40 };
        var data = BuildAv1Obu(6, payload);
        Assert.True(FfmpegEncoder.IsAv1Keyframe(data, data.Length));
    }

    [Fact]
    public void IsAv1Keyframe_FrameHeaderObu_InterFrame_ReturnsFalse()
    {
        // frame_type == 1 (INTER_FRAME) → bits [3..2] = 01 → 0x44.
        var payload = new byte[] { 0x44 };
        var data = BuildAv1Obu(3, payload);
        Assert.False(FfmpegEncoder.IsAv1Keyframe(data, data.Length));
    }

    [Fact]
    public void IsAv1Keyframe_FrameObu_InterFrame_ReturnsFalse()
    {
        var payload = new byte[] { 0x44 };
        var data = BuildAv1Obu(6, payload);
        Assert.False(FfmpegEncoder.IsAv1Keyframe(data, data.Length));
    }

    [Fact]
    public void IsAv1Keyframe_WithTemporalDelimiterAndSequenceHeader_DetectsKeyFrame()
    {
        // Payload realista: TEMPORAL_DELIMITER (2) → SEQUENCE_HEADER (1) → FRAME (6).
        var delimiter = BuildAv1Obu(2, Array.Empty<byte>());
        var seqHeader = BuildAv1Obu(1, new byte[] { 0x80, 0x00 });
        var frame = BuildAv1Obu(6, new byte[] { 0x40 });
        var data = Concat(delimiter, seqHeader, frame);
        Assert.True(FfmpegEncoder.IsAv1Keyframe(data, data.Length));
    }

    [Fact]
    public void IsAv1Keyframe_OnlyDelimiter_ReturnsFalse()
    {
        var data = BuildAv1Obu(2, Array.Empty<byte>());
        Assert.False(FfmpegEncoder.IsAv1Keyframe(data, data.Length));
    }

    [Fact]
    public void IsAv1Keyframe_Empty_ReturnsFalse()
    {
        Assert.False(FfmpegEncoder.IsAv1Keyframe(Array.Empty<byte>(), 0));
    }

    [Fact]
    public void IsAv1Keyframe_TruncatedObu_ReturnsFalse()
    {
        var payload = new byte[] { 0x00 };
        var data = BuildAv1Obu(6, payload);
        var truncated = new byte[data.Length - 1];
        Array.Copy(data, truncated, truncated.Length);
        Assert.False(FfmpegEncoder.IsAv1Keyframe(truncated, truncated.Length));
    }

    private static byte[] BuildAv1Obu(int obuType, byte[] payload)
    {
        // AV1 OBU header byte: forbidden(1) | obu_type(4) | extension(1) | has_size(1) | reserved(1).
        byte header = (byte)((obuType << 3) | 0x02); // has_size_field = 1
        var size = Leb128(payload.Length);
        var result = new byte[1 + size.Length + payload.Length];
        result[0] = header;
        Array.Copy(size, 0, result, 1, size.Length);
        Array.Copy(payload, 0, result, 1 + size.Length, payload.Length);
        return result;
    }

    private static byte[] Leb128(int value)
    {
        var bytes = new System.Collections.Generic.List<byte>();
        do
        {
            byte b = (byte)(value & 0x7F);
            value >>= 7;
            if (value > 0) b |= 0x80;
            bytes.Add(b);
        } while (value > 0);
        return bytes.ToArray();
    }

    private static byte[] Concat(params byte[][] arrays)
    {
        int total = 0;
        foreach (var a in arrays) total += a.Length;
        var result = new byte[total];
        int offset = 0;
        foreach (var a in arrays)
        {
            Array.Copy(a, 0, result, offset, a.Length);
            offset += a.Length;
        }
        return result;
    }

    // ─── TryWriteStdin / ComputeStdinWriteTimeout ──────────────────────

    [Fact]
    public void TryWriteStdin_ResponsiveStream_ReturnsOk()
    {
        using var ms = new MemoryStream();
        var result = FfmpegEncoder.TryWriteStdin(ms, new byte[] { 1, 2, 3 }, 200, out var fault);
        Assert.Equal(FfmpegEncoder.StdinWriteResult.Ok, result);
        Assert.Null(fault);
        Assert.Equal(new byte[] { 1, 2, 3 }, ms.ToArray());
    }

    [Fact]
    public void TryWriteStdin_SlowStream_TimesOutWithoutHanging()
    {
        var stream = new NeverCompletingStream();
        var sw = Stopwatch.StartNew();
        var result = FfmpegEncoder.TryWriteStdin(stream, new byte[] { 1 }, 100, out var fault);
        sw.Stop();
        Assert.Equal(FfmpegEncoder.StdinWriteResult.Timeout, result);
        Assert.Null(fault);
        Assert.True(sw.ElapsedMilliseconds < 2000, $"Wait deve respeitar o timeout; levou {sw.ElapsedMilliseconds}ms");
    }

    [Fact]
    public void TryWriteStdin_FaultingStream_ReturnsFaultedWithException()
    {
        var stream = new FaultingStream();
        var result = FfmpegEncoder.TryWriteStdin(stream, new byte[] { 1 }, 2000, out var fault);
        Assert.Equal(FfmpegEncoder.StdinWriteResult.Faulted, result);
        Assert.IsType<IOException>(fault);
    }

    [Fact]
    public void TryWriteStdin_EmptyData_StillWritesOk()
    {
        using var ms = new MemoryStream();
        var result = FfmpegEncoder.TryWriteStdin(ms, Array.Empty<byte>(), 200, out var fault);
        Assert.Equal(FfmpegEncoder.StdinWriteResult.Ok, result);
        Assert.Null(fault);
    }

    [Fact]
    public void ComputeStdinWriteTimeout_WarmupNoOutput_ReturnsGenerousTimeout()
    {
        Assert.Equal(FfmpegEncoder.StdinWriteWarmupTimeoutMs, FfmpegEncoder.ComputeStdinWriteTimeout(0));
        Assert.True(FfmpegEncoder.StdinWriteWarmupTimeoutMs > FfmpegEncoder.StdinWriteTimeoutMs);
    }

    [Fact]
    public void ComputeStdinWriteTimeout_ProducingOutput_ReturnsStrictTimeout()
    {
        Assert.Equal(FfmpegEncoder.StdinWriteTimeoutMs, FfmpegEncoder.ComputeStdinWriteTimeout(1));
        Assert.Equal(FfmpegEncoder.StdinWriteTimeoutMs, FfmpegEncoder.ComputeStdinWriteTimeout(9001));
    }

    // ─── CanUseDirectInput (O2 — evita a cópia redundante p/ texturas SR) ──

    [Theory]
    [InlineData(BindFlags.ShaderResource, true)]
    [InlineData(BindFlags.ShaderResource | BindFlags.RenderTarget, true)]
    [InlineData(BindFlags.None, false)]
    [InlineData(BindFlags.RenderTarget, false)]
    public void CanUseDirectInput_ChecksShaderResourceFlag(BindFlags flags, bool expected)
    {
        var desc = new Texture2DDescription
        {
            Width = 1920, Height = 1080, MipLevels = 1, ArraySize = 1,
            Format = Format.B8G8R8A8_UNorm,
            SampleDescription = new SampleDescription(1, 0),
            Usage = ResourceUsage.Default,
            BindFlags = flags,
            CPUAccessFlags = CpuAccessFlags.None
        };
        Assert.Equal(expected, FfmpegEncoder.CanUseDirectInput(desc));
    }

    // ─── DownscaleBgra (O1 — fallback CPU em escala de saída) ────────────

    private static byte[] Bgra(byte r, byte g, byte b, byte a = 255) => new[] { b, g, r, a };

    [Fact]
    public void DownscaleBgra_IdentityDimensions_ReturnsCopyUnchanged()
    {
        // 2x2 vermelho → 2x2 (dst == src): mesmos bytes, mesmas dims.
        var src = new byte[] { 255, 0, 0, 255, 255, 0, 0, 255, 255, 0, 0, 255, 255, 0, 0, 255 };
        var dst = FfmpegEncoder.DownscaleBgra(src, 2, 2, 8, 2, 2);
        Assert.Equal(16, dst.Length);
        Assert.Equal(src, dst);
    }

    [Fact]
    public void DownscaleBgra_SolidColor_AveragesToSameColor()
    {
        // 4x4 cinza (128,128,128) → 2x2: todos os pixels seguem iguais.
        var src = new byte[4 * 4 * 4];
        for (int i = 0; i < src.Length; i += 4)
        {
            src[i] = 128; src[i + 1] = 128; src[i + 2] = 128; src[i + 3] = 255;
        }
        var dst = FfmpegEncoder.DownscaleBgra(src, 4, 4, 16, 2, 2);
        Assert.Equal(16, dst.Length);
        for (int i = 0; i < dst.Length; i += 4)
        {
            Assert.Equal(128, dst[i]); Assert.Equal(128, dst[i + 1]);
            Assert.Equal(128, dst[i + 2]); Assert.Equal(255, dst[i + 3]);
        }
    }

    [Fact]
    public void DownscaleBgra_Bilinear_QuadrantsAverageCenter()
    {
        // 2x2 quadrantes assimétricos → 1x1 média bilinear: TL=vermelho(255,0,0),
        // TR=preto(0,0,0), BL=preto(0,0,0), BR=branco(255,255,255).
        // Centro = (0.5,0.5): R=(255+0+0+255)/4=127.5→128, G=(0+0+0+255)/4=63.75→64,
        // B=(0+0+0+255)/4=63.75→64.
        var src = new byte[]
        {
            0, 0, 255, 255,  0, 0, 0, 255,
            0, 0, 0, 255,  255, 255, 255, 255,
        };
        var dst = FfmpegEncoder.DownscaleBgra(src, 2, 2, 8, 1, 1);
        Assert.Equal(4, dst.Length);
        Assert.Equal(64, dst[0]);   // B
        Assert.Equal(64, dst[1]);   // G
        Assert.Equal(128, dst[2]);  // R
        Assert.Equal(255, dst[3]);  // A
    }

    [Fact]
    public void DownscaleBgra_OddSource_DownscalesToEvenTarget()
    {
        // 3x3 sólido → 2x2: dims corretas e cor preservada.
        var src = new byte[3 * 3 * 4];
        for (int i = 0; i < src.Length; i += 4)
        {
            src[i] = 10; src[i + 1] = 200; src[i + 2] = 40; src[i + 3] = 255;
        }
        var dst = FfmpegEncoder.DownscaleBgra(src, 3, 3, 12, 2, 2);
        Assert.Equal(16, dst.Length);
        for (int i = 0; i < dst.Length; i += 4)
        {
            Assert.Equal(10, dst[i]); Assert.Equal(200, dst[i + 1]);
            Assert.Equal(40, dst[i + 2]); Assert.Equal(255, dst[i + 3]);
        }
    }

    [Fact]
    public void DownscaleBgra_InvalidDims_ReturnsEmpty()
    {
        var src = new byte[16];
        Assert.Empty(FfmpegEncoder.DownscaleBgra(src, 2, 2, 8, 0, 0));
        Assert.Empty(FfmpegEncoder.DownscaleBgra(src, 0, 0, 0, 2, 2));
    }

    // ─── BgraToNv12 (O1 — conversão BGRA→NV12 em escala de saída) ───────

    [Fact]
    public void BgraToNv12_Gray2x2_LimitedRanges()
    {
        // Cinza (128,128,128): Y=126 (BT.601 limited), U=V=128.
        var src = new byte[2 * 2 * 4];
        for (int i = 0; i < src.Length; i += 4)
        {
            src[i] = 128; src[i + 1] = 128; src[i + 2] = 128; src[i + 3] = 255;
        }
        var nv12 = new byte[2 * 2 + (2 / 2) * 2];
        FfmpegEncoder.BgraToNv12(src, 8, 2, 2, nv12);
        Assert.Equal(6, nv12.Length);
        Assert.Equal(new byte[] { 126, 126, 126, 126, 128, 128 }, nv12);
    }

    [Fact]
    public void BgraToNv12_Red2x2_UvInterleavedAtCorrectOffset()
    {
        // Vermelho puro (255,0,0): Y=82, U=90, V=240 (clamp BT.601 limited).
        var src = new byte[]
        {
            0, 0, 255, 255,  0, 0, 255, 255,
            0, 0, 255, 255,  0, 0, 255, 255,
        };
        var nv12 = new byte[2 * 2 + (2 / 2) * 2];
        FfmpegEncoder.BgraToNv12(src, 8, 2, 2, nv12);
        // Y plane (4): 82 82 82 82 — UV plane (2): U=90, V=240
        Assert.Equal(new byte[] { 82, 82, 82, 82, 90, 240 }, nv12);
    }

    // Streams de teste para TryWriteStdin — sem depender de um processo ffmpeg real.

    private sealed class NeverCompletingStream : Stream
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
        public override void Write(byte[] buffer, int offset, int count) { }
        public override Task WriteAsync(byte[] buffer, int offset, int count, CancellationToken cancellationToken)
            => new TaskCompletionSource<byte[]>(TaskCreationOptions.RunContinuationsAsynchronously).Task;
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
        public override void Write(byte[] buffer, int offset, int count) => throw new NotSupportedException();
        public override Task WriteAsync(byte[] buffer, int offset, int count, CancellationToken cancellationToken)
            => Task.FromException<byte[]>(new IOException("pipe closed"));
    }

    // ─── Item B: Map DoNotWait + GPU busy (DXGI_ERROR_WAS_STILL_DRAWING) ─

    [Fact]
    public void StagingMapFlags_IsDoNotWait()
    {
        Assert.Equal(Vortice.Direct3D11.MapFlags.DoNotWait, FfmpegEncoder.StagingMapFlags);
    }

    [Fact]
    public void IsGpuBusyMapError_WasStillDrawing_ReturnsTrue()
    {
        var ex = new InvalidOperationException("map busy");
        ex.HResult = unchecked((int)0x887A000A); // DXGI_ERROR_WAS_STILL_DRAWING (valor real)
        Assert.True(FfmpegEncoder.IsGpuBusyMapError(ex));
    }

    [Fact]
    public void IsGpuBusyMapError_NonCompositedUi_ReturnsFalse()
    {
        var ex = new InvalidOperationException("non-composited ui");
        ex.HResult = unchecked((int)0x887A0021); // DXGI_ERROR_NON_COMPOSITED_UI — NÃO é busy
        Assert.False(FfmpegEncoder.IsGpuBusyMapError(ex));
    }

    [Fact]
    public void IsGpuBusyMapError_DeviceRemoved_ReturnsFalse()
    {
        var ex = new InvalidOperationException("device removed");
        ex.HResult = unchecked((int)0x887A0005); // DXGI_ERROR_DEVICE_REMOVED
        Assert.False(FfmpegEncoder.IsGpuBusyMapError(ex));
    }

    [Fact]
    public void IsGpuBusyMapError_EFail_ReturnsFalse()
    {
        var ex = new InvalidOperationException("efail");
        ex.HResult = unchecked((int)0x80004005); // E_FAIL
        Assert.False(FfmpegEncoder.IsGpuBusyMapError(ex));
    }

    [Fact]
    public void IsGpuBusyMapError_DefaultHResult_ReturnsFalse()
    {
        Assert.False(FfmpegEncoder.IsGpuBusyMapError(new InvalidOperationException("no hresult")));
    }

    [Fact]
    public void BuildEncodeDropReason_Busy_ReturnsGpuBusyMessage()
    {
        Assert.Equal("GPU busy (0x887A000A) — frame dropped, retry next frame.", FfmpegEncoder.BuildEncodeDropReason(true));
    }

    [Fact]
    public void BuildEncodeDropReason_NotBusy_ReturnsEncodeError()
    {
        Assert.Equal("Encoder não produziu frame (encode error).", FfmpegEncoder.BuildEncodeDropReason(false));
    }

    [Fact]
    public void GpuBusyDrops_ReadsThroughVolatileField()
    {
        using var enc = new FfmpegEncoder();
        SetField(enc, "_gpuBusyDrops", 3);
        Assert.Equal(3, enc.GpuBusyDrops);
    }

    [Fact]
    public void LastFrameBusyDrop_ReflectsField()
    {
        using var enc = new FfmpegEncoder();
        SetField(enc, "_lastFrameBusyDrop", true);
        Assert.True(enc.LastFrameBusyDrop);
    }

    [Fact]
    public void ResetState_ClearsGpuBusyState()
    {
        using var enc = new FfmpegEncoder();
        SetField(enc, "_lastFrameBusyDrop", true);
        SetField(enc, "_gpuBusyDrops", 5);

        var reset = typeof(FfmpegEncoder).GetMethod("ResetState", BindingFlags.NonPublic | BindingFlags.Instance);
        Assert.NotNull(reset);
        reset!.Invoke(enc, null);

        Assert.False(enc.LastFrameBusyDrop);
        Assert.Equal(0, enc.GpuBusyDrops);
    }

    // ─── Item B-fix: retry bloqueante no MESMO frame quando GPU busy ─

    private static InvalidOperationException BusyMapException()
    {
        var ex = new InvalidOperationException("map busy");
        ex.HResult = unchecked((int)0x887A000A); // DXGI_ERROR_WAS_STILL_DRAWING
        return ex;
    }

    [Fact]
    public void MapWithBusyRetry_FastPathSucceeds_ReturnsTrue_NoBlockingCall()
    {
        var blockingCalled = false;
        var result = FfmpegEncoder.TryMapWithBusyRetry(
            () => new MappedSubresource(new IntPtr(0x100), 1920, 1920),
            () => { blockingCalled = true; return new MappedSubresource(new IntPtr(0x200), 1920, 1920); },
            out var map);

        Assert.True(result);
        Assert.Equal(new IntPtr(0x100), map.DataPointer);
        Assert.False(blockingCalled);
    }

    [Fact]
    public void MapWithBusyRetry_FastBusy_BlockingRecovers_ReturnsBlockingResult()
    {
        var blockingCalled = false;
        var result = FfmpegEncoder.TryMapWithBusyRetry(
            () => throw BusyMapException(),
            () => { blockingCalled = true; return new MappedSubresource(new IntPtr(0x200), 1920, 1920); },
            out var map);

        Assert.True(result);
        Assert.True(blockingCalled);
        Assert.Equal(new IntPtr(0x200), map.DataPointer);
    }

    [Fact]
    public void MapWithBusyRetry_FastBusy_BlockingAlsoBusy_ReturnsFalse()
    {
        var result = FfmpegEncoder.TryMapWithBusyRetry(
            () => throw BusyMapException(),
            () => throw BusyMapException(),
            out _);

        Assert.False(result);
    }

    [Fact]
    public void MapWithBusyRetry_NonBusyError_Propagates()
    {
        Assert.Throws<InvalidOperationException>(() =>
            FfmpegEncoder.TryMapWithBusyRetry(
                () => throw new InvalidOperationException("non-busy"),
                () => throw new InvalidOperationException("blocking should not be called"),
                out _));
    }

    [Fact]
    public void MapWithBusyRetry_BlockingThrowsNonBusy_Propagates()
    {
        Assert.Throws<InvalidOperationException>(() =>
            FfmpegEncoder.TryMapWithBusyRetry(
                () => throw BusyMapException(),
                () => throw new InvalidOperationException("device removed"),
                out _));
    }
}
