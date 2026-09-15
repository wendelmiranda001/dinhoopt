using System.Runtime.InteropServices;
using DiNho.Capture.Poc.Encoders;
using DiNho.Capture.Poc.Logging;

namespace DiNho.Capture.Poc.Buffer;

/// <summary>
/// Segment-based temp file store for evicted EncodedPacket data.
///
/// When the in-memory ReplayBuffer exceeds its byte budget, packets are spilled
/// to disk so GetSegments() can still return the full requested duration.
///
/// Design goals (fixes the 76s pipeline stall from 2026-08-01):
///  - A single persistent FileStream is kept open for the active segment and
///    reused across writes — no open/close per evicted frame.
///  - Data is written in fixed-size segment files; trimming only removes index
///    entries and deletes segments that become fully consumed. The file is
///    never rewritten (no lazy compaction), so no operation reads+rewrites the
///    whole spill under any lock.
///  - All public operations serialize on a private lock (<see cref="_sync"/>)
///    so long I/O never runs under ReplayBuffer's write lock.
/// </summary>
public sealed class DiskSpillBuffer : IDisposable
{
    internal const int DefaultSegmentBytes = 64 * 1024 * 1024;
    private const int BufferSize = 64 * 1024;

    private readonly string _dir;
    private readonly string _id;
    private readonly int _segmentBytes;
    private readonly Lock _sync = new();
    private readonly List<SpillEntry> _index = new();
    private FileStream? _activeStream;
    private int _activeSegment = -1;
    private int _maxSegmentCreated = -1;
    private bool _disposed;
    private long _totalBytes;
    private long _totalVideoBytes;
    private long _totalAudioBytes;
    private int _videoCount;
    private int _audioCount;

    private readonly record struct SpillEntry(
        int Segment,
        long Offset,
        int Length,
        MediaType Type,
        TimeSpan Pts,
        TimeSpan Duration,
        bool IsKeyFrame,
        int Width,
        int Height,
        bool IsPcm);

    public DiskSpillBuffer(string? tempDir = null)
        : this(tempDir, DefaultSegmentBytes)
    {
    }

    internal DiskSpillBuffer(string? tempDir, int segmentBytes)
    {
        _dir = tempDir ?? Path.GetTempPath();
        _id = Guid.NewGuid().ToString("N")[..8];
        _segmentBytes = segmentBytes > 0 ? segmentBytes : DefaultSegmentBytes;
    }

    public int Count
    {
        get { lock (_sync) return _index.Count; }
    }

    public long TotalBytes
    {
        get { lock (_sync) return _totalBytes; }
    }

    public int VideoCount
    {
        get { lock (_sync) return _videoCount; }
    }

    public int AudioCount
    {
        get { lock (_sync) return _audioCount; }
    }

    private string SegmentPath(int segment) => Path.Combine(_dir, $"dinho-spill-{_id}-{segment:000000}.bin");

    /// <summary>
    /// Append a packet's raw bytes and metadata to the active segment.
    /// O(1) per frame — the segment FileStream stays open across writes.
    /// </summary>
    public void Write(EncodedPacket packet)
    {
        lock (_sync)
        {
            if (_disposed) return;

            EnsureActiveSegment();
            var stream = _activeStream!;
            long offset = stream.Position;

            int dataLen;
            var pcm = packet.PcmSamples;
            bool isPcm = pcm is { Length: > 0 };
            if (isPcm)
            {
                dataLen = pcm!.Length * sizeof(float);
                stream.Write(MemoryMarshal.AsBytes(pcm.AsSpan()));
            }
            else
            {
                dataLen = packet.DataLength;
                stream.Write(packet.Data, 0, dataLen);
            }

            _index.Add(new SpillEntry(
                _activeSegment, offset, dataLen, packet.Type, packet.Pts,
                packet.Duration, packet.IsKeyFrame, packet.Width, packet.Height, isPcm));

            _totalBytes += dataLen;
            if (packet.Type == MediaType.Video)
            {
                _videoCount++;
                _totalVideoBytes += dataLen;
            }
            else
            {
                _audioCount++;
                _totalAudioBytes += dataLen;
            }

            if (stream.Position >= _segmentBytes)
                CloseActiveStream();
        }
    }

    /// <summary>
    /// Read all spilled packets, reconstructed as EncodedPacket objects.
    /// Returns packets sorted by PTS (oldest first).
    /// </summary>
    public List<EncodedPacket> ReadAll()
    {
        lock (_sync)
        {
            if (_disposed || _index.Count == 0) return new List<EncodedPacket>();
            return ReadRange(0, _index.Count);
        }
    }

    /// <summary>
    /// Drop spilled packets older than <paramref name="maxAge"/> relative to the
    /// newest spilled packet (sliding time window, like ShadowPlay/Medal). The
    /// retained window is aligned to the oldest keyframe within it so the
    /// surviving stream starts at a decodable frame.
    ///
    /// Trimming is O(removed) index work + deletion of segment files that are
    /// fully consumed. No file is ever rewritten — this is what makes spill I/O
    /// safe to run outside ReplayBuffer's write lock (no full-file compaction).
    /// </summary>
    /// <returns>The number of entries removed.</returns>
    public int TrimOldest(TimeSpan maxAge)
    {
        lock (_sync)
        {
            if (_disposed || _index.Count == 0) return 0;

            var lastPts = _index[^1].Pts;
            var cutoff = lastPts - maxAge;
            if (cutoff < TimeSpan.Zero) cutoff = TimeSpan.Zero;

            // Fast path: nothing is older than the window.
            if (_index[0].Pts >= cutoff) return 0;

            // Align the retained window to the oldest keyframe >= cutoff.
            int splitIdx = -1;
            for (int i = 0; i < _index.Count; i++)
            {
                if (_index[i].Pts < cutoff) continue;
                if (_index[i].Type == MediaType.Video && _index[i].IsKeyFrame)
                {
                    splitIdx = i;
                    break;
                }
            }

            if (splitIdx < 0)
            {
                // No keyframe inside the retained region — fall back to the PTS
                // cutoff (same window semantics as GetSegments).
                for (int i = 0; i < _index.Count; i++)
                {
                    if (_index[i].Pts >= cutoff)
                    {
                        splitIdx = i;
                        break;
                    }
                }
                if (splitIdx < 0) splitIdx = _index.Count; // entire spill older than window
            }

            if (splitIdx == 0) return 0;

            // Incremental accounting: subtract only the removed entries instead of
            // recomputing the whole index on every trim (RecomputeCounts was O(n)
            // per evicted frame — with video near the budget cap that meant an
            // O(n) scan per frame on the capture thread).
            long removedBytes = 0;
            int removedVideo = 0, removedAudio = 0;
            long removedVideoBytes = 0, removedAudioBytes = 0;
            for (int i = 0; i < splitIdx; i++)
            {
                var removedEntry = _index[i];
                removedBytes += removedEntry.Length;
                if (removedEntry.Type == MediaType.Video) { removedVideo++; removedVideoBytes += removedEntry.Length; }
                else { removedAudio++; removedAudioBytes += removedEntry.Length; }
            }

            _index.RemoveRange(0, splitIdx);
            _totalBytes -= removedBytes;
            _totalVideoBytes -= removedVideoBytes;
            _totalAudioBytes -= removedAudioBytes;
            _videoCount -= removedVideo;
            _audioCount -= removedAudio;
            DeleteFullyConsumedSegments();

            return splitIdx;
        }
    }

    /// <summary>
    /// Remove orphaned spill files (dinho-spill-*.bin / dinho-spill-*.idx)
    /// left behind by crashed sessions. Called once at engine startup.
    /// Only our own temp files are deleted — unrelated files and directories
    /// are never touched.
    /// </summary>
    /// <returns>The number of files removed.</returns>
    public static int CleanupOrphans(string? tempDir = null)
    {
        var dir = tempDir ?? Path.GetTempPath();
        int removed = 0;
        try
        {
            foreach (var file in Directory.EnumerateFiles(dir, "dinho-spill-*"))
            {
                var ext = Path.GetExtension(file);
                if (ext is not (".bin" or ".idx")) continue;
                try
                {
                    File.Delete(file);
                    removed++;
                }
                catch { /* best effort — a live spill may be in use (Windows locks) */ }
            }
        }
        catch { /* temp directory may not exist */ }
        return removed;
    }

    /// <summary>
    /// Remove all spilled data and delete temp files.
    /// </summary>
    public void Clear()
    {
        lock (_sync)
        {
            _index.Clear();
            CloseActiveStream();
            for (int s = 0; s <= _maxSegmentCreated; s++)
                TryDeleteSegment(s);
            _activeSegment = -1;
            _maxSegmentCreated = -1;
            _totalBytes = 0;
            _totalVideoBytes = 0;
            _totalAudioBytes = 0;
            _videoCount = 0;
            _audioCount = 0;
        }
    }

    public void Dispose()
    {
        lock (_sync)
        {
            if (_disposed) return;
            _disposed = true;
            Clear();
        }
    }

    private void EnsureActiveSegment()
    {
        if (_activeStream != null && _activeStream.Position < _segmentBytes) return;
        CloseActiveStream();
        _activeSegment++;
        if (_activeSegment > _maxSegmentCreated) _maxSegmentCreated = _activeSegment;
        _activeStream = new FileStream(SegmentPath(_activeSegment), FileMode.Create, FileAccess.Write, FileShare.ReadWrite, BufferSize);
    }

    private void CloseActiveStream()
    {
        if (_activeStream == null) return;
        try { _activeStream.Flush(false); }
        catch (Exception ex) { Log.W("DiskSpillBuffer", $"CloseActiveStream Flush failed: {ex.GetType().Name}: {ex.Message}"); }
        try { _activeStream.Close(); }
        catch (Exception ex) { Log.W("DiskSpillBuffer", $"CloseActiveStream Close failed: {ex.GetType().Name}: {ex.Message}"); }
        _activeStream = null;
    }

    private void FlushActive()
    {
        try { _activeStream?.Flush(false); }
        catch (Exception ex) { Log.W("DiskSpillBuffer", $"FlushActive failed: {ex.GetType().Name}: {ex.Message}"); }
    }

    /// <summary>
    /// Force buffered writes to disk. Used by tests to make physical file size
    /// observable (the FileStream buffers 64KB, so Length is 0 until flushed)
    /// and by any consumer that needs the spill durable without disposing.
    /// </summary>
    public void Flush()
    {
        lock (_sync)
        {
            FlushActive();
        }
    }

    /// <summary>
    /// Reconstruct packets for index entries [startIdx, startIdx + count).
    /// Video is read into VideoPacketPool arrays; audio into non-pooled byte
    /// buffers that are converted to float PCM (matching ReplayBuffer usage).
    /// </summary>
    private List<EncodedPacket> ReadRange(int startIdx, int count)
    {
        var result = new List<EncodedPacket>(count);
        if (count == 0) return result;

        FlushActive();
        int lastSeg = -1;
        FileStream? segStream = null;
        try
        {
            for (int i = startIdx; i < startIdx + count; i++)
            {
                var entry = _index[i];
                if (entry.Segment != lastSeg)
                {
                    segStream?.Close();
                    segStream = new FileStream(SegmentPath(entry.Segment), FileMode.Open, FileAccess.Read, FileShare.ReadWrite, BufferSize);
                    lastSeg = entry.Segment;
                }

                segStream!.Seek(entry.Offset, SeekOrigin.Begin);
                var buf = entry.Type == MediaType.Video
                    ? VideoPacketPool.Rent(entry.Length)
                    : new byte[entry.Length];
                int read = 0;
                while (read < entry.Length)
                {
                    int n = segStream.Read(buf, read, entry.Length - read);
                    if (n == 0) break;
                    read += n;
                }

                // G3: leitura parcial de segmento truncado (crash durante Write, disco cheio,
                // segmento deletado por CleanupOrphans) — antes aceitava silenciosamente bytes
                // stale do pool; agora trunca efetivamente e loga para diagnóstico.
                if (read < entry.Length)
                    Log.W("DiskSpillBuffer", $"Partial read: {read}/{entry.Length} bytes seg={entry.Segment} — truncando");

                int effectiveLength = read;

                if (entry.Type == MediaType.Audio)
                {
                    // Production audio is always AAC ADTS bytes (PcmSamples == null).
                    if (entry.IsPcm)
                    {
                        var pcm = new float[effectiveLength / sizeof(float)];
                        SysCopyBlock(buf, 0, pcm, 0, effectiveLength);
                        result.Add(new EncodedPacket(pcm, entry.Type, entry.Pts, entry.Duration));
                    }
                    else
                    {
                        result.Add(new EncodedPacket(buf, entry.Type, entry.Pts, entry.Duration,
                            isKeyFrame: false, isPooled: false, width: 0, height: 0, effectiveLength));
                    }
                }
                else
                {
                    result.Add(new EncodedPacket(buf, entry.Type, entry.Pts, entry.Duration,
                        entry.IsKeyFrame, isPooled: true, entry.Width, entry.Height, effectiveLength));
                }
            }

            return result;
        }
        finally
        {
            segStream?.Close();
        }
    }

    private void DeleteFullyConsumedSegments()
    {
        if (_index.Count == 0)
        {
            // Everything removed — drop every segment file (no holes remain).
            CloseActiveStream();
            for (int s = 0; s <= _maxSegmentCreated; s++)
                TryDeleteSegment(s);
            _activeSegment = -1;
            _maxSegmentCreated = -1;
            return;
        }

        // Segments below the oldest live entry hold no index references anymore.
        int minSeg = _index[0].Segment;
        for (int s = 0; s < minSeg; s++)
            TryDeleteSegment(s);
    }

    private void TryDeleteSegment(int segment)
    {
        try
        {
            var path = SegmentPath(segment);
            if (File.Exists(path)) File.Delete(path);
        }
        catch { /* best effort — a live read/write may hold the handle */ }
    }

    // Avoid Buffer.BlockCopy — the "Buffer" namespace shadows System.Buffer
    private static void SysCopyBlock(float[] src, int srcOffset, byte[] dst, int dstOffset, int count)
    {
        var span = MemoryMarshal.AsBytes(src.AsSpan(srcOffset, count / sizeof(float)));
        span.CopyTo(dst.AsSpan(dstOffset, count));
    }

    private static void SysCopyBlock(byte[] src, int srcOffset, float[] dst, int dstOffset, int count)
    {
        var span = src.AsSpan(srcOffset, count);
        MemoryMarshal.Cast<byte, float>(span).CopyTo(dst.AsSpan(dstOffset, count / sizeof(float)));
    }
}
