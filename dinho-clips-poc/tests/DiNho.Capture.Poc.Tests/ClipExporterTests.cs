using DiNho.Capture.Poc.Encoders;
using DiNho.Capture.Poc.Export;

namespace DiNho.Capture.Poc.Tests;

public sealed class ClipExporterTests
{
    private static EncodedPacket MakePacket(long ptsTicks, long durTicks, MediaType type = MediaType.Video)
    {
        return new EncodedPacket(
            Array.Empty<byte>(), type,
            TimeSpan.FromTicks(ptsTicks), TimeSpan.FromTicks(durTicks),
            false, false, 1920, 1080);
    }

    // ── GenerateSilentAacFrames ──

    [Fact]
    public void GenerateSilentAacFrames_ReturnsCorrectCount()
    {
        var frames = ClipExporter.GenerateSilentAacFrames(10, TimeSpan.Zero, 48000);
        Assert.Equal(10, frames.Count);
    }

    [Fact]
    public void GenerateSilentAacFrames_PtsProgressesCorrectly()
    {
        var frames = ClipExporter.GenerateSilentAacFrames(3, TimeSpan.FromSeconds(10), 48000);
        Assert.Equal(10.0, frames[0].Pts.TotalSeconds, 3);
        Assert.Equal(10.02133, frames[1].Pts.TotalSeconds, 3);
        Assert.Equal(10.04267, frames[2].Pts.TotalSeconds, 3);
    }

    [Fact]
    public void GenerateSilentAacFrames_ValidAdtsHeader()
    {
        var frames = ClipExporter.GenerateSilentAacFrames(1, TimeSpan.Zero, 48000);
        var data = frames[0].Data;
        Assert.True(data.Length >= 7);
        Assert.Equal(0xFF, data[0]);
        Assert.Equal(0xF1, data[1]);
    }

    [Fact]
    public void GenerateSilentAacFrames_EachFrameHasCorrectDuration()
    {
        var frames = ClipExporter.GenerateSilentAacFrames(5, TimeSpan.Zero, 48000);
        foreach (var f in frames)
            Assert.Equal(1024.0 / 48000, f.Duration.TotalSeconds, 5);
    }

    [Fact]
    public void GenerateSilentAacFrames_ZeroCount_ReturnsEmpty()
    {
        var frames = ClipExporter.GenerateSilentAacFrames(0, TimeSpan.Zero, 48000);
        Assert.Empty(frames);
    }

    // ── IsAdts ──

    [Theory]
    [InlineData(new byte[] { 0xFF, 0xF0 }, true)]
    [InlineData(new byte[] { 0xFF, 0x01 }, false)]
    [InlineData(new byte[] { 0x00, 0x00 }, false)]
    [InlineData(new byte[0], false)]
    [InlineData(new byte[] { 0xFF, 0xF0, 0x00 }, true)]
    public void IsAdts_DetectsAacCorrectly(byte[] data, bool expected)
    {
        var pkt = new EncodedPacket(data, MediaType.Audio, TimeSpan.Zero, TimeSpan.Zero, false, false, 0, 0);
        Assert.Equal(expected, ClipExporter.IsAdts(pkt));
    }

    // ── GetVideoIntervals ──

    [Fact]
    public void GetVideoIntervals_Empty_ReturnsEmpty()
    {
        var result = ClipExporter.GetVideoIntervals(new List<EncodedPacket>(), TimeSpan.FromMilliseconds(50));
        Assert.Empty(result);
    }

    [Fact]
    public void GetVideoIntervals_SinglePacket_OneInterval()
    {
        var packets = new List<EncodedPacket> { MakePacket(0, 100_000) };
        var result = ClipExporter.GetVideoIntervals(packets, TimeSpan.FromMilliseconds(50));
        Assert.Single(result);
    }

    [Fact]
    public void GetVideoIntervals_Consecutive_Merged()
    {
        var packets = new List<EncodedPacket>
        {
            MakePacket(0, 100_000),
            MakePacket(100_000, 100_000)
        };
        var result = ClipExporter.GetVideoIntervals(packets, TimeSpan.FromMilliseconds(50));
        Assert.Single(result);
        Assert.Equal(TimeSpan.FromTicks(200_000), result[0].end - result[0].start);
    }

    [Fact]
    public void GetVideoIntervals_GapOverThreshold_Separate()
    {
        var packets = new List<EncodedPacket>
        {
            MakePacket(0, 100_000),
            MakePacket(1_000_000, 100_000)
        };
        var result = ClipExporter.GetVideoIntervals(packets, TimeSpan.FromMilliseconds(50));
        Assert.Equal(2, result.Count);
        Assert.Equal(TimeSpan.FromTicks(100_000), result[0].end - result[0].start);
        Assert.Equal(TimeSpan.FromTicks(100_000), result[1].end - result[1].start);
    }

    [Fact]
    public void GetVideoIntervals_GapBelowThreshold_Merged()
    {
        var packets = new List<EncodedPacket>
        {
            MakePacket(0, 100_000),
            MakePacket(100_100, 100_000)
        };
        var result = ClipExporter.GetVideoIntervals(packets, TimeSpan.FromMilliseconds(50));
        Assert.Single(result);
    }

    [Fact]
    public void GetVideoIntervals_MultipleGaps_CorrectIntervals()
    {
        var packets = new List<EncodedPacket>
        {
            MakePacket(0, 100_000),
            MakePacket(100_000, 100_000),
            MakePacket(2_000_000, 100_000),
            MakePacket(2_100_000, 100_000),
            MakePacket(5_000_000, 100_000)
        };
        var result = ClipExporter.GetVideoIntervals(packets, TimeSpan.FromMilliseconds(50));
        Assert.Equal(3, result.Count);
        Assert.Equal(TimeSpan.FromTicks(200_000), result[0].end - result[0].start);
        Assert.Equal(TimeSpan.FromTicks(200_000), result[1].end - result[1].start);
        Assert.Equal(TimeSpan.FromTicks(100_000), result[2].end - result[2].start);
    }

    [Fact]
    public void GetVideoIntervals_LastPacketDurationUsed()
    {
        var packets = new List<EncodedPacket>
        {
            MakePacket(0, 100_000),
            MakePacket(100_000, 200_000)
        };
        var result = ClipExporter.GetVideoIntervals(packets, TimeSpan.FromMilliseconds(50));
        Assert.Single(result);
        Assert.Equal(TimeSpan.FromTicks(300_000), result[0].end - result[0].start);
    }

    [Fact]
    public void GetVideoIntervals_GapSmallerThanThreshold_Merged()
    {
        var packets = new List<EncodedPacket>
        {
            MakePacket(0, 500_000),
            MakePacket(520_000, 500_000)
        };
        var result = ClipExporter.GetVideoIntervals(packets, TimeSpan.FromMilliseconds(50));
        Assert.Single(result);
    }

    // ── FilterAudioByIntervals ──

    [Fact]
    public void FilterAudioByIntervals_EmptyAudio_ReturnsEmpty()
    {
        var intervals = new List<(TimeSpan, TimeSpan)> { (TimeSpan.Zero, TimeSpan.FromSeconds(10)) };
        var result = ClipExporter.FilterAudioByIntervals(new List<EncodedPacket>(), intervals);
        Assert.Empty(result);
    }

    [Fact]
    public void FilterAudioByIntervals_EmptyIntervals_ReturnsOriginal()
    {
        var audio = new List<EncodedPacket>
        {
            new(Array.Empty<byte>(), MediaType.Audio, TimeSpan.FromSeconds(1), TimeSpan.FromMilliseconds(20), false)
        };
        var result = ClipExporter.FilterAudioByIntervals(audio, new List<(TimeSpan, TimeSpan)>());
        Assert.Single(result);
    }

    [Fact]
    public void FilterAudioByIntervals_AllWithinInterval_PassesAll()
    {
        var audio = new List<EncodedPacket>
        {
            new(Array.Empty<byte>(), MediaType.Audio, TimeSpan.FromSeconds(1), TimeSpan.FromMilliseconds(20), false),
            new(Array.Empty<byte>(), MediaType.Audio, TimeSpan.FromSeconds(2), TimeSpan.FromMilliseconds(20), false),
            new(Array.Empty<byte>(), MediaType.Audio, TimeSpan.FromSeconds(3), TimeSpan.FromMilliseconds(20), false)
        };
        var intervals = new List<(TimeSpan, TimeSpan)> { (TimeSpan.Zero, TimeSpan.FromSeconds(10)) };
        var result = ClipExporter.FilterAudioByIntervals(audio, intervals);
        Assert.Equal(3, result.Count);
    }

    [Fact]
    public void FilterAudioByIntervals_AudioBeforeInterval_Excludes()
    {
        var audio = new List<EncodedPacket>
        {
            new(Array.Empty<byte>(), MediaType.Audio, TimeSpan.FromSeconds(1), TimeSpan.FromMilliseconds(20), false)
        };
        var intervals = new List<(TimeSpan, TimeSpan)> { (TimeSpan.FromSeconds(5), TimeSpan.FromSeconds(10)) };
        var result = ClipExporter.FilterAudioByIntervals(audio, intervals);
        Assert.Empty(result);
    }

    [Fact]
    public void FilterAudioByIntervals_AudioSpanningGap_FilteredCorrectly()
    {
        var audio = new List<EncodedPacket>
        {
            new(Array.Empty<byte>(), MediaType.Audio, TimeSpan.FromSeconds(1), TimeSpan.FromMilliseconds(20), false),
            new(Array.Empty<byte>(), MediaType.Audio, TimeSpan.FromSeconds(3), TimeSpan.FromMilliseconds(20), false),
            new(Array.Empty<byte>(), MediaType.Audio, TimeSpan.FromSeconds(5), TimeSpan.FromMilliseconds(20), false),
            new(Array.Empty<byte>(), MediaType.Audio, TimeSpan.FromSeconds(7), TimeSpan.FromMilliseconds(20), false),
            new(Array.Empty<byte>(), MediaType.Audio, TimeSpan.FromSeconds(9), TimeSpan.FromMilliseconds(20), false)
        };
        var intervals = new List<(TimeSpan, TimeSpan)>
        {
            (TimeSpan.FromSeconds(0), TimeSpan.FromSeconds(4)),
            (TimeSpan.FromSeconds(6), TimeSpan.FromSeconds(10))
        };
        var result = ClipExporter.FilterAudioByIntervals(audio, intervals);
        Assert.Equal(4, result.Count);
        Assert.Equal(1.0, result[0].Pts.TotalSeconds, 3);
        Assert.Equal(3.0, result[1].Pts.TotalSeconds, 3);
        Assert.Equal(7.0, result[2].Pts.TotalSeconds, 3);
        Assert.Equal(9.0, result[3].Pts.TotalSeconds, 3);
    }

    [Fact]
    public void FilterAudioByIntervals_PacketExactlyAtBoundary_Included()
    {
        var audio = new List<EncodedPacket>
        {
            new(Array.Empty<byte>(), MediaType.Audio, TimeSpan.FromSeconds(5), TimeSpan.FromMilliseconds(20), false)
        };
        var intervals = new List<(TimeSpan, TimeSpan)> { (TimeSpan.FromSeconds(5), TimeSpan.FromSeconds(10)) };
        var result = ClipExporter.FilterAudioByIntervals(audio, intervals);
        Assert.Single(result);
    }

    // ── ComputeIntervalsDuration ──

    [Fact]
    public void ComputeIntervalsDuration_Empty_ReturnsZero()
    {
        Assert.Equal(0, ClipExporter.ComputeIntervalsDuration(new List<(TimeSpan, TimeSpan)>()));
    }

    [Fact]
    public void ComputeIntervalsDuration_SingleInterval_ReturnsDuration()
    {
        var intervals = new List<(TimeSpan, TimeSpan)> { (TimeSpan.Zero, TimeSpan.FromSeconds(10)) };
        Assert.Equal(10.0, ClipExporter.ComputeIntervalsDuration(intervals), 3);
    }

    [Fact]
    public void ComputeIntervalsDuration_MultipleIntervals_SumsCorrectly()
    {
        var intervals = new List<(TimeSpan, TimeSpan)>
        {
            (TimeSpan.Zero, TimeSpan.FromSeconds(5)),
            (TimeSpan.FromSeconds(10), TimeSpan.FromSeconds(15)),
            (TimeSpan.FromSeconds(20), TimeSpan.FromSeconds(30))
        };
        Assert.Equal(20.0, ClipExporter.ComputeIntervalsDuration(intervals), 3);
    }

    // ── TrimAudioEnd ──

    [Fact]
    public void TrimAudioEnd_Empty_ReturnsEmpty()
    {
        var result = ClipExporter.TrimAudioEnd(new List<EncodedPacket>(), TimeSpan.FromSeconds(10));
        Assert.Empty(result);
    }

    [Fact]
    public void TrimAudioEnd_AudioEndsBeforeVideo_NoTrim()
    {
        var audio = new List<EncodedPacket>
        {
            new(Array.Empty<byte>(), MediaType.Audio, TimeSpan.Zero, TimeSpan.FromSeconds(5), false)
        };
        var result = ClipExporter.TrimAudioEnd(audio, TimeSpan.FromSeconds(10));
        Assert.Single(result);
    }

    [Fact]
    public void TrimAudioEnd_AudioExtendsPastVideo_Trimmed()
    {
        var audio = new List<EncodedPacket>
        {
            new(Array.Empty<byte>(), MediaType.Audio, TimeSpan.Zero, TimeSpan.FromSeconds(5), false),
            new(Array.Empty<byte>(), MediaType.Audio, TimeSpan.FromSeconds(5), TimeSpan.FromSeconds(5), false),
            new(Array.Empty<byte>(), MediaType.Audio, TimeSpan.FromSeconds(10), TimeSpan.FromSeconds(5), false)
        };
        var result = ClipExporter.TrimAudioEnd(audio, TimeSpan.FromSeconds(12));
        Assert.Equal(2, result.Count);
    }

    [Fact]
    public void TrimAudioEnd_AudioExactlyAtVideoEnd_NoTrim()
    {
        var audio = new List<EncodedPacket>
        {
            new(Array.Empty<byte>(), MediaType.Audio, TimeSpan.Zero, TimeSpan.FromSeconds(10), false)
        };
        var result = ClipExporter.TrimAudioEnd(audio, TimeSpan.FromSeconds(10));
        Assert.Single(result);
    }

    [Fact]
    public void TrimAudioEnd_AllPastVideo_Empty()
    {
        var audio = new List<EncodedPacket>
        {
            new(Array.Empty<byte>(), MediaType.Audio, TimeSpan.FromSeconds(15), TimeSpan.FromSeconds(5), false)
        };
        var result = ClipExporter.TrimAudioEnd(audio, TimeSpan.FromSeconds(10));
        Assert.Empty(result);
    }

    // ── FindTrailingFrozenFrames ──

    [Fact]
    public void FindTrailingFrozenFrames_NoGap_ReturnsAll()
    {
        var dur = TimeSpan.FromMilliseconds(16);
        var packets = new List<EncodedPacket>();
        for (int i = 0; i < 10; i++)
            packets.Add(new(Array.Empty<byte>(), MediaType.Video, TimeSpan.FromMilliseconds(i * 16), dur, false));

        var result = ClipExporter.FindTrailingFrozenFrames(packets, TimeSpan.FromSeconds(1), 60);
        Assert.Equal(10, result);
    }

    [Fact]
    public void FindTrailingFrozenFrames_GapBelowThreshold_ReturnsAll()
    {
        var dur = TimeSpan.FromMilliseconds(16);
        var packets = new List<EncodedPacket>
        {
            new(Array.Empty<byte>(), MediaType.Video, TimeSpan.Zero, dur, false),
            new(Array.Empty<byte>(), MediaType.Video, TimeSpan.FromMilliseconds(16), dur, false),
            // 40ms gap (below 50ms threshold) — not a freeze
            new(Array.Empty<byte>(), MediaType.Video, TimeSpan.FromMilliseconds(56), dur, false)
        };

        var result = ClipExporter.FindTrailingFrozenFrames(packets, TimeSpan.FromSeconds(1), 60);
        Assert.Equal(3, result);
    }

    [Fact]
    public void FindTrailingFrozenFrames_GapAboveFreezeThreshold_Truncates()
    {
        var dur = TimeSpan.FromMilliseconds(16);
        var packets = new List<EncodedPacket>();
        // 10 normal frames (160ms)
        for (int i = 0; i < 10; i++)
            packets.Add(new(Array.Empty<byte>(), MediaType.Video, TimeSpan.FromMilliseconds(i * 16), dur, false));
        // 2s gap (alt-tab)
        // 3 frozen frames after gap
        for (int i = 0; i < 3; i++)
            packets.Add(new(Array.Empty<byte>(), MediaType.Video, TimeSpan.FromMilliseconds(2000 + i * 16), dur, false));

        var result = ClipExporter.FindTrailingFrozenFrames(packets, TimeSpan.FromSeconds(1), 60);
        Assert.Equal(10, result); // only keep the 10 frames before the gap
    }

    [Fact]
    public void FindTrailingFrozenFrames_GapBelowFreezeThreshold_ReturnsAll()
    {
        var dur = TimeSpan.FromMilliseconds(16);
        var packets = new List<EncodedPacket>();
        for (int i = 0; i < 10; i++)
            packets.Add(new(Array.Empty<byte>(), MediaType.Video, TimeSpan.FromMilliseconds(i * 16), dur, false));
        // 500ms gap (below 1s freeze threshold)
        for (int i = 0; i < 3; i++)
            packets.Add(new(Array.Empty<byte>(), MediaType.Video, TimeSpan.FromMilliseconds(500 + i * 16), dur, false));

        var result = ClipExporter.FindTrailingFrozenFrames(packets, TimeSpan.FromSeconds(1), 60);
        Assert.Equal(13, result); // keep all — gap < minFreezeDuration
    }

    [Fact]
    public void FindTrailingFrozenFrames_SinglePacket_ReturnsAll()
    {
        var packets = new List<EncodedPacket>
        {
            new(Array.Empty<byte>(), MediaType.Video, TimeSpan.Zero, TimeSpan.FromMilliseconds(16), false)
        };

        var result = ClipExporter.FindTrailingFrozenFrames(packets, TimeSpan.FromSeconds(1), 60);
        Assert.Equal(1, result);
    }

    // ── PadAudioWithSilence ──

    [Fact]
    public void PadAudioWithSilence_Empty_ReturnsEmpty()
    {
        var result = ClipExporter.PadAudioWithSilence(new List<EncodedPacket>(), 48000);
        Assert.Empty(result);
    }

    [Fact]
    public void PadAudioWithSilence_SinglePacket_NoChange()
    {
        var audio = new List<EncodedPacket>
        {
            new(Array.Empty<byte>(), MediaType.Audio, TimeSpan.Zero, TimeSpan.FromSeconds(5), false)
        };
        var result = ClipExporter.PadAudioWithSilence(audio, 48000);
        Assert.Single(result);
    }

    [Fact]
    public void PadAudioWithSilence_ConsecutivePackets_NoPadding()
    {
        var dur = TimeSpan.FromMilliseconds(21);
        var audio = new List<EncodedPacket>
        {
            new(Array.Empty<byte>(), MediaType.Audio, TimeSpan.Zero, dur, false),
            new(Array.Empty<byte>(), MediaType.Audio, TimeSpan.FromTicks(dur.Ticks), dur, false)
        };
        var result = ClipExporter.PadAudioWithSilence(audio, 48000);
        Assert.Equal(2, result.Count);
    }

    [Fact]
    public void PadAudioWithSilence_GapBetweenPackets_InsertsSilence()
    {
        var dur = TimeSpan.FromMilliseconds(21);
        var audio = new List<EncodedPacket>
        {
            new(Array.Empty<byte>(), MediaType.Audio, TimeSpan.Zero, dur, false),
            // 3-second gap
            new(Array.Empty<byte>(), MediaType.Audio, TimeSpan.FromSeconds(3), dur, false)
        };
        var result = ClipExporter.PadAudioWithSilence(audio, 48000);
        // original 2 + silence frames for 3s gap
        Assert.True(result.Count > 2);
    }

    [Fact]
    public void PadAudioWithSilence_GapBelowThreshold_NoPadding()
    {
        var dur = TimeSpan.FromMilliseconds(21);
        var gap = TimeSpan.FromMilliseconds(10); // below 30ms threshold
        var audio = new List<EncodedPacket>
        {
            new(Array.Empty<byte>(), MediaType.Audio, TimeSpan.Zero, dur, false),
            new(Array.Empty<byte>(), MediaType.Audio, TimeSpan.FromTicks(dur.Ticks + gap.Ticks), dur, false)
        };
        var result = ClipExporter.PadAudioWithSilence(audio, 48000);
        Assert.Equal(2, result.Count);
    }

    [Fact]
    public void PadAudioWithSilence_ExpectedStart_InsertsSilenceBeforeFirstPacket()
    {
        var dur = TimeSpan.FromMilliseconds(21);
        // First packet at 667ms (simulating WASAPI init delay)
        var audio = new List<EncodedPacket>
        {
            new(Array.Empty<byte>(), MediaType.Audio, TimeSpan.FromMilliseconds(667), dur, false)
        };
        var result = ClipExporter.PadAudioWithSilence(audio, 48000, 2, TimeSpan.Zero);
        // Should have original 1 + silence frames for 667ms gap
        Assert.True(result.Count > 1, $"Expected >1 frame, got {result.Count}");
        // First frame should have PTS = 0
        Assert.Equal(TimeSpan.Zero, result[0].Pts);
        // Last frame should be the original (PTS = 667ms)
        Assert.Equal(TimeSpan.FromMilliseconds(667), result[^1].Pts);
    }

    [Fact]
    public void PadAudioWithSilence_ExpectedStartMatchesAudio_NoExtraSilence()
    {
        var dur = TimeSpan.FromMilliseconds(21);
        var audio = new List<EncodedPacket>
        {
            new(Array.Empty<byte>(), MediaType.Audio, TimeSpan.Zero, dur, false)
        };
        var result = ClipExporter.PadAudioWithSilence(audio, 48000, 2, TimeSpan.Zero);
        Assert.Single(result);
    }

    [Fact]
    public void PadAudioWithSilence_ExpectedStartNull_NoExtraSilence()
    {
        var dur = TimeSpan.FromMilliseconds(21);
        var audio = new List<EncodedPacket>
        {
            new(Array.Empty<byte>(), MediaType.Audio, TimeSpan.FromMilliseconds(500), dur, false)
        };
        // null expectedStart means start from first audio packet — 500ms gap not filled
        var result = ClipExporter.PadAudioWithSilence(audio, 48000, 2, null);
        Assert.Single(result);
        Assert.Equal(TimeSpan.FromMilliseconds(500), result[0].Pts);
    }

    // ── ReTimestampToContiguous ──

    [Fact]
    public void ReTimestampToContiguous_NoGap_SingleInterval_PreservesPTS()
    {
        var video = new List<EncodedPacket>
        {
            MakePacket(0, 10_000_000),
            MakePacket(10_000_000, 10_000_000),
            MakePacket(20_000_000, 10_000_000)
        };
        var audio = new List<EncodedPacket>
        {
            new(Array.Empty<byte>(), MediaType.Audio, TimeSpan.FromMilliseconds(50), TimeSpan.FromMilliseconds(21), false)
        };
        var intervals = new List<(TimeSpan, TimeSpan)>
        {
            (TimeSpan.Zero, TimeSpan.FromSeconds(3))
        };
        ClipExporter.ReTimestampToContiguous(video, audio, intervals);
        Assert.Equal(0.0, video[0].Pts.TotalSeconds, 3);
        Assert.Equal(1.0, video[1].Pts.TotalSeconds, 3);
        Assert.Equal(2.0, video[2].Pts.TotalSeconds, 3);
        Assert.Equal(0.05, audio[0].Pts.TotalSeconds, 3);
    }

    [Fact]
    public void ReTimestampToContiguous_OneGap_ClosesGap()
    {
        // 5s active, 5s gap, 5s active → total 10s
        var video = new List<EncodedPacket>
        {
            MakePacket(0, 1_666_666),                              // 0.000s
            MakePacket(48_333_334, 1_666_666),                     // 4.833s
            MakePacket(100_000_000, 1_666_666),                    // 10.000s
            MakePacket(148_333_334, 1_666_666)                     // 14.833s
        };
        var audio = new List<EncodedPacket>
        {
            new(Array.Empty<byte>(), MediaType.Audio, TimeSpan.FromSeconds(1), TimeSpan.FromMilliseconds(21), false),
            new(Array.Empty<byte>(), MediaType.Audio, TimeSpan.FromSeconds(11), TimeSpan.FromMilliseconds(21), false)
        };
        var intervals = new List<(TimeSpan, TimeSpan)>
        {
            (TimeSpan.Zero, TimeSpan.FromSeconds(5)),       // dur=5s, output=0s
            (TimeSpan.FromSeconds(10), TimeSpan.FromSeconds(15))  // dur=5s, output=5s
        };
        ClipExporter.ReTimestampToContiguous(video, audio, intervals);

        // Interval 1 (offset=0): 0→0, 4.833→4.833
        Assert.Equal(0.0, video[0].Pts.TotalSeconds, 3);
        Assert.Equal(4.833, video[1].Pts.TotalSeconds, 3);

        // Interval 2 (offset=-5s): 10→5, 14.833→9.833
        Assert.Equal(5.0, video[2].Pts.TotalSeconds, 3);
        Assert.Equal(9.833, video[3].Pts.TotalSeconds, 3);

        // Audio: 1s→1s (interval 1), 11s→6s (interval 2)
        Assert.Equal(1.0, audio[0].Pts.TotalSeconds, 3);
        Assert.Equal(9.962, audio[1].Pts.TotalSeconds, 3);
    }

    [Fact]
    public void ReTimestampToContiguous_RateScalesAudioToVideoSpan()
    {
        var video = new List<EncodedPacket>
        {
            MakePacket(0, 1_666_666),
            MakePacket(48_333_334, 1_666_666),
            MakePacket(100_000_000, 1_666_666),
            MakePacket(148_333_334, 1_666_666),
        };
        var audio = new List<EncodedPacket>
        {
            new(Array.Empty<byte>(), MediaType.Audio, TimeSpan.FromSeconds(1), TimeSpan.FromMilliseconds(21), false),
            new(Array.Empty<byte>(), MediaType.Audio, TimeSpan.FromSeconds(11), TimeSpan.FromMilliseconds(21), false),
        };
        var intervals = new List<(TimeSpan, TimeSpan)>
        {
            // dur=5s, output=0s
            (TimeSpan.Zero, TimeSpan.FromSeconds(5)),
            // dur=5s, output=5s
            (TimeSpan.FromSeconds(10), TimeSpan.FromSeconds(15)),
        };

        ClipExporter.ReTimestampToContiguous(video, audio, intervals);

        // Audio starts after a 1s silence gap; its span must be rate-scaled to match the video span.
        Assert.Equal(0.0, video[0].Pts.TotalSeconds, 3);
        Assert.Equal((video[^1].Pts + video[^1].Duration).TotalSeconds, (audio[^1].Pts + audio[^1].Duration).TotalSeconds, 3);
    }

    [Fact]
    public void ReTimestampToContiguous_TwoGaps_ClosesBoth()
    {
        var video = new List<EncodedPacket>
        {
            MakePacket(0, 1_666_666),
            MakePacket(48_333_334, 1_666_666),
            MakePacket(100_000_000, 1_666_666),
            MakePacket(148_333_334, 1_666_666),
            MakePacket(200_000_000, 1_666_666)
        };
        var audio = new List<EncodedPacket>
        {
            new(Array.Empty<byte>(), MediaType.Audio, TimeSpan.FromSeconds(1), TimeSpan.FromMilliseconds(21), false),
            new(Array.Empty<byte>(), MediaType.Audio, TimeSpan.FromSeconds(11), TimeSpan.FromMilliseconds(21), false),
            new(Array.Empty<byte>(), MediaType.Audio, TimeSpan.FromSeconds(21), TimeSpan.FromMilliseconds(21), false)
        };
        var intervals = new List<(TimeSpan, TimeSpan)>
        {
            (TimeSpan.Zero, TimeSpan.FromSeconds(5)),         // 5s → output 0s
            (TimeSpan.FromSeconds(10), TimeSpan.FromSeconds(15)), // 5s → output 5s
            (TimeSpan.FromSeconds(20), TimeSpan.FromSeconds(25))  // 5s → output 10s
        };
        ClipExporter.ReTimestampToContiguous(video, audio, intervals);

        Assert.Equal(0.0, video[0].Pts.TotalSeconds, 3);
        Assert.Equal(4.833, video[1].Pts.TotalSeconds, 3);
        Assert.Equal(5.0, video[2].Pts.TotalSeconds, 3);
        Assert.Equal(9.833, video[3].Pts.TotalSeconds, 3);
        Assert.Equal(10.0, video[4].Pts.TotalSeconds, 3);

Assert.Equal(1.0, audio[0].Pts.TotalSeconds, 3);
		Assert.Equal(5.574, audio[1].Pts.TotalSeconds, 3);
		Assert.Equal(10.147, audio[2].Pts.TotalSeconds, 3);
    }

    [Fact]
    public void ReTimestampToContiguous_EmptyIntervals_NoChange()
    {
        var video = new List<EncodedPacket> { MakePacket(0, 100_000) };
        var audio = new List<EncodedPacket>
        {
            new(Array.Empty<byte>(), MediaType.Audio, TimeSpan.FromSeconds(1), TimeSpan.FromMilliseconds(21), false)
        };
        ClipExporter.ReTimestampToContiguous(video, audio, new List<(TimeSpan, TimeSpan)>());
        Assert.Equal(0.0, video[0].Pts.TotalSeconds, 3);
        Assert.Equal(1.0, audio[0].Pts.TotalSeconds, 3);
    }

    [Fact]
    public void ReTimestampToContiguous_EmptyVideo_NoChange()
    {
        var video = new List<EncodedPacket>();
        var audio = new List<EncodedPacket>
        {
            new(Array.Empty<byte>(), MediaType.Audio, TimeSpan.FromSeconds(1), TimeSpan.FromMilliseconds(21), false)
        };
        var intervals = new List<(TimeSpan, TimeSpan)> { (TimeSpan.Zero, TimeSpan.FromSeconds(5)) };
        ClipExporter.ReTimestampToContiguous(video, audio, intervals);
        Assert.Equal(1.0, audio[0].Pts.TotalSeconds, 3);
    }

    [Fact]
    public void ReTimestampToContiguous_AudioBeforeFirstInterval_ClampedToZero()
    {
        var video = new List<EncodedPacket> { MakePacket(5_000_000, 100_000) };
        var audio = new List<EncodedPacket>
        {
            new(Array.Empty<byte>(), MediaType.Audio, TimeSpan.FromSeconds(1), TimeSpan.FromMilliseconds(21), false)
        };
        var intervals = new List<(TimeSpan, TimeSpan)> { (TimeSpan.FromSeconds(5), TimeSpan.FromSeconds(10)) };
        ClipExporter.ReTimestampToContiguous(video, audio, intervals);
        Assert.Equal(0.0, video[0].Pts.TotalSeconds, 3);
        Assert.Equal(0.0, audio[0].Pts.TotalSeconds, 3);
    }

    [Fact]
    public void ReTimestampToContiguous_AudioAfterLastInterval_Shifted()
    {
        var video = new List<EncodedPacket> { MakePacket(0, 100_000) };
        var audio = new List<EncodedPacket>
        {
            new(Array.Empty<byte>(), MediaType.Audio, TimeSpan.FromSeconds(6), TimeSpan.FromMilliseconds(21), false)
        };
        var intervals = new List<(TimeSpan, TimeSpan)> { (TimeSpan.Zero, TimeSpan.FromSeconds(5)) };
        ClipExporter.ReTimestampToContiguous(video, audio, intervals);
        Assert.Equal(0.0, video[0].Pts.TotalSeconds, 3);
        Assert.Equal(6.0, audio[0].Pts.TotalSeconds, 3);
    }

    [Fact]
    public void ReTimestampToContiguous_DurationPreserved()
    {
        var video = new List<EncodedPacket>
        {
            MakePacket(0, 1_666_666),
            MakePacket(48_333_334, 1_666_666),
            MakePacket(100_000_000, 1_666_666),
            MakePacket(148_333_334, 1_666_666)
        };
        var audio = new List<EncodedPacket>();
        var intervals = new List<(TimeSpan, TimeSpan)>
        {
            (TimeSpan.Zero, TimeSpan.FromSeconds(5)),
            (TimeSpan.FromSeconds(10), TimeSpan.FromSeconds(15))
        };
        ClipExporter.ReTimestampToContiguous(video, audio, intervals);
        // Total active duration = 10s (2 × 5s intervals), last PTS + dur = 10s
        var lastPts = video[^1].Pts + video[^1].Duration;
        Assert.Equal(10.0, lastPts.TotalSeconds, 1);
    }

    // ── TrimNonAdtsPrefix (Opção B: descarta prefixo não-ADTS) ──

    private static EncodedPacket MakeAdtsAudio(int i)
    {
        // ADTS syncword 0xFFF + valid header (IsAdts true)
        var data = new byte[7] { 0xFF, 0xF1, 0x50, 0x80, 0x00, 0x1F, 0xFC };
        return new EncodedPacket(data, MediaType.Audio,
            TimeSpan.FromSeconds(i), TimeSpan.FromMilliseconds(21), false);
    }

    [Fact]
    public void TrimNonAdtsPrefix_Empty_ReturnsEmpty()
    {
        var result = ClipExporter.TrimNonAdtsPrefix(new List<EncodedPacket>());
        Assert.NotNull(result);
        Assert.Empty(result);
    }

    [Fact]
    public void TrimNonAdtsPrefix_AllAdts_ReturnsSameCount()
    {
        var audio = new List<EncodedPacket>
        {
            MakeAdtsAudio(1),
            MakeAdtsAudio(2),
            MakeAdtsAudio(3)
        };
        var result = ClipExporter.TrimNonAdtsPrefix(audio);
        Assert.Equal(3, result.Count);
        Assert.Equal(1.0, result[0].Pts.TotalSeconds, 3);
    }

    [Fact]
    public void TrimNonAdtsPrefix_DropsLeadingNonAdts()
    {
        // Data=[] (corrupt packet, e.g. spilled) → IsAdts false
        var corrupt = new EncodedPacket(Array.Empty<byte>(), MediaType.Audio,
            TimeSpan.FromSeconds(0), TimeSpan.FromMilliseconds(21), false);
        var audio = new List<EncodedPacket>
        {
            corrupt,
            MakeAdtsAudio(1),
            MakeAdtsAudio(2)
        };
        var result = ClipExporter.TrimNonAdtsPrefix(audio);
        Assert.Equal(2, result.Count);
        Assert.Equal(1.0, result[0].Pts.TotalSeconds, 3);
        Assert.Equal(2.0, result[1].Pts.TotalSeconds, 3);
        // Original untouched
        Assert.Equal(3, audio.Count);
    }

    [Fact]
    public void TrimNonAdtsPrefix_AllNonAdts_ReturnsEmpty()
    {
        var audio = new List<EncodedPacket>
        {
            new(Array.Empty<byte>(), MediaType.Audio, TimeSpan.Zero, TimeSpan.FromMilliseconds(21), false),
            new(Array.Empty<byte>(), MediaType.Audio, TimeSpan.FromSeconds(1), TimeSpan.FromMilliseconds(21), false)
        };
        var result = ClipExporter.TrimNonAdtsPrefix(audio);
        Assert.Empty(result);
    }

    // ── GenerateThumbnail ──

    [Fact]
    public void GenerateThumbnail_NonexistentFile_Throws()
    {
        Assert.Throws<System.InvalidOperationException>(() =>
            ClipExporter.GenerateThumbnail(@"Z:\nonexistent\file.mp4"));
    }

    // ═══════════════════════════════════════════════════════════════
    //  BuildHvcc — guarda de tamanho mínimo (3.1 CRITICAL)
    //  Streams HEVC truncados/corruptos podem ter SPS < 13 bytes.
    //  Sem esta guarda, sps[12] lançava IndexOutOfRangeException e
    //  o clipe inteiro era perdido silenciosamente.
    // ═══════════════════════════════════════════════════════════════

    private static byte[] MakeValidHvccInput() => new byte[]
    {
        // vps (4 bytes), sps (13 bytes), pps (1 byte) — valores mínimos validadores
        0x40, 0x01, 0x0C, 0x01,  // VPS: 4 bytes (não inspecionados por Profile/Tier)
        0x42, 0x01, 0x01, 0x01, 0x60, // SPS[0..4]: profile/compat
        0, 0, 0, 0, 0,           // SPS[5..9]
        0, 0,                     // SPS[10..11]
        0x5D,                     // SPS[12]: generalLevelIdc
        0x01                      // PPS: 1 byte
    };

    [Fact]
    public void BuildHvcc_ShortSps_ReturnsNull()
    {
        var vps = MakeValidHvccInput()[..4];
        var sps = new byte[10]; // < 13
        var pps = new byte[] { 0x01 };
        Assert.Null(ClipExporter.BuildHvcc(vps, sps, pps));
    }

    [Fact]
    public void BuildHvcc_ShortVps_ReturnsNull()
    {
        var vps = new byte[2]; // < 4
        var sps = new byte[13];
        var pps = new byte[] { 0x01 };
        Assert.Null(ClipExporter.BuildHvcc(vps, sps, pps));
    }

    [Fact]
    public void BuildHvcc_EmptyPps_ReturnsNull()
    {
        var vps = new byte[4];
        var sps = new byte[13];
        var pps = Array.Empty<byte>(); // 0
        Assert.Null(ClipExporter.BuildHvcc(vps, sps, pps));
    }

    [Fact]
    public void BuildHvcc_ValidLengths_ReturnsNonEmpty()
    {
        var input = MakeValidHvccInput();
        var vps = input[..4];
        var sps = input[4..17];
        var pps = input[17..];
        var result = ClipExporter.BuildHvcc(vps, sps, pps);
        Assert.NotNull(result);
        Assert.NotEmpty(result);
        Assert.Equal(1, result[0]); // version
    }

    // ═══════════════════════════════════════════════════════════════
    //  SetLength truncation (3.3) — arquivos temp não ficam com
    //  ~20% de zeros no final (SetLength预留 + sem truncamento final)
    // ═══════════════════════════════════════════════════════════════

    [Fact]
    public void WriteMatroskaFile_WithEstimatedSize_TruncatesToActualContent()
    {
        var path = Path.Combine(Path.GetTempPath(), $"test_mkv_{Guid.NewGuid():N}.mkv");
        try
        {
            var pkt1 = new EncodedPacket(new byte[80], MediaType.Video, TimeSpan.Zero, TimeSpan.FromMilliseconds(33), isKeyFrame: true);
            var pkt2 = new EncodedPacket(new byte[80], MediaType.Video, TimeSpan.FromMilliseconds(33), TimeSpan.FromMilliseconds(33), isKeyFrame: false);
            var packets = new List<EncodedPacket> { pkt1, pkt2 };

            long hugeEstimate = 1_000_000; // 1 MB estimate para 160 bytes reais
            ClipExporter.WriteMatroskaFile(path, packets, "h264", estimatedSize: hugeEstimate);

            var fileSize = new FileInfo(path).Length;
            // G3: com truncamento, fileSize ≪ hugeEstimate
            Assert.True(fileSize < hugeEstimate / 10,
                $"fileSize={fileSize} deveria ser muito menor que estimated={hugeEstimate} (truncamento falhou?)");
            Assert.True(fileSize > 0);
        }
        finally { File.Delete(path); }
    }

    [Fact]
    public void WriteAdtsFile_WithEstimatedSize_TruncatesToActualContent()
    {
        var path = Path.Combine(Path.GetTempPath(), $"test_adts_{Guid.NewGuid():N}.aac");
        try
        {
            // Minimal ADTS frame: 7-byte header + data
            var adts1 = new EncodedPacket(new byte[30], MediaType.Audio, TimeSpan.Zero, TimeSpan.FromMilliseconds(23), false);
            var adts2 = new EncodedPacket(new byte[30], MediaType.Audio, TimeSpan.FromMilliseconds(23), TimeSpan.FromMilliseconds(23), false);
            var packets = new List<EncodedPacket> { adts1, adts2 };

            long hugeEstimate = 500_000; // 500 KB para 60 bytes reais
            ClipExporter.WriteAdtsFile(path, packets, hugeEstimate);

            var fileSize = new FileInfo(path).Length;
            Assert.True(fileSize < hugeEstimate / 10,
                $"fileSize={fileSize} deveria ser muito menor que estimated={hugeEstimate} (truncamento falhou?)");
            Assert.True(fileSize > 0);
        }
        finally { File.Delete(path); }
    }
}
