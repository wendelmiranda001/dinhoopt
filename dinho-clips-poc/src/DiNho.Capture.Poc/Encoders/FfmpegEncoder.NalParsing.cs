using System.Buffers;
using DiNho.Capture.Poc.Export;
using DiNho.Capture.Poc.Logging;
using Vortice.MediaFoundation;

namespace DiNho.Capture.Poc.Encoders;

internal partial class FfmpegEncoder
{
    internal static bool IsAnnexB(byte[] buf, int len)
    {
        if (len < 3) return false;
        if (buf[0] != 0 || buf[1] != 0) return false;
        if (buf[2] == 1) return true;
        return len >= 4 && buf[2] == 0 && buf[3] == 1;
    }

    internal static bool ScanForStartCode(byte[] buf, int len, out int position)
    {
        position = -1;
        int end = len - 2;
        for (int i = 0; i < end; i++)
        {
            if (buf[i] != 0 || buf[i + 1] != 0) continue;
            if (buf[i + 2] == 1) { position = i; return true; }
            if (i + 3 < len && buf[i + 2] == 0 && buf[i + 3] == 1) { position = i; return true; }
        }
        return false;
    }

    internal static int ConvertAnnexBToAvcc(byte[] buf, int length, out int consumed)
    {
        int readPos = 0, writePos = 0;
        int firstScPos = -1;
        for (int i = 0; i < length - 2; i++)
        {
            if (buf[i] != 0) continue;
            if (buf[i + 1] != 0) continue;
            if (buf[i + 2] == 1) { firstScPos = i; break; }
            if (i + 3 < length && buf[i + 2] == 0 && buf[i + 3] == 1) { firstScPos = i; break; }
        }
        bool foundFirstSc = firstScPos != 0;

        while (readPos + 2 < length)
        {
            int scPos = -1, scLen = 3;
            int scanEnd = length - 2;
            for (int i = readPos; i < scanEnd; i++)
            {
                if (buf[i] != 0) continue;
                if (buf[i + 1] != 0) continue;
                if (buf[i + 2] == 1) { scPos = i; scLen = 3; break; }
                if (i + 3 < length && buf[i + 2] == 0 && buf[i + 3] == 1) { scPos = i; scLen = 4; break; }
            }

            if (scPos < 0)
            {
                consumed = readPos;
                return writePos;
            }

            int nalLen = scPos - readPos;
            if (nalLen > 0 && foundFirstSc)
            {
                if (readPos != writePos + 4)
                    System.Buffer.BlockCopy(buf, readPos, buf, writePos + 4, nalLen);
                buf[writePos] = (byte)(nalLen >> 24);
                buf[writePos + 1] = (byte)(nalLen >> 16);
                buf[writePos + 2] = (byte)(nalLen >> 8);
                buf[writePos + 3] = (byte)nalLen;
                writePos += 4 + nalLen;
            }

            readPos = scPos + scLen;
            foundFirstSc = true;
        }

        consumed = readPos;
        return writePos;
    }

    private static int FindAnnexBAccessUnitBoundary(byte[] buf, int len, bool hadSlice)
    {
        int pos = 0;
        bool seenSlice = hadSlice;

        while (pos + 3 < len)
        {
            if (buf[pos] != 0 || buf[pos + 1] != 0) { pos++; continue; }
            int scLen = 0;
            if (buf[pos + 2] == 1) scLen = 3;
            else if (pos + 3 < len && buf[pos + 2] == 0 && buf[pos + 3] == 1) scLen = 4;
            if (scLen == 0) { pos++; continue; }

            int nalStart = pos + scLen;
            if (nalStart >= len) break;

            int nalType = buf[nalStart] & 0x1F;

            bool isAuStart = nalType == 9
                          || nalType == 7
                          || nalType == 8;

            bool isSlice = nalType >= 1 && nalType <= 5;

            if (seenSlice && (isAuStart || isSlice))
                return pos;

            if (isSlice)
                seenSlice = true;

            pos = nalStart + 1;
        }

        return 0;
    }

    private void ParseAnnexBAu(byte[] buf, int length)
    {
        _pendingTooLarge = false;
        int pos = 0;

        while (pos + 3 < length)
        {
            int scLen = 0;
            if (buf[pos] == 0 && buf[pos + 1] == 0)
            {
                if (buf[pos + 2] == 1) scLen = 3;
                else if (pos + 3 < length && buf[pos + 2] == 0 && buf[pos + 3] == 1) scLen = 4;
            }
            if (scLen == 0) { pos++; continue; }

            int nalStart = pos + scLen;
            if (nalStart >= length) break;

            int nalType = buf[nalStart] & 0x1F;
            bool isSlice = nalType >= 1 && nalType <= 5;
            bool isAUD = nalType == 9;

            int nalEnd = length;
            for (int i = nalStart + 1; i < length - 2; i++)
            {
                if (buf[i] != 0 || buf[i + 1] != 0) continue;
                if (buf[i + 2] == 1) { nalEnd = i; break; }
                if (i + 3 < length && buf[i + 2] == 0 && buf[i + 3] == 1) { nalEnd = i; break; }
            }
            int nalLen = nalEnd - nalStart;

            if (_outputFrameIndex == 0 && _frameCount < 10)
                Log.D("FfmpegEncoder", $"ParseAnnexBAu: NAL type={nalType} isSlice={isSlice} isAUD={isAUD} nalLen={nalLen} pos={pos} hadSlice={_hadSlice}");

            if (isAUD)
            {
                if (_hadSlice)
                    EmitPacket();
            }
            else
            {
                if (((IsHevc && _cachedHvcc == null) || (!IsHevc && _cachedAvcc == null)) && !IsAv1)
                {
                    if (IsHevc)
                    {
                        if (nalType == 32 && _cachedVps == null)
                        {
                            _cachedVps = new byte[nalLen];
                            System.Buffer.BlockCopy(buf, nalStart, _cachedVps, 0, nalLen);
                        }
                        else if (nalType == 33 && _cachedSps == null)
                        {
                            _cachedSps = new byte[nalLen];
                            System.Buffer.BlockCopy(buf, nalStart, _cachedSps, 0, nalLen);
                        }
                        else if (nalType == 34 && _cachedPps == null)
                        {
                            _cachedPps = new byte[nalLen];
                            System.Buffer.BlockCopy(buf, nalStart, _cachedPps, 0, nalLen);
                        }
                        if (_cachedVps != null && _cachedSps != null && _cachedPps != null)
                            _cachedHvcc = ClipExporter.BuildHvcc(_cachedVps, _cachedSps, _cachedPps);
                    }
                    else
                    {
                        if (nalType == 7 && _cachedSps == null)
                        {
                            _cachedSps = new byte[nalLen];
                            System.Buffer.BlockCopy(buf, nalStart, _cachedSps, 0, nalLen);
                        }
                        else if (nalType == 8 && _cachedPps == null)
                        {
                            _cachedPps = new byte[nalLen];
                            System.Buffer.BlockCopy(buf, nalStart, _cachedPps, 0, nalLen);
                        }
                        if (_cachedSps != null && _cachedPps != null)
                            _cachedAvcc = ClipExporter.BuildAvcc(_cachedSps, _cachedPps);
                    }
                }

                if (isSlice && _hadSlice)
                {
                    if (_pendingLen > 200 * 1024)
                    {
                        Log.W("FfmpegEncoder", $"ParseAnnexBAu: slice trigger with {_pendingLen}B pending — likely format mismatch");
                        _pendingTooLarge = true;
                    }
                    else
                    {
                        EmitPacket();
                    }
                }

                if (nalType == 8 && _hadSlice)
                {
                    if (_pendingLen > 200 * 1024)
                    {
                        Log.W("FfmpegEncoder", $"ParseAnnexBAu: PPS trigger with {_pendingLen}B pending — likely format mismatch");
                        _pendingTooLarge = true;
                    }
                    else
                    {
                        EmitPacket();
                    }
                }

                AppendPendingAvccNal(buf, nalStart, nalLen);
                if (isSlice) _hadSlice = true;
            }

            pos = nalEnd > nalStart ? nalEnd : nalStart + 1;
        }

        if (_hadSlice && !_pendingTooLarge)
            EmitPacket();
    }

    private void ProcessIvfFrames()
    {
        if (!_ivfHeaderParsed)
        {
            if (_rawLen < 32) return;

            _ivfTimebaseDen = BitConverter.ToUInt32(_rawBuf!, 16);
            _ivfTimebaseNum = BitConverter.ToUInt32(_rawBuf!, 20);
            if (_ivfTimebaseDen == 0) _ivfTimebaseDen = (uint)_frameRate;
            if (_ivfTimebaseNum == 0) _ivfTimebaseNum = 1;

            _ivfHeaderParsed = true;
            int tail = _rawLen - 32;
            if (tail > 0)
                System.Buffer.BlockCopy(_rawBuf!, 32, _rawBuf!, 0, tail);
            _rawLen = tail;

            Log.I("FfmpegEncoder", $"IVF header parsed: tb={_ivfTimebaseNum}/{_ivfTimebaseDen} rawFmt={_codec}");
        }

        while (_rawLen >= 12)
        {
            int frameSize = BitConverter.ToInt32(_rawBuf!, 0);
            long ptsIvf = BitConverter.ToInt64(_rawBuf!, 4);
            int totalFrame = 12 + frameSize;

            if (_rawLen < totalFrame) break;

            long ptsTicks = ptsIvf * _ivfTimebaseNum * 10_000_000L / _ivfTimebaseDen;
            long durTicks = _ivfTimebaseNum * 10_000_000L / _ivfTimebaseDen;

            // Mesma resolução de PTS da rota AnnexB (EmitPacket): o container IVF traz um PTS
            // sintético por frame-index (que avança a 60fps fantasma mesmo se a captura alimenta
            // menos), enquanto o PTS REAL de captura está na _inputPtsQueue. Se usássemos só o
            // ptsIvf, quando o feed cai para ~46fps o vídeo avança 46/60 do relógio de parede →
            // drift A/V crescente de ~0,23 s/s (diagnosticado na sessão de drift do pipeline).
            long prevPts = _lastRealPtsTicks;
            bool usedExtrapolated = false;
            if (_inputPtsQueue.TryDequeue(out var realPts))
            {
                ptsTicks = realPts.Ticks;
                _lastRealPtsTicks = ptsTicks;
            }
            else if (_lastRealPtsTicks >= 0)
            {
                ptsTicks = _lastRealPtsTicks + durTicks;
                _lastRealPtsTicks = ptsTicks;
                usedExtrapolated = true;
            }

            if (prevPts >= 0 && ptsTicks <= prevPts)
            {
                ptsTicks = prevPts + 1;
                _lastRealPtsTicks = ptsTicks;
                Log.W("FfmpegEncoder", $"ProcessIvfFrames: corrected non-monotonic pts to {ptsTicks / 10000}ms (frameIndex={_outputFrameIndex})");
            }

            if (usedExtrapolated)
                Log.D("FfmpegEncoder", $"ProcessIvfFrames: used extrapolated pts {ptsTicks / 10000}ms (frameIndex={_outputFrameIndex})");

            byte[] data = VideoPacketPool.Rent(frameSize);
            System.Buffer.BlockCopy(_rawBuf!, 12, data, 0, frameSize);

            // M2: detecta keyframe no payload AV1 (IVF). O payload é uma sequência
            // de OBUs; keyframes são precedidos por um OBU SEQUENCE_HEADER (type 1).
            // O caminho AnnexB retorna false para AV1 (CheckKeyFrame), então este
            // parser dá à rota IVF a mesma capacidade (TrimVideoStart/seek no Matroska).
            bool key = IsAv1Keyframe(data, frameSize);

            _outputChannel.Writer.TryWrite(new EncodedPacket(
                data, MediaType.Video,
                TimeSpan.FromTicks(ptsTicks), TimeSpan.FromTicks(durTicks),
                isKeyFrame: key, isPooled: true, dataLength: frameSize, width: EncodedWidth, height: EncodedHeight));

            if (_outputFrameIndex < 10 || _outputFrameIndex % 300 == 1)
                Log.I("FfmpegEncoder", $"ProcessIvfFrames #{_outputFrameIndex} pts={ptsTicks/10000}ms len={frameSize}B");

            _outputFrameIndex++;

            int remaining = _rawLen - totalFrame;
            if (remaining > 0)
                System.Buffer.BlockCopy(_rawBuf!, totalFrame, _rawBuf!, 0, remaining);
            _rawLen = remaining;
        }
    }

    private void ReaderLoop(CancellationToken ct)
    {
        var buf = ArrayPool<byte>.Shared.Rent(2 * 1024 * 1024);
        bool firstData = true;

        try
        {
            while (!ct.IsCancellationRequested)
            {
                int read = _stdout!.Read(buf, 0, buf.Length);
                if (read == 0)
                {
                    _processFailed = true;
                    _processFailedCause = "reader:stdout_eof";
                    Log.W("FfmpegEncoder", $"stdout EOF after {_frameCount} frames written, {_outputFrameIndex} packets emitted");
                    break;
                }

                if (_disposed) break;

                if (firstData)
                {
                    firstData = false;
                    int rawHexLen = Math.Min(read, 32);
                    var rawHex = Convert.ToHexString(buf.AsSpan(0, rawHexLen));
                    Log.I("FfmpegEncoder", $"reader first data: {read}B, rawHex={rawHex}");
                }

                if (_rawBuf == null)
                {
                    _rawBuf = ArrayPool<byte>.Shared.Rent(Math.Max(512 * 1024, read));
                    _rawLen = 0;
                }
                int need = _rawLen + read;
                if (need > _rawBuf.Length)
                {
                    byte[] newBuf = ArrayPool<byte>.Shared.Rent(Math.Max(_rawBuf.Length * 2, need));
                    System.Buffer.BlockCopy(_rawBuf, 0, newBuf, 0, _rawLen);
                    ArrayPool<byte>.Shared.Return(_rawBuf);
                    _rawBuf = newBuf;
                }
                System.Buffer.BlockCopy(buf, 0, _rawBuf, _rawLen, read);
                _rawLen = need;

                // Bug 1 fix: Prepend incomplete NALU tail from previous ParseAvcc call
                if (_incompleteNalLen > 0 && _incompleteNalBuf != null)
                {
                    int prependLen = _incompleteNalLen;
                    _incompleteNalLen = 0;
                    if (_rawLen + prependLen > _rawBuf.Length)
                    {
                        byte[] bigger = ArrayPool<byte>.Shared.Rent(Math.Max(_rawBuf.Length * 2, _rawLen + prependLen));
                        System.Buffer.BlockCopy(_rawBuf, 0, bigger, prependLen, _rawLen);
                        ArrayPool<byte>.Shared.Return(_rawBuf);
                        _rawBuf = bigger;
                    }
                    else
                    {
                        // Shift existing data right by prependLen
                        System.Buffer.BlockCopy(_rawBuf, 0, _rawBuf, prependLen, _rawLen);
                    }
                    System.Buffer.BlockCopy(_incompleteNalBuf, 0, _rawBuf, 0, prependLen);
                    _rawLen += prependLen;
                    Log.D("FfmpegEncoder", $"prepended {prependLen}B incomplete NALU tail");
                }

                if (_pipeFormat == PipeFormat.Unknown && _rawLen >= 4)
                {
                    // IVF magic signature: "DKIF" at offset 0
                    if (_rawBuf[0] == 'D' && _rawBuf[1] == 'K' && _rawBuf[2] == 'I' && _rawBuf[3] == 'F')
                    {
                        _pipeFormat = PipeFormat.Ivf;
                    }
                    else if ((_rawBuf[0] == 0 && _rawBuf[1] == 0 && _rawBuf[2] == 1) ||
                             (_rawBuf[0] == 0 && _rawBuf[1] == 0 && _rawBuf[2] == 0 && _rawBuf[3] == 1))
                    {
                        _pipeFormat = PipeFormat.AnnexB;
                    }
                    else
                    {
                        // Bug 2 fix: Validate AVCC — first 4 bytes must form a plausible NALU length.
                        // Prevents false AVCC latch when pipe splits mid-NALU after a format reset.
                        int probeLen = (_rawBuf[0] << 24) | (_rawBuf[1] << 16) | (_rawBuf[2] << 8) | _rawBuf[3];
                        if (probeLen > 0 && probeLen < 5 * 1024 * 1024 && 4 + probeLen <= _rawLen)
                            _pipeFormat = PipeFormat.Avcc;
                        // else: wait for more data — might be mid-NALU bytes from a format reset
                    }
                    if (_pipeFormat != PipeFormat.Unknown)
                        Log.I("FfmpegEncoder", $"pipe format latched: {_pipeFormat} (codec={_codec}) rawHex={Convert.ToHexString(_rawBuf.AsSpan(0, Math.Min(_rawLen, 8)))}");
                }

                if (_pipeFormat == PipeFormat.Unknown)
                {
                    if (_rawLen > 2 * 1024 * 1024)
                    {
                        Log.W("FfmpegEncoder", $"Unknown format raw overflow {_rawLen}B — forcing format re-detect");
                        _rawLen = 0;
                        _incompleteNalLen = 0;
                        _hadRawSlice = false;
                        int drained = 0;
                        while (_inputPtsQueue.TryDequeue(out _)) drained++;
                        Log.W("FfmpegEncoder", $"drained {drained} stale PTS entries");
                    }
                    continue;
                }

                if (_pipeFormat == PipeFormat.Ivf)
                {
                    ProcessIvfFrames();

                    // 2MB overflow guard for IVF
                    if (_rawLen > 2 * 1024 * 1024)
                    {
                        Log.W("FfmpegEncoder", $"IVF raw overflow {_rawLen}B — resetting buffer");
                        _rawLen = 0;
                        _ivfHeaderParsed = false;
                        int drained = 0;
                        while (_inputPtsQueue.TryDequeue(out _)) drained++;
                        Log.W("FfmpegEncoder", $"drained {drained} stale PTS entries");
                        _pipeFormat = PipeFormat.Unknown;
                    }
                    continue;
                }

                if (_pipeFormat == PipeFormat.AnnexB)
                {
                    int auEnd = FindAnnexBAccessUnitBoundary(_rawBuf, _rawLen, _hadRawSlice);

                    if (auEnd > 0)
                    {
                        ParseAnnexBAu(_rawBuf, auEnd);

                        int tail = _rawLen - auEnd;
                        if (tail > 0)
                            System.Buffer.BlockCopy(_rawBuf, auEnd, _rawBuf, 0, tail);
                        _rawLen = tail;
                        _hadRawSlice = false;
                    }

                    if (_rawLen > 2 * 1024 * 1024)
                    {
                        Log.W("FfmpegEncoder", $"AnnexB raw overflow {_rawLen}B hadRawSlice={_hadRawSlice} — forcing format re-detect");
                        _pipeFormat = PipeFormat.Unknown;
                        _rawLen = 0;
                        _incompleteNalLen = 0;
                        _hadRawSlice = false;
                        int drained = 0;
                        while (_inputPtsQueue.TryDequeue(out _)) drained++;
                        Log.W("FfmpegEncoder", $"drained {drained} stale PTS entries");
                    }
                }
                else
                {
                    ParseAvcc(new ReadOnlySpan<byte>(_rawBuf, 0, _rawLen));
                    _rawLen = 0;

                    if (!_hadSlice && _pendingLen > 512 * 1024)
                    {
                        Log.W("FfmpegEncoder", $"AVCC mismatch: pending={_pendingLen}B hadSlice={_hadSlice} — forcing format re-detect");
                        _pipeFormat = PipeFormat.Unknown;
                        _pendingLen = 0;
                        _incompleteNalLen = 0;
                        _hadSlice = false;
                        int drained = 0;
                        while (_inputPtsQueue.TryDequeue(out _)) drained++;
                        Log.W("FfmpegEncoder", $"drained {drained} stale PTS entries");
                    }
                }
            }
        }
        catch (OperationCanceledException) { }
        catch (IOException ex)
        {
            _processFailed = true;
            _processFailedCause = "reader:stdout_io_error";
            Log.E("FfmpegEncoder", $"stdout: {ex.Message}");
        }
        finally
        {
            ArrayPool<byte>.Shared.Return(buf);
            if (_pendingBuf != null)
            {
                ArrayPool<byte>.Shared.Return(_pendingBuf);
                _pendingBuf = null;
            }
            if (_rawBuf != null)
            {
                ArrayPool<byte>.Shared.Return(_rawBuf);
                _rawBuf = null;
            }
            _pendingLen = 0;
            _rawLen = 0;
            _incompleteNalBuf = null;
            _incompleteNalLen = 0;
            _hadSlice = false;
            LogProcessExit();
        }
    }

    internal void ParseAvcc(ReadOnlySpan<byte> data)
    {
        _pendingTooLarge = false;
        int pos = 0;
        int firstHex = data.Length >= 4 ? (data[0] << 24) | (data[1] << 16) | (data[2] << 8) | data[3] : -1;
        if (!_loggedParseAvcc)
        {
            _loggedParseAvcc = true;
            Log.D("FfmpegEncoder", $"ParseAvcc: dataLen={data.Length} first4Bytes=0x{firstHex:X8} pending={_pendingLen} hadSlice={_hadSlice}");
        }

        while (pos + 4 <= data.Length)
        {
            int nalLen = (data[pos] << 24) | (data[pos + 1] << 16) | (data[pos + 2] << 8) | data[pos + 3];
            int totalSize = 4 + nalLen;

            if (nalLen <= 0 || pos + totalSize > data.Length)
            {
                // Bug 1 fix: Save incomplete tail to separate buffer instead of appending to _pendingBuf.
                // _pendingBuf is for complete NALUs ready for EmitPacket — incomplete data corrupts it.
                if (pos < data.Length)
                {
                    int tailLen = data.Length - pos;
                    if (_incompleteNalBuf == null || _incompleteNalBuf.Length < tailLen)
                        _incompleteNalBuf = new byte[Math.Max(tailLen, 4096)];
                    data.Slice(pos, tailLen).CopyTo(_incompleteNalBuf);
                    _incompleteNalLen = tailLen;
                    Log.D("FfmpegEncoder", $"ParseAvcc: incomplete NALU at pos={pos} nalLen={nalLen} tailLen={tailLen} — saved for next read");
                }
                break;
            }

            int nalType = IsHevc ? (data[pos + 4] >> 1) & 0x3F : data[pos + 4] & 0x1F;
            bool isSlice = IsHevc ? nalType <= 9 : nalType >= 1 && nalType <= 5;
            bool isAUD = IsHevc ? nalType == 35 : nalType == 9;

            if (_outputFrameIndex == 0 && _frameCount < 10)
                Log.D("FfmpegEncoder", $"ParseAvcc: codec={_codec} NAL type={nalType} isSlice={isSlice} isAUD={isAUD} nalLen={nalLen} pos={pos} hadSlice={_hadSlice}");

            if (isAUD)
            {
                if (_hadSlice)
                    EmitPacket();
            }
            else
            {
                if (((IsHevc && _cachedHvcc == null) || (!IsHevc && _cachedAvcc == null)) && !IsAv1)
                {
                    if (IsHevc)
                    {
                        if (nalType == 32 && _cachedVps == null)
                        {
                            _cachedVps = new byte[nalLen];
                            data.Slice(pos + 4, nalLen).CopyTo(_cachedVps);
                        }
                        else if (nalType == 33 && _cachedSps == null)
                        {
                            _cachedSps = new byte[nalLen];
                            data.Slice(pos + 4, nalLen).CopyTo(_cachedSps);
                        }
                        else if (nalType == 34 && _cachedPps == null)
                        {
                            _cachedPps = new byte[nalLen];
                            data.Slice(pos + 4, nalLen).CopyTo(_cachedPps);
                        }
                        if (_cachedVps != null && _cachedSps != null && _cachedPps != null)
                            _cachedHvcc = ClipExporter.BuildHvcc(_cachedVps, _cachedSps, _cachedPps);
                    }
                    else
                    {
                        int spsType = 7;
                        int ppsType = 8;
                        if (nalType == spsType && _cachedSps == null)
                        {
                            _cachedSps = new byte[nalLen];
                            data.Slice(pos + 4, nalLen).CopyTo(_cachedSps);
                        }
                        else if (nalType == ppsType && _cachedPps == null)
                        {
                            _cachedPps = new byte[nalLen];
                            data.Slice(pos + 4, nalLen).CopyTo(_cachedPps);
                        }
                        if (_cachedSps != null && _cachedPps != null)
                            _cachedAvcc = ClipExporter.BuildAvcc(_cachedSps, _cachedPps);
                    }
                }

                if (isSlice && _hadSlice)
                {
                    if (_pendingLen > 200 * 1024)
                    {
                        Log.W("FfmpegEncoder", $"ParseAvcc: slice trigger with {_pendingLen}B pending — likely format mismatch");
                        _pendingTooLarge = true;
                    }
                    else
                    {
                        EmitPacket();
                    }
                }

                int ppsNalType = IsHevc ? 34 : 8;
                if (nalType == ppsNalType && _hadSlice)
                {
                    if (_pendingLen > 200 * 1024)
                    {
                        Log.W("FfmpegEncoder", $"ParseAvcc: PPS trigger with {_pendingLen}B pending — likely format mismatch, skipping emit");
                        _pendingTooLarge = true;
                    }
                    else
                    {
                        EmitPacket();
                    }
                }

                AppendPending(data.Slice(pos, totalSize));
                if (isSlice) _hadSlice = true;
            }

            pos += totalSize;
        }

        if (_hadSlice && !_pendingTooLarge)
            EmitPacket();
    }

    internal void AppendPending(ReadOnlySpan<byte> chunk)
    {
        if (_pendingBuf == null)
        {
            _pendingBuf = ArrayPool<byte>.Shared.Rent(64 * 1024);
            _pendingLen = 0;
        }
        if (_pendingLen > 50 * 1024 * 1024)
        {
            Log.W("FfmpegEncoder", $"AppendPending: pendingLen={_pendingLen} exceeds 50MB — resetting to prevent OOM");
            _pendingLen = 0;
            _hadSlice = false;
        }
        int need = _pendingLen + chunk.Length;
        if (need > _pendingBuf.Length)
        {
            var newBuf = ArrayPool<byte>.Shared.Rent(Math.Max(_pendingBuf.Length * 2, need));
            System.Buffer.BlockCopy(_pendingBuf, 0, newBuf, 0, _pendingLen);
            ArrayPool<byte>.Shared.Return(_pendingBuf);
            _pendingBuf = newBuf;
        }
        chunk.CopyTo(new Span<byte>(_pendingBuf, _pendingLen, chunk.Length));
        _pendingLen += chunk.Length;
    }

    private void AppendPendingAvccNal(byte[] data, int offset, int nalLen)
    {
        if (_pendingLen > 50 * 1024 * 1024)
        {
            Log.W("FfmpegEncoder", $"AppendPendingAvccNal: pendingLen={_pendingLen} exceeds 50MB — resetting to prevent OOM");
            _pendingLen = 0;
            _hadSlice = false;
        }
        int totalSize = 4 + nalLen;
        int need = _pendingLen + totalSize;
        if (_pendingBuf == null)
        {
            _pendingBuf = ArrayPool<byte>.Shared.Rent(Math.Max(64 * 1024, need));
            _pendingLen = 0;
        }
        if (need > _pendingBuf.Length)
        {
            var newBuf = ArrayPool<byte>.Shared.Rent(Math.Max(_pendingBuf.Length * 2, need));
            System.Buffer.BlockCopy(_pendingBuf, 0, newBuf, 0, _pendingLen);
            ArrayPool<byte>.Shared.Return(_pendingBuf);
            _pendingBuf = newBuf;
        }
        _pendingBuf[_pendingLen] = (byte)(nalLen >> 24);
        _pendingBuf[_pendingLen + 1] = (byte)(nalLen >> 16);
        _pendingBuf[_pendingLen + 2] = (byte)(nalLen >> 8);
        _pendingBuf[_pendingLen + 3] = (byte)nalLen;
        _pendingLen += 4;
        System.Buffer.BlockCopy(data, offset, _pendingBuf, _pendingLen, nalLen);
        _pendingLen += nalLen;
    }

    private bool CheckPendingHasSlice()
    {
        if (_pendingBuf == null || _pendingLen == 0) return false;
        if (IsAv1) return true;
        int pos = 0;
        while (pos + 4 <= _pendingLen)
        {
            int nalLen = (_pendingBuf[pos] << 24) | (_pendingBuf[pos + 1] << 16) | (_pendingBuf[pos + 2] << 8) | _pendingBuf[pos + 3];
            if (nalLen <= 0 || pos + 4 + nalLen > _pendingLen) break;
            int nalType = IsHevc ? (_pendingBuf[pos + 4] >> 1) & 0x3F : _pendingBuf[pos + 4] & 0x1F;
            if (IsHevc ? nalType <= 9 : nalType >= 1 && nalType <= 5) return true;
            pos += 4 + nalLen;
        }
        return false;
    }

    private void EmitPacket()
    {
        if (_pendingLen == 0 || !_hadSlice || _pendingBuf == null) return;
        if (!CheckPendingHasSlice()) return;

        byte[] data = VideoPacketPool.Rent(_pendingLen);
        System.Buffer.BlockCopy(_pendingBuf, 0, data, 0, _pendingLen);

        long dur = 10_000_000L / _frameRate;

        long prevPts = _lastRealPtsTicks;

        long pts = _outputFrameIndex * dur;
        bool usedExtrapolated = false;
        if (_inputPtsQueue.TryDequeue(out var realPts))
        {
            pts = realPts.Ticks;
            _lastRealPtsTicks = pts;
        }
        else if (_lastRealPtsTicks >= 0)
        {
            pts = _lastRealPtsTicks + dur;
            _lastRealPtsTicks = pts;
            usedExtrapolated = true;
        }

        if (prevPts >= 0 && pts <= prevPts)
        {
            pts = prevPts + 1;
            _lastRealPtsTicks = pts;
            Log.W("FfmpegEncoder", $"EmitPacket: corrected non-monotonic pts to {pts / 10000}ms (frameIndex={_outputFrameIndex})");
        }

        if (usedExtrapolated)
            Log.D("FfmpegEncoder", $"EmitPacket: used extrapolated pts {pts/10000}ms (frameIndex={_outputFrameIndex})");
        bool key = CheckKeyFrame(data);

        _outputChannel.Writer.TryWrite(new EncodedPacket(
            data, MediaType.Video,
            TimeSpan.FromTicks(pts), TimeSpan.FromTicks(dur),
            key, isPooled: true, dataLength: _pendingLen, width: EncodedWidth, height: EncodedHeight));

        long ptsMs = pts / 10_000;
        if (_outputFrameIndex < 10 || _outputFrameIndex % 300 == 1)
            Log.I("FfmpegEncoder", $"EmitPacket #{_outputFrameIndex} pts={ptsMs}ms len={_pendingLen}B key={key} hadSlice={_hadSlice}");

        _outputFrameIndex++;
        _pendingLen = 0;
        _hadSlice = false;
    }

    private bool CheckKeyFrame(byte[] data)
    {
        if (IsAv1) return false;
        int pos = 0;
        while (pos + 5 <= data.Length)
        {
            int nalLen = (data[pos] << 24) | (data[pos + 1] << 16) | (data[pos + 2] << 8) | data[pos + 3];
            if (nalLen <= 0) break;
            int nalStart = pos + 4;
            if (IsHevc)
            {
                int t = (data[nalStart] >> 1) & 0x3F;
                if (t == 19 || t == 20) return true;
                if (t <= 9) return false;
            }
            else
            {
                int t = data[nalStart] & 0x1F;
                if (t == 5) return true;
                if (t >= 1 && t <= 5) return false;
            }
            pos = nalStart + nalLen;
        }
        return false;
    }

    internal static bool IsAv1Keyframe(byte[] data, int length)
    {
        // AV1 uncompressed header (within the frame OBU) begins with a
        // frame_type (2 bits). frame_type == 0 => KEY_FRAME.
        // IVF payload is a sequence of OBUs: TEMPORAL_DELIMITER (2) →
        // SEQUENCE_HEADER (1) for keyframes → FRAME_HEADER (3) / FRAME (6).
        // Walk OBU headers (with leb128 size fields) to the frame OBU and
        // read frame_type from the first payload bit.
        int pos = 0;
        while (pos < length)
        {
            if (pos + 1 > length) break;
            byte obuHeader = data[pos];
            int obuType = (obuHeader >> 3) & 0x0F;
            bool hasExtension = (obuHeader & 0x04) != 0;
            bool hasSizeField = (obuHeader & 0x02) != 0;
            pos += 1;

            if (hasExtension)
            {
                if (pos >= length) break;
                pos += 1;
            }

            long payloadSize = -1;
            if (hasSizeField)
            {
                long sz = 0;
                int shift = 0;
                bool done = false;
                while (pos < length && shift < 56)
                {
                    byte b = data[pos];
                    pos += 1;
                    sz |= (long)(b & 0x7F) << shift;
                    shift += 7;
                    if ((b & 0x80) == 0) { done = true; break; }
                }
                if (!done) break;
                payloadSize = sz;
            }

            // Frame header / frame OBU — read frame_type from the payload.
            // AV1 uncompressed header first byte layout (MSB→LSB):
            //   frame_marker(2)=01 | version(1) | show_existing_frame(1) |
            //   frame_type(2) | show_frame(1) | error_resilient_mode(1)
            // → frame_type == 0 means KEY_FRAME. Bits [3..2] → shift by 2.
            if (obuType == 3 || obuType == 6)
            {
                if (pos >= length) return false;
                int frameType = (data[pos] >> 2) & 0x03;
                return frameType == 0;
            }

            if (payloadSize >= 0)
            {
                pos += (int)payloadSize;
            }
            else if (obuType != 2)
            {
                // No size field on a non-delimiter OBU — cannot locate the
                // frame header safely; fall back to "not keyframe".
                break;
            }
        }
        return false;
    }
}
