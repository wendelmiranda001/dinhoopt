using DiNho.Capture.Poc.Encoders;
using DiNho.Capture.Poc.Export;

namespace DiNho.Capture.Poc.Tests;

public sealed class AudioSyncTests
{
    private static EncodedPacket Pkt(MediaType type, long ptsMs, long durMs, byte[]? data = null)
    {
        return new EncodedPacket(
            data ?? Array.Empty<byte>(), type,
            TimeSpan.FromMilliseconds(ptsMs), TimeSpan.FromMilliseconds(durMs),
            false);
    }

    private static byte[] MakeSps() =>
        [0x67, 0x64, 0x00, 0x1E, 0xAC, 0x52, 0x80, 0x7B, 0x02, 0x20, 0x20, 0x20, 0x80];

    private static byte[] MakePps() => [0x68, 0xEE, 0x3C, 0x80];

    private static byte[] BuildAvccNal(byte[] nalData)
    {
        var r = new byte[4 + nalData.Length];
        r[0] = (byte)(nalData.Length >> 24);
        r[1] = (byte)(nalData.Length >> 16);
        r[2] = (byte)(nalData.Length >> 8);
        r[3] = (byte)nalData.Length;
        System.Buffer.BlockCopy(nalData, 0, r, 4, nalData.Length);
        return r;
    }

    private static byte[] AdtsFrame()
    {
        var d = new byte[9];
        d[0] = 0xFF; d[1] = 0xF1;
        d[2] = (byte)((1 << 6) | (3 << 2) | (2 >> 2));
        d[3] = (byte)(((2 & 3) << 6) | 0x1F);
        d[4] = 0x1C; d[5] = 0x20; d[6] = 0xFC;
        d[7] = 0; d[8] = 0;
        return d;
    }

    // ════════════════════════════════════════════════════════════
    //  TrimAudioStart
    // ════════════════════════════════════════════════════════════

    [Fact]
    public void TrimAudioStart_Empty_ReturnsEmpty()
    {
        var result = ClipExporter.TrimAudioStart([], TimeSpan.FromSeconds(1));
        Assert.Empty(result);
    }

    [Fact]
    public void TrimAudioStart_SkipsPacketsBeforeVideo()
    {
        var audio = new List<EncodedPacket>
        {
            Pkt(MediaType.Audio, 0, 21),   // ends at 21 < 100 → skip
            Pkt(MediaType.Audio, 21, 21),  // ends at 42 < 100 → skip
            Pkt(MediaType.Audio, 42, 21),  // ends at 63 < 100 → skip
            Pkt(MediaType.Audio, 500, 21), // ends at 521 >= 100 → keep
        };
        var result = ClipExporter.TrimAudioStart(audio, TimeSpan.FromMilliseconds(100));
        Assert.Single(result);
        Assert.Equal(500, result[0].Pts.TotalMilliseconds, 0);
    }

    [Fact]
    public void TrimAudioStart_NoTrimWhenAligned()
    {
        var audio = new List<EncodedPacket>
        {
            Pkt(MediaType.Audio, 0, 21),
            Pkt(MediaType.Audio, 21, 21),
        };
        var result = ClipExporter.TrimAudioStart(audio, TimeSpan.Zero);
        Assert.Same(audio, result);
    }

    [Fact]
    public void TrimAudioStart_AllBeforeVideo_ReturnsEmpty()
    {
        var audio = new List<EncodedPacket>
        {
            Pkt(MediaType.Audio, 0, 21),
            Pkt(MediaType.Audio, 21, 21),
        };
        var result = ClipExporter.TrimAudioStart(audio, TimeSpan.FromMilliseconds(100));
        Assert.Empty(result);
    }

    [Fact]
    public void TrimAudioStart_ExactlyAtBoundary_Keeps()
    {
        var audio = new List<EncodedPacket>
        {
            Pkt(MediaType.Audio, 100, 21),
        };
        var result = ClipExporter.TrimAudioStart(audio, TimeSpan.FromMilliseconds(100));
        Assert.Single(result);
    }

    [Fact]
    public void TrimAudioStart_PacketEndsJustBeforeBoundary_Skipped()
    {
        var audio = new List<EncodedPacket>
        {
            Pkt(MediaType.Audio, 70, 29),
            Pkt(MediaType.Audio, 100, 21),
        };
        var result = ClipExporter.TrimAudioStart(audio, TimeSpan.FromMilliseconds(100));
        Assert.Single(result);
        Assert.Equal(100, result[0].Pts.TotalMilliseconds, 0);
    }

    // ════════════════════════════════════════════════════════════
    //  TrimAudioEnd
    // ════════════════════════════════════════════════════════════

    [Fact]
    public void TrimAudioEnd_SkipsPacketsAfterVideo()
    {
        var audio = new List<EncodedPacket>
        {
            Pkt(MediaType.Audio, 0, 21),
            Pkt(MediaType.Audio, 21, 21),
            Pkt(MediaType.Audio, 42, 21),
            Pkt(MediaType.Audio, 8000, 21),
        };
        var result = ClipExporter.TrimAudioEnd(audio, TimeSpan.FromMilliseconds(100));
        Assert.Equal(3, result.Count);
    }

    [Fact]
    public void TrimAudioEnd_PacketStraddlingBoundary_Trimmed()
    {
        var audio = new List<EncodedPacket>
        {
            Pkt(MediaType.Audio, 80, 15),  // ends at 95 <= 100 → keep
            Pkt(MediaType.Audio, 111, 21), // ends at 132 > 100 → trim
        };
        var result = ClipExporter.TrimAudioEnd(audio, TimeSpan.FromMilliseconds(100));
        Assert.Single(result);
        Assert.Equal(80, result[0].Pts.TotalMilliseconds, 0);
    }

    // ════════════════════════════════════════════════════════════
    //  FilterAudioByIntervals
    // ════════════════════════════════════════════════════════════

    [Fact]
    public void FilterAudioByIntervals_OverlappingIntervals_AllMatch()
    {
        var audio = new List<EncodedPacket> { Pkt(MediaType.Audio, 3000, 21) };
        var intervals = new List<(TimeSpan start, TimeSpan end)>
        {
            (TimeSpan.FromSeconds(1), TimeSpan.FromSeconds(5)),
            (TimeSpan.FromSeconds(3), TimeSpan.FromSeconds(7)),
        };
        var result = ClipExporter.FilterAudioByIntervals(audio, intervals);
        Assert.Single(result);
    }

    [Fact]
    public void FilterAudioByIntervals_AdjacentIntervals_Correct()
    {
        var audio = new List<EncodedPacket>
        {
            Pkt(MediaType.Audio, 500, 21),
            Pkt(MediaType.Audio, 1500, 21),
            Pkt(MediaType.Audio, 2500, 21),
        };
        var intervals = new List<(TimeSpan start, TimeSpan end)>
        {
            (TimeSpan.Zero, TimeSpan.FromSeconds(1)),
            (TimeSpan.FromSeconds(1), TimeSpan.FromSeconds(2)),
            (TimeSpan.FromSeconds(2), TimeSpan.FromSeconds(4)),
        };
        var result = ClipExporter.FilterAudioByIntervals(audio, intervals);
        Assert.Equal(3, result.Count);
    }

    [Fact]
    public void FilterAudioByIntervals_AllInGap_ExcludesAll()
    {
        var audio = new List<EncodedPacket> { Pkt(MediaType.Audio, 5000, 21) };
        var intervals = new List<(TimeSpan start, TimeSpan end)>
        {
            (TimeSpan.Zero, TimeSpan.FromSeconds(3)),
            (TimeSpan.FromSeconds(8), TimeSpan.FromSeconds(10)),
        };
        var result = ClipExporter.FilterAudioByIntervals(audio, intervals);
        Assert.Empty(result);
    }

    [Fact]
    public void FilterAudioByIntervals_PacketAtIntervalEnd_Excluded()
    {
        var audio = new List<EncodedPacket> { Pkt(MediaType.Audio, 10000, 21) };
        var intervals = new List<(TimeSpan start, TimeSpan end)>
        {
            (TimeSpan.Zero, TimeSpan.FromSeconds(10)),
        };
        var result = ClipExporter.FilterAudioByIntervals(audio, intervals);
        Assert.Empty(result);
    }

    // ════════════════════════════════════════════════════════════
    //  GetVideoIntervals — PTS gap detection
    // ════════════════════════════════════════════════════════════

    [Fact]
    public void GetVideoIntervals_ContinuousStream_OneInterval()
    {
        var packets = new List<EncodedPacket>();
        for (int i = 0; i < 60; i++)
            packets.Add(Pkt(MediaType.Video, i * 16, 16));
        var result = ClipExporter.GetVideoIntervals(packets, TimeSpan.FromMilliseconds(50));
        Assert.Single(result);
        Assert.Equal(0, result[0].start.TotalMilliseconds, 1);
        Assert.Equal(960, result[0].end.TotalMilliseconds, 1);
    }

    [Fact]
    public void GetVideoIntervals_LargeAltTabGap_DetectsTwoIntervals()
    {
        var packets = new List<EncodedPacket>
        {
            Pkt(MediaType.Video, 0, 16),
            Pkt(MediaType.Video, 16, 16),
            Pkt(MediaType.Video, 32, 16),
            Pkt(MediaType.Video, 5000, 16),
            Pkt(MediaType.Video, 5016, 16),
        };
        var result = ClipExporter.GetVideoIntervals(packets, TimeSpan.FromMilliseconds(50));
        Assert.Equal(2, result.Count);
    }

    // ════════════════════════════════════════════════════════════
    //  AlignAudioToVideoPts — re-âncora do PTS do áudio (bug clip mudo)
    // ════════════════════════════════════════════════════════════

    [Fact]
    public void AlignAudioToVideoPts_AudioFarAhead_ShiftsToVideoTimeline()
    {
        // Vídeo: 30s a 60fps começando em 2220s (encoder atrasado ~481s)
        var video = new List<EncodedPacket>();
        for (int i = 0; i < 1800; i++)
            video.Add(Pkt(MediaType.Video, 2_220_000 + i * 16, 16));

        // Áudio: ~30s em 2700s (wall-clock real — per-stream reference)
        var audio = new List<EncodedPacket>();
        for (int i = 0; i < 1430; i++)
            audio.Add(Pkt(MediaType.Audio, 2_700_000 + i * 21, 21));

        // Antes da re-âncora, nenhum PTS de áudio cai nos intervalos do vídeo
        var intervals = ClipExporter.GetVideoIntervals(video, TimeSpan.FromMilliseconds(50));
        var before = ClipExporter.FilterAudioByIntervals(audio, intervals);
        Assert.Empty(before);

        var shift = ClipExporter.AlignAudioToVideoPts(audio, video);

        Assert.True(shift > TimeSpan.Zero);
        Assert.Equal(2_730_030 - 2_248_800, shift.TotalMilliseconds, 0);

        // Agora o áudio alinhado sobrevive ao filtro → clip com áudio
        var after = ClipExporter.FilterAudioByIntervals(audio, intervals);
        Assert.NotEmpty(after);
    }

    [Fact]
    public void AlignAudioToVideoPts_VideoRestarted_AudioStillAligned()
    {
        // Vídeo reiniciou (PTS fresca ~125s) enquanto o áudio seguiu em ~2716s
        var video = new List<EncodedPacket>();
        for (int i = 0; i < 200; i++)
            video.Add(Pkt(MediaType.Video, 95_000 + i * 16, 16));
        var audio = new List<EncodedPacket>();
        for (int i = 0; i < 1430; i++)
            audio.Add(Pkt(MediaType.Audio, 2_686_000 + i * 21, 21));

        var shift = ClipExporter.AlignAudioToVideoPts(audio, video);

        Assert.True(shift > TimeSpan.Zero);
        // Fim do áudio alinhado ao fim do vídeo
        var aNow = audio[^1].Pts + audio[^1].Duration;
        var vNow = video[^1].Pts + video[^1].Duration;
        Assert.Equal(0, (aNow - vNow).TotalMilliseconds, 1);
    }

    [Fact]
    public void AlignAudioToVideoPts_SmallOffset_NoChange()
    {
        var video = new List<EncodedPacket> { Pkt(MediaType.Video, 0, 16), Pkt(MediaType.Video, 16, 16) };
        var audio = new List<EncodedPacket> { Pkt(MediaType.Audio, 300, 21), Pkt(MediaType.Audio, 321, 21) };

        var before = audio[0].Pts;
        var shift = ClipExporter.AlignAudioToVideoPts(audio, video);

        Assert.Equal(TimeSpan.Zero, shift);
        Assert.Equal(before, audio[0].Pts);
    }

    [Fact]
    public void AlignAudioToVideoPts_EmptyStreams_ReturnsZero()
    {
        Assert.Equal(TimeSpan.Zero, ClipExporter.AlignAudioToVideoPts([], new List<EncodedPacket>()));
        var audio = new List<EncodedPacket> { Pkt(MediaType.Audio, 0, 21) };
Assert.Equal(TimeSpan.Zero, ClipExporter.AlignAudioToVideoPts(audio, []));
        }

        [Fact]
        public void AlignAudioToVideoPts_RateScaling_ScalesInbetweenToVideoSpan()
        {
            var video = new List<EncodedPacket>
            {
                Pkt(MediaType.Video, 0, 500),
                Pkt(MediaType.Video, 500, 500),
                Pkt(MediaType.Video, 1000, 500),
            };
            var audio = new List<EncodedPacket>
            {
                Pkt(MediaType.Audio, 0, 600),
                Pkt(MediaType.Audio, 600, 600),
            };

            ClipExporter.AlignAudioToVideoPts(audio, video);

            Assert.Equal(0, (audio[^1].Pts + audio[^1].Duration - (video[^1].Pts + video[^1].Duration)).TotalMilliseconds, 1);
            Assert.Equal(750, audio[1].Pts.TotalMilliseconds, 1);
            Assert.Equal(750, audio[1].Duration.TotalMilliseconds, 1);
            Assert.Equal(0, audio[0].Pts.TotalMilliseconds, 1);
            Assert.Equal(500, video[1].Pts.TotalMilliseconds, 1);
        }

    // ════════════════════════════════════════════════════════════
    //  ClonePackets — export não corrompe o anel vivo do buffer
    // ════════════════════════════════════════════════════════════

    [Fact]
    public void ClonePackets_ReturnsIndependentPts_SharedData()
    {
        var original = new List<EncodedPacket>
        {
            Pkt(MediaType.Video, 1000, 16, [1, 2, 3]),
            Pkt(MediaType.Audio, 2000, 21),
        };

        var clones = ClipExporter.ClonePackets(original);

        Assert.Equal(2, clones.Count);
        Assert.Same(original[0].Data, clones[0].Data);
        Assert.Equal(original[0].Pts, clones[0].Pts);
        Assert.Equal(original[0].Duration, clones[0].Duration);
        Assert.Equal(original[0].IsKeyFrame, clones[0].IsKeyFrame);
        Assert.Equal(original[0].DataLength, clones[0].DataLength);
        Assert.False(clones[0].IsPooled);

        // Mutar o clone NÃO afeta o original (anel vivo)
        clones[0].Pts = TimeSpan.FromMilliseconds(9999);
        Assert.Equal(TimeSpan.FromMilliseconds(1000), original[0].Pts);
    }

    [Fact]
    public void ClonePackets_Empty_ReturnsSame()
    {
        var empty = new List<EncodedPacket>();
        Assert.Same(empty, ClipExporter.ClonePackets(empty));
    }

    [Fact]
    public void PadAudioWithSilence_LargeGap_InsertsSilence()
    {
        var dur = TimeSpan.FromMilliseconds(21);
        var audio = new List<EncodedPacket>
        {
            Pkt(MediaType.Audio, 0, 21),
            Pkt(MediaType.Audio, 5000, 21),
        };
        var result = ClipExporter.PadAudioWithSilence(audio, 48000);
        Assert.True(result.Count > 2);
    }

    [Fact]
    public void PadAudioWithSilence_NoPadWhenAudioStartsFirst()
    {
        var audio = new List<EncodedPacket>
        {
            Pkt(MediaType.Audio, 0, 21),
            Pkt(MediaType.Audio, 21, 21),
        };
        var result = ClipExporter.PadAudioWithSilence(audio, 48000);
        Assert.Equal(2, result.Count);
    }

    [Fact]
    public void PadAudioWithSilence_ExpectedStartDelayed_InsertsUpfront()
    {
        var audio = new List<EncodedPacket>
        {
            Pkt(MediaType.Audio, 500, 21),
        };
        var result = ClipExporter.PadAudioWithSilence(audio, 48000, 2, TimeSpan.Zero);
        Assert.True(result.Count > 1);
        Assert.Equal(TimeSpan.Zero, result[0].Pts);
    }

    [Fact]
    public void PadAudioWithSilence_MultipleGaps_MultiplePaddings()
    {
        var audio = new List<EncodedPacket>
        {
            Pkt(MediaType.Audio, 0, 21),
            Pkt(MediaType.Audio, 3000, 21),
            Pkt(MediaType.Audio, 6000, 21),
        };
        var result = ClipExporter.PadAudioWithSilence(audio, 48000);
        Assert.True(result.Count > 3);
    }

    // ════════════════════════════════════════════════════════════
    //  FindTrailingFrozenFrames
    // ════════════════════════════════════════════════════════════

    [Fact]
    public void FindTrailingFrozenFrames_MultipleGaps_TruncatesAtLargest()
    {
        var dur = TimeSpan.FromMilliseconds(16);
        var packets = new List<EncodedPacket>();
        for (int i = 0; i < 5; i++)
            packets.Add(Pkt(MediaType.Video, i * 16, 16));
        // 2s gap
        for (int i = 0; i < 5; i++)
            packets.Add(Pkt(MediaType.Video, 2000 + i * 16, 16));

        var result = ClipExporter.FindTrailingFrozenFrames(packets, TimeSpan.FromSeconds(1), 60);
        Assert.Equal(5, result);
    }

    [Fact]
    public void FindTrailingFrozenFrames_MoreThanHalf_KeepsAll()
    {
        var packets = new List<EncodedPacket>
        {
            Pkt(MediaType.Video, 0, 16),       // index 0
            Pkt(MediaType.Video, 2000, 16),     // index 1 — 2s gap before this
            Pkt(MediaType.Video, 2016, 16),     // index 2
            Pkt(MediaType.Video, 2032, 16),     // index 3
            Pkt(MediaType.Video, 2048, 16),     // index 4
        };

        var result = ClipExporter.FindTrailingFrozenFrames(packets, TimeSpan.FromSeconds(1), 60);
        Assert.Equal(5, result); // trailingFrames=4 > 5/2=2 → keeps all
    }

    // ════════════════════════════════════════════════════════════
    //  ComputeIntervalsDuration
    // ════════════════════════════════════════════════════════════

    [Fact]
    public void ComputeIntervalsDuration_SingleInterval()
    {
        var intervals = new List<(TimeSpan start, TimeSpan end)>
        {
            (TimeSpan.FromSeconds(2), TimeSpan.FromSeconds(7)),
        };
        Assert.Equal(5.0, ClipExporter.ComputeIntervalsDuration(intervals), 3);
    }

    // ════════════════════════════════════════════════════════════
    //  ConvertAvccToAnnexB
    // ════════════════════════════════════════════════════════════

    [Fact]
    public void ConvertAvccToAnnexB_SingleNal()
    {
        byte[] nal = [0x65, 0x88, 0x84, 0x00, 0x00];
        var avcc = BuildAvccNal(nal);
        var result = ClipExporter.ConvertAvccToAnnexB(avcc, avcc.Length);
        Assert.Equal(3 + nal.Length, result.Length);
        Assert.Equal(0, result[0]);
        Assert.Equal(0, result[1]);
        Assert.Equal(1, result[2]);
        Assert.Equal(0x65, result[3]);
    }

    [Fact]
    public void ConvertAvccToAnnexB_MultipleNals()
    {
        byte[] sps = [0x67, 0x64, 0x00, 0x1E];
        byte[] pps = [0x68, 0xEE, 0x3C, 0x80];
        var avcc = new byte[BuildAvccNal(sps).Length + BuildAvccNal(pps).Length];
        System.Buffer.BlockCopy(BuildAvccNal(sps), 0, avcc, 0, BuildAvccNal(sps).Length);
        System.Buffer.BlockCopy(BuildAvccNal(pps), 0, avcc, BuildAvccNal(sps).Length, BuildAvccNal(pps).Length);
        var result = ClipExporter.ConvertAvccToAnnexB(avcc, avcc.Length);
        Assert.Equal(3 + sps.Length + 3 + pps.Length, result.Length);
    }

    [Fact]
    public void ConvertAvccToAnnexB_NoValidNals_ReturnsCopy()
    {
        byte[] data = [0x01, 0x02, 0x03, 0x04];
        var result = ClipExporter.ConvertAvccToAnnexB(data, data.Length);
        Assert.Equal(data.Length, result.Length);
    }

    [Fact]
    public void ConvertAvccToAnnexB_ZeroLengthNal_StopsAtZero()
    {
        byte[] data = [0x00, 0x00, 0x00, 0x00, 0x65, 0x01];
        var result = ClipExporter.ConvertAvccToAnnexB(data, data.Length);
        Assert.Equal(data.Length, result.Length);
    }

    [Fact]
    public void ConvertAvccToAnnexB_NalLengthExceedsData_Stops()
    {
        byte[] data = [0x00, 0x00, 0x01, 0x00, 0x01, 0x02];
        var result = ClipExporter.ConvertAvccToAnnexB(data, data.Length);
        Assert.Equal(data.Length, result.Length);
    }

    // ════════════════════════════════════════════════════════════
    //  RemoveEmulationPrevention
    // ════════════════════════════════════════════════════════════

    [Fact]
    public void RemoveEmulationPrevention_NoEmulation_ReturnsSame()
    {
        byte[] nal = [0x67, 0x64, 0x00, 0x1E, 0xAC];
        var result = ClipExporter.RemoveEmulationPrevention(nal);
        Assert.Same(nal, result);
    }

    [Fact]
    public void RemoveEmulationPrevention_RemovesEmulationBytes()
    {
        byte[] nal = [0x67, 0x64, 0x00, 0x00, 0x03, 0x01, 0x00, 0x00, 0x03, 0x02];
        var result = ClipExporter.RemoveEmulationPrevention(nal);
        Assert.Equal(8, result.Length);
    }

    [Fact]
    public void RemoveEmulationPrevention_MultipleEmulation_AllRemoved()
    {
        byte[] nal = [0x00, 0x00, 0x03, 0x00, 0x00, 0x03, 0x01];
        var result = ClipExporter.RemoveEmulationPrevention(nal);
        Assert.Equal(5, result.Length);
    }

    [Fact]
    public void RemoveEmulationPrevention_ShortNal_NoChange()
    {
        byte[] nal = [0x00, 0x03];
        var result = ClipExporter.RemoveEmulationPrevention(nal);
        Assert.Same(nal, result);
    }

    // ════════════════════════════════════════════════════════════
    //  BuildAvcc
    // ════════════════════════════════════════════════════════════

    [Fact]
    public void BuildAvcc_ValidSpsPps_ReturnsAvccRecord()
    {
        var sps = MakeSps();
        var pps = MakePps();
        var avcc = ClipExporter.BuildAvcc(sps, pps);
        Assert.NotNull(avcc);
        Assert.Equal(1, avcc[0]);
        Assert.Equal(sps[1], avcc[1]);
        Assert.Equal(sps[2], avcc[2]);
        Assert.Equal(sps[3], avcc[3]);
    }

    [Fact]
    public void BuildAvcc_SpsTooShort_ReturnsNull()
    {
        var result = ClipExporter.BuildAvcc([0x67, 0x64, 0x00], MakePps());
        Assert.Null(result);
    }

    [Fact]
    public void BuildAvcc_EmptyPps_ReturnsNull()
    {
        var result = ClipExporter.BuildAvcc(MakeSps(), []);
        Assert.Null(result);
    }

    [Fact]
    public void BuildAvcc_SpsWithEmulationPrevention_Preserved()
    {
        // Bug 3 fix: emulation prevention bytes (0x03) are NOT removed — they are part
        // of the NAL unit syntax and MUST be preserved in the avcC record per ISO 14496-15.
        byte[] sps = [0x67, 0x64, 0x00, 0x00, 0x03, 0x01, 0x1E, 0xAC];
        var pps = MakePps();
        var avcc = ClipExporter.BuildAvcc(sps, pps);
        Assert.NotNull(avcc);
        int spsLen = (avcc[6] << 8) | avcc[7];
        Assert.Equal(8, spsLen); // SPS preserved as-is (8 bytes, not 7)
    }

    // ════════════════════════════════════════════════════════════
    //  ExtractAvccExtradata
    // ════════════════════════════════════════════════════════════

    [Fact]
    public void ExtractAvccExtradata_AudioOnly_ReturnsNull()
    {
        var packets = new List<EncodedPacket>
        {
            Pkt(MediaType.Audio, 0, 21),
        };
        Assert.Null(ClipExporter.ExtractAvccExtradata(packets));
    }

    [Fact]
    public void ExtractAvccExtradata_MissingPps_ReturnsNull()
    {
        byte[] spsNal = [0x67, 0x64, 0x00, 0x1E, 0xAC];
        var data = BuildAvccNal(spsNal);
        var pkt = new EncodedPacket(data, MediaType.Video, TimeSpan.Zero, TimeSpan.FromMilliseconds(16), true);
        Assert.Null(ClipExporter.ExtractAvccExtradata([pkt]));
    }

    // ════════════════════════════════════════════════════════════
    //  GenerateSilentAacFrames
    // ════════════════════════════════════════════════════════════

    [Fact]
    public void GenerateSilentAacFrames_44100Hz_CorrectSampleRateIdx()
    {
        var frames = ClipExporter.GenerateSilentAacFrames(1, TimeSpan.Zero, 44100);
        Assert.Single(frames);
        Assert.Equal(0xFF, frames[0].Data[0]);
    }

    [Fact]
    public void GenerateSilentAacFrames_4Channel_Config()
    {
        var frames = ClipExporter.GenerateSilentAacFrames(1, TimeSpan.Zero, 48000, 4);
        Assert.Single(frames);
        Assert.Equal(MediaType.Audio, frames[0].Type);
    }

    // ════════════════════════════════════════════════════════════
    //  BuildAudioSpecificConfig
    // ════════════════════════════════════════════════════════════

    [Fact]
    public void BuildAudioSpecificConfig_ValidAdts_Returns2Bytes()
    {
        var pkt = Pkt(MediaType.Audio, 0, 21, AdtsFrame());
        var result = ClipExporter.BuildAudioSpecificConfig(pkt);
        Assert.NotNull(result);
        Assert.Equal(2, result.Length);
    }

    [Fact]
    public void BuildAudioSpecificConfig_NotAdts_ReturnsNull()
    {
        var pkt = Pkt(MediaType.Audio, 0, 21, [0x00, 0x00, 0x00, 0x00, 0x00]);
        var result = ClipExporter.BuildAudioSpecificConfig(pkt);
        Assert.Null(result);
    }

    [Fact]
    public void BuildAudioSpecificConfig_TooShort_ReturnsNull()
    {
        var pkt = Pkt(MediaType.Audio, 0, 21, [0xFF, 0xF0]);
        var result = ClipExporter.BuildAudioSpecificConfig(pkt);
        Assert.Null(result);
    }

    [Fact]
    public void BuildAudioSpecificConfig_NullData_ReturnsNull()
    {
        var pkt = new EncodedPacket(Array.Empty<byte>(), MediaType.Audio, TimeSpan.Zero, TimeSpan.Zero, false);
        var result = ClipExporter.BuildAudioSpecificConfig(pkt);
        Assert.Null(result);
    }

    // ════════════════════════════════════════════════════════════
    //  ExtractHvccExtradata
    // ════════════════════════════════════════════════════════════

    private static EncodedPacket MakeHevcPacket(params byte[] nalData)
    {
        return new EncodedPacket(nalData, MediaType.Video, TimeSpan.Zero, TimeSpan.FromMilliseconds(16), true);
    }

    private static byte[] BuildHevcNal(int nalType, byte[] payload)
    {
        int nalLen = 1 + payload.Length;
        var r = new byte[4 + nalLen];
        r[0] = (byte)(nalLen >> 24);
        r[1] = (byte)(nalLen >> 16);
        r[2] = (byte)(nalLen >> 8);
        r[3] = (byte)nalLen;
        r[4] = (byte)((nalType << 1) | 1);
        System.Buffer.BlockCopy(payload, 0, r, 5, payload.Length);
        return r;
    }

    [Fact]
    public void ExtractHvccExtradata_MissingVps_ReturnsNull()
    {
        byte[] spsPayload = new byte[20];
        byte[] ppsPayload = new byte[5];
        var data = new byte[BuildHevcNal(33, spsPayload).Length + BuildHevcNal(34, ppsPayload).Length];
        System.Buffer.BlockCopy(BuildHevcNal(33, spsPayload), 0, data, 0, BuildHevcNal(33, spsPayload).Length);
        System.Buffer.BlockCopy(BuildHevcNal(34, ppsPayload), 0, data, BuildHevcNal(33, spsPayload).Length, BuildHevcNal(34, ppsPayload).Length);
        var pkt = MakeHevcPacket(data);
        Assert.Null(ClipExporter.ExtractHvccExtradata([pkt]));
    }

    [Fact]
    public void ExtractHvccExtradata_AllNals_ReturnsValidHvcc()
    {
        byte[] vpsPayload = new byte[10];
        byte[] spsPayload = new byte[20];
        spsPayload[0] = 0x01;
        byte[] ppsPayload = new byte[5];
        var data = new byte[BuildHevcNal(32, vpsPayload).Length + BuildHevcNal(33, spsPayload).Length + BuildHevcNal(34, ppsPayload).Length];
        int off = 0;
        System.Buffer.BlockCopy(BuildHevcNal(32, vpsPayload), 0, data, off, BuildHevcNal(32, vpsPayload).Length); off += BuildHevcNal(32, vpsPayload).Length;
        System.Buffer.BlockCopy(BuildHevcNal(33, spsPayload), 0, data, off, BuildHevcNal(33, spsPayload).Length); off += BuildHevcNal(33, spsPayload).Length;
        System.Buffer.BlockCopy(BuildHevcNal(34, ppsPayload), 0, data, off, BuildHevcNal(34, ppsPayload).Length);
        var pkt = MakeHevcPacket(data);
        var hvcc = ClipExporter.ExtractHvccExtradata([pkt]);
        Assert.NotNull(hvcc);
        Assert.Equal(1, hvcc[0]); // configurationVersion
    }

    [Fact]
    public void ExtractHvccExtradata_EmptyPackets_ReturnsNull()
    {
        Assert.Null(ClipExporter.ExtractHvccExtradata([]));
    }

    // ════════════════════════════════════════════════════════════
    //  BuildHvcc
    // ════════════════════════════════════════════════════════════

    [Fact]
    public void BuildHvcc_CorrectVersion()
    {
        byte[] vps = new byte[10];
        byte[] sps = new byte[20];
        sps[0] = 0x01;
        byte[] pps = new byte[5];
        var hvcc = ClipExporter.BuildHvcc(vps, sps, pps);
        Assert.NotNull(hvcc);
        Assert.Equal(1, hvcc[0]); // configurationVersion
    }

    [Fact]
    public void BuildHvcc_CorrectTotalLength()
    {
        byte[] vps = new byte[10];
        byte[] sps = new byte[20];
        sps[0] = 0x01;
        byte[] pps = new byte[5];
        var hvcc = ClipExporter.BuildHvcc(vps, sps, pps);
        Assert.NotNull(hvcc);
        Assert.Equal(35 + 10 + 20 + 5, hvcc.Length); // 70 = 35 header + data
    }

    // ════════════════════════════════════════════════════════════
    //  ExtractAv1Extradata
    // ════════════════════════════════════════════════════════════

    [Fact]
    public void ExtractAv1Extradata_EmptyPackets_ReturnsNull()
    {
        Assert.Null(ClipExporter.ExtractAv1Extradata([]));
    }

    [Fact]
    public void ExtractAv1Extradata_NoSeqHeader_ReturnsNull()
    {
        byte[] obuNoSeq = [0x12, 0x02, 0x00];
        var pkt = Pkt(MediaType.Video, 0, 16, obuNoSeq);
        Assert.Null(ClipExporter.ExtractAv1Extradata([pkt]));
    }

    [Fact]
    public void ExtractAv1Extradata_WithSeqHeader_ReturnsRawObu()
    {
        byte[] seqHeaderPayload = [0x80, 0x01, 0x02, 0x03, 0x04];
        int obuSize = seqHeaderPayload.Length;
        int headerByte = (1 << 3) | 0;
        var data = new byte[1 + leb128Size(obuSize) + obuSize];
        data[0] = (byte)headerByte;
        int pos = WriteLeb128(data, 1, obuSize);
        System.Buffer.BlockCopy(seqHeaderPayload, 0, data, pos, obuSize);
        var pkt = Pkt(MediaType.Video, 0, 16, data);
        var result = ClipExporter.ExtractAv1Extradata([pkt]);
        Assert.NotNull(result);
        Assert.Equal(data.Length, result.Length);
        Assert.Equal(data, result);
    }

    [Fact]
    public void ExtractAv1Extradata_WithExtensionFlag_ReturnsFullObu()
    {
        byte[] seqHeaderPayload = [0xAA, 0xBB];
        int obuSize = seqHeaderPayload.Length;
        int headerByte = (1 << 3) | 0x04; // OBU type 1 + extension flag
        int extByte = 0xA0;
        var data = new byte[2 + leb128Size(obuSize) + obuSize];
        data[0] = (byte)headerByte;
        data[1] = (byte)extByte;
        int pos = WriteLeb128(data, 2, obuSize);
        System.Buffer.BlockCopy(seqHeaderPayload, 0, data, pos, obuSize);
        var pkt = Pkt(MediaType.Video, 0, 16, data);
        var result = ClipExporter.ExtractAv1Extradata([pkt]);
        Assert.NotNull(result);
        Assert.Equal(data.Length, result.Length);
        Assert.Equal(data, result);
    }

    private static int leb128Size(int value)
    {
        int size = 0;
        do { size++; value >>= 7; } while (value > 0);
        return size;
    }

    private static int WriteLeb128(byte[] buf, int offset, int value)
    {
        int pos = offset;
        do
        {
            int b = value & 0x7F;
            value >>= 7;
            if (value > 0) b |= 0x80;
            buf[pos++] = (byte)b;
        } while (value > 0);
        return pos;
    }
}
