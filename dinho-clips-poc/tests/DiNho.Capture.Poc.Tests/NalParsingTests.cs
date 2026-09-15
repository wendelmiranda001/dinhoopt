using System.Reflection;
using DiNho.Capture.Poc.Encoders;

namespace DiNho.Capture.Poc.Tests;

public sealed class NalParsingTests
{
    // ── Reflection helpers ──────────────────────────────────────────

    private static int InvokeFindAnnexBAccessUnitBoundaryPos(byte[] buf, int len, bool hadSlice)
    {
        var method = typeof(FfmpegEncoder).GetMethod("FindAnnexBAccessUnitBoundary",
            BindingFlags.NonPublic | BindingFlags.Static);
        Assert.NotNull(method);
        return (int)method!.Invoke(null, [buf, len, hadSlice])!;
    }

    private static bool InvokeCheckKeyFrame(FfmpegEncoder encoder, byte[] data)
    {
        var method = typeof(FfmpegEncoder).GetMethod("CheckKeyFrame",
            BindingFlags.NonPublic | BindingFlags.Instance);
        Assert.NotNull(method);
        return (bool)method!.Invoke(encoder, [data])!;
    }

    private static void SetEncoderField(FfmpegEncoder encoder, string fieldName, object? value)
    {
        var field = typeof(FfmpegEncoder).GetField(fieldName,
            BindingFlags.NonPublic | BindingFlags.Instance);
        Assert.NotNull(field);
        field!.SetValue(encoder, value);
    }

    private static object GetEncoderField(FfmpegEncoder encoder, string fieldName)
    {
        var field = typeof(FfmpegEncoder).GetField(fieldName,
            BindingFlags.NonPublic | BindingFlags.Instance);
        Assert.NotNull(field);
        return field!.GetValue(encoder)!;
    }

    private static FfmpegEncoder CreateEncoderForTest()
    {
        var enc = (FfmpegEncoder)System.Runtime.CompilerServices.RuntimeHelpers
            .GetUninitializedObject(typeof(FfmpegEncoder));
        var bf = BindingFlags.NonPublic | BindingFlags.Instance;
        typeof(FfmpegEncoder).GetField("_outputChannel", bf)!.SetValue(enc,
            System.Threading.Channels.Channel.CreateBounded<EncodedPacket>(
                new System.Threading.Channels.BoundedChannelOptions(256)
                { FullMode = System.Threading.Channels.BoundedChannelFullMode.DropOldest }));
        typeof(FfmpegEncoder).GetField("_inputPtsQueue", bf)!.SetValue(enc,
            new System.Collections.Concurrent.ConcurrentQueue<TimeSpan>());
        typeof(FfmpegEncoder).GetField("_frameRate", bf)!.SetValue(enc, 60);
        typeof(FfmpegEncoder).GetField("_width", bf)!.SetValue(enc, 1920);
        typeof(FfmpegEncoder).GetField("_height", bf)!.SetValue(enc, 1080);
        return enc;
    }

    private static FfmpegEncoder CreateH264Encoder()
    {
        var enc = CreateEncoderForTest();
        SetEncoderField(enc, "_codec", "h264_nvenc");
        return enc;
    }

    private static void InitParseAvccState(FfmpegEncoder enc)
    {
        SetEncoderField(enc, "_hadSlice", false);
        SetEncoderField(enc, "_pendingTooLarge", false);
        SetEncoderField(enc, "_outputFrameIndex", 0);
        SetEncoderField(enc, "_frameCount", 0);
        SetEncoderField(enc, "_pendingLen", 0);
        SetEncoderField(enc, "_cachedAvcc", null);
        SetEncoderField(enc, "_cachedSps", null);
        SetEncoderField(enc, "_cachedPps", null);
        SetEncoderField(enc, "_loggedParseAvcc", true);
    }

    // ═══════════════════════════════════════════════════════════════════
    // IsAnnexB
    // ═══════════════════════════════════════════════════════════════════

    [Fact]
    public void IsAnnexB_ThreeByteStartCode_ReturnsTrue()
    {
        byte[] buf = [0x00, 0x00, 0x01, 0x65, 0x88];
        Assert.True(FfmpegEncoder.IsAnnexB(buf, buf.Length));
    }

    [Fact]
    public void IsAnnexB_FourByteStartCode_ReturnsTrue()
    {
        byte[] buf = [0x00, 0x00, 0x00, 0x01, 0x67];
        Assert.True(FfmpegEncoder.IsAnnexB(buf, buf.Length));
    }

    [Fact]
    public void IsAnnexB_TooShort_ReturnsFalse()
    {
        byte[] buf = [0x00, 0x01];
        Assert.False(FfmpegEncoder.IsAnnexB(buf, buf.Length));
    }

    [Fact]
    public void IsAnnexB_ZeroLength_ReturnsFalse()
    {
        byte[] buf = [];
        Assert.False(FfmpegEncoder.IsAnnexB(buf, 0));
    }

    [Fact]
    public void IsAnnexB_FirstByteNonZero_ReturnsFalse()
    {
        byte[] buf = [0x01, 0x00, 0x01, 0x65];
        Assert.False(FfmpegEncoder.IsAnnexB(buf, buf.Length));
    }

    [Fact]
    public void IsAnnexB_SecondByteNonZero_ReturnsFalse()
    {
        byte[] buf = [0x00, 0x01, 0x01, 0x65];
        Assert.False(FfmpegEncoder.IsAnnexB(buf, buf.Length));
    }

    [Fact]
    public void IsAnnexB_ThirdByteNotOneOrZero_ReturnsFalse()
    {
        byte[] buf = [0x00, 0x00, 0x02, 0x65];
        Assert.False(FfmpegEncoder.IsAnnexB(buf, buf.Length));
    }

    [Fact]
    public void IsAnnexB_ThirdByteZeroButFourthNotOne_ReturnsFalse()
    {
        byte[] buf = [0x00, 0x00, 0x00, 0x02];
        Assert.False(FfmpegEncoder.IsAnnexB(buf, buf.Length));
    }

    [Fact]
    public void IsAnnexB_ThreeBytesOnly_ThirdIsOne_ReturnsTrue()
    {
        byte[] buf = [0x00, 0x00, 0x01];
        Assert.True(FfmpegEncoder.IsAnnexB(buf, buf.Length));
    }

    [Fact]
    public void IsAnnexB_LengthExactlyThree_ThirdByteZero_ReturnsFalse()
    {
        byte[] buf = [0x00, 0x00, 0x00];
        Assert.False(FfmpegEncoder.IsAnnexB(buf, 3));
    }

    [Fact]
    public void IsAnnexB_OnlyZerosFourBytes_ReturnsFalse()
    {
        byte[] buf = [0x00, 0x00, 0x00, 0x00];
        Assert.False(FfmpegEncoder.IsAnnexB(buf, buf.Length));
    }

    [Fact]
    public void IsAnnexB_000001FollowedByData_ReturnsTrue()
    {
        byte[] buf = [0x00, 0x00, 0x01, 0xFF, 0xFF, 0xFF];
        Assert.True(FfmpegEncoder.IsAnnexB(buf, buf.Length));
    }

    // ═══════════════════════════════════════════════════════════════════
    // ScanForStartCode
    // ═══════════════════════════════════════════════════════════════════

    [Fact]
    public void ScanForStartCode_ThreeByteSC_FindsPosition()
    {
        byte[] buf = [0x65, 0x88, 0x00, 0x00, 0x01, 0x67, 0x42];
        Assert.True(FfmpegEncoder.ScanForStartCode(buf, buf.Length, out var pos));
        Assert.Equal(2, pos);
    }

    [Fact]
    public void ScanForStartCode_FourByteSC_FindsPosition()
    {
        byte[] buf = [0x65, 0x00, 0x00, 0x00, 0x01, 0x67, 0x42];
        Assert.True(FfmpegEncoder.ScanForStartCode(buf, buf.Length, out var pos));
        Assert.Equal(1, pos);
    }

    [Fact]
    public void ScanForStartCode_SCAtStart_FindsPositionZero()
    {
        byte[] buf = [0x00, 0x00, 0x01, 0x65, 0x88];
        Assert.True(FfmpegEncoder.ScanForStartCode(buf, buf.Length, out var pos));
        Assert.Equal(0, pos);
    }

    [Fact]
    public void ScanForStartCode_NoSC_ReturnsFalse()
    {
        byte[] buf = [0x65, 0x88, 0x04, 0x00, 0x00, 0x7D, 0x40];
        Assert.False(FfmpegEncoder.ScanForStartCode(buf, buf.Length, out var pos));
        Assert.Equal(-1, pos);
    }

    [Fact]
    public void ScanForStartCode_EmptyBuffer_ReturnsFalse()
    {
        byte[] buf = [];
        Assert.False(FfmpegEncoder.ScanForStartCode(buf, 0, out var pos));
        Assert.Equal(-1, pos);
    }

    [Fact]
    public void ScanForStartCode_TooShort_ReturnsFalse()
    {
        byte[] buf = [0x00, 0x00];
        Assert.False(FfmpegEncoder.ScanForStartCode(buf, buf.Length, out var pos));
        Assert.Equal(-1, pos);
    }

    [Fact]
    public void ScanForStartCode_MultipleSCs_FindsFirst()
    {
        byte[] buf = [0x00, 0x65, 0x00, 0x00, 0x01, 0x67, 0x00, 0x00, 0x01, 0x68];
        Assert.True(FfmpegEncoder.ScanForStartCode(buf, buf.Length, out var pos));
        Assert.Equal(2, pos);
    }

    [Fact]
    public void ScanForStartCode_NearEnd_ThreeByteSC()
    {
        byte[] buf = [0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01, 0x41];
        Assert.True(FfmpegEncoder.ScanForStartCode(buf, buf.Length, out var pos));
        Assert.Equal(5, pos);
    }

    [Fact]
    public void ScanForStartCode_FourByteSC_AtVeryEnd_FindsIt()
    {
        byte[] buf = [0x42, 0x42, 0x42, 0x00, 0x00, 0x00, 0x01];
        Assert.True(FfmpegEncoder.ScanForStartCode(buf, buf.Length, out var pos));
        Assert.Equal(3, pos);
    }

    [Fact]
    public void ScanForStartCode_FiveZerosThenOne_FindsAtPosition1()
    {
        byte[] buf = [0x00, 0x00, 0x00, 0x00, 0x01, 0x67];
        Assert.True(FfmpegEncoder.ScanForStartCode(buf, buf.Length, out var pos));
        Assert.Equal(1, pos);
    }

    [Fact]
    public void ScanForStartCode_Only3ByteSCs_FindsFirst()
    {
        byte[] buf = [0x00, 0x00, 0x01, 0x41, 0x00, 0x00, 0x01, 0x42];
        Assert.True(FfmpegEncoder.ScanForStartCode(buf, buf.Length, out var pos));
        Assert.Equal(0, pos);
    }

    [Fact]
    public void ScanForStartCode_DataEndsWith000000_ReturnsFalse()
    {
        byte[] buf = [0x42, 0x00, 0x00, 0x00];
        Assert.False(FfmpegEncoder.ScanForStartCode(buf, buf.Length, out var pos));
        Assert.Equal(-1, pos);
    }

    [Fact]
    public void ScanForStartCode_ThreeBytesExactly_ThreeByteSC_FindsIt()
    {
        byte[] buf = [0x00, 0x00, 0x01];
        Assert.True(FfmpegEncoder.ScanForStartCode(buf, buf.Length, out var pos));
        Assert.Equal(0, pos);
    }

    [Fact]
    public void ScanForStartCode_ThreeBytesExactly_NoSC_ReturnsFalse()
    {
        byte[] buf = [0x00, 0x00, 0x00];
        Assert.False(FfmpegEncoder.ScanForStartCode(buf, buf.Length, out var pos));
        Assert.Equal(-1, pos);
    }

    [Fact]
    public void ScanForStartCode_EightZeros_FindsFourByteSC()
    {
        byte[] buf = [0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01, 0x41];
        Assert.True(FfmpegEncoder.ScanForStartCode(buf, buf.Length, out var pos));
        Assert.Equal(4, pos);
    }

    [Fact]
    public void ScanForStartCode_TwoBuffers_000001_ThenData_Then00000001()
    {
        byte[] buf = [0x00, 0x00, 0x01, 0x41, 0x00, 0x00, 0x00, 0x01, 0x42];
        Assert.True(FfmpegEncoder.ScanForStartCode(buf, buf.Length, out var pos));
        Assert.Equal(0, pos);
    }

    [Fact]
    public void ScanForStartCode_ExactTwoBytes_ReturnsFalse()
    {
        byte[] buf = [0x00, 0x00];
        Assert.False(FfmpegEncoder.ScanForStartCode(buf, 2, out var pos));
        Assert.Equal(-1, pos);
    }

    [Fact]
    public void ScanForStartCode_ThreeByteSCOnlyAtEnd_ReturnsTrue()
    {
        byte[] buf = [0xFF, 0xFF, 0x00, 0x00, 0x01];
        Assert.True(FfmpegEncoder.ScanForStartCode(buf, buf.Length, out var pos));
        Assert.Equal(2, pos);
    }

    [Fact]
    public void ScanForStartCode_ConsecutiveZeroBytes_ThenOne()
    {
        byte[] buf = [0xFF, 0x00, 0x00, 0x00, 0x00, 0x01, 0x41];
        Assert.True(FfmpegEncoder.ScanForStartCode(buf, buf.Length, out var pos));
        Assert.Equal(2, pos);
    }

    // ═══════════════════════════════════════════════════════════════════
    // ConvertAnnexBToAvcc
    // ═══════════════════════════════════════════════════════════════════

    [Fact]
    public void ConvertAnnexBToAvcc_SingleNALU_WithTrailingSC_CreatesLengthPrefix()
    {
        byte[] nal = [0x65, 0x88, 0x04, 0x00, 0x7D];
        byte[] buf = new byte[64];
        int pos = 0;
        buf[pos++] = 0x00; buf[pos++] = 0x00; buf[pos++] = 0x01;
        System.Buffer.BlockCopy(nal, 0, buf, pos, nal.Length);
        pos += nal.Length;
        buf[pos++] = 0x00; buf[pos++] = 0x00; buf[pos++] = 0x01; buf[pos++] = 0x09;

        var result = FfmpegEncoder.ConvertAnnexBToAvcc(buf, pos, out var consumed);

        Assert.Equal(4 + nal.Length, result);
        Assert.Equal(nal.Length, (buf[0] << 24) | (buf[1] << 16) | (buf[2] << 8) | buf[3]);
        Assert.Equal(nal[0], buf[4]);
        Assert.Equal(nal[1], buf[5]);
    }

    [Fact]
    public void ConvertAnnexBToAvcc_TwoNALUs_CreatesTwoLengthPrefixes()
    {
        byte[] sps = [0x67, 0x42, 0x00, 0x1E];
        byte[] pps = [0x68, 0xCE, 0x38, 0x80];
        byte[] buf = new byte[64];
        int pos = 0;
        buf[pos++] = 0x00; buf[pos++] = 0x00; buf[pos++] = 0x01;
        System.Buffer.BlockCopy(sps, 0, buf, pos, sps.Length);
        pos += sps.Length;
        buf[pos++] = 0x00; buf[pos++] = 0x00; buf[pos++] = 0x01;
        System.Buffer.BlockCopy(pps, 0, buf, pos, pps.Length);
        pos += pps.Length;
        buf[pos++] = 0x00; buf[pos++] = 0x00; buf[pos++] = 0x01; buf[pos++] = 0x09;

        var result = FfmpegEncoder.ConvertAnnexBToAvcc(buf, pos, out var consumed);

        int expected = sps.Length + pps.Length + 4 + 4;
        Assert.Equal(expected, result);
    }

    [Fact]
    public void ConvertAnnexBToAvcc_FourByteSC_Works()
    {
        byte[] nal = [0x65, 0x10, 0x20];
        byte[] buf = new byte[64];
        int pos = 0;
        buf[pos++] = 0x00; buf[pos++] = 0x00; buf[pos++] = 0x00; buf[pos++] = 0x01;
        System.Buffer.BlockCopy(nal, 0, buf, pos, nal.Length);
        pos += nal.Length;
        buf[pos++] = 0x00; buf[pos++] = 0x00; buf[pos++] = 0x01; buf[pos++] = 0x09;

        var result = FfmpegEncoder.ConvertAnnexBToAvcc(buf, pos, out var consumed);

        Assert.Equal(4 + nal.Length, result);
        Assert.Equal(nal.Length, (buf[0] << 24) | (buf[1] << 16) | (buf[2] << 8) | buf[3]);
    }

    [Fact]
    public void ConvertAnnexBToAvcc_EmptyBuffer_ReturnsZero()
    {
        byte[] buf = new byte[8];
        var result = FfmpegEncoder.ConvertAnnexBToAvcc(buf, 0, out var consumed);
        Assert.Equal(0, result);
        Assert.Equal(0, consumed);
    }

    [Fact]
    public void ConvertAnnexBToAvcc_LeadingDataBeforeFirstSC_ConvertedAsNALU()
    {
        byte[] nal = [0x65, 0x88];
        byte[] buf = new byte[64];
        buf[0] = 0xDE; buf[1] = 0xAD;
        buf[2] = 0x00; buf[3] = 0x00; buf[4] = 0x01;
        buf[5] = nal[0]; buf[6] = nal[1];

        var result = FfmpegEncoder.ConvertAnnexBToAvcc(buf, 7, out var consumed);

        // Orphaned data before first SC IS converted as NALU payload: 4 prefix + 2 junk = 6
        Assert.Equal(6, result);
        Assert.Equal(2, (buf[0] << 24) | (buf[1] << 16) | (buf[2] << 8) | buf[3]);
        Assert.Equal(0xDE, buf[4]);
        Assert.Equal(0xAD, buf[5]);
    }

    [Fact]
    public void ConvertAnnexBToAvcc_LargeNALU_16384Bytes_UsesCorrectPrefix()
    {
        int nalLen = 16384;
        byte[] nal = new byte[nalLen];
        nal[0] = 0x65;
        byte[] buf = new byte[nalLen + 20];
        int pos = 0;
        buf[pos++] = 0x00; buf[pos++] = 0x00; buf[pos++] = 0x01;
        System.Buffer.BlockCopy(nal, 0, buf, pos, nalLen);
        pos += nalLen;
        buf[pos++] = 0xFF;
        buf[pos++] = 0x00; buf[pos++] = 0x00; buf[pos++] = 0x01; buf[pos++] = 0x09;

        var result = FfmpegEncoder.ConvertAnnexBToAvcc(buf, pos, out var consumed);

        // Guard byte counted as part of inter-SC payload
        Assert.Equal(4 + nalLen + 1, result);
        Assert.Equal(nalLen + 1, (buf[0] << 24) | (buf[1] << 16) | (buf[2] << 8) | buf[3]);
    }

    [Fact]
    public void ConvertAnnexBToAvcc_ConsumedTracksReadPosition()
    {
        byte[] nal = [0x65, 0x10];
        byte[] buf = new byte[64];
        int pos = 0;
        buf[pos++] = 0x00; buf[pos++] = 0x00; buf[pos++] = 0x01;
        buf[pos++] = nal[0]; buf[pos++] = nal[1];
        buf[pos++] = 0x00; buf[pos++] = 0x00; buf[pos++] = 0x01; buf[pos++] = 0x09;

        FfmpegEncoder.ConvertAnnexBToAvcc(buf, pos, out var consumed);
        Assert.True(consumed > 0);
        Assert.True(consumed <= pos);
    }

    [Fact]
    public void ConvertAnnexBToAvcc_NoStartCode_ReturnsZeroAndConsumesNothing()
    {
        byte[] buf = [0x65, 0x88, 0x04, 0x00, 0x7D, 0x40, 0x00, 0x00];
        var result = FfmpegEncoder.ConvertAnnexBToAvcc(buf, buf.Length, out var consumed);
        Assert.Equal(0, result);
        Assert.Equal(0, consumed);
    }

    [Fact]
    public void ConvertAnnexBToAvcc_ThreeNALUs_AllConverted()
    {
        byte[] buf = new byte[64];
        int pos = 0;
        // SPS (3 bytes)
        buf[pos++] = 0x00; buf[pos++] = 0x00; buf[pos++] = 0x01; buf[pos++] = 0x67;
        buf[pos++] = 0x42; buf[pos++] = 0x00;
        // PPS (2 bytes)
        buf[pos++] = 0x00; buf[pos++] = 0x00; buf[pos++] = 0x01; buf[pos++] = 0x68;
        buf[pos++] = 0xCE;
        // IDR (3 bytes)
        buf[pos++] = 0x00; buf[pos++] = 0x00; buf[pos++] = 0x01; buf[pos++] = 0x65;
        buf[pos++] = 0x88; buf[pos++] = 0x04;
        // Trailing AUD delimiter
        buf[pos++] = 0x00; buf[pos++] = 0x00; buf[pos++] = 0x01; buf[pos++] = 0x09;

        var result = FfmpegEncoder.ConvertAnnexBToAvcc(buf, pos, out _);

        // 3 NALUs between SCs: SPS(4+2=6) + PPS(4+2=6) + IDR(4+3=7) = 19
        Assert.Equal(19, result);
    }

    [Fact]
    public void ConvertAnnexBToAvcc_OrphanedDataBeforeSC_Converted()
    {
        byte[] buf = new byte[32];
        buf[0] = 0xFF; buf[1] = 0xFE; buf[2] = 0xFD; buf[3] = 0xFC; buf[4] = 0xFB;
        buf[5] = 0x00; buf[6] = 0x00; buf[7] = 0x01; buf[8] = 0x65; buf[9] = 0x10;

        var result = FfmpegEncoder.ConvertAnnexBToAvcc(buf, 10, out _);
        // Orphaned data converted as NALU payload: 4 prefix + 5 junk = 9
        Assert.Equal(9, result);
        Assert.Equal(5, (buf[0] << 24) | (buf[1] << 16) | (buf[2] << 8) | buf[3]);
        Assert.Equal(0xFF, buf[4]);
        Assert.Equal(0xFB, buf[8]);
    }

    [Fact]
    public void ConvertAnnexBToAvcc_MixedThreeAndFourByteSCs_AllConverted()
    {
        byte[] buf = new byte[64];
        int pos = 0;
        buf[pos++] = 0x00; buf[pos++] = 0x00; buf[pos++] = 0x01; buf[pos++] = 0x67;
        buf[pos++] = 0x42; buf[pos++] = 0x00;
        buf[pos++] = 0x00; buf[pos++] = 0x00; buf[pos++] = 0x00; buf[pos++] = 0x01;
        buf[pos++] = 0x68; buf[pos++] = 0xCE;
        buf[pos++] = 0x00; buf[pos++] = 0x00; buf[pos++] = 0x01; buf[pos++] = 0x09;

        var result = FfmpegEncoder.ConvertAnnexBToAvcc(buf, pos, out _);
        // First SC at pos=0 → nalLen=0, not written.
        // SPS: 3 bytes (0x67,0x42,0x00) → 4+3=7, PPS: 2 bytes (0x68,0xCE) → 4+2=6, trailing AUD is orphaned tail.
        Assert.Equal(13, result);
    }

    [Fact]
    public void ConvertAnnexBToAvcc_SingleThreeByteSC_WithTrailingSC_Works()
    {
        byte[] buf = new byte[16];
        int pos = 0;
        buf[pos++] = 0x00; buf[pos++] = 0x00; buf[pos++] = 0x01; buf[pos++] = 0x65;
        buf[pos++] = 0x00; buf[pos++] = 0x00; buf[pos++] = 0x01; buf[pos++] = 0x09;

        var result = FfmpegEncoder.ConvertAnnexBToAvcc(buf, pos, out _);
        Assert.Equal(4 + 1, result);
        Assert.Equal(1, buf[3]);
    }

    [Fact]
    public void ConvertAnnexBToAvcc_TwoBytesBuffer_ReturnsZero()
    {
        byte[] buf = [0x00, 0x01];
        var result = FfmpegEncoder.ConvertAnnexBToAvcc(buf, 2, out var consumed);
        Assert.Equal(0, result);
        Assert.Equal(0, consumed);
    }

    [Fact]
    public void ConvertAnnexBToAvcc_OnlyStartCode_ReturnsZero()
    {
        byte[] buf = [0x00, 0x00, 0x01];
        var result = FfmpegEncoder.ConvertAnnexBToAvcc(buf, 3, out _);
        Assert.Equal(0, result);
    }

    [Fact]
    public void ConvertAnnexBToAvcc_MultipleNALUs_PreservesOrder()
    {
        byte[] buf = new byte[64];
        int pos = 0;
        buf[pos++] = 0x00; buf[pos++] = 0x00; buf[pos++] = 0x01;
        buf[pos++] = 0x67; buf[pos++] = 0xAA;
        buf[pos++] = 0x00; buf[pos++] = 0x00; buf[pos++] = 0x01;
        buf[pos++] = 0x68; buf[pos++] = 0xBB;
        buf[pos++] = 0x00; buf[pos++] = 0x00; buf[pos++] = 0x01;
        buf[pos++] = 0x65; buf[pos++] = 0xCC;
        buf[pos++] = 0x00; buf[pos++] = 0x00; buf[pos++] = 0x01; buf[pos++] = 0x09;

        var result = FfmpegEncoder.ConvertAnnexBToAvcc(buf, pos, out _);
        // First SC at pos=0 → nalLen=0, not written.
        // Each NALU has 2 bytes (type + 1 data byte), so 3 NALUs × (4+2) = 18.
        // Trailing AUD (0x09) is orphaned tail — not written.
        Assert.Equal(18, result);

        // SPS: 4-byte len prefix + 0x67 + 0xAA (writePos 0..5)
        Assert.Equal(0x67, buf[4]);
        Assert.Equal(0xAA, buf[5]);
        // PPS: 4-byte len prefix + 0x68 + 0xBB (writePos 6..11)
        Assert.Equal(0x68, buf[10]);
        Assert.Equal(0xBB, buf[11]);
        // IDR: 4-byte len prefix + 0x65 + 0xCC (writePos 12..17)
        Assert.Equal(0x65, buf[16]);
        Assert.Equal(0xCC, buf[17]);
    }

    [Fact]
    public void ConvertAnnexBToAvcc_NALUsWithoutLeadingSC_HandledGracefully()
    {
        byte[] buf = new byte[32];
        int pos = 0;
        buf[pos++] = 0x00; buf[pos++] = 0x00; buf[pos++] = 0x01;
        buf[pos++] = 0x67; buf[pos++] = 0x42;
        buf[pos++] = 0x00; buf[pos++] = 0x00; buf[pos++] = 0x01;
        buf[pos++] = 0x68;

        var result = FfmpegEncoder.ConvertAnnexBToAvcc(buf, pos, out _);
        Assert.True(result > 0);
    }

    [Fact]
    public void ConvertAnnexBToAvcc_ConsumedTracksUnconvertedTail()
    {
        byte[] buf = new byte[16];
        int pos = 0;
        buf[pos++] = 0x00; buf[pos++] = 0x00; buf[pos++] = 0x01; buf[pos++] = 0x65;
        buf[pos++] = 0x88; buf[pos++] = 0x04; buf[pos++] = 0x00;
        buf[pos++] = 0x00; buf[pos++] = 0x00; buf[pos++] = 0x00;

        var result = FfmpegEncoder.ConvertAnnexBToAvcc(buf, pos, out var consumed);
        // No trailing SC → orphaned tail not converted
        Assert.Equal(0, result);
        Assert.True(consumed <= pos);
    }

    [Fact]
    public void ConvertAnnexBToAvcc_LargeNALU_64KB_Works()
    {
        int nalLen = 65536;
        byte[] buf = new byte[nalLen + 20];
        int pos = 0;
        buf[pos++] = 0x00; buf[pos++] = 0x00; buf[pos++] = 0x01;
        buf[pos++] = 0x65;
        pos += nalLen - 1;
        pos = 3 + nalLen;
        buf[pos++] = 0xFF;
        buf[pos++] = 0x00; buf[pos++] = 0x00; buf[pos++] = 0x01; buf[pos++] = 0x09;

        var result = FfmpegEncoder.ConvertAnnexBToAvcc(buf, pos, out _);
        // Guard byte counted as inter-SC payload
        Assert.Equal(4 + nalLen + 1, result);
        Assert.Equal(0x00, buf[0]);
        Assert.Equal(0x01, buf[1]);
        Assert.Equal(0x00, buf[2]);
        Assert.Equal(0x01, buf[3]);
    }

    [Fact]
    public void ConvertAnnexBToAvcc_AdjacentSCs_EmptyNALU()
    {
        byte[] buf = new byte[16];
        int pos = 0;
        buf[pos++] = 0x00; buf[pos++] = 0x00; buf[pos++] = 0x01; buf[pos++] = 0x09;
        buf[pos++] = 0x00; buf[pos++] = 0x00; buf[pos++] = 0x01; buf[pos++] = 0x65;
        buf[pos++] = 0x10;

        var result = FfmpegEncoder.ConvertAnnexBToAvcc(buf, pos, out _);
        // AUD (1 byte) between first two SCs: 4 prefix + 1 = 5
        // IDR is orphaned tail: not converted
        Assert.Equal(5, result);
    }

    [Fact]
    public void ConvertAnnexBToAvcc_JunkBetweenSCs_IncludedInNALU()
    {
        byte[] buf = new byte[32];
        int pos = 0;
        buf[pos++] = 0x00; buf[pos++] = 0x00; buf[pos++] = 0x01; buf[pos++] = 0x65;
        buf[pos++] = 0xAA; buf[pos++] = 0xBB; buf[pos++] = 0xCC;
        buf[pos++] = 0x00; buf[pos++] = 0x00; buf[pos++] = 0x01; buf[pos++] = 0x68;

        var result = FfmpegEncoder.ConvertAnnexBToAvcc(buf, pos, out _);
        // NAL #1 between SCs: 4 prefix + 4 data (65 AA BB CC) = 8
        // NAL #2 (0x68) is orphaned tail: not converted
        Assert.Equal(8, result);
    }

    [Fact]
    public void ConvertAnnexBToAvcc_TrailingNALUWithoutSC_NotWritten()
    {
        byte[] buf = new byte[32];
        int pos = 0;
        buf[pos++] = 0x00; buf[pos++] = 0x00; buf[pos++] = 0x01;
        buf[pos++] = 0x65; buf[pos++] = 0x10; buf[pos++] = 0x20;

        var result = FfmpegEncoder.ConvertAnnexBToAvcc(buf, pos, out var consumed);
        // Single SC: NALU after last SC is orphaned tail, not written
        Assert.Equal(0, result);
        Assert.Equal(3, consumed);
    }

    [Fact]
    public void ConvertAnnexBToAvcc_ConsumedEqualsInputLength_WhenAllProcessed()
    {
        byte[] buf = new byte[16];
        int pos = 0;
        buf[pos++] = 0x00; buf[pos++] = 0x00; buf[pos++] = 0x01;
        buf[pos++] = 0x65; buf[pos++] = 0x10;

        FfmpegEncoder.ConvertAnnexBToAvcc(buf, pos, out var consumed);
        // NALU is orphaned tail → consumed = 3 (after first SC), not full length
        Assert.Equal(3, consumed);
    }

    [Fact]
    public void ConvertAnnexBToAvcc_OrphanedTail_LeavesConsumedLessThanLength()
    {
        byte[] buf = new byte[16];
        int pos = 0;
        buf[pos++] = 0x00; buf[pos++] = 0x00; buf[pos++] = 0x01;
        buf[pos++] = 0x65; buf[pos++] = 0x10;
        buf[pos++] = 0xDE; buf[pos++] = 0xAD; buf[pos++] = 0xBE;

        var result = FfmpegEncoder.ConvertAnnexBToAvcc(buf, pos, out var consumed);

        // Single SC: orphaned tail includes NAL data + trailing junk
        Assert.Equal(0, result);
        Assert.Equal(3, consumed);
        Assert.True(consumed < pos);
    }

    // ═══════════════════════════════════════════════════════════════════
    // FindAnnexBAccessUnitBoundary (private static, via reflection)
    // ═══════════════════════════════════════════════════════════════════

    // Buffer layout helper: SC at position p is [p]=00 [p+1]=00 [p+2]=01, NAL byte at p+3
    // Position is where the start code begins.

    [Fact]
    public void FindBoundary_NoSliceNoAUD_ReturnsZero()
    {
        byte[] buf = [0x00, 0x00, 0x01, 0x67, 0x42, 0x00, 0x01];
        int pos = InvokeFindAnnexBAccessUnitBoundaryPos(buf, buf.Length, hadSlice: false);
        Assert.Equal(0, pos);
    }

    [Fact]
    public void FindBoundary_SPSAfterSlice_ReturnsSPSPosition()
    {
        byte[] buf = new byte[32];
        int pos = 0;
        // IDR slice at position 0
        buf[pos++] = 0x00; buf[pos++] = 0x00; buf[pos++] = 0x01; buf[pos++] = 0x65;
        buf[pos++] = 0x88;
        // SPS at position 5 (3-byte SC: 00 00 01 at indices 5,6,7)
        buf[pos++] = 0x00; buf[pos++] = 0x00; buf[pos++] = 0x01; buf[pos++] = 0x67;
        buf[pos++] = 0x42;

        int boundary = InvokeFindAnnexBAccessUnitBoundaryPos(buf, pos, hadSlice: false);
        Assert.Equal(5, boundary);
    }

    [Fact]
    public void FindBoundary_PPSAfterSlice_ReturnsPPSPosition()
    {
        byte[] buf = new byte[32];
        int pos = 0;
        buf[pos++] = 0x00; buf[pos++] = 0x00; buf[pos++] = 0x01; buf[pos++] = 0x65;
        buf[pos++] = 0x88;
        // PPS at position 5
        buf[pos++] = 0x00; buf[pos++] = 0x00; buf[pos++] = 0x01; buf[pos++] = 0x68;
        buf[pos++] = 0xCE;

        int boundary = InvokeFindAnnexBAccessUnitBoundaryPos(buf, pos, hadSlice: false);
        Assert.Equal(5, boundary);
    }

    [Fact]
    public void FindBoundary_AUDAfterSlice_ReturnsZero()
    {
        byte[] buf = new byte[32];
        int pos = 0;
        // P slice (type 1) at position 0
        buf[pos++] = 0x00; buf[pos++] = 0x00; buf[pos++] = 0x01; buf[pos++] = 0x41;
        buf[pos++] = 0x10;
        // AUD (type 9) at position 5
        buf[pos++] = 0x00; buf[pos++] = 0x00; buf[pos++] = 0x01; buf[pos++] = 0x09;
        buf[pos++] = 0x10;

        // With hadSlice=true, first slice at pos=0 triggers immediately
        int boundary = InvokeFindAnnexBAccessUnitBoundaryPos(buf, pos, hadSlice: true);
        Assert.Equal(0, boundary);
    }

    [Fact]
    public void FindBoundary_SliceAfterSlice_SplitsAtSecondSlice()
    {
        byte[] buf = new byte[32];
        int pos = 0;
        buf[pos++] = 0x00; buf[pos++] = 0x00; buf[pos++] = 0x01; buf[pos++] = 0x65;
        buf[pos++] = 0x88;
        buf[pos++] = 0x00; buf[pos++] = 0x00; buf[pos++] = 0x01; buf[pos++] = 0x41;
        buf[pos++] = 0x10;

        int boundary = InvokeFindAnnexBAccessUnitBoundaryPos(buf, pos, hadSlice: false);
        Assert.Equal(5, boundary);
    }

    [Fact]
    public void FindBoundary_hadSliceTrue_SplitsAtNextAU()
    {
        byte[] buf = new byte[32];
        int pos = 0;
        // SEI (type 6) at position 0
        buf[pos++] = 0x00; buf[pos++] = 0x00; buf[pos++] = 0x01; buf[pos++] = 0x06;
        buf[pos++] = 0xAA;
        // SPS (type 7) at position 5
        buf[pos++] = 0x00; buf[pos++] = 0x00; buf[pos++] = 0x01; buf[pos++] = 0x67;
        buf[pos++] = 0x42;

        int boundary = InvokeFindAnnexBAccessUnitBoundaryPos(buf, pos, hadSlice: true);
        Assert.Equal(5, boundary);
    }

    [Fact]
    public void FindBoundary_AllZeros_ReturnsZero()
    {
        byte[] buf = [0x00, 0x00, 0x00, 0x00, 0x00];
        int boundary = InvokeFindAnnexBAccessUnitBoundaryPos(buf, buf.Length, hadSlice: false);
        Assert.Equal(0, boundary);
    }

    [Fact]
    public void FindBoundary_BufferTooShort_ReturnsZero()
    {
        byte[] buf = [0x00, 0x00, 0x01, 0x65];
        int boundary = InvokeFindAnnexBAccessUnitBoundaryPos(buf, buf.Length, hadSlice: false);
        Assert.Equal(0, boundary);
    }

    [Fact]
    public void FindBoundary_hadSliceFalseSliceNAL_ReturnsZero()
    {
        byte[] buf = [0x00, 0x00, 0x01, 0x65, 0x88, 0x00, 0x00, 0x01, 0x41, 0x10];
        int boundary = InvokeFindAnnexBAccessUnitBoundaryPos(buf, buf.Length, hadSlice: false);
        Assert.Equal(5, boundary);
    }

    [Fact]
    public void FindBoundary_NonSCData_DoesNotTrigger()
    {
        byte[] buf = new byte[32];
        int pos = 0;
        buf[pos++] = 0x00; buf[pos++] = 0x00; buf[pos++] = 0x01; buf[pos++] = 0x06;
        buf[pos++] = 0xAA;
        buf[pos++] = 0x00; buf[pos++] = 0x00; buf[pos++] = 0x01; buf[pos++] = 0x06;
        buf[pos++] = 0xBB;

        int boundary = InvokeFindAnnexBAccessUnitBoundaryPos(buf, pos, hadSlice: false);
        Assert.Equal(0, boundary);
    }

    [Fact]
    public void FindBoundary_FourByteSC_SliceAfterSlice_Splits()
    {
        byte[] buf = new byte[32];
        int pos = 0;
        // IDR with 4-byte SC at position 0
        buf[pos++] = 0x00; buf[pos++] = 0x00; buf[pos++] = 0x00; buf[pos++] = 0x01;
        buf[pos++] = 0x65; buf[pos++] = 0x88;
        // PPS with 3-byte SC at position 6
        buf[pos++] = 0x00; buf[pos++] = 0x00; buf[pos++] = 0x01;
        buf[pos++] = 0x68; buf[pos++] = 0xCE;

        int boundary = InvokeFindAnnexBAccessUnitBoundaryPos(buf, pos, hadSlice: false);
        Assert.Equal(6, boundary);
    }

    [Fact]
    public void FindBoundary_SliceType2_NonIDR_SetsSeenSlice()
    {
        byte[] buf = new byte[32];
        int pos = 0;
        // Non-IDR slice (type 2) at position 0
        buf[pos++] = 0x00; buf[pos++] = 0x00; buf[pos++] = 0x01; buf[pos++] = 0x42;
        buf[pos++] = 0x10;
        // SPS (type 7) at position 5
        buf[pos++] = 0x00; buf[pos++] = 0x00; buf[pos++] = 0x01; buf[pos++] = 0x67;
        buf[pos++] = 0x42;

        int boundary = InvokeFindAnnexBAccessUnitBoundaryPos(buf, pos, hadSlice: false);
        Assert.Equal(5, boundary);
    }

    [Fact]
    public void FindBoundary_hadSliceFalse_AndFirstNALUIsSlice_NoSecondNALU_ReturnsZero()
    {
        // Single IDR, no second NALU to trigger boundary
        byte[] buf = [0x00, 0x00, 0x01, 0x65, 0x88, 0x40];
        int boundary = InvokeFindAnnexBAccessUnitBoundaryPos(buf, buf.Length, hadSlice: false);
        Assert.Equal(0, boundary);
    }

    // ═══════════════════════════════════════════════════════════════════
    // CheckKeyFrame (private instance, via reflection)
    // ═══════════════════════════════════════════════════════════════════

    [Fact]
    public void CheckKeyFrame_H264_IDR_ReturnsTrue()
    {
        var enc = CreateH264Encoder();
        byte[] data = [0x00, 0x00, 0x00, 0x01, 0x65];
        Assert.True(InvokeCheckKeyFrame(enc, data));
    }

    [Fact]
    public void CheckKeyFrame_H264_NonSliceNAL_ReturnsFalse()
    {
        var enc = CreateH264Encoder();
        byte[] data = [0x00, 0x00, 0x00, 0x01, 0x67];
        Assert.False(InvokeCheckKeyFrame(enc, data));
    }

    [Fact]
    public void CheckKeyFrame_H264_PSlice_ReturnsFalse()
    {
        var enc = CreateH264Encoder();
        byte[] data = [0x00, 0x00, 0x00, 0x01, 0x41];
        Assert.False(InvokeCheckKeyFrame(enc, data));
    }

    [Fact]
    public void CheckKeyFrame_H264_EmptyData_ReturnsFalse()
    {
        var enc = CreateH264Encoder();
        byte[] data = [];
        Assert.False(InvokeCheckKeyFrame(enc, data));
    }

    [Fact]
    public void CheckKeyFrame_Av1_AlwaysReturnsFalse()
    {
        var enc = CreateEncoderForTest();
        SetEncoderField(enc, "_codec", "av1_nvenc");
        byte[] data = [0x00, 0x00, 0x00, 0x01, 0x65];
        Assert.False(InvokeCheckKeyFrame(enc, data));
    }

    [Fact]
    public void CheckKeyFrame_HEVC_IDR19_ReturnsTrue()
    {
        var enc = CreateEncoderForTest();
        SetEncoderField(enc, "_codec", "hevc_nvenc");
        // NAL type 19 → (19 << 1 | 1) = 0x27
        byte[] data = [0x00, 0x00, 0x00, 0x01, 0x27];
        Assert.True(InvokeCheckKeyFrame(enc, data));
    }

    [Fact]
    public void CheckKeyFrame_HEVC_IDR20_ReturnsTrue()
    {
        var enc = CreateEncoderForTest();
        SetEncoderField(enc, "_codec", "hevc_nvenc");
        // NAL type 20 → (20 << 1 | 1) = 0x29
        byte[] data = [0x00, 0x00, 0x00, 0x01, 0x29];
        Assert.True(InvokeCheckKeyFrame(enc, data));
    }

    [Fact]
    public void CheckKeyFrame_HEVC_TRAIL_ReturnsFalse()
    {
        var enc = CreateEncoderForTest();
        SetEncoderField(enc, "_codec", "hevc_nvenc");
        // NAL type 0 → (0 << 1 | 0) = 0x00
        byte[] data = [0x00, 0x00, 0x00, 0x01, 0x00];
        Assert.False(InvokeCheckKeyFrame(enc, data));
    }

    [Fact]
    public void CheckKeyFrame_H264_ZeroLengthNAL_ReturnsFalse()
    {
        var enc = CreateH264Encoder();
        byte[] data = [0x00, 0x00, 0x00, 0x00];
        Assert.False(InvokeCheckKeyFrame(enc, data));
    }

    [Fact]
    public void CheckKeyFrame_H264_SPSThenIDR_ReturnsTrue()
    {
        var enc = CreateH264Encoder();
        // AVCC: SPS len=1, IDR len=1 — IDR at type 5 triggers return true
        byte[] data = [
            0x00, 0x00, 0x00, 0x01, 0x67,  // SPS len=1
            0x00, 0x00, 0x00, 0x01, 0x65   // IDR len=1
        ];
        Assert.True(InvokeCheckKeyFrame(enc, data));
    }

    [Fact]
    public void CheckKeyFrame_H264_IDRWithMultiByteNAL_ReturnsTrue()
    {
        var enc = CreateH264Encoder();
        // AVCC: SPS len=2 (type + extra byte), IDR len=1
        byte[] data = [
            0x00, 0x00, 0x00, 0x02, 0x67, 0x42,  // SPS len=2
            0x00, 0x00, 0x00, 0x01, 0x65           // IDR len=1
        ];
        Assert.True(InvokeCheckKeyFrame(enc, data));
    }

    [Fact]
    public void CheckKeyFrame_H264_BSlice_ReturnsFalse()
    {
        var enc = CreateH264Encoder();
        byte[] data = [0x00, 0x00, 0x00, 0x01, 0x43];
        Assert.False(InvokeCheckKeyFrame(enc, data));
    }

    [Fact]
    public void CheckKeyFrame_HEVC_CRA_ReturnsFalse()
    {
        var enc = CreateEncoderForTest();
        SetEncoderField(enc, "_codec", "hevc_nvenc");
        // CRA NAL type 16 → (16 << 1 | 1) = 0x21
        // CheckKeyFrame only matches type 19 (IDR_W_RADL) and 20 (IDR_N_LP)
        byte[] data = [0x00, 0x00, 0x00, 0x01, 0x21];
        Assert.False(InvokeCheckKeyFrame(enc, data));
    }

    [Fact]
    public void CheckKeyFrame_HEVC_BLA_ReturnsFalse()
    {
        var enc = CreateEncoderForTest();
        SetEncoderField(enc, "_codec", "hevc_nvenc");
        // BLA NAL type 13 → (13 << 1 | 1) = 0x1B
        // Not in CheckKeyFrame's keyframe set (19, 20)
        byte[] data = [0x00, 0x00, 0x00, 0x01, 0x1B];
        Assert.False(InvokeCheckKeyFrame(enc, data));
    }

    [Fact]
    public void CheckKeyFrame_HEVC_TRAIL_NonKey_ReturnsFalse()
    {
        var enc = CreateEncoderForTest();
        SetEncoderField(enc, "_codec", "hevc_nvenc");
        // NAL type 1 → (1 << 1 | 1) = 0x03 → type 1 (TRAIL_R, <= 9)
        byte[] data = [0x00, 0x00, 0x00, 0x01, 0x03];
        Assert.False(InvokeCheckKeyFrame(enc, data));
    }

    // ═══════════════════════════════════════════════════════════════════
    // ParseAvcc (internal instance, direct call)
    // ═══════════════════════════════════════════════════════════════════

    [Fact]
    public void ParseAvcc_SingleSliceNALU_SetsHadSliceThenEmitResetsIt()
    {
        var enc = CreateH264Encoder();
        InitParseAvccState(enc);

        byte[] avccData = [0x00, 0x00, 0x00, 0x01, 0x65, 0x88];
        enc.ParseAvcc(avccData);

        // EmitPacket at end resets _hadSlice to false after successful emit
        bool hadSlice = (bool)GetEncoderField(enc, "_hadSlice");
        Assert.False(hadSlice);
    }

    [Fact]
    public void ParseAvcc_SingleSliceNALU_AppendsToPending()
    {
        var enc = CreateH264Encoder();
        InitParseAvccState(enc);

        byte[] avccData = [0x00, 0x00, 0x00, 0x01, 0x65, 0x88];
        enc.ParseAvcc(avccData);

        // EmitPacket consumed the pending buffer
        int pendingLen = (int)GetEncoderField(enc, "_pendingLen");
        Assert.Equal(0, pendingLen);
    }

    [Fact]
    public void ParseAvcc_IncompleteNALU_SavesTailForNextRead()
    {
        var enc = CreateH264Encoder();
        InitParseAvccState(enc);

        // Complete NALU (len=2, slice) + incomplete NALU (len=5 but only 1 byte payload)
        byte[] avccData = [
            0x00, 0x00, 0x00, 0x02, 0x65, 0x10,
            0x00, 0x00, 0x00, 0x05, 0x67
        ];

        enc.ParseAvcc(avccData);

        // Bug 1 fix: Incomplete NALU goes to _incompleteNalBuf, NOT _pendingBuf.
        // Complete NALU (len=2 slice) is in _pendingBuf with _hadSlice=true.
        // Post-loop EmitPacket fires for the complete NALU only.
        int pendingLen = (int)GetEncoderField(enc, "_pendingLen");
        Assert.Equal(0, pendingLen); // EmitPacket consumed the complete NALU

        // Verify incomplete tail was saved separately
        int incompleteLen = (int)GetEncoderField(enc, "_incompleteNalLen");
        Assert.Equal(5, incompleteLen); // 4-byte length prefix + 1 byte payload

        // Verify the emitted packet has only the complete NALU (6 bytes: 4 prefix + 2 payload)
        var channel = (System.Threading.Channels.Channel<EncodedPacket>)GetEncoderField(enc, "_outputChannel");
        Assert.True(channel.Reader.TryRead(out var packet));
        Assert.Equal(6, packet!.DataLength);
    }

    [Fact]
    public void ParseAvcc_SPSThenPPS_CachesAvcc()
    {
        var enc = CreateH264Encoder();
        InitParseAvccState(enc);

        byte[] spsData = [0x67, 0x42, 0x00, 0x1E, 0xAC, 0x52, 0x80, 0x7B, 0x02, 0x20, 0x20, 0x20, 0x80];
        byte[] ppsData = [0x68, 0xEE, 0x3C, 0x80];
        byte[] idrData = [0x65, 0x88, 0x84];

        byte[] avccBuf = new byte[4 + spsData.Length + 4 + ppsData.Length + 4 + idrData.Length];
        int off = 0;
        avccBuf[off++] = 0x00; avccBuf[off++] = 0x00; avccBuf[off++] = 0x00;
        avccBuf[off++] = (byte)spsData.Length;
        System.Buffer.BlockCopy(spsData, 0, avccBuf, off, spsData.Length); off += spsData.Length;
        avccBuf[off++] = 0x00; avccBuf[off++] = 0x00; avccBuf[off++] = 0x00;
        avccBuf[off++] = (byte)ppsData.Length;
        System.Buffer.BlockCopy(ppsData, 0, avccBuf, off, ppsData.Length); off += ppsData.Length;
        avccBuf[off++] = 0x00; avccBuf[off++] = 0x00; avccBuf[off++] = 0x00;
        avccBuf[off++] = (byte)idrData.Length;
        System.Buffer.BlockCopy(idrData, 0, avccBuf, off, idrData.Length); off += idrData.Length;

        enc.ParseAvcc(avccBuf);

        var cachedAvcc = GetEncoderField(enc, "_cachedAvcc");
        Assert.NotNull(cachedAvcc);
    }

    [Fact]
    public void ParseAvcc_EmptyData_NoSideEffects()
    {
        var enc = CreateH264Encoder();
        InitParseAvccState(enc);

        enc.ParseAvcc(ReadOnlySpan<byte>.Empty);

        bool hadSlice = (bool)GetEncoderField(enc, "_hadSlice");
        Assert.False(hadSlice);
    }

    [Fact]
    public void ParseAvcc_AUDDelimiter_DoesNotSetHadSlice()
    {
        var enc = CreateH264Encoder();
        InitParseAvccState(enc);

        // AUD (type 9) then slice (type 5)
        byte[] data = [
            0x00, 0x00, 0x00, 0x01, 0x09,
            0x00, 0x00, 0x00, 0x01, 0x65
        ];

        enc.ParseAvcc(data);

        // AUD doesn't set hadSlice. Slice sets it, then EmitPacket at end resets it.
        bool hadSlice = (bool)GetEncoderField(enc, "_hadSlice");
        Assert.False(hadSlice);
    }

    [Fact]
    public void ParseAvcc_LargeNALUOver200KB_SetsPendingTooLarge()
    {
        var enc = CreateH264Encoder();
        InitParseAvccState(enc);
        SetEncoderField(enc, "_hadSlice", true);
        SetEncoderField(enc, "_pendingLen", 300_000);

        byte[] nalPayload = new byte[100];
        nalPayload[0] = 0x65;
        byte[] avccData = new byte[4 + nalPayload.Length];
        avccData[3] = (byte)nalPayload.Length;
        System.Buffer.BlockCopy(nalPayload, 0, avccData, 4, nalPayload.Length);

        enc.ParseAvcc(avccData);

        var tooLarge = GetEncoderField(enc, "_pendingTooLarge");
        Assert.True((bool)tooLarge);
    }

    [Fact]
    public void ParseAvcc_AV1Codec_SkipsSPSPPSCaching()
    {
        var enc = CreateEncoderForTest();
        SetEncoderField(enc, "_codec", "av1_nvenc");
        InitParseAvccState(enc);

        // AV1 OBU type 2 (Sequence Header) — doesn't match H264 SPS/PPS types
        byte[] data = [
            0x00, 0x00, 0x00, 0x03, 0x12, 0x34, 0x56
        ];

        enc.ParseAvcc(data);

        var cachedSps = GetEncoderField(enc, "_cachedSps");
        var cachedPps = GetEncoderField(enc, "_cachedPps");
        Assert.Null(cachedSps);
        Assert.Null(cachedPps);
    }

    [Fact]
    public void ParseAvcc_H264TwoFramesWithAUD_EmitsBetweenFrames()
    {
        var enc = CreateH264Encoder();
        InitParseAvccState(enc);

        // AUD + IDR slice → AUD delimiter, then IDR slice
        // At end: hadSlice=true → EmitPacket resets it
        byte[] frame1 = [
            0x00, 0x00, 0x00, 0x01, 0x09,   // AUD (type 9)
            0x00, 0x00, 0x00, 0x02, 0x65, 0x88  // IDR slice (type 5, len=2)
        ];

        enc.ParseAvcc(frame1);

        // After first frame: slice set hadSlice=true, EmitPacket at end resets to false
        bool hadSlice = (bool)GetEncoderField(enc, "_hadSlice");
        Assert.False(hadSlice);

        // Second frame
        byte[] frame2 = [
            0x00, 0x00, 0x00, 0x01, 0x09,
            0x00, 0x00, 0x00, 0x01, 0x65
        ];
        enc.ParseAvcc(frame2);

        hadSlice = (bool)GetEncoderField(enc, "_hadSlice");
        Assert.False(hadSlice);
    }

    // ═══════════════════════════════════════════════════════════════════
    // AppendPendingAvccNal (private instance, via reflection)
    // ═══════════════════════════════════════════════════════════════════

    private static void InvokeAppendPendingAvccNal(FfmpegEncoder encoder, byte[] data, int offset, int nalLen)
    {
        var method = typeof(FfmpegEncoder).GetMethod("AppendPendingAvccNal",
            BindingFlags.NonPublic | BindingFlags.Instance);
        Assert.NotNull(method);
        method!.Invoke(encoder, [data, offset, nalLen]);
    }

    [Fact]
    public void AppendPendingAvccNal_SingleNALU_CreatesLengthPrefixedData()
    {
        var enc = CreateEncoderForTest();
        SetEncoderField(enc, "_pendingLen", 0);
        SetEncoderField(enc, "_pendingBuf", null);

        byte[] nalData = [0x65, 0x88, 0x04, 0x00];
        InvokeAppendPendingAvccNal(enc, nalData, 0, nalData.Length);

        int pendingLen = (int)GetEncoderField(enc, "_pendingLen");
        var pendingBuf = (byte[])GetEncoderField(enc, "_pendingBuf");

        Assert.Equal(8, pendingLen);
        Assert.Equal(0, pendingBuf[0]);
        Assert.Equal(0, pendingBuf[1]);
        Assert.Equal(0, pendingBuf[2]);
        Assert.Equal(4, pendingBuf[3]);
        Assert.Equal(0x65, pendingBuf[4]);
        Assert.Equal(0x88, pendingBuf[5]);
    }

    [Fact]
    public void AppendPendingAvccNal_MultipleNALUs_Accumulates()
    {
        var enc = CreateEncoderForTest();
        SetEncoderField(enc, "_pendingLen", 0);
        SetEncoderField(enc, "_pendingBuf", null);

        byte[] nal1 = [0x67, 0x42];
        byte[] nal2 = [0x68, 0xCE];
        InvokeAppendPendingAvccNal(enc, nal1, 0, nal1.Length);
        InvokeAppendPendingAvccNal(enc, nal2, 0, nal2.Length);

        int pendingLen = (int)GetEncoderField(enc, "_pendingLen");
        Assert.Equal(12, pendingLen);
    }

    [Fact]
    public void AppendPendingAvccNal_LargeNALU_Works()
    {
        var enc = CreateEncoderForTest();
        SetEncoderField(enc, "_pendingLen", 0);
        SetEncoderField(enc, "_pendingBuf", null);

        byte[] nalData = new byte[100_000];
        nalData[0] = 0x65;
        InvokeAppendPendingAvccNal(enc, nalData, 0, nalData.Length);

        int pendingLen = (int)GetEncoderField(enc, "_pendingLen");
        Assert.Equal(4 + 100_000, pendingLen);
    }

    [Fact]
    public void AppendPendingAvccNal_Exceeding50MB_ResetsState()
    {
        var enc = CreateEncoderForTest();
        SetEncoderField(enc, "_pendingLen", 50 * 1024 * 1024 + 1);
        SetEncoderField(enc, "_pendingBuf", new byte[50 * 1024 * 1024 + 1]);
        SetEncoderField(enc, "_hadSlice", true);

        InvokeAppendPendingAvccNal(enc, [0x01, 0x02], 0, 2);

        int pendingLen = (int)GetEncoderField(enc, "_pendingLen");
        bool hadSlice = (bool)GetEncoderField(enc, "_hadSlice");
        // 50MB exceeded → reset: pendingLen=0, hadSlice=false, then append 6 bytes (4 prefix + 2 data)
        Assert.Equal(6, pendingLen);
        Assert.False(hadSlice);
    }

    [Fact]
    public void AppendPendingAvccNal_OffsetAndLength_NALData()
    {
        var enc = CreateEncoderForTest();
        SetEncoderField(enc, "_pendingLen", 0);
        SetEncoderField(enc, "_pendingBuf", null);

        byte[] buf = [0xFF, 0x65, 0x88, 0x04, 0x00, 0xAA];
        // Read NAL from offset=1, length=3 (0x65, 0x88, 0x04)
        InvokeAppendPendingAvccNal(enc, buf, 1, 3);

        int pendingLen = (int)GetEncoderField(enc, "_pendingLen");
        var pendingBuf = (byte[])GetEncoderField(enc, "_pendingBuf");

        Assert.Equal(7, pendingLen); // 4 prefix + 3 data
        Assert.Equal(3, pendingBuf[3]); // nalLen = 3
        Assert.Equal(0x65, pendingBuf[4]);
        Assert.Equal(0x88, pendingBuf[5]);
        Assert.Equal(0x04, pendingBuf[6]);
    }

    // ═══════════════════════════════════════════════════════════════════
    // AppendPending (internal instance, direct call)
    // ═══════════════════════════════════════════════════════════════════

    [Fact]
    public void AppendPending_SingleChunk_SetsPendingLen()
    {
        var enc = CreateEncoderForTest();
        SetEncoderField(enc, "_pendingLen", 0);
        SetEncoderField(enc, "_pendingBuf", null);

        byte[] chunk = [0x00, 0x00, 0x00, 0x02, 0x65, 0x10];
        enc.AppendPending(chunk);

        int pendingLen = (int)GetEncoderField(enc, "_pendingLen");
        Assert.Equal(6, pendingLen);
    }

    [Fact]
    public void AppendPending_MultipleChunks_Accumulates()
    {
        var enc = CreateEncoderForTest();
        SetEncoderField(enc, "_pendingLen", 0);
        SetEncoderField(enc, "_pendingBuf", null);

        enc.AppendPending(new byte[] { 0x01, 0x02 });
        enc.AppendPending(new byte[] { 0x03, 0x04, 0x05 });

        int pendingLen = (int)GetEncoderField(enc, "_pendingLen");
        Assert.Equal(5, pendingLen);
    }

    [Fact]
    public void AppendPending_Over50MB_ResetsState()
    {
        var enc = CreateEncoderForTest();
        SetEncoderField(enc, "_pendingLen", 50 * 1024 * 1024 + 1);
        SetEncoderField(enc, "_pendingBuf", new byte[50 * 1024 * 1024 + 1]);
        SetEncoderField(enc, "_hadSlice", true);

        enc.AppendPending(new byte[] { 0x01 });

        int pendingLen = (int)GetEncoderField(enc, "_pendingLen");
        bool hadSlice = (bool)GetEncoderField(enc, "_hadSlice");
        Assert.Equal(1, pendingLen);
        Assert.False(hadSlice);
    }

    // ═══════════════════════════════════════════════════════════════════
    // CheckPendingHasSlice (private instance, via reflection)
    // ═══════════════════════════════════════════════════════════════════

    private static bool InvokeCheckPendingHasSlice(FfmpegEncoder encoder)
    {
        var method = typeof(FfmpegEncoder).GetMethod("CheckPendingHasSlice",
            BindingFlags.NonPublic | BindingFlags.Instance);
        Assert.NotNull(method);
        return (bool)method!.Invoke(encoder, [])!;
    }

    [Fact]
    public void CheckPendingHasSlice_EmptyPending_ReturnsFalse()
    {
        var enc = CreateH264Encoder();
        SetEncoderField(enc, "_pendingBuf", null);
        SetEncoderField(enc, "_pendingLen", 0);
        Assert.False(InvokeCheckPendingHasSlice(enc));
    }

    [Fact]
    public void CheckPendingHasSlice_SPSONly_ReturnsFalse()
    {
        var enc = CreateH264Encoder();
        byte[] nalData = [0x67, 0x42];
        InvokeAppendPendingAvccNal(enc, nalData, 0, nalData.Length);
        Assert.False(InvokeCheckPendingHasSlice(enc));
    }

    [Fact]
    public void CheckPendingHasSlice_SliceNALU_ReturnsTrue()
    {
        var enc = CreateH264Encoder();
        byte[] nalData = [0x65, 0x88];
        InvokeAppendPendingAvccNal(enc, nalData, 0, nalData.Length);
        Assert.True(InvokeCheckPendingHasSlice(enc));
    }

    [Fact]
    public void CheckPendingHasSlice_AV1_AlwaysReturnsTrue()
    {
        var enc = CreateEncoderForTest();
        SetEncoderField(enc, "_codec", "av1_nvenc");
        byte[] nalData = [0x12, 0x34];
        InvokeAppendPendingAvccNal(enc, nalData, 0, nalData.Length);
        Assert.True(InvokeCheckPendingHasSlice(enc));
    }

    [Fact]
    public void CheckPendingHasSlice_HEVC_VCLNALU_ReturnsTrue()
    {
        var enc = CreateEncoderForTest();
        SetEncoderField(enc, "_codec", "hevc_nvenc");
        // VCL NAL type 2 → (2 << 1 | 0) = 0x04
        byte[] nalData = [0x04, 0x10];
        InvokeAppendPendingAvccNal(enc, nalData, 0, nalData.Length);
        Assert.True(InvokeCheckPendingHasSlice(enc));
    }

    [Fact]
    public void CheckPendingHasSlice_HEVC_NonVCLNALU_ReturnsFalse()
    {
        var enc = CreateEncoderForTest();
        SetEncoderField(enc, "_codec", "hevc_nvenc");
        // VPS NAL type 32 → (32 << 1 | 0) = 0x40
        byte[] nalData = [0x40, 0x10];
        InvokeAppendPendingAvccNal(enc, nalData, 0, nalData.Length);
        Assert.False(InvokeCheckPendingHasSlice(enc));
    }

    [Fact]
    public void CheckPendingHasSlice_InvalidNALLen_StopsScan()
    {
        var enc = CreateH264Encoder();
        var pendingBuf = new byte[1024];
        pendingBuf[0] = 0x00; pendingBuf[1] = 0x00;
        pendingBuf[2] = 0x00; pendingBuf[3] = 100;
        pendingBuf[4] = 0x65; pendingBuf[5] = 0x88;
        SetEncoderField(enc, "_pendingBuf", pendingBuf);
        SetEncoderField(enc, "_pendingLen", 6);

        Assert.False(InvokeCheckPendingHasSlice(enc));
    }

    [Fact]
    public void CheckPendingHasSlice_PSlice_ReturnsTrue()
    {
        var enc = CreateH264Encoder();
        // P slice (type 1) → isSlice = true
        byte[] nalData = [0x41, 0x10];
        InvokeAppendPendingAvccNal(enc, nalData, 0, nalData.Length);
        Assert.True(InvokeCheckPendingHasSlice(enc));
    }

    [Fact]
    public void CheckPendingHasSlice_MultipleNALUs_SPSThenSlice_ReturnsTrue()
    {
        var enc = CreateH264Encoder();
        byte[] sps = [0x67, 0x42];
        byte[] slice = [0x65, 0x88];
        InvokeAppendPendingAvccNal(enc, sps, 0, sps.Length);
        InvokeAppendPendingAvccNal(enc, slice, 0, slice.Length);
        Assert.True(InvokeCheckPendingHasSlice(enc));
    }

    // ═══════════════════════════════════════════════════════════════════
    // BuildAvcc (ClipExporter internal static)
    // ═══════════════════════════════════════════════════════════════════

    [Fact]
    public void BuildAvcc_ValidSpsPps_ProducesCorrectStructure()
    {
        byte[] sps = [0x67, 0x42, 0x00, 0x1E, 0xAC, 0x52, 0x80, 0x7B, 0x02, 0x20, 0x20, 0x20, 0x80];
        byte[] pps = [0x68, 0xEE, 0x3C, 0x80];

        var avcc = DiNho.Capture.Poc.Export.ClipExporter.BuildAvcc(sps, pps);

        Assert.NotNull(avcc);
        Assert.Equal(1, avcc![0]);
        Assert.Equal(sps[1], avcc[1]);
        Assert.Equal(sps[2], avcc[2]);
        Assert.Equal(sps[3], avcc[3]);
        Assert.Equal(0xFF, avcc[4]);
        Assert.Equal(0xE1, avcc[5]);
    }

    [Fact]
    public void BuildAvcc_TooShortSps_ReturnsNull()
    {
        byte[] sps = [0x67, 0x42];
        byte[] pps = [0x68, 0xEE, 0x3C, 0x80];
        var avcc = DiNho.Capture.Poc.Export.ClipExporter.BuildAvcc(sps, pps);
        Assert.Null(avcc);
    }

    [Fact]
    public void BuildAvcc_EmptyPps_ReturnsNull()
    {
        byte[] sps = [0x67, 0x42, 0x00, 0x1E];
        byte[] pps = [];
        var avcc = DiNho.Capture.Poc.Export.ClipExporter.BuildAvcc(sps, pps);
        Assert.Null(avcc);
    }

    [Fact]
    public void BuildAvcc_TotalLengthMatchesStructure()
    {
        byte[] sps = [0x67, 0x42, 0x00, 0x1E, 0xAC, 0x52];
        byte[] pps = [0x68, 0xEE];

        var avcc = DiNho.Capture.Poc.Export.ClipExporter.BuildAvcc(sps, pps);

        Assert.NotNull(avcc);
        // RemoveEmulationPrevention doesn't remove anything here (no 00 00 03 pattern)
        int expected = 5 + 1 + 2 + sps.Length + 1 + 2 + pps.Length;
        Assert.Equal(expected, avcc!.Length);
    }

    [Fact]
    public void BuildAvcc_WithEmulationPrevention_Preserved()
    {
        // Bug 3 fix: emulation prevention bytes preserved per ISO 14496-15.
        byte[] sps = [0x67, 0x42, 0x00, 0x00, 0x03, 0x01, 0x80];
        byte[] pps = [0x68, 0xEE];

        var avcc = DiNho.Capture.Poc.Export.ClipExporter.BuildAvcc(sps, pps);

        Assert.NotNull(avcc);
        // SPS preserved as-is (7 bytes), not cleaned to 6
        int expected = 5 + 1 + 2 + 7 + 1 + 2 + pps.Length;
        Assert.Equal(expected, avcc!.Length);
    }

    [Fact]
    public void BuildAvcc_SpsBytes_PreservedCorrectly()
    {
        byte[] sps = [0x67, 0xAB, 0xCD, 0xEF];
        byte[] pps = [0x68, 0x01];

        var avcc = DiNho.Capture.Poc.Export.ClipExporter.BuildAvcc(sps, pps);

        Assert.NotNull(avcc);
        int spsLenInAvcc = (avcc![6] << 8) | avcc[7];
        Assert.Equal(sps.Length, spsLenInAvcc);
        for (int i = 0; i < sps.Length; i++)
            Assert.Equal(sps[i], avcc[8 + i]);
    }

    [Fact]
    public void BuildAvcc_PpsBytes_PreservedCorrectly()
    {
        byte[] sps = [0x67, 0x42, 0x00, 0x1E];
        byte[] pps = [0x68, 0xAB, 0xCD];

        var avcc = DiNho.Capture.Poc.Export.ClipExporter.BuildAvcc(sps, pps);

        Assert.NotNull(avcc);
        int spsLen = sps.Length;
        int off = 8 + spsLen;
        Assert.Equal(1, avcc[off]); // numPPS = 1
        int ppsLenInAvcc = (avcc[off + 1] << 8) | avcc[off + 2];
        Assert.Equal(pps.Length, ppsLenInAvcc);
        for (int i = 0; i < pps.Length; i++)
            Assert.Equal(pps[i], avcc[off + 3 + i]);
    }

    // ═══════════════════════════════════════════════════════════════════
    // RemoveEmulationPrevention (ClipExporter internal static)
    // ═══════════════════════════════════════════════════════════════════

    [Fact]
    public void RemoveEmulationPrevention_NoEmulation_ReturnsSameArray()
    {
        byte[] nal = [0x67, 0x42, 0x00, 0x1E, 0xAC];
        var result = DiNho.Capture.Poc.Export.ClipExporter.RemoveEmulationPrevention(nal);
        Assert.Same(nal, result);
    }

    [Fact]
    public void RemoveEmulationPrevention_WithEmulation_Removes03Byte()
    {
        // 00 00 03 01 → 00 00 01 (one byte removed)
        byte[] nal = [0x67, 0x42, 0x00, 0x00, 0x03, 0x01, 0x80];
        var result = DiNho.Capture.Poc.Export.ClipExporter.RemoveEmulationPrevention(nal);

        Assert.Equal(6, result.Length);
        Assert.Equal(0x00, result[2]);
        Assert.Equal(0x00, result[3]);
        Assert.Equal(0x01, result[4]);
        Assert.Equal(0x80, result[5]);
    }

    [Fact]
    public void RemoveEmulationPrevention_MultipleEmulation_AllRemoved()
    {
        byte[] nal = [0x67, 0x00, 0x00, 0x03, 0x00, 0x00, 0x03, 0x01];
        var result = DiNho.Capture.Poc.Export.ClipExporter.RemoveEmulationPrevention(nal);
        Assert.Equal(6, result.Length);
    }

    [Fact]
    public void RemoveEmulationPrevention_EmptyArray_ReturnsSame()
    {
        byte[] nal = [];
        var result = DiNho.Capture.Poc.Export.ClipExporter.RemoveEmulationPrevention(nal);
        Assert.Same(nal, result);
    }

    [Fact]
    public void RemoveEmulationPrevention_03AtStart_NotRemoved()
    {
        byte[] nal = [0x03, 0x67, 0x42, 0x00, 0x1E];
        var result = DiNho.Capture.Poc.Export.ClipExporter.RemoveEmulationPrevention(nal);
        Assert.Same(nal, result);
    }

    [Fact]
    public void RemoveEmulationPrevention_03WithoutPreceding0000_NotRemoved()
    {
        // 0x03 preceded by 00 FF, not 00 00
        byte[] nal = [0x67, 0x00, 0xFF, 0x03, 0x01];
        var result = DiNho.Capture.Poc.Export.ClipExporter.RemoveEmulationPrevention(nal);
        Assert.Same(nal, result);
    }

    // ═══════════════════════════════════════════════════════════════════
    // ProcessIvfFrames (AV1)
    // ═══════════════════════════════════════════════════════════════════

    private static EncodedPacket? InvokeProcessIvfFrames(FfmpegEncoder encoder, byte[] frameBlock)
    {
        SetEncoderField(encoder, "_ivfHeaderParsed", true);
        SetEncoderField(encoder, "_ivfTimebaseDen", 1000u);
        SetEncoderField(encoder, "_ivfTimebaseNum", 1u);
        SetEncoderField(encoder, "_rawBuf", frameBlock);
        SetEncoderField(encoder, "_rawLen", frameBlock.Length);
        SetEncoderField(encoder, "_outputFrameIndex", 0);
        SetEncoderField(encoder, "_codec", "av1_nvenc");

        var method = typeof(FfmpegEncoder).GetMethod("ProcessIvfFrames",
            BindingFlags.NonPublic | BindingFlags.Instance);
        Assert.NotNull(method);
        method!.Invoke(encoder, null);

        var channel = (System.Threading.Channels.ChannelReader<EncodedPacket>)GetEncoderField(encoder, "_outputChannel").GetType()
            .GetProperty("Reader")!.GetValue(GetEncoderField(encoder, "_outputChannel"))!;
        return channel.TryRead(out var pkt) ? pkt : null;
    }

    private static byte[] BuildIvfFrameBlock(long ptsIvf, byte[] payload)
    {
        var block = new byte[12 + payload.Length];
        BitConverter.GetBytes(payload.Length).CopyTo(block, 0);
        BitConverter.GetBytes(ptsIvf).CopyTo(block, 4);
        System.Buffer.BlockCopy(payload, 0, block, 12, payload.Length);
        return block;
    }

    [Fact]
    public void ProcessIvfFrames_PrefersRealCapturePts_OverContainerPts()
    {
        var enc = CreateEncoderForTest();
        SetEncoderField(enc, "_codec", "av1_nvenc");
        var realPts = TimeSpan.FromMilliseconds(5500);
        ((System.Collections.Concurrent.ConcurrentQueue<TimeSpan>)GetEncoderField(enc, "_inputPtsQueue")).Enqueue(realPts);

        // Container diz 250ms (frame-index sintético), mas o PTS real de captura é 5500ms.
        var packet = InvokeProcessIvfFrames(enc, BuildIvfFrameBlock(ptsIvf: 250, payload: [0x12, 0x00, 0x00]))!;

        Assert.NotNull(packet);
        Assert.Equal(5500, packet.Pts.TotalMilliseconds);
    }

    [Fact]
    public void ProcessIvfFrames_ExtrapolatesFromLastRealPts_WhenQueueEmpty()
    {
        var enc = CreateEncoderForTest();
        SetEncoderField(enc, "_codec", "av1_nvenc");
        SetEncoderField(enc, "_lastRealPtsTicks", TimeSpan.FromSeconds(5).Ticks);

        var packet = InvokeProcessIvfFrames(enc, BuildIvfFrameBlock(ptsIvf: 250, payload: [0x12, 0x00, 0x00]))!;

        Assert.NotNull(packet);
        // Extrapola do último PTS real: 5000ms + dur (timebase 1/1000 = 1ms).
        Assert.Equal(5001, packet.Pts.TotalMilliseconds);
    }

    [Fact]
    public void ProcessIvfFrames_RealPtsAreConsumedInOrder_AcrossFrames()
    {
        var enc = CreateEncoderForTest();
        SetEncoderField(enc, "_codec", "av1_nvenc");
        var queue = (System.Collections.Concurrent.ConcurrentQueue<TimeSpan>)GetEncoderField(enc, "_inputPtsQueue");
        queue.Enqueue(TimeSpan.FromSeconds(10.0));
        queue.Enqueue(TimeSpan.FromSeconds(10.0).Add(TimeSpan.FromMilliseconds(16.6)));

        // Dois frames no mesmo bloco raw (layout IVF: só o payload varia).
        var p1 = new byte[] { 0x12, 0x00, 0x00 };
        var p2 = new byte[] { 0x13, 0x00, 0x00 };
        var block = new byte[2 * (12 + p1.Length)];
        BitConverter.GetBytes(p1.Length).CopyTo(block, 0);
        System.Buffer.BlockCopy(p1, 0, block, 12, p1.Length);
        int off = 12 + p1.Length;
        BitConverter.GetBytes(p2.Length).CopyTo(block, off);
        System.Buffer.BlockCopy(p2, 0, block, off + 12, p2.Length);

        SetEncoderField(enc, "_ivfHeaderParsed", true);
        SetEncoderField(enc, "_ivfTimebaseDen", 1000u);
        SetEncoderField(enc, "_ivfTimebaseNum", 1u);
        SetEncoderField(enc, "_rawBuf", block);
        SetEncoderField(enc, "_rawLen", block.Length);
        SetEncoderField(enc, "_outputFrameIndex", 0);

        typeof(FfmpegEncoder).GetMethod("ProcessIvfFrames",
            BindingFlags.NonPublic | BindingFlags.Instance)!.Invoke(enc, null);

        var reader = (System.Threading.Channels.ChannelReader<EncodedPacket>)GetEncoderField(enc, "_outputChannel").GetType()
            .GetProperty("Reader")!.GetValue(GetEncoderField(enc, "_outputChannel"))!;
        Assert.True(reader.TryRead(out var first));
        Assert.True(reader.TryRead(out var second));
        Assert.Equal(10_000, first.Pts.TotalMilliseconds);
        Assert.Equal(10_016.6, second.Pts.TotalMilliseconds, 1);
    }

    [Fact]
    public void ProcessIvfFrames_CorrectsNonMonotonicRealPts()
    {
        var enc = CreateEncoderForTest();
        SetEncoderField(enc, "_codec", "av1_nvenc");
        SetEncoderField(enc, "_lastRealPtsTicks", TimeSpan.FromSeconds(9).Ticks);
        var realPts = TimeSpan.FromMilliseconds(4000);
        ((System.Collections.Concurrent.ConcurrentQueue<TimeSpan>)GetEncoderField(enc, "_inputPtsQueue")).Enqueue(realPts);

        var packet = InvokeProcessIvfFrames(enc, BuildIvfFrameBlock(ptsIvf: 250, payload: [0x12, 0x00, 0x00]))!;

        Assert.NotNull(packet);
        // PTS real (4000ms) é menor que o último emitido (9000ms) → corrige para prevPts+1 tick.
        Assert.Equal(TimeSpan.FromSeconds(9).Ticks + 1, packet.Pts.Ticks);
    }

    // ═══════════════════════════════════════════════════════════════════
    // Cross-method: AnnexB → AVCC roundtrip validation
    // ═══════════════════════════════════════════════════════════════════

    [Fact]
    public void AnnexB_Roundtrip_ProducesValidAVCC()
    {
        byte[] spsData = [0x67, 0x64, 0x00, 0x1E, 0xAC, 0x52, 0x80, 0x7B, 0x02, 0x20, 0x20, 0x20, 0x80];
        byte[] ppsData = [0x68, 0xEE, 0x3C, 0x80];
        byte[] idrData = [0x65, 0x88, 0x84, 0x00, 0x00, 0x7D, 0x40];

        byte[] buf = new byte[256];
        int pos = 0;
        buf[pos++] = 0x00; buf[pos++] = 0x00; buf[pos++] = 0x01;
        System.Buffer.BlockCopy(spsData, 0, buf, pos, spsData.Length); pos += spsData.Length;
        buf[pos++] = 0x00; buf[pos++] = 0x00; buf[pos++] = 0x01;
        System.Buffer.BlockCopy(ppsData, 0, buf, pos, ppsData.Length); pos += ppsData.Length;
        buf[pos++] = 0x00; buf[pos++] = 0x00; buf[pos++] = 0x01;
        System.Buffer.BlockCopy(idrData, 0, buf, pos, idrData.Length); pos += idrData.Length;
        buf[pos++] = 0x00; buf[pos++] = 0x00; buf[pos++] = 0x01; buf[pos++] = 0x09;

        int avccLen = FfmpegEncoder.ConvertAnnexBToAvcc(buf, pos, out _);

        int off = 0;
        int spsLen = (buf[off] << 24) | (buf[off + 1] << 16) | (buf[off + 2] << 8) | buf[off + 3];
        off += 4;
        Assert.Equal(spsData.Length, spsLen);
        Assert.Equal(spsData[0], buf[off]);

        off += spsLen;
        int ppsLen = (buf[off] << 24) | (buf[off + 1] << 16) | (buf[off + 2] << 8) | buf[off + 3];
        off += 4;
        Assert.Equal(ppsData.Length, ppsLen);

        off += ppsLen;
        int idrLen = (buf[off] << 24) | (buf[off + 1] << 16) | (buf[off + 2] << 8) | (buf[off + 3] & 0xFF);
        off += 4;
        Assert.Equal(idrData.Length, idrLen);

        off += idrLen;
        Assert.Equal(off, avccLen);
    }

    // ═══════════════════════════════════════════════════════════════════
    // G3-2.2: IVF com frameSize inválido (negativo) — não pode crashar
    // ═══════════════════════════════════════════════════════════════════

    [Fact]
    public void ProcessIvfFrames_NegativeFrameSize_DoesNotCrash_AndResetsBuffer()
    {
        var enc = CreateEncoderForTest();
        SetEncoderField(enc, "_codec", "av1_nvenc");
        SetEncoderField(enc, "_ivfHeaderParsed", true);
        SetEncoderField(enc, "_ivfTimebaseDen", 1000u);
        SetEncoderField(enc, "_ivfTimebaseNum", 1u);
        SetEncoderField(enc, "_outputFrameIndex", 0);

        // Cabeçalho IVF válido, porém frameSize NEGATIVO (corrupção/lixo de captura).
        // Antes do fix: VideoPacketPool.Rent(−1) lança OverflowException.
        var block = new byte[16];
        BitConverter.GetBytes(-1).CopyTo(block, 0); // frameSize = -1
        BitConverter.GetBytes(0L).CopyTo(block, 4); // ptsIvf
        block[12] = 0xDE; block[13] = 0xAD; block[14] = 0x12;
        SetEncoderField(enc, "_rawBuf", block);
        SetEncoderField(enc, "_rawLen", block.Length);

        var method = typeof(FfmpegEncoder).GetMethod("ProcessIvfFrames",
            BindingFlags.NonPublic | BindingFlags.Instance);
        Assert.NotNull(method);

        // Não pode lançar (Rent(−1) lançaria). Buffer corrompido é resetado.
        method!.Invoke(enc, null);

        var reader = (System.Threading.Channels.ChannelReader<EncodedPacket>)GetEncoderField(enc, "_outputChannel").GetType()
            .GetProperty("Reader")!.GetValue(GetEncoderField(enc, "_outputChannel"))!;
        Assert.False(reader.TryRead(out _));

        // Buffer corrompido foi resetado (o parser deixa de confiar nos limites).
        Assert.Equal(0, (int)GetEncoderField(enc, "_rawLen"));
    }

    // ═══════════════════════════════════════════════════════════════════
    // G3-2.5: Duration do pacote reflete o gap real de PTS (feed < framerate)
    // ═══════════════════════════════════════════════════════════════════

    private static void SetPendingSlice(FfmpegEncoder enc)
    {
        // AVCC slice (nal type 5 = IDR) — satisfaz CheckPendingHasSlice.
        byte[] nal = [0x00, 0x00, 0x00, 0x03, 0x65, 0x01, 0x02];
        SetEncoderField(enc, "_pendingBuf", nal);
        SetEncoderField(enc, "_pendingLen", nal.Length);
        SetEncoderField(enc, "_hadSlice", true);
    }

    private static void InvokeEmitPacket(FfmpegEncoder enc)
    {
        var method = typeof(FfmpegEncoder).GetMethod("EmitPacket",
            BindingFlags.NonPublic | BindingFlags.Instance);
        Assert.NotNull(method);
        method!.Invoke(enc, null);
    }

    private static System.Threading.Channels.ChannelReader<EncodedPacket> GetOutputReader(FfmpegEncoder enc) =>
        (System.Threading.Channels.ChannelReader<EncodedPacket>)GetEncoderField(enc, "_outputChannel").GetType()
            .GetProperty("Reader")!.GetValue(GetEncoderField(enc, "_outputChannel"))!;

    [Fact]
    public void EmitPacket_PicksUpRealPtsGap_InDuration()
    {
        var enc = CreateEncoderForTest();
        SetEncoderField(enc, "_codec", "h264_nvenc");
        SetEncoderField(enc, "_lastRealPtsTicks", -1L);

        // Frame 1: PTS real 5000ms, sem PTS anterior → duration nominal (1/60fps).
        SetPendingSlice(enc);
        ((System.Collections.Concurrent.ConcurrentQueue<TimeSpan>)GetEncoderField(enc, "_inputPtsQueue"))
            .Enqueue(TimeSpan.FromMilliseconds(5000));
        InvokeEmitPacket(enc);

        // Frame 2: PTS real 5050ms → gap de 50ms (feed caiu para ~20fps).
        SetPendingSlice(enc);
        ((System.Collections.Concurrent.ConcurrentQueue<TimeSpan>)GetEncoderField(enc, "_inputPtsQueue"))
            .Enqueue(TimeSpan.FromMilliseconds(5050));
        InvokeEmitPacket(enc);

        Assert.True(GetOutputReader(enc).TryRead(out var first));
        Assert.True(GetOutputReader(enc).TryRead(out var second));

        Assert.Equal(16.666, first.Duration.TotalMilliseconds, 0.5);
        Assert.Equal(50, second.Duration.TotalMilliseconds, 0.5);
    }

    [Fact]
    public void ProcessIvfFrames_PicksUpRealPtsGap_InDuration()
    {
        var enc = CreateEncoderForTest();
        SetEncoderField(enc, "_codec", "av1_nvenc");
        SetEncoderField(enc, "_lastRealPtsTicks", TimeSpan.FromSeconds(5).Ticks);
        ((System.Collections.Concurrent.ConcurrentQueue<TimeSpan>)GetEncoderField(enc, "_inputPtsQueue"))
            .Enqueue(TimeSpan.FromMilliseconds(5066.6));

        var packet = InvokeProcessIvfFrames(enc, BuildIvfFrameBlock(ptsIvf: 250, payload: [0x12, 0x00, 0x00]))!;

        Assert.NotNull(packet);
        // Gap real: 5066.6ms − 5000ms = 66.6ms (não o timebase sintético de 1ms).
        Assert.Equal(66.6, packet.Duration.TotalMilliseconds, 0.5);
    }
}
