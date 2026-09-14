using System.Diagnostics;
using System.Threading;
using DiNho.Capture.Poc.Encoders;
using DiNho.Capture.Poc.Logging;

namespace DiNho.Capture.Poc.Buffer;

public sealed class ReplayBuffer : IDisposable
{
    private EncodedPacket?[] _videoPackets;
    private EncodedPacket?[] _audioPackets;
    private int _videoHead;
    private int _videoTail;
    private int _videoCount;
    private int _audioHead;
    private int _audioTail;
    private int _audioCount;
    private TimeSpan _maxDuration;
    private TimeSpan? _videoRamDuration;
    private TimeSpan? _audioRamDuration;
    private long _maxBytes;
    private long _maxVideoBytes;
    private long _maxAudioBytes;
    private readonly ReaderWriterLockSlim _lock = new(LockRecursionPolicy.NoRecursion);
    private TimeSpan _totalVideoDuration;
    private TimeSpan _totalAudioDuration;
    private long _totalVideoBytes;
    private long _totalAudioBytes;
    private DiskSpillBuffer? _spill;
    private bool _diskSpillEnabled;
    private bool _spillAudioWhenEvicted;
    private static long _lastSegmentOffsetLogTick;
    private const double SegmentOffsetWarnMs = 100.0;
    private static readonly long SegmentOffsetLogThrottleTicks = Stopwatch.Frequency * 5;

    public ReplayBuffer(TimeSpan maxDuration, long maxBytes = 0)
    {
        _maxDuration = maxDuration;
        _maxBytes = maxBytes;
        RecalculateProportionalBudgets();
        _videoPackets = new EncodedPacket[4096];
        _audioPackets = new EncodedPacket[1024];
    }

    /// <summary>
    /// Enable disk spill: evicted frames are written to a temp file
    /// instead of being released, allowing GetSegments() to return
    /// durations longer than the RAM budget.
    /// </summary>
    public void EnableDiskSpill(string? tempDir = null)
    {
        _lock.EnterWriteLock();
        try
        {
            if (_diskSpillEnabled) return;
            _spill = new DiskSpillBuffer(tempDir);
            _diskSpillEnabled = true;
        }
        finally { _lock.ExitWriteLock(); }
    }

    public bool IsDiskSpillEnabled
    {
        get
        {
            _lock.EnterReadLock();
            try { return _diskSpillEnabled; }
            finally { _lock.ExitReadLock(); }
        }
    }

    public (int ramVideo, int ramAudio, int diskVideo, int diskAudio, long ramBytes, long diskBytes) SpillStats()
    {
        _lock.EnterReadLock();
        try
        {
            return (_videoCount, _audioCount,
                _spill?.VideoCount ?? 0, _spill?.AudioCount ?? 0,
                _totalVideoBytes + _totalAudioBytes,
                _spill?.TotalBytes ?? 0);
        }
        finally { _lock.ExitReadLock(); }
    }

    private void RecalculateProportionalBudgets()
    {
        // Video tipicamente consome ~90% do budget (frames H.264 grandes),
        // áudio ~10% (AAC compacto). Budgets separados evitam que um stream
        // trime excessivamente o outro, garantindo janelas de tempo balanceadas.
        if (_maxBytes <= 0)
        {
            _maxVideoBytes = _maxAudioBytes = 0;
            return;
        }
        // Proporção 90/10 com base na observação empírica de que AAC a 192kbps
        // é ~5% do bitrate total (NVENC ~15-40 Mbps + AAC 0.192 Mbps).
        // 10% dá folga para áudio sem comprometer vídeo.
        _maxVideoBytes = (long)(_maxBytes * 0.9);
        _maxAudioBytes = _maxBytes - _maxVideoBytes;
    }

    public TimeSpan MaxDuration
    {
        get
        {
            _lock.EnterReadLock();
            try { return _maxDuration; }
            finally { _lock.ExitReadLock(); }
        }
        set
        {
            List<EncodedPacket>? evicted;
            _lock.EnterWriteLock();
            try { _maxDuration = value; evicted = TrimExcess(); }
            finally { _lock.ExitWriteLock(); }
            FlushEvicted(evicted);
        }
    }

    public long MaxBytes
    {
        get
        {
            _lock.EnterReadLock();
            try { return _maxBytes; }
            finally { _lock.ExitReadLock(); }
        }
        set
        {
            List<EncodedPacket>? evicted;
            _lock.EnterWriteLock();
            try
            {
                _maxBytes = value;
                RecalculateProportionalBudgets();
                evicted = TrimExcess();
            }
            finally { _lock.ExitWriteLock(); }
            FlushEvicted(evicted);
        }
    }

    /// <summary>
    /// Hybrid mode RAM cap: limits how much VIDEO the ring retains in RAM.
    /// Excess video older than this window is evicted to the disk spill, while
    /// audio (AAC) always stays RAM-only. Null = RAM holds the full replay
    /// window (legacy 'ram' mode). Setting a value also makes the spill
    /// video-only — evicted audio is dropped instead of written to disk.
    /// </summary>
    public TimeSpan? VideoRamDuration
    {
        get
        {
            _lock.EnterReadLock();
            try { return _videoRamDuration; }
            finally { _lock.ExitReadLock(); }
        }
        set
        {
            List<EncodedPacket>? evicted;
            _lock.EnterWriteLock();
            try
            {
                _videoRamDuration = value;
                evicted = TrimExcessVideo();
            }
            finally { _lock.ExitWriteLock(); }
            FlushEvicted(evicted);
        }
    }

    /// <summary>
    /// Disk-only mode audio RAM cap: limits how much AUDIO the ring retains in
    /// RAM. Excess audio older than this window is evicted (and spilled to disk
    /// when <see cref="SpillAudioWhenEvicted"/> is set). Null = audio stays in
    /// RAM for the full replay window (legacy 'ram'/'hybrid' behavior, where
    /// audio was always RAM-only).
    /// </summary>
    public TimeSpan? AudioRamDuration
    {
        get
        {
            _lock.EnterReadLock();
            try { return _audioRamDuration; }
            finally { _lock.ExitReadLock(); }
        }
        set
        {
            List<EncodedPacket>? evicted;
            _lock.EnterWriteLock();
            try
            {
                _audioRamDuration = value;
                evicted = TrimExcessAudio();
            }
            finally { _lock.ExitWriteLock(); }
            FlushEvicted(evicted);
        }
    }

    /// <summary>
    /// When true, evicted AUDIO packets are written to the disk spill instead of
    /// being dropped. Enables disk-only mode (both streams live on disk), where
    /// the RAM caps (<see cref="VideoRamDuration"/>/<see cref="AudioRamDuration"/>)
    /// shrink both streams to a small transient staging window. Default false —
    /// hybrid keeps evicted audio dropped (audio RAM-only).
    /// </summary>
    public bool SpillAudioWhenEvicted
    {
        get
        {
            _lock.EnterReadLock();
            try { return _spillAudioWhenEvicted; }
            finally { _lock.ExitReadLock(); }
        }
        set
        {
            _lock.EnterWriteLock();
            try { _spillAudioWhenEvicted = value; }
            finally { _lock.ExitWriteLock(); }
        }
    }

    public int VideoCount
    {
        get
        {
            _lock.EnterReadLock();
            try { return _videoCount; }
            finally { _lock.ExitReadLock(); }
        }
    }

    public void AddVideo(EncodedPacket packet)
    {
        List<EncodedPacket>? evicted;
        _lock.EnterWriteLock();
        try
        {
            GrowIfNeeded(ref _videoPackets, ref _videoHead, ref _videoTail, ref _videoCount);
            _videoPackets[_videoTail] = packet;
            _videoTail = (_videoTail + 1) % _videoPackets.Length;
            _videoCount++;
            _totalVideoDuration += packet.Duration;
            _totalVideoBytes += packet.DataLength;
            evicted = TrimExcessVideo();
        }
        finally { _lock.ExitWriteLock(); }
        FlushEvicted(evicted);
    }

    public void AddAudio(EncodedPacket packet)
    {
        List<EncodedPacket>? evicted;
        _lock.EnterWriteLock();
        try
        {
            GrowIfNeeded(ref _audioPackets, ref _audioHead, ref _audioTail, ref _audioCount);
            _audioPackets[_audioTail] = packet;
            _audioTail = (_audioTail + 1) % _audioPackets.Length;
            _audioCount++;
            _totalAudioDuration += packet.Duration;
            // Áudio no buffer é sempre AAC (PcmSamples == null) — contabilização
            // consistente via DataLength (B2: ramo PcmSamples era inalcançável).
            _totalAudioBytes += packet.DataLength;
            evicted = TrimExcessAudio();
        }
        finally { _lock.ExitWriteLock(); }
        FlushEvicted(evicted);
    }

    /// <summary>
    /// Trim both streams, returning the evicted packets. Eviction only removes
    /// packets from the ring under the lock — the actual spill write + release
    /// happens later in <see cref="FlushEvicted"/>, outside the write lock.
    /// </summary>
    private List<EncodedPacket>? TrimExcess()
    {
        var v = TrimExcessVideo();
        var a = TrimExcessAudio();
        if (v == null) return a;
        if (a == null) return v;
        v.AddRange(a);
        return v;
    }

    private List<EncodedPacket>? TrimExcessVideo()
    {
        List<EncodedPacket>? evicted = null;
        // Hybrid (VideoRamDuration setado): o vídeo em RAM é limitado à janela de
        // RAM (ex.: 2 min fixos via ComputeHybridRamCap) — o excedente é evictado
        // para o disco, não solto.
        // Sem o cap (modo 'ram'), a RAM guarda a janela completa (_maxDuration).
        var window = _videoRamDuration ?? _maxDuration;
        while (_videoCount > 0 && (_totalVideoDuration > window || (_maxVideoBytes > 0 && _totalVideoBytes > _maxVideoBytes)))
        {
            var oldest = _videoPackets[_videoHead]!;
            _videoPackets[_videoHead] = null;
            _videoHead = (_videoHead + 1) % _videoPackets.Length;
            _videoCount--;
            _totalVideoDuration -= oldest.Duration;
            _totalVideoBytes -= oldest.DataLength;
            (evicted ??= new List<EncodedPacket>(4)).Add(oldest);
        }
        return evicted;
    }

    private List<EncodedPacket>? TrimExcessAudio()
    {
        List<EncodedPacket>? evicted = null;
        // Disk-only (AudioRamDuration setado): áudio em RAM é limitado à janela
        // de staging (ex.: 1s) — o excedente é evictado (e espilhado quando
        // SpillAudioWhenEvicted=true). Sem o cap, a RAM guarda _maxDuration.
        var window = _audioRamDuration ?? _maxDuration;
        while (_audioCount > 0 && (_totalAudioDuration > window || (_maxAudioBytes > 0 && _totalAudioBytes > _maxAudioBytes)))
        {
            var oldest = _audioPackets[_audioHead]!;
            _audioPackets[_audioHead] = null;
            _audioHead = (_audioHead + 1) % _audioPackets.Length;
            _audioCount--;
            _totalAudioDuration -= oldest.Duration;
            _totalAudioBytes -= oldest.DataLength;
            (evicted ??= new List<EncodedPacket>(4)).Add(oldest);
        }
        return evicted;
    }

    /// <summary>
    /// Write evicted packets to the disk spill and release them, OUTSIDE the
    /// ReplayBuffer write lock. Both the spill write and the sliding-window
    /// trim (which only deletes fully-consumed segment files — no compaction)
    /// are long I/O; running them under the write lock froze the whole capture
    /// pipeline for 76s (2026-08-01 incident).
    /// </summary>
    private void FlushEvicted(List<EncodedPacket>? evicted)
    {
        if (evicted == null || evicted.Count == 0) return;

        var spill = _spill;
        var spillEnabled = _diskSpillEnabled;
        // Híbrido (VideoRamDuration setado e SpillAudioWhenEvicted=false): o disco
        // é vídeo-only — áudio (AAC) evictado é descartado, nunca gravado no spill.
        // Sem o cap (modo 'ram'): todos os evictados vão pro disco (emergencial por
        // bytes). Disk-only (SpillAudioWhenEvicted=true): áudio também espilha.
        var dropAudio = _videoRamDuration != null && !_spillAudioWhenEvicted;
        try
        {
            if (spillEnabled && spill != null)
            {
                foreach (var oldest in evicted)
                {
                    if (dropAudio && oldest.Type != MediaType.Video)
                        continue; // áudio evictado: dropa (não spill)
                    spill.Write(oldest);
                }
                spill.TrimOldest(_maxDuration);
            }
        }
        catch (Exception ex)
        {
            // Spill é best-effort: falha de I/O (disco cheio/erro) não pode
            // matar a captura nem vazar arrays pooled. Pacotes evictados são
            // descartados (sem spill) mas sempre liberados abaixo.
            Log.W("ReplayBuffer", $"FlushEvicted: spill write/trim falhou: {ex.GetType().Name}: {ex.Message}");
        }
        finally
        {
            foreach (var oldest in evicted)
                oldest.Release();
        }
    }

    private static void GrowIfNeeded(ref EncodedPacket?[] buffer, ref int head, ref int tail, ref int count)
    {
        if (count < buffer.Length) return;

        int newCapacity = buffer.Length * 2;
        var newBuf = new EncodedPacket[newCapacity];
        if (count > 0)
        {
            if (head < tail)
            {
                System.Array.Copy(buffer, head, newBuf, 0, count);
            }
            else
            {
                int rightLen = buffer.Length - head;
                System.Array.Copy(buffer, head, newBuf, 0, rightLen);
                System.Array.Copy(buffer, 0, newBuf, rightLen, tail);
            }
        }
        buffer = newBuf;
        head = 0;
        tail = count;
    }

    public (List<EncodedPacket> video, List<EncodedPacket> audio) GetSegments(TimeSpan? duration = null, TimeSpan? endOffset = null)
    {
        // G1-3: snapshot do anel sob um lock CURTO; o I/O do spill (ReadAll) e o
        // merge/trim rodam FORA do lock. Segurar o lock durante I/O de disco
        // congelava o pipeline de captura inteiro (incidente stall 76s de
        // 2026-08-01 — a mesma classe de bug que o TrimExcess/FlushEvicted fix).
        List<EncodedPacket> video;
        List<EncodedPacket> audio;
        DiskSpillBuffer? spill;
        _lock.EnterReadLock();
        try
        {
            video = CopyRing(_videoPackets, _videoHead, _videoCount);
            audio = CopyRing(_audioPackets, _audioHead, _audioCount);
            // Snapshota a referência do spill sob o lock (atribuída uma única vez
            // em EnableDiskSpill, nunca nulleada). O I/O do ReadAll acontece FORA
            // do lock — ler o spill inteiro (potencialmente centenas de MB) sob o
            // read lock bloquearia AddVideo/AddAudio (write lock exclusivo) e
            // congelaria o pipeline de captura (classe do incidente stall 76s).
            spill = (_diskSpillEnabled && _spill is { Count: > 0 }) ? _spill : null;
        }
        finally { _lock.ExitReadLock(); }

        List<EncodedPacket>? diskVideo = null;
        List<EncodedPacket>? diskAudio = null;
        if (spill != null)
        {
            // Leitura NÃO destrutiva: os dados permanecem no spill até
            // TrimOldest/Clear/Dispose. Os pacotes retornados são objetos novos
            // desta chamada; o merge decide quais entram na janela ou são liberados.
            List<EncodedPacket>? diskPkts;
            try
            {
                diskPkts = spill.ReadAll();
            }
            catch (ObjectDisposedException)
            {
                // Teardown race: o buffer foi disposto (Dispose → _spill.Dispose)
                // entre o snapshot e o ReadAll. O save já está inviável — usa só o
                // snapshot RAM; nada a liberar (o spill Clear()/Dispose() cuidou).
                diskPkts = null;
            }
            if (diskPkts != null)
            {
                diskVideo = new List<EncodedPacket>();
                diskAudio = new List<EncodedPacket>();
                foreach (var pkt in diskPkts)
                {
                    if (pkt.Type == MediaType.Video) diskVideo.Add(pkt);
                    else diskAudio.Add(pkt);
                }
            }
        }

        // Merge + dedup fora do lock. Em PTS igual o copy RAM (retido) vence — a
        // mesma frame pode ter sido evictada para o spill entre o snapshot do anel
        // e a leitura do disco; o duplicado do spill é liberado (ownership desta
        // chamada). Pacotes do spill que ficarem fora da janela abaixo também são
        // liberados — RAM e disk compartilham o mesmo caminho de release.
        if (diskVideo != null) video = MergeSpilledPackets(video, diskVideo);
        if (diskAudio != null) audio = MergeSpilledPackets(audio, diskAudio);

        // Diagnostic: mede offset entre último PTS de video/audio (throttled 5s)
        if (video.Count > 0 && audio.Count > 0)
        {
            var offsetMs = (audio[^1].Pts - video[^1].Pts).TotalMilliseconds;
            if (Math.Abs(offsetMs) > SegmentOffsetWarnMs)
            {
                var now = Stopwatch.GetTimestamp();
                if (now - _lastSegmentOffsetLogTick >= SegmentOffsetLogThrottleTicks)
                {
                    _lastSegmentOffsetLogTick = now;
                    Log.D("ReplayBuffer", $"GetSegments: offset entre último PTS de video/audio = {offsetMs:F0}ms " +
                        $"(video={video[^1].Pts.TotalSeconds:F2}s audio={audio[^1].Pts.TotalSeconds:F2}s)");
                }
            }
        }

        if (duration == null && endOffset == null)
            return (video, audio);

        var cutoff = endOffset ?? TimeSpan.Zero;
        var maxAge = duration ?? _maxDuration;

        var videoStart = video.Count > 0 ? video[^1].Pts - maxAge + cutoff : TimeSpan.Zero;
        if (videoStart < TimeSpan.Zero) videoStart = TimeSpan.Zero;
        var audioStart = audio.Count > 0 ? audio[^1].Pts - maxAge + cutoff : TimeSpan.Zero;
        if (audioStart < TimeSpan.Zero) audioStart = TimeSpan.Zero;

        // Alinha o início do clipe ao primeiro keyframe dentro da janela — o
        // clipe não começa no meio de um GOP (frames P/B órfãs sem o I-base →
        // artefatos H.264 até o próximo keyframe; o mux usa -c:v copy, não
        // conserta). Custo: até ~1 GOP (2s a 60fps) do início é descartado.
        videoStart = AlignToKeyframe(video, videoStart);

        // Trim da janela: pacotes fora da janela são liberados.
        //   - RAM: solta o Retain() do snapshot desta chamada (1 → 0) — o anel
        //     mantém ownership e o Clear() posterior faz o release final (-1).
        //   - Disk: libera a ownership integral desta chamada (0 → -1 → pooled).
        // Ambos os caminhos são consistentes sob a contagem de referência: nem
        // leak (G1-3) nem duplo release.
        var trimmedVideo = new List<EncodedPacket>(video.Count);
        for (int i = 0; i < video.Count; i++)
            if (video[i].Pts >= videoStart)
                trimmedVideo.Add(video[i]);
            else
                video[i].Release();
        video = trimmedVideo;

        var trimmedAudio = new List<EncodedPacket>(audio.Count);
        for (int i = 0; i < audio.Count; i++)
            if (audio[i].Pts >= audioStart)
                trimmedAudio.Add(audio[i]);
            else
                audio[i].Release();
        audio = trimmedAudio;

        return (video, audio);
    }

    /// <summary>
    /// Merge um snapshot RAM (pacotes retidos para esta chamada — o anel ainda os
    /// possui) com pacotes do spill (ownership desta chamada) numa única lista
    /// ordenada por PTS.
    ///
    /// Em PTS igual o copy RAM vence: a mesma frame pode ter sido evictada para o
    /// spill entre o snapshot do anel e a leitura do disco (as duas aquisições de
    /// lock são separadas). O copy RAM é o authoritative e retido; o duplicado do
    /// disco é liberado aqui (é ownership desta chamada). Todos os pacotes do
    /// disk com o mesmo PTS do RAM são consumidos/liberados para a frame não
    /// aparecer duas vezes no clipe.
    ///
    /// Ownership da lista retornada: pacotes RAM continuam retidos (snapshot do
    /// GetSegments), pacotes disk são entregues. O chamador deve fazer Release()
    /// de cada pacote retornado exatamente uma vez.
    /// </summary>
    internal static List<EncodedPacket> MergeSpilledPackets(List<EncodedPacket> ram, List<EncodedPacket> disk)
    {
        if (disk.Count == 0) return ram;
        if (ram.Count == 0) return disk;

        // Defensivo — o spill devolve ordenado e o CopyRing também, mas este
        // merge roda no save (não no hot path de captura); ordenar é barato e
        // garante o contrato independente da origem.
        if (ram.Count > 1)
            ram.Sort((a, b) => a.Pts.CompareTo(b.Pts));
        if (disk.Count > 1)
            disk.Sort((a, b) => a.Pts.CompareTo(b.Pts));

        var merged = new List<EncodedPacket>(ram.Count + disk.Count);
        int i = 0, j = 0;
        while (i < ram.Count && j < disk.Count)
        {
            var cmp = ram[i].Pts.CompareTo(disk[j].Pts);
            if (cmp < 0)
            {
                merged.Add(ram[i]);
                i++;
            }
            else if (cmp > 0)
            {
                merged.Add(disk[j]);
                j++;
            }
            else
            {
                // PTS igual: RAM vence; TODOS os duplicados do disk com este PTS
                // são liberados (evita a mesma frame duas vezes no clipe).
                merged.Add(ram[i]);
                var dupPts = ram[i].Pts;
                i++;
                while (j < disk.Count && disk[j].Pts == dupPts)
                {
                    disk[j].Release();
                    j++;
                }
            }
        }
        while (i < ram.Count) merged.Add(ram[i++]);
        while (j < disk.Count) merged.Add(disk[j++]);
        return merged;
    }

    // Avança o cutoff para o primeiro keyframe >= cutoff (lista já janelada).
    // Evita que o clipe salvo comece no meio de um GOP (frame P/B órfã sem o
    // I-base -> artefatos H.264 até o próximo keyframe). Sem keyframe na janela
    // o cutoff é preservado (comportamento antigo).
    public static TimeSpan AlignToKeyframe(List<EncodedPacket> video, TimeSpan cutoff)
    {
        foreach (var pkt in video)
        {
            if (pkt.IsKeyFrame && pkt.Pts >= cutoff)
                return pkt.Pts;
        }
        return cutoff;
    }

    private static List<EncodedPacket> CopyRing(EncodedPacket?[] buffer, int head, int count)
    {
        var result = new List<EncodedPacket>(count);
        for (int i = 0; i < count; i++)
        {
            int idx = (head + i) % buffer.Length;
            var pkt = buffer[idx]!;
            pkt.Retain();
            result.Add(pkt);
        }
        return result;
    }

    public (TimeSpan firstPts, TimeSpan lastPts, TimeSpan span) PeekVideoPtsRange()
    {
        _lock.EnterReadLock();
        try
        {
            if (_videoCount == 0) return (TimeSpan.Zero, TimeSpan.Zero, TimeSpan.Zero);
            var first = _videoPackets[_videoHead]!.Pts;
            var last = _videoPackets[(_videoHead + _videoCount - 1) % _videoPackets.Length]!.Pts;
            return (first, last, last - first);
        }
        finally { _lock.ExitReadLock(); }
    }

    public (int videoCount, int audioCount, TimeSpan duration, long bytes) Stats()
    {
        _lock.EnterReadLock();
        try
        {
            var maxDuration = _totalVideoDuration > _totalAudioDuration
                ? _totalVideoDuration : _totalAudioDuration;
            return (_videoCount, _audioCount, maxDuration, _totalVideoBytes + _totalAudioBytes);
        }
        finally { _lock.ExitReadLock(); }
    }

    public (TimeSpan videoLastPts, TimeSpan audioLastPts) StatsPtsRange()
    {
        _lock.EnterReadLock();
        try
        {
            var vLast = _videoCount > 0
                ? _videoPackets[(_videoHead + _videoCount - 1) % _videoPackets.Length]!.Pts
                : TimeSpan.Zero;
            var aLast = _audioCount > 0
                ? _audioPackets[(_audioHead + _audioCount - 1) % _audioPackets.Length]!.Pts
                : TimeSpan.Zero;
            return (vLast, aLast);
        }
        finally { _lock.ExitReadLock(); }
    }

    public (int videoCount, int audioCount, long videoBytes, long audioBytes, TimeSpan videoDuration, TimeSpan audioDuration) StatsDetailed()
    {
        _lock.EnterReadLock();
        try
        {
            return (_videoCount, _audioCount, _totalVideoBytes, _totalAudioBytes, _totalVideoDuration, _totalAudioDuration);
        }
        finally { _lock.ExitReadLock(); }
    }

    public void Clear()
    {
        _lock.EnterWriteLock();
        try
        {
            ReleaseAll(_videoPackets, _videoHead, _videoCount);
            ReleaseAll(_audioPackets, _audioHead, _audioCount);
            System.Array.Clear(_videoPackets, 0, _videoPackets.Length);
            System.Array.Clear(_audioPackets, 0, _audioPackets.Length);
            _videoHead = _videoTail = _videoCount = 0;
            _audioHead = _audioTail = _audioCount = 0;
            _totalVideoDuration = TimeSpan.Zero;
            _totalAudioDuration = TimeSpan.Zero;
            _totalVideoBytes = 0;
            _totalAudioBytes = 0;
            _spill?.Clear();
        }
        finally { _lock.ExitWriteLock(); }
    }

    private static void ReleaseAll(EncodedPacket?[] buffer, int head, int count)
    {
        for (int i = 0; i < count; i++)
        {
            int idx = (head + i) % buffer.Length;
            buffer[idx]?.Release();
        }
    }

    public void Dispose()
    {
        Clear();
        _spill?.Dispose();
        _lock.Dispose();
    }
}
