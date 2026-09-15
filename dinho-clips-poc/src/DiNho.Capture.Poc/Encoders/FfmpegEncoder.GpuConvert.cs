using System.Runtime.CompilerServices;
using DiNho.Capture.Poc.Logging;
using Vortice.Direct3D11;
using Vortice.DXGI;
using Vortice.MediaFoundation;

namespace DiNho.Capture.Poc.Encoders;

internal partial class FfmpegEncoder
{
    private DateTime _gpuConverterFailedUntil = DateTime.MinValue;
    private const int GPU_CONVERTER_COOLDOWN_MS = 5000;

    // Item B: readback do staging sem bloquear a thread de captura. DoNotWait devolve
    // DXGI_ERROR_WAS_STILL_DRAWING quando a GPU ainda desenha o frame anterior — em vez
    // de segurar a thread por 0.5-4ms (o hotspot do Map visto no benchmark do pipeline).
    internal const Vortice.Direct3D11.MapFlags StagingMapFlags = Vortice.Direct3D11.MapFlags.DoNotWait;
    internal const int DXGI_ERROR_WAS_STILL_DRAWING = unchecked((int)0x887A000A);

    // Classifica exceção do Map como "GPU ocupada" (busy transiente). Só WAS_STILL_DRAWING
    // é retry no mesmo frame; device removed / E_FAIL são falhas reais (contam como drop).
    internal static bool IsGpuBusyMapError(Exception ex) => ex.HResult == DXGI_ERROR_WAS_STILL_DRAWING;

    // Incidente 2026-08-14: DoNotWait devolve WAS_STILL_DRAWING em TODO frame sob carga
    // sustentada (jogo + WGC + NVENC) — GPU nunca alcança, "retry no próximo frame" nunca
    // vence → video=0frames → "Nothing to save". Primeiro tenta o fast-path DoNotWait
    // (não bloqueia a thread quando a GPU está livre); se busy, retenta bloqueante no MESMO
    // frame com MapFlags.None (espera a GPU liberar, ~0.5-4ms) — preserva o frame em vez de
    // descartar. False só quando AMBOS falharem busy (drop transiente legítimo).
    // Erro NÃO-busy em qualquer um dos paths propaga (falha real: device removed / E_FAIL).
    internal static bool TryMapWithBusyRetry(
        Func<MappedSubresource> fastMap,
        Func<MappedSubresource> blockingMap,
        out MappedSubresource map)
    {
        try
        {
            map = fastMap();
            return true;
        }
        catch (Exception ex) when (IsGpuBusyMapError(ex))
        {
            // Fast-path ocupado: bloqueia no mesmo frame para preservar o frame.
            try
            {
                map = blockingMap();
                return true;
            }
            catch (Exception ex2) when (IsGpuBusyMapError(ex2))
            {
                map = default;
                return false;
            }
        }
    }

    private ID3D11Texture2D? _cpuStaging;
    private int _cpuStagingW, _cpuStagingH;
    private Format _cpuStagingFormat;
    private byte[]? _downscaleScratch;
    private int _downscaleScratchW, _downscaleScratchH;

    // O2: o D3D11 VideoProcessor (VideoProcessorBlt) lê a textura de entrada via
    // ID3D11VideoProcessorInputView, que exige bind como ShaderResource. Texturas criadas
    // com BindFlags.None (PrintWindow/Hybrid) precisam da cópia _inputCopy; texturas do
    // TexturePool (WGC) já saem com ShaderResource e podem ser lidas direto — evita a
    // cópia redundante de ~9,9MB por frame (1080p BGRA).
    internal static bool CanUseDirectInput(Texture2DDescription desc) =>
        (desc.BindFlags & BindFlags.ShaderResource) != 0;

    /// <summary>
    /// Downscale bilinear BGRA. Preserva o aspect ao operar sobre a frame inteira
    /// (dst já traz o aspect ajustado pelo ComputeScaleTarget). Identidade = cópia.
    /// </summary>
    internal static byte[] DownscaleBgra(ReadOnlySpan<byte> src, int srcW, int srcH, int srcRowPitch, int dstW, int dstH)
        => DownscaleBgra(src, srcW, srcH, srcRowPitch, dstW, dstH, new byte[dstW * dstH * 4]);

    /// <summary>
    /// Overload que grava num buffer de destino fornecido pelo chamador (cacheado),
    /// evitando o alloc de LOH por frame no fallback CPU (MED #2).
    /// </summary>
    internal static byte[] DownscaleBgra(ReadOnlySpan<byte> src, int srcW, int srcH, int srcRowPitch, int dstW, int dstH, byte[] dst)
    {
        if (srcW <= 0 || srcH <= 0 || dstW <= 0 || dstH <= 0 || src.Length == 0)
            return Array.Empty<byte>();
        if (dstW == srcW && dstH == srcH)
        {
            src.CopyTo(dst);
            return dst;
        }

        int dstBytes = dstW * dstH * 4;
        // Mapeamento centro-a-centro: o centro do pixel de destino é projetado na origem
        // ((dst+0.5)*srcW/dstW - 0.5). Evita viés para os pixels de borda e coincide com o
        // filtro do VideoProcessor (box/bilinear na resolução final). Em identidade (dst==src)
        // cai no branch de cópia acima — nunca chega aqui.
        float xScale = (float)srcW / dstW;
        float yScale = (float)srcH / dstH;
        for (int dy = 0; dy < dstH; dy++)
        {
            float fy = (dy + 0.5f) * yScale - 0.5f;
            if (fy < 0) fy = 0;
            int y0 = (int)fy;
            if (y0 > srcH - 2) y0 = srcH - 2;
            float wy = fy - y0;
            int y1 = y0 + 1;
            for (int dx = 0; dx < dstW; dx++)
            {
                float fx = (dx + 0.5f) * xScale - 0.5f;
                if (fx < 0) fx = 0;
                int x0 = (int)fx;
                if (x0 > srcW - 2) x0 = srcW - 2;
                float wx = fx - x0;
                int x1 = x0 + 1;

                int p00 = y0 * srcRowPitch + x0 * 4;
                int p01 = y0 * srcRowPitch + x1 * 4;
                int p10 = y1 * srcRowPitch + x0 * 4;
                int p11 = y1 * srcRowPitch + x1 * 4;
                int o = (dy * dstW + dx) * 4;
                for (int c = 0; c < 4; c++)
                {
                    float top = src[p00 + c] * (1 - wx) + src[p01 + c] * wx;
                    float bottom = src[p10 + c] * (1 - wx) + src[p11 + c] * wx;
                    float v = top * (1 - wy) + bottom * wy;
                    dst[o + c] = (byte)Math.Round(v);
                }
            }
        }
        return dst;
    }

    /// <summary>
    /// Converte BGRA (largura = srcRowPitch, sem padding assumido nas linhas) → NV12.
    /// NV12: plane Y (width*height) seguida de UV interleaved ((height/2)*width*2),
    /// BT.601 limited range (mesmas fórmulas do caminho GPU/ffmpeg).
    /// </summary>
    internal static void BgraToNv12(ReadOnlySpan<byte> bgra, int srcRowPitch, int width, int height, byte[] nv12)
    {
        int ySize = width * height;
        for (int row = 0; row < height; row++)
        {
            var srcRow = bgra.Slice(row * srcRowPitch, width * 4);
            for (int col = 0; col < width; col++)
            {
                byte b = srcRow[col * 4 + 0];
                byte g = srcRow[col * 4 + 1];
                byte r = srcRow[col * 4 + 2];

                int y = ((66 * r + 129 * g + 25 * b + 128) >> 8) + 16;
                nv12[row * width + col] = (byte)(y < 16 ? 16 : y > 235 ? 235 : y);

                if ((row & 1) == 0 && (col & 1) == 0)
                {
                    int u = ((-38 * r - 74 * g + 112 * b + 128) >> 8) + 128;
                    int v = ((112 * r - 94 * g - 18 * b + 128) >> 8) + 128;
                    int uvIdx = ySize + (row / 2) * width + col;
                    nv12[uvIdx] = (byte)(u < 16 ? 16 : u > 240 ? 240 : u);
                    nv12[uvIdx + 1] = (byte)(v < 16 ? 16 : v > 240 ? 240 : v);
                }
            }
        }
    }

    private int Nv12W => _nv12W > 0 ? _nv12W : _width;
    private int Nv12H => _nv12H > 0 ? _nv12H : _height;

    private unsafe byte[]? ConvertGpuNv12(ID3D11Texture2D texture, byte[] dst)
    {
        if ((_cropW > 0 && _cropW < 320) || (_cropH > 0 && _cropH < 240))
        {
            _gpuConvertFails++;
            Log.W("FfmpegEncoder", $"crop too small {_cropW}x{_cropH} — skipping frame");
            return null;
        }

        var texDesc = texture.Description;
        // Allow height mismatch of 1 pixel (odd→even rounding in Initialize).
        // G3: mismatch NÃO descarta o frame permanentemente — cai para a conversão CPU
        // (que acomoda dims arbitrárias da textura). Antes o frame era dropado até o
        // restart; um mismatch transiente (stale do pool/res change) custava vídeo.
        if (texDesc.Width != _width || Math.Abs((int)texDesc.Height - _height) > 1)
        {
            _gpuConvertFails++;
            Log.W("FfmpegEncoder", $"DIM MISMATCH guard: tex={texDesc.Width}x{texDesc.Height} esperado={_width}x{_height} — usando conversão CPU");
            return ConvertCpuNv12(texture, texture.Device, dst);
        }

        // Odd capture height: GpuVideoConverter requires even NV12 dimensions — go straight to CPU fallback
        if ((texDesc.Height & 1) != 0)
            return ConvertCpuNv12(texture, texture.Device, dst);

        var device = texture.Device;
        var ctx = device.ImmediateContext;

        if (_gpuConverter == null && DateTime.UtcNow < _gpuConverterFailedUntil)
            return ConvertCpuNv12(texture, device, dst);

        int nv12W = Nv12W, nv12H = Nv12H;
        try
        {
            // Recria se as dims mudaram (cascading fallback altera o scale target).
            if (_gpuConverter == null
                || _gpuConverter.InputWidth != _width
                || _gpuConverter.InputHeight != _height
                || _gpuConverter.OutputWidth != nv12W
                || _gpuConverter.OutputHeight != nv12H)
            {
                _gpuConverter?.Dispose();
                _gpuConverter = new GpuVideoConverter(device, _width, _height, nv12W, nv12H);
            }
            _gpuConverterFailedUntil = DateTime.MinValue;
        }
        catch (Exception ex)
        {
            _gpuConvertFails++;
            _gpuConverterFailedUntil = DateTime.UtcNow.AddMilliseconds(GPU_CONVERTER_COOLDOWN_MS);
            Log.E("FfmpegEncoder", $"GpuVideoConverter constructor fail #{_gpuConvertFails}: {ex.Message} — falling back to CPU conversion");
            return ConvertCpuNv12(texture, device, dst);
        }

        try
        {
            // O2: textura ShaderResource (WGC) é lida direto pelo VideoProcessor — sem cópia.
            // BindFlags.None (PrintWindow/Hybrid) precisa da cópia _inputCopy (SR|RT).
            var source = texture;
            if (!CanUseDirectInput(texDesc))
            {
                EnsureInputCopy(texture, device);
                ctx.CopyResource(_inputCopy, texture);
                source = _inputCopy!;
            }

            var nv12Tex = _gpuConverter.Convert(source);
            EnsureStaging(device);
            ctx.CopyResource(_nv12Staging, nv12Tex);

            // Map() com DoNotWait: devolve DXGI_ERROR_WAS_STILL_DRAWING quando a GPU ainda
            // desenha o frame anterior, em vez de bloquear a thread de captura 0.5-4ms.
            // Incidente 2026-08-14: sob carga SUSTENTADA (jogo + WGC + NVENC) a GPU NUNCA
            // alcança — DoNotWait falha em TODO frame e o "retry no próximo frame" nunca
            // vence → video=0frames → "Nothing to save". Fix: retry bloqueante no MESMO
            // frame com MapFlags.None (bloqueia até a GPU liberar, ~0.5-4ms de espera).
            // Busy mantido + retry bloqueante ainda falhando = drop transiente SEM contar
            // como falha de conversão (evita restart loop); watchdog cobre drops sustentados.
            MappedSubresource map;
            if (!TryMapWithBusyRetry(
                    () => ctx.Map(_nv12Staging!, 0, MapMode.Read, StagingMapFlags),
                    () => ctx.Map(_nv12Staging!, 0, MapMode.Read, Vortice.Direct3D11.MapFlags.None),
                    out map))
            {
                _lastFrameBusyDrop = true;
                Interlocked.Increment(ref _gpuBusyDrops);
                Log.D("FfmpegEncoder", "GPU busy (0x887A000A) — fast DoNotWait + blocking retry failed, frame dropped");
                return null;
            }
            _gpuConvertFails = 0;
            try
            {
                return PackNv12(map, dst);
            }
            finally { ctx.Unmap(_nv12Staging, 0); }
        }
        catch (DeviceLostException)
        {
            _gpuConverter?.Dispose();
            _gpuConverter = null;
            _gpuConverterFailedUntil = DateTime.MinValue;
            _nv12Staging?.Dispose();
            _nv12Staging = null;
            _inputCopy?.Dispose();
            _inputCopy = null;
            _gpuConvertFails++;
            throw;
        }
        catch (Exception ex)
        {
            _gpuConvertFails++;
            Log.E("FfmpegEncoder", $"GPU convert fail #{_gpuConvertFails}: {ex.GetType().Name}: {ex.Message}");
            return ConvertCpuNv12(texture, device, dst);
        }
    }

    private unsafe byte[]? ConvertCpuNv12(ID3D11Texture2D texture, ID3D11Device device, byte[] dst)
    {
        try
        {
            var texDesc = texture.Description;
            int texW = (int)texDesc.Width;
            int texH = (int)texDesc.Height;
            // Staging texture must match source size AND format for CopyResource, but we only convert _height rows
            if (_cpuStaging == null || _cpuStagingW != texW || _cpuStagingH != texH || _cpuStagingFormat != texDesc.Format)
            {
                _cpuStaging?.Dispose();
                _cpuStaging = device.CreateTexture2D(new Texture2DDescription
                {
                    Width = (uint)texW, Height = (uint)texH, MipLevels = 1, ArraySize = 1,
                    Format = texDesc.Format,
                    SampleDescription = new SampleDescription(1, 0),
                    Usage = ResourceUsage.Staging,
                    BindFlags = BindFlags.None,
                    CPUAccessFlags = CpuAccessFlags.Read,
                });
                _cpuStagingW = texW;
                _cpuStagingH = texH;
                _cpuStagingFormat = texDesc.Format;
                Log.W("FfmpegEncoder", $"CPU BGRA→NV12 fallback active (capture={texW}x{texH} encode={_width}x{_height} fmt={texDesc.Format})");
            }

            int nv12W = Nv12W, nv12H = Nv12H;
            var ctx = device.ImmediateContext;
            ctx.CopyResource(_cpuStaging, texture);
            var map = ctx.Map(_cpuStaging, 0, MapMode.Read, Vortice.Direct3D11.MapFlags.None);
            try
            {
                int srcPitch = (int)map.RowPitch;
                int ySize = nv12H * nv12W;
                int totalSize = ySize + (nv12H / 2) * nv12W;

                var src = (byte*)map.DataPointer.ToPointer();
                // texH == nv12H + 1 (altura ímpar) pode usar o branch direto: só converte as
                // primeiras nv12H linhas e descarta a última — evita bilinear do frame inteiro.
                if (texW == nv12W && (texH == nv12H || texH == nv12H + 1))
                {
                    fixed (byte* dstPtr = dst)
                    {
                        byte* yPlane = dstPtr;
                        byte* uvPlane = dstPtr + ySize;

                        // Only convert _height rows (may be 1 less than texH if odd)
                        for (int row = 0; row < nv12H; row++)
                        {
                            var srcRow = src + row * srcPitch;
                            for (int col = 0; col < nv12W; col++)
                            {
                                byte b = srcRow[col * 4 + 0];
                                byte g = srcRow[col * 4 + 1];
                                byte r = srcRow[col * 4 + 2];

                                int y = ((66 * r + 129 * g + 25 * b + 128) >> 8) + 16;
                                yPlane[row * nv12W + col] = (byte)(y < 16 ? 16 : y > 235 ? 235 : y);

                                // NV12: U and V are interleaved in the same plane (U V U V ...)
                                if ((row & 1) == 0 && (col & 1) == 0)
                                {
                                    int u = ((-38 * r - 74 * g + 112 * b + 128) >> 8) + 128;
                                    int v = ((112 * r - 94 * g - 18 * b + 128) >> 8) + 128;
                                    int uvIdx = (row / 2) * nv12W + col;
                                    uvPlane[uvIdx] = (byte)(u < 16 ? 16 : u > 240 ? 240 : u);
                                    uvPlane[uvIdx + 1] = (byte)(v < 16 ? 16 : v > 240 ? 240 : v);
                                }
                            }
                        }
                    }
                }
                else
                {
                    // O1: downscale bilinear + conversão na resolução final (uma única cópia
                    // da staging → scratch, sem passar pelo scale do ffmpeg).
                    if (_downscaleScratch == null
                        || _downscaleScratchW != nv12W
                        || _downscaleScratchH != nv12H)
                    {
                        _downscaleScratch = new byte[nv12W * nv12H * 4];
                        _downscaleScratchW = nv12W;
                        _downscaleScratchH = nv12H;
                    }
                    DownscaleBgra(
                        new ReadOnlySpan<byte>(src, srcPitch * texH),
                        texW, texH, srcPitch, nv12W, nv12H, _downscaleScratch);
                    BgraToNv12(_downscaleScratch, nv12W * 4, nv12W, nv12H, dst);
                }
                return dst;
            }
            finally { ctx.Unmap(_cpuStaging, 0); }
        }
        catch (Exception ex)
        {
            _gpuConvertFails++;
            Log.E("FfmpegEncoder", $"CPU convert fail #{_gpuConvertFails}: {ex.GetType().Name}: {ex.Message}");
            return null;
        }
    }

    private void EnsureInputCopy(ID3D11Texture2D texture, ID3D11Device device)
    {
        var desc = texture.Description;
        if (_inputCopy != null && _inputCopyW == desc.Width && _inputCopyH == desc.Height && _inputCopyFormat == desc.Format)
            return;
        _inputCopy?.Dispose();
        _inputCopy = device.CreateTexture2D(new Texture2DDescription
        {
            Width = desc.Width, Height = desc.Height, MipLevels = 1, ArraySize = 1,
            Format = desc.Format,
            SampleDescription = new SampleDescription(1, 0),
            Usage = ResourceUsage.Default,
            BindFlags = BindFlags.ShaderResource | BindFlags.RenderTarget,
            CPUAccessFlags = CpuAccessFlags.None,
        });
        Log.D("FfmpegEncoder", $"EnsureInputCopy: {desc.Width}x{desc.Height} fmt={desc.Format}");
        _inputCopyW = (int)desc.Width;
        _inputCopyH = (int)desc.Height;
        _inputCopyFormat = desc.Format;
    }

    private void EnsureStaging(ID3D11Device device)
    {
        int nv12W = Nv12W, nv12H = Nv12H;
        if (_nv12Staging != null && _stagingW == nv12W && _stagingH == nv12H) return;
        _nv12Staging?.Dispose();
        _nv12Staging = device.CreateTexture2D(new Texture2DDescription
        {
            Width = (uint)nv12W, Height = (uint)nv12H, MipLevels = 1, ArraySize = 1,
            Format = Format.NV12,
            SampleDescription = new SampleDescription(1, 0),
            Usage = ResourceUsage.Staging,
            BindFlags = BindFlags.None,
            CPUAccessFlags = CpuAccessFlags.Read,
        });
        _stagingW = nv12W;
        _stagingH = nv12H;
    }

    private unsafe byte[] PackNv12(MappedSubresource map, byte[] dst)
    {
        int srcPitch = (int)map.RowPitch;
        int nv12W = Nv12W, nv12H = Nv12H;
        int ySize = nv12H * nv12W;
        int totalSize = ySize + nv12H / 2 * nv12W;

        var src = (byte*)map.DataPointer.ToPointer();

        // Bulk copy Y plane (1620 individual CopyBlock calls → 1 bulk copy for 1080p)
        int yBytes = ySize;
        if (srcPitch == nv12W)
        {
            Unsafe.CopyBlockUnaligned(ref dst[0], ref src[0], (uint)yBytes);
        }
        else
        {
            for (int y = 0; y < nv12H; y++)
                Unsafe.CopyBlockUnaligned(ref dst[y * nv12W], ref src[y * srcPitch], (uint)nv12W);
        }

        // Bulk copy UV plane
        int uvSrcBase = srcPitch * nv12H;
        int uvBytes = nv12H / 2 * nv12W;
        if (srcPitch == nv12W)
        {
            Unsafe.CopyBlockUnaligned(ref dst[yBytes], ref src[uvSrcBase], (uint)uvBytes);
        }
        else
        {
            for (int y = 0; y < nv12H / 2; y++)
                Unsafe.CopyBlockUnaligned(ref dst[yBytes + y * nv12W], ref src[uvSrcBase + y * srcPitch], (uint)nv12W);
        }

        return dst;
    }
}
