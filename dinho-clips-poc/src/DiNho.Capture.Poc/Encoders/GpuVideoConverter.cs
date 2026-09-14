using Vortice.Direct3D11;
using Vortice.DXGI;

namespace DiNho.Capture.Poc.Encoders;

internal sealed class GpuVideoConverter : IDisposable
{
    private readonly ID3D11VideoDevice _videoDevice;
    private readonly ID3D11VideoContext _videoContext;
    private readonly ID3D11VideoProcessor _videoProcessor;
    private readonly ID3D11VideoProcessorEnumerator _enumerator;
    private ID3D11VideoContext1? _videoContext1;
    private readonly int _width;
    private readonly int _height;
    private readonly int _outW;
    private readonly int _outH;
    private ID3D11Texture2D? _cachedOutput;
    private ID3D11VideoProcessorInputView? _cachedInputView;
    private ID3D11VideoProcessorOutputView? _cachedOutputView;
    private ID3D11Texture2D? _cachedInputViewTexture;
    private bool _disposed;

    public GpuVideoConverter(ID3D11Device device, int width, int height, int outputWidth = 0, int outputHeight = 0)
    {
        if (width < 64 || height < 64)
            throw new ArgumentException($"GpuVideoConverter: dimensão ({width}x{height}) abaixo do mínimo 64x64 — crop muito pequeno causa E_INVALIDARG no VideoProcessorBlt");
        _width = width;
        _height = height;
        _outW = (outputWidth > 0 ? outputWidth : width) & ~1;
        _outH = (outputHeight > 0 ? outputHeight : height) & ~1;
        if (_outW < 2) _outW = 2;
        if (_outH < 2) _outH = 2;

        ID3D11VideoDevice? videoDevice = null;
        ID3D11VideoContext? videoContext = null;
        ID3D11VideoProcessorEnumerator? enumerator = null;
        ID3D11VideoProcessor? processor = null;
        try
        {
            videoDevice = device.QueryInterface<ID3D11VideoDevice>();
            var ctx = device.ImmediateContext;
            videoContext = ctx.QueryInterface<ID3D11VideoContext>();
            _videoDevice = videoDevice;
            _videoContext = videoContext;

            var contentDesc = new VideoProcessorContentDescription
            {
                InputFrameFormat = VideoFrameFormat.Progressive,
                InputFrameRate = new Rational(60, 1),
                InputWidth = (uint)width,
                InputHeight = (uint)height,
                OutputFrameRate = new Rational(60, 1),
                OutputWidth = (uint)_outW,
                OutputHeight = (uint)_outH,
                // OptimalQuality (não PlaybackNormal): este VideoProcessor é usado para conversão
                // de captura BGRA→NV12 frame-accurate, NÃO para playback. O modo PlaybackNormal
                // permite o driver aplicar noise reduction + edge enhancement (filtros de "TV
                // smooth"), que suavizam microdetalhes (asfalto, paredes, vegetação) mesmo em
                // alta resolução/bitrate. Vortice.OptimalQuality = 2 = native D3D11
                // VIDEO_PROCESSOR_USAGE_QUALITY (o Vortice fundiu QUALITY/OPTIMAL_QUALITY),
                // que força conversão de alta qualidade sem filtros de playback.
                Usage = VideoUsage.OptimalQuality
            };

            _videoDevice.CreateVideoProcessorEnumerator(ref contentDesc, out enumerator).CheckError();
            _videoDevice.CreateVideoProcessor(enumerator, 0, out processor).CheckError();
            _enumerator = enumerator;
            _videoProcessor = processor;

            // Define o espaço de cores correto: entrada BGRA full-range BT.709 → saída NV12
            // limited-range BT.709. Sem isso o D3D11 VideoProcessor mantém o default BT.601 e o
            // MP4 exportado fica sem o atom `colr` — players assumem BT.601 e as cores saem lavadas.
            _videoContext1 = ctx.QueryInterfaceOrNull<ID3D11VideoContext1>();
            if (_videoContext1 is not null)
            {
                try
                {
                    _videoContext1.VideoProcessorSetStreamColorSpace1(_videoProcessor, 0, ColorSpaceType.RgbFullG22NoneP709);
                    _videoContext1.VideoProcessorSetOutputColorSpace1(_videoProcessor, ColorSpaceType.YcbcrStudioG22LeftP709);
                }
                catch (Exception)
                {
                    _videoContext1.Dispose();
                    _videoContext1 = null;
                }
            }

            var nv12Desc = new Texture2DDescription
            {
                Width = (uint)_outW,
                Height = (uint)_outH,
                MipLevels = 1,
                ArraySize = 1,
                Format = Format.NV12,
                SampleDescription = new SampleDescription(1, 0),
                Usage = ResourceUsage.Default,
                BindFlags = BindFlags.RenderTarget,
                CPUAccessFlags = CpuAccessFlags.None,
            };
            _cachedOutput = device.CreateTexture2D(nv12Desc);
        }
        catch
        {
            processor?.Dispose();
            enumerator?.Dispose();
            videoDevice?.Dispose();
            videoContext?.Dispose();
            _videoContext1?.Dispose();
            throw;
        }
    }

    public ID3D11Texture2D Convert(ID3D11Texture2D inputBgra)
    {
        if (_cachedInputView == null || _cachedInputViewTexture != inputBgra)
        {
            _cachedInputView?.Dispose();
            var inputViewDesc = new VideoProcessorInputViewDescription
            {
                ViewDimension = VideoProcessorInputViewDimension.Texture2D,
                FourCC = 0,
                Texture2D = new Texture2DVideoProcessorInputView { MipSlice = 0, ArraySlice = 0 }
            };
            _videoDevice.CreateVideoProcessorInputView(
                inputBgra, _enumerator, inputViewDesc, out _cachedInputView).CheckError();
            _cachedInputViewTexture = inputBgra;
        }

        if (_cachedOutputView == null)
        {
            var outputViewDesc = new VideoProcessorOutputViewDescription
            {
                ViewDimension = VideoProcessorOutputViewDimension.Texture2D,
                Texture2D = new Texture2DVideoProcessorOutputView { MipSlice = 0 }
            };
            _videoDevice.CreateVideoProcessorOutputView(
                _cachedOutput, _enumerator, outputViewDesc, out _cachedOutputView).CheckError();
        }

        var stream = new VideoProcessorStream
        {
            Enable = true,
            OutputIndex = 0,
            InputFrameOrField = 0,
            PastFrames = 0,
            FutureFrames = 0,
            InputSurface = _cachedInputView
        };

        try
        {
            _videoContext.VideoProcessorBlt(
                _videoProcessor,
                _cachedOutputView,
                0,
                1,
                new[] { stream });
        }
        catch (Exception) when (IsDeviceLost())
        {
            throw new DeviceLostException("VideoProcessorBlt failed — device removed");
        }

        return _cachedOutput ?? throw new InvalidOperationException("GpuVideoConverter output texture not allocated");
    }

    public ID3D11Texture2D? OutputTexture => _cachedOutput;

    public int OutputWidth => _outW;

    public int OutputHeight => _outH;

    public int InputWidth => _width;

    public int InputHeight => _height;

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        _cachedOutput?.Dispose();
        _cachedInputView?.Dispose();
        _cachedOutputView?.Dispose();
        // _videoContext1 é uma QueryInterface do shared device (esperada, distinta
        // do _videoContext acima) com AddRef próprio — NÃO é o contexto compartilhado.
        // Sem o Dispose, vaza 1 ref COM por instância a cada reinit/restart do
        // encoder (classe do bug obs-nvenc "resource destruction order" — acumulação
        // não revertida de objetos do driver até o fim do processo).
        _videoContext1?.Dispose();
        _videoContext1 = null;
        // VideoProcessor and Enumerator were created by us — safe to dispose.
        _videoProcessor.Dispose();
        _enumerator.Dispose();
        // _videoContext and _videoDevice are QueryInterface references from the
        // shared D3D11 device. Disposing them releases the shared COM object
        // and crashes other subsystems using the same device (FfmpegEncoder,
        // WgcCaptureSource, etc.). We must NOT dispose or Release them here.
    }

    /// <summary>
    /// Verifica se o dispositivo D3D11 foi removido (TDR, driver crash, sleep/wake).
    /// Chamado no catch do VideoProcessorBlt para distinguir device lost de outros erros.
    /// </summary>
    private bool IsDeviceLost()
    {
        try
        {
            using var device = _videoDevice.QueryInterface<ID3D11Device>();
            return device.DeviceRemovedReason is { Failure: true };
        }
        catch
        {
            return true; // Se não conseguiu obter o device, considerar lost
        }
    }
}
