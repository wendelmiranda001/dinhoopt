using DiNho.Capture.Poc.Logging;
using System.Text;
using System.Threading;
using DiNho.Capture.Poc.Encoders;

namespace DiNho.Capture.Poc.Export;

public sealed partial class ClipExporter
{
    private static void WriteEbmlMaster(BinaryWriter bw, uint id, Action<BinaryWriter> body)
    {
        var ms = new MemoryStream();
        using (var inner = new BinaryWriter(ms))
        {
            body(inner);
        }
        var data = ms.ToArray();
        WriteEbmlId(bw, id);
        WriteEbmlVint(bw, (ulong)data.Length);
        bw.Write(data);
    }

    private static void WriteEbmlMasterBegin(BinaryWriter bw, uint id)
    {
        WriteEbmlId(bw, id);
        bw.Write((byte)0xFF); // 1-byte VINT → all 7 data bits = 1 = unknown size
    }

    private static void WriteEbmlId(BinaryWriter bw, uint id)
    {
        if (id >= 0x10000000) bw.Write((byte)(id >> 24));
        if (id >= 0x100000) bw.Write((byte)(id >> 16));
        if (id >= 0x100) bw.Write((byte)(id >> 8));
        bw.Write((byte)id);
    }

    private static void WriteEbmlVint(BinaryWriter bw, ulong value)
    {
        if (value < 0x7F) { bw.Write((byte)(0x80 | value)); return; }
        if (value < 0x3FFF) { bw.Write((byte)(0x40 | (byte)(value >> 8))); bw.Write((byte)(value & 0xFF)); return; }
        if (value < 0x1FFFFF) { bw.Write((byte)(0x20 | (byte)(value >> 16))); bw.Write((byte)((value >> 8) & 0xFF)); bw.Write((byte)(value & 0xFF)); return; }
        if (value < 0x0FFFFFFF) { bw.Write((byte)(0x10 | (byte)(value >> 24))); bw.Write((byte)((value >> 16) & 0xFF)); bw.Write((byte)((value >> 8) & 0xFF)); bw.Write((byte)(value & 0xFF)); return; }
        if (value < 0x07FFFFFFFF) { bw.Write((byte)(0x08 | (byte)(value >> 32))); bw.Write((byte)((value >> 24) & 0xFF)); bw.Write((byte)((value >> 16) & 0xFF)); bw.Write((byte)((value >> 8) & 0xFF)); bw.Write((byte)(value & 0xFF)); return; }
        if (value < 0x03FFFFFFFFFFF) { bw.Write((byte)(0x04 | (byte)(value >> 40))); bw.Write((byte)((value >> 32) & 0xFF)); bw.Write((byte)((value >> 24) & 0xFF)); bw.Write((byte)((value >> 16) & 0xFF)); bw.Write((byte)((value >> 8) & 0xFF)); bw.Write((byte)(value & 0xFF)); return; }
        if (value < 0x01FFFFFFFFFFFFF) { bw.Write((byte)(0x02 | (byte)(value >> 48))); bw.Write((byte)((value >> 40) & 0xFF)); bw.Write((byte)((value >> 32) & 0xFF)); bw.Write((byte)((value >> 24) & 0xFF)); bw.Write((byte)((value >> 16) & 0xFF)); bw.Write((byte)((value >> 8) & 0xFF)); bw.Write((byte)(value & 0xFF)); return; }
        bw.Write((byte)(0x01 | (byte)(value >> 56)));
        bw.Write((byte)((value >> 48) & 0xFF));
        bw.Write((byte)((value >> 40) & 0xFF));
        bw.Write((byte)((value >> 32) & 0xFF));
        bw.Write((byte)((value >> 24) & 0xFF));
        bw.Write((byte)((value >> 16) & 0xFF));
        bw.Write((byte)((value >> 8) & 0xFF));
        bw.Write((byte)(value & 0xFF));
    }

    private static void WriteEbmlUnsignedInt(BinaryWriter bw, uint id, ulong value)
    {
        WriteEbmlId(bw, id);
        if (value <= 0xFF) { WriteEbmlVint(bw, 1); bw.Write((byte)value); }
        else if (value <= 0xFFFF) { WriteEbmlVint(bw, 2); var b = BitConverter.GetBytes((ushort)value); Array.Reverse(b); bw.Write(b); }
        else if (value <= 0xFFFFFFFF) { WriteEbmlVint(bw, 4); var b = BitConverter.GetBytes((uint)value); Array.Reverse(b); bw.Write(b); }
        else { WriteEbmlVint(bw, 8); var b = BitConverter.GetBytes(value); Array.Reverse(b); bw.Write(b); }
    }

    private static void WriteEbmlDouble(BinaryWriter bw, uint id, double value)
    {
        WriteEbmlId(bw, id);
        WriteEbmlVint(bw, 8); // Matroska "float" 64-bit IEEE 754 — Duration em precisão total
        var b = BitConverter.GetBytes(value);
        Array.Reverse(b);
        bw.Write(b);
    }

    private static void WriteEbmlString(BinaryWriter bw, uint id, string value)
    {
        var bytes = Encoding.UTF8.GetBytes(value);
        WriteEbmlId(bw, id);
        WriteEbmlVint(bw, (ulong)bytes.Length);
        bw.Write(bytes);
    }

    private static void WriteEbmlBinary(BinaryWriter bw, uint id, byte[] data)
    {
        WriteEbmlId(bw, id);
        WriteEbmlVint(bw, (ulong)data.Length);
        bw.Write(data);
    }

    /// <summary>
    /// Termina o arquivo com um elemento EBML Void alinhado a 4 bytes (3.12).
    /// Um EOF truncado no meio de bytes não-EBML é tratado como lixo por parsers
    /// estritos; o Void absorve a sobra de alinhamento como elemento válido.
    /// </summary>
    private static void WriteEbmlVoidAlign(BinaryWriter bw, long currentPos)
    {
        int dataLen = (int)(4 - (currentPos + 2) % 4) % 4;
        if (dataLen == 0) return;
        WriteEbmlId(bw, 0xEC); // Void
        WriteEbmlVint(bw, (ulong)dataLen);
        bw.Write(new byte[dataLen]);
    }

    private static void WriteSimpleBlock(BinaryWriter bw, int trackNumber, int timecode, bool keyframe, byte[] data, int dataLength, int dataOffset = 0)
    {
        int payloadSize = 0;
        int trackSize = trackNumber < 0x7F ? 1 : 2;
        payloadSize += trackSize + 2 + 1 + dataLength; // track + timecode + flags + data
        WriteEbmlId(bw, 0xA3);
        WriteEbmlVint(bw, (ulong)payloadSize);

        if (trackNumber < 0x7F)
            bw.Write((byte)(0x80 | trackNumber));
        else
        {
            bw.Write((byte)(0xC0 | (trackNumber >> 8)));
            bw.Write((byte)(trackNumber & 0xFF));
        }

        var tcBytes = BitConverter.GetBytes((short)timecode);
        Array.Reverse(tcBytes);
        bw.Write(tcBytes);

        byte flags = 0;
        if (keyframe) flags |= 0x80;
        bw.Write(flags);

        bw.Write(data, dataOffset, dataLength);
    }

    internal static void WriteMatroskaFile(string path, List<EncodedPacket> packets, string rawFormat, byte[]? avccFallback = null, byte[]? hvccFallback = null, long estimatedSize = 0)
    {
        using var fs = new FileStream(path, FileMode.Create, FileAccess.Write,
            FileShare.Read, 256 * 1024, FileOptions.SequentialScan);
        if (estimatedSize > 0) fs.SetLength(estimatedSize);
        using var bw = new BinaryWriter(fs);

        // Re-baseline PTS so the first frame starts at 0.
        // Áudio NÃO é gravado no MKV (M4): o áudio é exportado num arquivo ADTS
        // separado e mapeado no mux via -f aac. Gravar trilha A_AAC aqui só
        // adicionava parsing do matroskadec (que não seta frame_size para A_AAC)
        // e bytes gastos no temp, além de risco residual de falha de demux.
        var minPts = packets.Count > 0 ? packets[0].Pts : TimeSpan.Zero;
        for (int i = 1; i < packets.Count; i++)
            if (packets[i].Pts < minPts)
                minPts = packets[i].Pts;

        // EBML Header (known-size — ffmpeg must be able to skip it cleanly)
        WriteEbmlMaster(bw, 0x1A45DFA3, (w) =>
        {
            WriteEbmlUnsignedInt(w, 0x4286, 1);  // EBMLVersion
            WriteEbmlUnsignedInt(w, 0x42F7, 1);  // EBMLReadVersion
            WriteEbmlUnsignedInt(w, 0x42F2, 4);  // EBMLMaxIDLength
            WriteEbmlUnsignedInt(w, 0x42F3, 8);  // EBMLMaxSizeLength
            WriteEbmlString(w, 0x4282, "matroska"); // DocType
            WriteEbmlUnsignedInt(w, 0x4287, 4);  // DocTypeVersion
            WriteEbmlUnsignedInt(w, 0x4285, 2);  // DocTypeReadVersion
        });

        // Segment (unknown size — ffmpeg doesn't need it for demux)
        WriteEbmlMasterBegin(bw, 0x18538067); // Segment

        // ── Info (known-size — required for ffmpeg when Segment has unknown size) ──
        WriteEbmlMaster(bw, 0x1549A966, (w) =>
        {
            WriteEbmlUnsignedInt(w, 0x2AD7B1, 1_000_000); // TimecodeScale (1ms)
            double totalSec = 0;
            if (packets.Count >= 2)
                totalSec = (packets[^1].Pts - minPts).TotalSeconds + packets[^1].Duration.TotalSeconds;
            if (totalSec > 0)
                // Duration em ticks de TimecodeScale (1 tick = 1ms) — precisão total (double)
                WriteEbmlDouble(w, 0x4489, totalSec * 1000.0);
            WriteEbmlString(w, 0x4D80, "DiNho Capture"); // MuxingApp
            WriteEbmlString(w, 0x5741, "DiNho Capture"); // WritingApp
        });

        // ── Tracks (known-size) ──
        WriteEbmlMaster(bw, 0x1654AE6B, (w) =>
        {
            // Track 1: Video
            WriteEbmlMaster(w, 0xAE, (tw) =>
        {
            WriteEbmlUnsignedInt(tw, 0xD7, 1);  // TrackNumber
            WriteEbmlUnsignedInt(tw, 0x73C5, 1); // TrackUID
            WriteEbmlUnsignedInt(tw, 0x83, 1);  // TrackType (1=video)
            WriteEbmlUnsignedInt(tw, 0x9A, 0);  // FlagDefault (audio é o default)
            WriteEbmlUnsignedInt(tw, 0x9C, 1);  // FlagLacing
            WriteEbmlString(tw, 0x437E, "und"); // Language (undetermined)
            WriteEbmlString(tw, 0x86, rawFormat switch
            {
                "hevc" => "V_MPEG4/ISO/HEVC",
                "av1" => "V_AV1",
                _ => "V_MPEG4/ISO/AVC"
            }); // CodecID

            // CodecPrivate (avcC for H264, hvcC for HEVC, AV1CodecConfigurationRecord for AV1)
            if (rawFormat == "h264")
            {
                var avcc = avccFallback ?? ExtractAvccExtradata(packets);
                if (avcc != null)
                {
                    Log.I("Exporter", $"avcC len={avcc.Length} source={(avcc == avccFallback ? "encoder" : "packets")}");
                    WriteEbmlBinary(tw, 0x63A2, avcc);
                }
                else
                    Log.W("Exporter", "avcC CodecPrivate not found — MKV may not mux correctly");
            }
            else if (rawFormat == "hevc")
            {
                var hvcc = hvccFallback ?? ExtractHvccExtradata(packets);
                if (hvcc != null)
                {
                    Log.I("Exporter", $"hvcC len={hvcc.Length} source={(hvcc == hvccFallback ? "encoder" : "packets")}");
                    WriteEbmlBinary(tw, 0x63A2, hvcc);
                }
                else
                    Log.W("Exporter", "hvcC CodecPrivate not found — MKV may not mux correctly");
            }
            else if (rawFormat == "av1")
            {
                var av1c = ExtractAv1Extradata(packets);
                if (av1c != null)
                {
                    Log.I("Exporter", $"AV1CodecConfigurationRecord len={av1c.Length}");
                    WriteEbmlBinary(tw, 0x63A2, av1c);
                }
                else
                    Log.W("Exporter", "AV1CodecConfigurationRecord not found — MKV may not mux correctly");
            }

            WriteEbmlMaster(tw, 0xE0, (vw) => // Video
            {
                var vw_ = packets.Count > 0 ? (uint)packets[0].Width : 1920u;
                var vh_ = packets.Count > 0 ? (uint)packets[0].Height : 1080u;
                WriteEbmlUnsignedInt(vw, 0xB0, vw_);  // PixelWidth (mandatory)
                WriteEbmlUnsignedInt(vw, 0xB2, vh_);  // PixelHeight (mandatory)
                WriteEbmlUnsignedInt(vw, 0xB4, vw_);  // DisplayWidth
                WriteEbmlUnsignedInt(vw, 0xBA, vh_);  // DisplayHeight
            });
        });
        }); // fecha WriteEbmlMaster Tracks (Track 2 de áudio removido no M4)

        // ── Diagnostics: log first frame hex ──
        bool loggedFirstFrame = false;

        // ── Clusters (PTS re-baselined to minPts) ──
        int clusterSize = 0;
        const int maxClusterFrames = 1000;
        long clusterBaseTimecode = 0;

        int frameCount = 0;
        foreach (var pkt in packets)
        {
            if (pkt.Type != MediaType.Video) continue;
            if (++frameCount % 60 == 0) Thread.Sleep(1);

            if (!loggedFirstFrame)
            {
                loggedFirstFrame = true;
                var hex = new StringBuilder();
                int dumpLen = Math.Min(pkt.DataLength, 128);
                for (int i = 0; i < dumpLen; i++)
                    hex.Append($"{pkt.Data[i]:X2} ");
                Log.I("Exporter", $"first frame: pts={pkt.Pts.TotalMilliseconds:F0}ms len={pkt.DataLength}B key={pkt.IsKeyFrame} hex={hex.ToString().Trim()}");
            }

            long ptsMs = (pkt.Pts - minPts).Ticks / 10_000; // 100ns → ms, re-baselined

            bool startNew = clusterSize == 0 ||
                            clusterSize >= maxClusterFrames ||
                            ptsMs - clusterBaseTimecode > 30000;

            if (startNew)
            {
                clusterSize = 0;
                clusterBaseTimecode = ptsMs;
                WriteEbmlMasterBegin(bw, 0x1F43B675); // Cluster
                WriteEbmlUnsignedInt(bw, 0xE7, (ulong)ptsMs); // Timecode (re-baselined ms)
                clusterSize = 1;
            }
            else
            {
                clusterSize++;
            }

            int relTc = (int)(ptsMs - clusterBaseTimecode);
            WriteSimpleBlock(bw, 1, relTc, pkt.IsKeyFrame, pkt.Data, pkt.DataLength);
        }

        // G3: truncamento do padding zero — SetLength预allocate ~20% extra; sem truncar,
        // o MKV temporário fica com bytes zero no final (tolerado pelo ffmpeg mas não por
        // players/MediaInfo). SetLength ao tamanho escrito real — Opera NTFS ignora.
        fs.SetLength(fs.Position);
        WriteEbmlVoidAlign(bw, fs.Position);
    }
}
