using DiNho.Capture.Poc.Encoders;
using DiNho.Capture.Poc.Export;

namespace DiNho.Capture.Poc.Tests;

// Regression: o offset de áudio intencional (áudio começa ~600ms depois do
// vídeo, decisão do NoSyncNeeded) era perdido no mux — o ADTS cru não carrega
// PTS e o comando ffmpeg não tinha -itsoffset, então o áudio tocava adiantado.
public sealed class ClipExporterMuxOffsetTests
{
    private static EncodedPacket V(double ptsMs) =>
        new(new byte[4], MediaType.Video, TimeSpan.FromMilliseconds(ptsMs),
            TimeSpan.FromMilliseconds(16), true);

    private static EncodedPacket A(double ptsMs) =>
        new(new byte[4], MediaType.Audio, TimeSpan.FromMilliseconds(ptsMs),
            TimeSpan.FromMilliseconds(21), false);

    [Fact]
    public void ComputeAudioMuxOffset_AudioAfterVideo_ReturnsDelta()
    {
        var video = new List<EncodedPacket> { V(0), V(16), V(33) };
        var audio = new List<EncodedPacket> { A(675), A(696), A(717) };
        Assert.Equal(TimeSpan.FromMilliseconds(675),
            ClipExporter.ComputeAudioMuxOffset(video, audio));
    }

    [Fact]
    public void ComputeAudioMuxOffset_UnsortedVideo_UsesMinPts()
    {
        var video = new List<EncodedPacket> { V(100), V(0), V(50) };
        var audio = new List<EncodedPacket> { A(200) };
        Assert.Equal(TimeSpan.FromMilliseconds(200),
            ClipExporter.ComputeAudioMuxOffset(video, audio));
    }

    [Fact]
    public void ComputeAudioMuxOffset_AudioBeforeVideo_ClampsToZero()
    {
        var video = new List<EncodedPacket> { V(500), V(516) };
        var audio = new List<EncodedPacket> { A(100), A(121) };
        Assert.Equal(TimeSpan.Zero, ClipExporter.ComputeAudioMuxOffset(video, audio));
    }

    [Fact]
    public void ComputeAudioMuxOffset_EmptyLists_ReturnsZero()
    {
        Assert.Equal(TimeSpan.Zero, ClipExporter.ComputeAudioMuxOffset([], []));
        Assert.Equal(TimeSpan.Zero,
            ClipExporter.ComputeAudioMuxOffset(new List<EncodedPacket> { V(0) }, []));
        Assert.Equal(TimeSpan.Zero,
            ClipExporter.ComputeAudioMuxOffset([], new List<EncodedPacket> { A(10) }));
    }

    [Fact]
    public void BuildMuxArgs_WithAudioAndOffset_PlacesItsoffsetBeforeAudioInput()
    {
        var args = ClipExporter.BuildMuxArgs(
            "out.mp4", "v.mkv", hasAudio: true, TimeSpan.FromMilliseconds(675), "a.adts");

        // -itsoffset é opção de INPUT: precisa vir imediatamente antes do -f aac -i.
        Assert.Contains("-itsoffset 0.675 -f aac -i", args);
        Assert.Contains("-map 0:v:0 -map 1:a:0", args);
        Assert.Contains("-c:v copy -c:a copy", args);
        Assert.Contains("-movflags +faststart", args);
    }

    [Fact]
    public void BuildMuxArgs_WithAudioZeroOffset_NoItsoffset()
    {
        var args = ClipExporter.BuildMuxArgs(
            "out.mp4", "v.mkv", hasAudio: true, TimeSpan.Zero, "a.adts");

        Assert.DoesNotContain("itsoffset", args);
        Assert.Contains("-f aac -i", args);
        Assert.Contains("-map 0:v:0 -map 1:a:0", args);
    }

    [Fact]
    public void BuildMuxArgs_NoAudio_NoAudioInput()
    {
        var args = ClipExporter.BuildMuxArgs(
            "out.mp4", "v.mkv", hasAudio: false, TimeSpan.FromMilliseconds(675), null);

        Assert.DoesNotContain("itsoffset", args);
        Assert.DoesNotContain("-f aac", args);
        Assert.Contains("-map 0:v:0 ", args);
        Assert.Contains("-c:v copy ", args);
    }
}
