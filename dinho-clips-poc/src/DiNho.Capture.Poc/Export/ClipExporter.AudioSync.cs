using DiNho.Capture.Poc.Logging;
using DiNho.Capture.Poc.Encoders;

namespace DiNho.Capture.Poc.Export;

public sealed partial class ClipExporter
{
    internal static List<EncodedPacket> GenerateSilentAacFrames(int count, TimeSpan startPts, int sampleRate, int channels = 2)
    {
        var frames = new List<EncodedPacket>(count);
        long durTicks = 1024L * 10_000_000 / sampleRate;
        var dur = TimeSpan.FromTicks(durTicks);

        for (int i = 0; i < count; i++)
        {
            int frameLen = 9;
            var data = new byte[frameLen];

            int profile = 1; // AAC-LC
            int sampleRateIdx = sampleRate switch
            {
                96000 => 0, 88200 => 1, 64000 => 2, 48000 => 3,
                44100 => 4, 32000 => 5, 24000 => 6, 22050 => 7,
                16000 => 8, 12000 => 9, 11025 => 10, 8000 => 11, _ => 3
            };
            int chanConfig = channels;

            int h1 = 0xFFF1; // syncword=0xFFF, ID=0(MPEG4), layer=0, protection_absent=1
            int h2 = (profile << 6) | (sampleRateIdx << 2) | (chanConfig >> 2);
            int h3 = ((chanConfig & 3) << 6) | ((frameLen >> 11) & 0x03);
            int h4 = (frameLen >> 3) & 0xFF;
            int h5 = ((frameLen & 7) << 5) | 0x1F;
            int h6 = 0xFC;

            data[0] = (byte)(h1 >> 8);
            data[1] = (byte)(h1 & 0xFF);
            data[2] = (byte)h2;
            data[3] = (byte)h3;
            data[4] = (byte)h4;
            data[5] = (byte)h5;
            data[6] = (byte)h6;
            data[7] = 0;
            data[8] = 0;

            var pts = startPts + TimeSpan.FromTicks(durTicks * i);
            frames.Add(new EncodedPacket(data, MediaType.Audio, pts, dur, false));
        }
        return frames;
    }

    internal static List<(TimeSpan start, TimeSpan end)> GetVideoIntervals(List<EncodedPacket> videoPackets, TimeSpan gapThreshold)
    {
        var intervals = new List<(TimeSpan start, TimeSpan end)>();
        if (videoPackets.Count == 0) return intervals;

        for (int vi = 0; vi < videoPackets.Count; vi++)
        {
            var pkt = videoPackets[vi];
            var s = pkt.Pts;
            var e = s + pkt.Duration;
            if (intervals.Count == 0 || s - intervals[^1].end > gapThreshold)
                intervals.Add((s, e));
            else
                intervals[^1] = (intervals[^1].start, e);
        }

        return intervals;
    }

    internal static List<EncodedPacket> FilterAudioByIntervals(List<EncodedPacket> audioPackets, List<(TimeSpan start, TimeSpan end)> intervals)
    {
        if (audioPackets.Count == 0 || intervals.Count == 0) return audioPackets;

        int intervalIdx = 0;
        var result = new List<EncodedPacket>(audioPackets.Count);
        foreach (var pkt in audioPackets)
        {
            while (intervalIdx < intervals.Count && pkt.Pts >= intervals[intervalIdx].end)
                intervalIdx++;
            if (intervalIdx < intervals.Count && pkt.Pts >= intervals[intervalIdx].start)
                result.Add(pkt);
        }

        return result;
    }

    /// <summary>
    /// Re-anchora o PTS do áudio na timeline do vídeo.
    /// <para>
    /// <c>GetSegments</c> corta cada stream na sua própria referência ("now") —
    /// janela de vídeo em <c>video[^1].Pts</c>, janela de áudio em <c>audio[^1].Pts</c>.
    /// Quando o encoder roda abaixo de tempo real (NVENC speed &lt; 1.0x), o PTS do
    /// vídeo fica atrás do áudio por um offset acumulativo (observado até ~480s em
    /// sessão de 45min). Sem re-âncora, <see cref="FilterAudioByIntervals"/> descarta
    /// TODO o áudio — nenhum PTS de áudio cai dentro dos intervalos do vídeo → clip mudo
    /// (MP4 probe <c>audio=False</c>).
    /// </para>
    /// <para>
    /// Ambos os segmentos representam a mesma janela de wall-clock (per-stream
    /// reference), então alinhar os fins ("now") é a correspondência correta.
    /// Só aplica quando o offset é material (&gt; 2s — mesmo limiar do TrimVideoStart);
    /// offsets pequenos preservam o tratamento 30ms–2s existente.
    /// </para>
    /// </summary>
    /// <param name="audioPackets">Áudio (Pts é mutado).</param>
    /// <param name="videoPackets">Vídeo (não mutado — é a referência).</param>
    /// <returns>O shift aplicado (TimeSpan.Zero se não houve re-âncora).</returns>
    internal static TimeSpan AlignAudioToVideoPts(List<EncodedPacket> audioPackets, List<EncodedPacket> videoPackets)
    {
        if (audioPackets.Count == 0 || videoPackets.Count == 0)
            return TimeSpan.Zero;

        var aNow = audioPackets[^1].Pts + audioPackets[^1].Duration;
        var vNow = videoPackets[^1].Pts + videoPackets[^1].Duration;
        var shift = aNow - vNow;

if (shift > TimeSpan.Zero && shift.TotalSeconds <= 2.0)
                return TimeSpan.Zero;

        // Quando o span remapeado do áudio é mais CURTO que o do vídeo, o áudio não
        // cobre o fim do vídeo — re-dimensionar (rate-scale) para esticar o áudio até
        // o fim do vídeo, preservando o início. Quando o áudio é mais longo ou igual,
        // aplica apenas o shift uniforme.
        if (shift.TotalSeconds < 0.0 && aNow > TimeSpan.Zero)
        {
            var audioStart = audioPackets[0].Pts;
            var audioSpan = aNow - audioStart;
            if (audioSpan > TimeSpan.Zero)
            {
                var videoSpan = vNow - audioStart;
                double factor = videoSpan.TotalSeconds / audioSpan.TotalSeconds;
                for (int i = 0; i < audioPackets.Count; i++)
                {
                    var rel = (audioPackets[i].Pts - audioStart).TotalSeconds * factor;
                    audioPackets[i].Pts = audioStart + TimeSpan.FromSeconds(rel);
                    audioPackets[i].Duration = TimeSpan.FromSeconds(
                        audioPackets[i].Duration.TotalSeconds * factor);
                }
                return shift;
            }
        }

        for (int i = 0; i < audioPackets.Count; i++)
            audioPackets[i].Pts -= shift;
        return shift;
    }

    /// <summary>
    /// Cria wrappers leves (mesmo byte[] compartilhado, Pts independente) dos pacotes
    /// para o export. <see cref="ReplayBuffer.GetSegments"/> retorna referências Retain'd
    /// aos objetos vivos do anel; o export (ReTimestampToContiguous, AlignAudioToVideoPts)
    /// muta Pts — fazê-lo in-place corromperia o anel vivo (janelas de segmento seguintes
    /// calcularam PTS já re-mapeados). Clones têm <c>IsPooled = false</c> e NUNCA são
    /// Release()'d aqui: o caller libera os originais no finally após o export retornar.
    /// Seguro porque os originais permanecem retidos durante todo o export (arrays pooled
    /// não voltam ao pool até o último Release do caller).
    /// </summary>
    internal static List<EncodedPacket> ClonePackets(List<EncodedPacket> packets)
    {
        if (packets.Count == 0) return packets;
        var clones = new List<EncodedPacket>(packets.Count);
        foreach (var pkt in packets)
        {
            if (pkt.PcmSamples != null)
                clones.Add(new EncodedPacket(pkt.PcmSamples, pkt.Type, pkt.Pts, pkt.Duration));
            else
                clones.Add(new EncodedPacket(pkt.Data, pkt.Type, pkt.Pts, pkt.Duration,
                    pkt.IsKeyFrame, isPooled: false, pkt.Width, pkt.Height, pkt.DataLength));
        }
        return clones;
    }

    internal static double ComputeIntervalsDuration(List<(TimeSpan start, TimeSpan end)> intervals)
    {
        double total = 0;
        foreach (var (start, end) in intervals)
            total += (end - start).TotalSeconds;
        return total;
    }

    internal static List<EncodedPacket> TrimAudioStart(List<EncodedPacket> audioPackets, TimeSpan firstVideoPts)
    {
        if (audioPackets.Count == 0) return audioPackets;

        int skip = 0;
        for (int i = 0; i < audioPackets.Count; i++)
        {
            if (audioPackets[i].Pts + audioPackets[i].Duration < firstVideoPts)
                skip = i + 1;
            else
                break;
        }

        return skip > 0 ? audioPackets.GetRange(skip, audioPackets.Count - skip) : audioPackets;
    }

    internal static List<EncodedPacket> TrimAudioEnd(List<EncodedPacket> audioPackets, TimeSpan lastVideoPts)
    {
        if (audioPackets.Count == 0) return audioPackets;

        int trimAt = audioPackets.Count;
        for (int i = 0; i < audioPackets.Count; i++)
        {
            if (audioPackets[i].Pts + audioPackets[i].Duration > lastVideoPts)
            {
                trimAt = i;
                break;
            }
        }

        return trimAt < audioPackets.Count ? audioPackets.GetRange(0, trimAt) : audioPackets;
    }

    internal static int FindTrailingFrozenFrames(List<EncodedPacket> videoPackets, TimeSpan minFreezeDuration, int nominalFps)
    {
        for (int i = videoPackets.Count - 1; i > 0; i--)
        {
            var gap = videoPackets[i].Pts - (videoPackets[i - 1].Pts + videoPackets[i - 1].Duration);
            if (gap >= minFreezeDuration)
            {
                int trailingFrames = videoPackets.Count - i;
                if (trailingFrames > videoPackets.Count / 2)
                {
                    Log.W("PTS", $"FindTrailingFrozenFrames: gap at frame #{i} of {gap.TotalSeconds:F3}s but {trailingFrames}/{videoPackets.Count} frames would be discarded — assuming buffer boundary, keeping all frames");
                    return videoPackets.Count;
                }
                Log.I("PTS", $"FindTrailingFrozenFrames: gap at frame #{i} of {gap.TotalSeconds:F3}s — truncating {trailingFrames} trailing frames");
                return i;
            }
        }

        return videoPackets.Count;
    }

    internal static List<EncodedPacket> PadAudioWithSilence(List<EncodedPacket> audioPackets, int sampleRate, int channels = 2, TimeSpan? expectedStart = null)
    {
        if (audioPackets.Count == 0) return audioPackets;

        long durTicks = 1024L * 10_000_000 / sampleRate;
        var gapThreshold = TimeSpan.FromMilliseconds(30);

        var result = new List<EncodedPacket>(audioPackets.Count * 2);

        // If expectedStart is set and audio starts later (e.g. WASAPI init delay), pad silence upfront
        var expectedPts = expectedStart ?? audioPackets[0].Pts;
        if (expectedStart.HasValue && audioPackets[0].Pts > expectedStart.Value + gapThreshold)
        {
            var gapSec = (audioPackets[0].Pts - expectedStart.Value).TotalSeconds;
            int silentFrames = (int)(gapSec * sampleRate / 1024.0); // floor — remaining sub-frame gap handled by in-loop check
            if (silentFrames > 0)
            {
                Log.I("PTS", $"PadAudioWithSilence: inserting {silentFrames} silent frames at start for init delay gap of {gapSec:F3}s");
                result.AddRange(GenerateSilentAacFrames(silentFrames, expectedStart.Value, sampleRate, channels));
                expectedPts = expectedStart.Value + TimeSpan.FromTicks(durTicks * silentFrames);
            }
        }

        foreach (var pkt in audioPackets)
        {
            // Insert silence at any PTS gap > 30ms (e.g. alt-tab gaps, buffer eviction gaps)
            if (pkt.Pts > expectedPts + gapThreshold)
            {
                var gapSec = (pkt.Pts - expectedPts).TotalSeconds;
                int silentFrames = (int)Math.Ceiling(gapSec * sampleRate / 1024.0);
                result.AddRange(GenerateSilentAacFrames(silentFrames, expectedPts, sampleRate, channels));
            }
            result.Add(pkt);
            expectedPts = pkt.Pts + pkt.Duration;
        }

        return result;
    }

    internal static byte[] ConvertAvccToAnnexB(byte[] avccData, int dataLength)
    {
        // Count NALUs to allocate exact buffer size
        int nalCount = 0;
        int pos = 0;
        while (pos + 4 <= dataLength)
        {
            int nalLen = (avccData[pos] << 24) | (avccData[pos + 1] << 16) | (avccData[pos + 2] << 8) | avccData[pos + 3];
            if (nalLen <= 0 || pos + 4 + nalLen > dataLength) break;
            nalCount++;
            pos += 4 + nalLen;
        }

        if (nalCount == 0) return avccData[..dataLength];

        int annexBSize = dataLength - nalCount * 4 + nalCount * 3; // replace 4-byte len with 3-byte sc
        var result = new byte[annexBSize];
        int srcPos = 0;
        int dstPos = 0;

        while (srcPos + 4 <= dataLength)
        {
            int nalLen = (avccData[srcPos] << 24) | (avccData[srcPos + 1] << 16) | (avccData[srcPos + 2] << 8) | avccData[srcPos + 3];
            if (nalLen <= 0 || srcPos + 4 + nalLen > dataLength) break;

            // Write start code (0x00 0x00 0x01) instead of 4-byte length
            result[dstPos] = 0;
            result[dstPos + 1] = 0;
            result[dstPos + 2] = 1;
            dstPos += 3;

            // Copy NAL data
            System.Buffer.BlockCopy(avccData, srcPos + 4, result, dstPos, nalLen);
            srcPos += 4 + nalLen;
            dstPos += nalLen;
        }

        return result;
    }

    internal static byte[]? ExtractAvccExtradata(List<EncodedPacket> packets)
    {
        // Scan video packets for SPS (type 7) and PPS (type 8) NAL units.
        // Data is in AVCC format: 4-byte big-endian length prefix + NAL unit.
        byte[]? sps = null, pps = null;
        foreach (var pkt in packets)
        {
            if (pkt.Type != MediaType.Video) continue;
            var data = pkt.Data;
            int len = pkt.DataLength;
            int pos = 0;
            while (pos + 4 <= len)
            {
                int nalLen = (data[pos] << 24) | (data[pos + 1] << 16) | (data[pos + 2] << 8) | data[pos + 3];
                if (nalLen <= 0 || pos + 4 + nalLen > len) break;
                int nalStart = pos + 4;
                int nalType = data[nalStart] & 0x1F;

                if (nalType == 7 && sps == null)
                {
                    sps = new byte[nalLen];
                    System.Buffer.BlockCopy(data, nalStart, sps, 0, nalLen);
                }
                else if (nalType == 8 && pps == null)
                {
                    pps = new byte[nalLen];
                    System.Buffer.BlockCopy(data, nalStart, pps, 0, nalLen);
                }

                pos = nalStart + nalLen;
            }
            if (sps != null && pps != null) break;
        }

        if (sps == null || pps == null) return null;

        return BuildAvcc(sps, pps);
    }

    internal static byte[]? BuildAvcc(byte[] sps, byte[] pps)
    {
        if (sps.Length < 4 || pps.Length == 0) return null;

        // Bug 3 fix: Use sps directly — emulation prevention bytes (0x03) are part
        // of the NAL unit syntax and MUST be preserved in the avcC record per ISO 14496-15 Section 5.3.3.1.2.

        int avccLen = 5 + 1 + 2 + sps.Length + 1 + 2 + pps.Length;
        var avcc = new byte[avccLen];
        avcc[0] = 1;
        avcc[1] = sps[1];
        avcc[2] = sps[2];
        avcc[3] = sps[3];
        avcc[4] = 0xFC | 3;
        avcc[5] = 0xE0 | 1;
        avcc[6] = (byte)(sps.Length >> 8);
        avcc[7] = (byte)(sps.Length & 0xFF);
        System.Buffer.BlockCopy(sps, 0, avcc, 8, sps.Length);
        int off = 8 + sps.Length;
        avcc[off] = 1;
        avcc[off + 1] = (byte)(pps.Length >> 8);
        avcc[off + 2] = (byte)(pps.Length & 0xFF);
        System.Buffer.BlockCopy(pps, 0, avcc, off + 3, pps.Length);
        return avcc;
    }

    internal static byte[] RemoveEmulationPrevention(byte[] nal)
    {
        int count = 0;
        for (int i = 2; i < nal.Length; i++)
            if (nal[i - 2] == 0 && nal[i - 1] == 0 && nal[i] == 3)
                count++;

        if (count == 0) return nal;

        var result = new byte[nal.Length - count];
        int ri = 0;
        for (int i = 0; i < nal.Length; i++)
        {
            if (i >= 2 && nal[i - 2] == 0 && nal[i - 1] == 0 && nal[i] == 3)
                continue;
            result[ri++] = nal[i];
        }
        return result;
    }

    internal static byte[]? ExtractHvccExtradata(List<EncodedPacket> packets)
    {
        byte[]? vps = null, sps = null, pps = null;
        foreach (var pkt in packets)
        {
            if (pkt.Type != MediaType.Video) continue;
            var data = pkt.Data;
            int len = pkt.DataLength;
            int pos = 0;
            while (pos + 4 <= len)
            {
                int nalLen = (data[pos] << 24) | (data[pos + 1] << 16) | (data[pos + 2] << 8) | data[pos + 3];
                if (nalLen <= 0 || pos + 4 + nalLen > len) break;
                int nalStart = pos + 4;
                int nalType = (data[nalStart] >> 1) & 0x3F;

                if (nalType == 32 && vps == null)
                {
                    vps = new byte[nalLen];
                    System.Buffer.BlockCopy(data, nalStart, vps, 0, nalLen);
                }
                else if (nalType == 33 && sps == null)
                {
                    sps = new byte[nalLen];
                    System.Buffer.BlockCopy(data, nalStart, sps, 0, nalLen);
                }
                else if (nalType == 34 && pps == null)
                {
                    pps = new byte[nalLen];
                    System.Buffer.BlockCopy(data, nalStart, pps, 0, nalLen);
                }

                pos = nalStart + nalLen;
            }
            if (vps != null && sps != null && pps != null) break;
        }

        if (vps == null || sps == null || pps == null) return null;
        return BuildHvcc(vps, sps, pps);
    }

    internal static byte[]? BuildHvcc(byte[] vps, byte[] sps, byte[] pps)
    {
        // Bug 3 fix: Use vps/sps/pps directly — emulation prevention bytes preserved per spec.
        // G3: guarda de tamanho mínimo (equivale ao BuildAvcc guard) — streams HEVC
        // truncados ou corruptos podem ter SPS curto; sem isto, sps[12] lança
        // IndexOutOfRangeException e o clipe inteiro é perdido silenciosamente.
        if (vps.Length < 4 || sps.Length < 13 || pps.Length < 1) return null;

        int profileSpace = (sps[0] >> 6) & 0x03;
        bool tierFlag = (sps[0] & 0x20) != 0;
        int profileIdc = sps[0] & 0x1F;
        int generalProfileCompat = (sps[1] << 24) | (sps[2] << 16) | (sps[3] << 8) | sps[4];
        int generalLevelIdc = sps[12];

        // G3: len subestimado em 6 bytes — o cálculo anterior contava 23 como header total
        // mas só incluía os 3 bytes NAL (type+2) do VPS; SPS e PPS adicionam mais 3+2 cada.
        // Correct: 20 (profile) + 3*(NAL header+length) = 20 + 3*5 = 35, then + data.
        int len = 35 + vps.Length + sps.Length + pps.Length;
        var hvcc = new byte[len];
        hvcc[0] = 1;
        hvcc[1] = (byte)((profileSpace << 6) | (tierFlag ? 0x20 : 0) | profileIdc);
        hvcc[2] = (byte)(generalProfileCompat >> 24);
        hvcc[3] = (byte)(generalProfileCompat >> 16);
        hvcc[4] = (byte)(generalProfileCompat >> 8);
        hvcc[5] = (byte)generalProfileCompat;
        hvcc[10] = (byte)generalLevelIdc;
        hvcc[11] = 0xF0;
        hvcc[12] = 0xFC;
        hvcc[13] = 0xFC;
        hvcc[14] = 0xF8;
        hvcc[15] = 0xF8;
        hvcc[16] = 0; hvcc[17] = 0;
        hvcc[18] = 0x0F;
        hvcc[19] = 3;

        int off = 20;
        hvcc[off++] = 0x20;
        hvcc[off++] = 0; hvcc[off++] = 1;
        hvcc[off++] = (byte)(vps.Length >> 8);
        hvcc[off++] = (byte)(vps.Length & 0xFF);
        System.Buffer.BlockCopy(vps, 0, hvcc, off, vps.Length);
        off += vps.Length;

        hvcc[off++] = 0x21;
        hvcc[off++] = 0; hvcc[off++] = 1;
        hvcc[off++] = (byte)(sps.Length >> 8);
        hvcc[off++] = (byte)(sps.Length & 0xFF);
        System.Buffer.BlockCopy(sps, 0, hvcc, off, sps.Length);
        off += sps.Length;

        hvcc[off++] = 0x22;
        hvcc[off++] = 0; hvcc[off++] = 1;
        hvcc[off++] = (byte)(pps.Length >> 8);
        hvcc[off++] = (byte)(pps.Length & 0xFF);
        System.Buffer.BlockCopy(pps, 0, hvcc, off, pps.Length);

        return hvcc;
    }

    internal static byte[]? ExtractAv1Extradata(List<EncodedPacket> packets)
    {
        foreach (var pkt in packets)
        {
            if (pkt.Type != MediaType.Video) continue;
            var data = pkt.Data;
            int len = pkt.DataLength;
            int pos = 0;

            while (pos < len)
            {
                if (pos + 2 > len) break;
                int headerByte = data[pos];
                int obuType = (headerByte >> 3) & 0x0F;
                bool obuExtension = (headerByte & 0x04) != 0;
                int headerLen = 1 + (obuExtension ? 1 : 0);

                int sizeStart = pos + headerLen;
                if (sizeStart >= len) break;
                ulong obuSize = 0;
                int shift = 0;
                int sizeIdx = sizeStart;
                while (sizeIdx < len && shift < 64)
                {
                    byte b = data[sizeIdx++];
                    obuSize |= (ulong)(b & 0x7F) << shift;
                    shift += 7;
                    if ((b & 0x80) == 0) break;
                }

                int obuStart = sizeIdx;
                int obuEnd = obuStart + (int)obuSize;
                if (obuEnd > len) break;

                if (obuType == 1)
                {
                    // Return the complete raw Sequence Header OBU (header + extensions + LEB128 size + payload).
                    // FFmpeg's ff_av1_parse_seq_header handles raw OBU data (buf[0] & 0x80 == 0) and
                    // derives profile/level/bitdepth, so libdav1d/muxers parse it correctly. A synthetic
                    // 4-byte av1C (0x00 marker flag off + reserved seq_level_idx_0 0x1F) made ffmpeg treat
                    // it as raw OBU data and fail with "No sequence header available" (AVERROR_INVALIDDATA).
                    int obuLen = obuEnd - pos;
                    var seqHeader = new byte[obuLen];
                    System.Buffer.BlockCopy(data, pos, seqHeader, 0, obuLen);
                    return seqHeader;
                }

                pos = obuEnd;
            }
        }
        return null;
    }

    /// <summary>
    /// Re-timestamps video and audio packets to produce a contiguous output timeline.
    /// After FilterAudioByIntervals removes audio during video gaps (alt-tab),
    /// the Matroska file still has gapped timestamps. This function maps each
    /// active video interval to a contiguous output range and shifts audio PTS
    /// accordingly, producing a seamless MP4 without timestamp jumps.
    /// </summary>
    internal static void ReTimestampToContiguous(
        List<EncodedPacket> videoPackets,
        List<EncodedPacket> audioPackets,
        List<(TimeSpan start, TimeSpan end)> intervals)
    {
        if (intervals.Count == 0 || videoPackets.Count == 0) return;

        // Build contiguous output timeline from video intervals
        var outputStarts = new TimeSpan[intervals.Count];
        var outPts = TimeSpan.Zero;
        for (int i = 0; i < intervals.Count; i++)
        {
            outputStarts[i] = outPts;
            outPts += (intervals[i].end - intervals[i].start);
        }

        // Re-map video PTS in-place — no allocation
        for (int i = 0; i < videoPackets.Count; i++)
        {
            videoPackets[i].Pts = RemapPts(videoPackets[i].Pts, intervals, outputStarts);
        }

        // Re-map audio PTS in-place — no allocation
        for (int i = 0; i < audioPackets.Count; i++)
        {
            audioPackets[i].Pts = RemapPts(audioPackets[i].Pts, intervals, outputStarts);
        }

        // When the remapped audio span differs in length from the video span,
        // rate-scale the audio so its end aligns with the video end while
        // preserving the audio start. Equal spans keep remapped values as-is.
        if (audioPackets.Count > 0)
        {
            var aNow = audioPackets[^1].Pts + audioPackets[^1].Duration;
            var vNow = videoPackets[^1].Pts + videoPackets[^1].Duration;
            if (aNow != vNow)
            {
                var audioStart = audioPackets[0].Pts;
                var audioSpan = aNow - audioStart;
                if (audioSpan > TimeSpan.Zero)
                {
                    double factor = (vNow - audioStart).TotalSeconds / audioSpan.TotalSeconds;
                    for (int i = 0; i < audioPackets.Count; i++)
                    {
                        var rel = (audioPackets[i].Pts - audioStart).TotalSeconds * factor;
                        audioPackets[i].Pts = audioStart + TimeSpan.FromSeconds(rel);
                        audioPackets[i].Duration = TimeSpan.FromSeconds(
                            audioPackets[i].Duration.TotalSeconds * factor);
                    }
                }
            }
        }
    }

    private static TimeSpan RemapPts(
        TimeSpan pts,
        List<(TimeSpan start, TimeSpan end)> intervals,
        TimeSpan[] outputStarts)
    {
        for (int j = 0; j < intervals.Count; j++)
        {
            if (pts >= intervals[j].start && pts < intervals[j].end)
                return outputStarts[j] + (pts - intervals[j].start);
            if (pts < intervals[j].start)
                return outputStarts[j];
        }
        return outputStarts[^1] + (pts - intervals[^1].start);
    }

    internal static void WriteH264AnnexBFile(string path, List<EncodedPacket> videoPackets, string rawFormat = "h264", byte[]? vps = null, byte[]? sps = null, byte[]? pps = null)
    {
        using var fs = new FileStream(path, FileMode.Create, FileAccess.Write,
            FileShare.Read, 256 * 1024, FileOptions.SequentialScan);

        bool loggedFirst = false;

        // Prepend VPS + SPS + PPS cached from encoder (in case ReplayBuffer evicted initial frames).
        // For HEVC: VPS (type 32) must come first, then SPS (33), then PPS (34).
        // For H264: SPS (type 7) then PPS (type 8).
        // Without these at the start of the raw stream, ffmpeg's demuxer cannot decode
        // any frame — "non-existing PPS 0 referenced".
        if (rawFormat == "hevc" && vps != null && vps.Length > 0)
        {
            fs.Write([0x00, 0x00, 0x00, 0x01], 0, 4);
            fs.Write(vps, 0, vps.Length);
            loggedFirst = true;
            Log.I("Exporter", $"Prepended VPS ({vps.Length}B) from encoder cache");
        }
        if (sps != null && sps.Length > 0)
        {
            fs.Write([0x00, 0x00, 0x00, 0x01], 0, 4);
            fs.Write(sps, 0, sps.Length);
            loggedFirst = true;
            Log.I("Exporter", $"Prepended SPS ({sps.Length}B) from encoder cache");
        }
        if (pps != null && pps.Length > 0)
        {
            fs.Write([0x00, 0x00, 0x00, 0x01], 0, 4);
            fs.Write(pps, 0, pps.Length);
            loggedFirst = true;
            Log.I("Exporter", $"Prepended PPS ({pps.Length}B) from encoder cache");
        }

        bool loggedFirstFrame = false;
        foreach (var pkt in videoPackets)
        {
            if (pkt.Type != MediaType.Video) continue;

            // Data is in AVCC format (4-byte length-prefixed NALUs).
            // Convert to AnnexB (start-code delimited) for raw .h264 mux.
            var annexB = ConvertAvccToAnnexB(pkt.Data, pkt.DataLength);
            fs.Write(annexB, 0, annexB.Length);

            if (!loggedFirstFrame && !loggedFirst)
            {
                loggedFirstFrame = true;
                var hex = new System.Text.StringBuilder();
                int dumpLen = Math.Min(annexB.Length, 128);
                for (int i = 0; i < dumpLen; i++)
                    hex.Append($"{annexB[i]:X2} ");
                Log.I("Exporter", $"AnnexB first frame: len={annexB.Length}B hex={hex.ToString().Trim()}");
            }
        }
    }

    internal static byte[]? BuildAudioSpecificConfig(EncodedPacket audioPkt)
    {
        if (audioPkt.Data == null || audioPkt.DataLength < 5) return null;
        var data = audioPkt.Data;
        if (data[0] != 0xFF || (data[1] & 0xF0) != 0xF0) return null; // not ADTS

        int profile = (data[2] >> 6) & 0x03;
        int sampleRateIdx = (data[2] >> 2) & 0x0F;
        int channelConfig = ((data[2] & 0x01) << 2) | ((data[3] >> 6) & 0x03);
        int audioObjectType = profile + 1;

        return [ (byte)((audioObjectType << 3) | (sampleRateIdx >> 1)),
                 (byte)(((sampleRateIdx & 0x01) << 7) | (channelConfig << 3)) ];
    }
}
