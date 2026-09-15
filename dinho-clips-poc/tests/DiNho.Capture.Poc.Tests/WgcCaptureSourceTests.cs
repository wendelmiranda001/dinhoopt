using DiNho.Capture.Poc.Capture;
using System.Reflection;
using System.Runtime.InteropServices;

namespace DiNho.Capture.Poc.Tests;

public sealed class WgcCaptureSourceTests
{
    // ═══════════════════════════════════════════════════════════════
    //  CapturedFrame — constructor & properties
    // ═══════════════════════════════════════════════════════════════

    [Fact]
    public void CapturedFrame_Success_HasCorrectDimensions()
    {
        var frame = new CapturedFrame(100, 200, 1920, 1080, success: true);
        Assert.Equal(1920, frame.Width);
        Assert.Equal(1080, frame.Height);
        Assert.True(frame.Success);
    }

    [Fact]
    public void CapturedFrame_Failure_HasZeroDimensions()
    {
        var frame = new CapturedFrame(100, 200, 0, 0, success: false);
        Assert.Equal(0, frame.Width);
        Assert.Equal(0, frame.Height);
        Assert.False(frame.Success);
    }

    [Fact]
    public void CapturedFrame_PreservesTicks()
    {
        var frame = new CapturedFrame(startTicks: 1000, endTicks: 2000, width: 100, height: 100, success: true);
        Assert.Equal(1000, frame.CaptureStartTicks);
        Assert.Equal(2000, frame.CaptureEndTicks);
    }

    [Fact]
    public void CapturedFrame_WaitEndTicks_DefaultsToZero()
    {
        var frame = new CapturedFrame(0, 0, 0, 0, success: false);
        Assert.Equal(0, frame.WaitEndTicks);
        Assert.Equal(0, frame.CopyEndTicks);
    }

    [Fact]
    public void CapturedFrame_WaitEndTicks_CanBeSet()
    {
        var frame = new CapturedFrame(0, 0, 100, 100, success: true, waitEndTicks: 500, copyEndTicks: 600);
        Assert.Equal(500, frame.WaitEndTicks);
        Assert.Equal(600, frame.CopyEndTicks);
    }

    [Fact]
    public void CapturedFrame_TextureDefaultsToNull()
    {
        var frame = new CapturedFrame(0, 0, 100, 100, success: true);
        Assert.Null(frame.Texture);
        Assert.Null(frame.Device);
    }

    [Fact]
    public void CapturedFrame_OwnsTexture_DefaultsTrue()
    {
        var frame = new CapturedFrame(0, 0, 100, 100, success: true);
        Assert.True(frame.OwnsTexture);
    }

    [Fact]
    public void CapturedFrame_OwnsTexture_CanBeSetFalse()
    {
        var frame = new CapturedFrame(0, 0, 100, 100, success: true, ownsTexture: false);
        Assert.False(frame.OwnsTexture);
    }

    // ── Dispose behavior ────────────────────────────────────────────

    [Fact]
    public void CapturedFrame_Dispose_WithNullTexture_DoesNotThrow()
    {
        var frame = new CapturedFrame(0, 0, 100, 100, success: true);
        frame.Dispose(); // no exception
    }

    [Fact]
    public void CapturedFrame_Dispose_CanBeCalledMultipleTimes()
    {
        var frame = new CapturedFrame(0, 0, 100, 100, success: true);
        frame.Dispose();
        frame.Dispose(); // no exception
    }

    // ── Failure frame scenarios ─────────────────────────────────────

    [Fact]
    public void CapturedFrame_Timeout_HasZeroSize()
    {
        // Simulates timeout from TryCaptureFrame
        var frame = new CapturedFrame(100, 300, 0, 0, success: false, waitEndTicks: 300);
        Assert.False(frame.Success);
        Assert.Equal(0, frame.Width);
        Assert.Equal(0, frame.Height);
        Assert.Equal(300, frame.WaitEndTicks);
    }

    [Fact]
    public void CapturedFrame_DisposedSignal_HasZeroSize()
    {
        // Simulates ObjectDisposedException from TryCaptureFrame
        var frame = new CapturedFrame(100, 400, 0, 0, success: false, waitEndTicks: 400);
        Assert.False(frame.Success);
        Assert.Equal(400, frame.WaitEndTicks);
    }

    // ═══════════════════════════════════════════════════════════════
    //  WgcCaptureSource — Name property (comparable without GPU init)
    // ═══════════════════════════════════════════════════════════════

    // Note: WgcCaptureSource cannot be constructed without D3D11/WGC APIs.
    // These tests verify the Name via the ICaptureSource interface contract.
    // The actual name is "Windows Graphics Capture" (hardcoded).

    [Fact]
    public void CapturedFrame_LargeDimensions_Preserved()
    {
        var frame = new CapturedFrame(0, 0, 3840, 2160, success: true);
        Assert.Equal(3840, frame.Width);
        Assert.Equal(2160, frame.Height);
    }

    [Fact]
    public void CapturedFrame_ZeroTicks_IsValid()
    {
        var frame = new CapturedFrame(0, 0, 1920, 1080, success: true);
        Assert.Equal(0, frame.CaptureStartTicks);
        Assert.Equal(0, frame.CaptureEndTicks);
    }

    // ═══════════════════════════════════════════════════════════════
    //  CapturedFrame — timing sequence invariant
    // ═══════════════════════════════════════════════════════════════

    [Fact]
    public void CapturedFrame_TimingSequence_StartLessThanWaitLessThanCopy()
    {
        // Typical timing: start < waitEnd < copyEnd
        var frame = new CapturedFrame(
            startTicks: 100,
            endTicks: 300,
            width: 1920,
            height: 1080,
            success: true,
            waitEndTicks: 200,
            copyEndTicks: 300);

        Assert.True(frame.CaptureStartTicks <= frame.WaitEndTicks);
        Assert.True(frame.WaitEndTicks <= frame.CaptureEndTicks);
    }

    [Fact]
    public void CapturedFrame_TimingSequence_AllZero_ForFailure()
    {
        var frame = new CapturedFrame(0, 0, 0, 0, success: false);
        Assert.Equal(0, frame.CaptureStartTicks);
        Assert.Equal(0, frame.CaptureEndTicks);
        Assert.Equal(0, frame.WaitEndTicks);
        Assert.Equal(0, frame.CopyEndTicks);
    }

    // ═══════════════════════════════════════════════════════════════
    //  TryExtractTextureFromNativePtr — extração de textura D3D11
    //  (seam testável do caminho WGC; o leak do GetRef()/Release é
    //  gerenciado pelo caller via try/finally — ver TryCaptureFrame)
    // ═══════════════════════════════════════════════════════════════

    private static string[] RunExtraction(IntPtr ptr)
    {
        var logs = new List<string>();
        var result = WgcCaptureSource.TryExtractTextureFromNativePtr(
            ptr,
            (source, message) => logs.Add($"{source}: {message}"));
        Assert.Null(result); // ponteiro de teste nunca produz textura válida
        return logs.ToArray();
    }

    [Fact]
    public void TryExtractTexture_NullPointer_ReturnsNull_WithoutLogging()
    {
        var logs = RunExtraction(IntPtr.Zero);
        Assert.Empty(logs);
    }

    [Fact]
    public void TryExtractTexture_UnsupportedPointer_ReturnsNull_AndLogsBothStrategiesFailed()
    {
        var logs = RunExtraction(Marshal.GetIUnknownForObject(new object()));
        Assert.NotEmpty(logs);
        Assert.Contains(logs, l => l.Contains("Ambas estratégias falharam"));
    }

    // ═══════════════════════════════════════════════════════════════
    //  CreateNullTextureFrame — frame com textura ausente é FALHA
    //  (o watchdog conta como drop real NoFrame; antes era success:true
    //   com textura nula — invisível ao watchdog, stall silencioso)
    // ═══════════════════════════════════════════════════════════════

    [Fact]
    public void CreateNullTextureFrame_ReportsFailure()
    {
        var frame = WgcCaptureSource.CreateNullTextureFrame(1, 2, 1920, 1080, 3, 4);
        Assert.False(frame.Success);
        Assert.Null(frame.Texture);
        Assert.Equal(1920, frame.Width);
        Assert.Equal(1080, frame.Height);
    }

    // ═══════════════════════════════════════════════════════════════
    //  ComputeCapIntervalTicks — intervalo mínimo entre frames (cap)
    //  (seam puro: 1e7 ticks = 1s; 10_000_000L / fps)
    // ═══════════════════════════════════════════════════════════════

    [Theory]
    [InlineData(30, 333333)]
    [InlineData(60, 166666)]
    [InlineData(75, 133333)]
    [InlineData(120, 83333)]
    [InlineData(144, 69444)]
    public void ComputeCapIntervalTicks_ValidFps_ReturnsExpected(int fps, long expectedTicks)
    {
        Assert.Equal(expectedTicks, WgcCaptureSource.ComputeCapIntervalTicks(fps));
    }

    [Theory]
    [InlineData(0)]
    [InlineData(-1)]
    [InlineData(-120)]
    public void ComputeCapIntervalTicks_ZeroOrNegative_ReturnsZero(int fps)
    {
        Assert.Equal(0, WgcCaptureSource.ComputeCapIntervalTicks(fps));
    }

    // ═══════════════════════════════════════════════════════════════
    //  ShouldAcceptFrame — fallback manual do cap (pré-24H2)
    //  (seam puro: aceita quando agora - último >= intervalo)
    // ═══════════════════════════════════════════════════════════════

    [Fact]
    public void ShouldAcceptFrame_NoCap_AlwaysAccepts()
    {
        Assert.True(WgcCaptureSource.ShouldAcceptFrame(1000, 0, capIntervalTicks: 0));
        Assert.True(WgcCaptureSource.ShouldAcceptFrame(1000, 500, capIntervalTicks: 0));
        Assert.True(WgcCaptureSource.ShouldAcceptFrame(1000, 999, capIntervalTicks: -1));
    }

    [Fact]
    public void ShouldAcceptFrame_WithinInterval_Rejects()
    {
        // intervalo 166666 ticks (60fps): frame 100_000 ticks após o último → rejeita
        Assert.False(WgcCaptureSource.ShouldAcceptFrame(500_000, 400_000, 166_666));
    }

    [Fact]
    public void ShouldAcceptFrame_ExactlyAtInterval_Accepts()
    {
        // agora - último == intervalo exato → aceita (boundary inclusiva)
        Assert.True(WgcCaptureSource.ShouldAcceptFrame(566_666, 400_000, 166_666));
    }

    [Fact]
    public void ShouldAcceptFrame_AfterInterval_Accepts()
    {
        Assert.True(WgcCaptureSource.ShouldAcceptFrame(600_000, 400_000, 166_666));
    }

    [Fact]
    public void ShouldAcceptFrame_FirstFrame_Accepts()
    {
        // último = 0 (inicial): primeiro frame sempre aceito
        Assert.True(WgcCaptureSource.ShouldAcceptFrame(100_000, 0, 166_666));
    }

    [Fact]
    public void TryExtractTexture_UnsupportedPointer_DoesNotOverReleaseCallersPointer()
    {
        var managed = new object();
        var ptr = Marshal.GetIUnknownForObject(managed);
        try
        {
            RunExtraction(ptr);

            // Se o helper desse Release indevido no ponteiro do caller,
            // o RCW seria desconectado e o QI a seguir falharia com
            // RPC_E_DISCONNECTED (0x80010108) ou retornaria erro.
            var iidIUnknown = Guid.Parse("00000000-0000-0000-C000-000000000046");
            var hr = Marshal.QueryInterface(ptr, in iidIUnknown, out var ppv);
            try
            {
                Assert.Equal(0, hr);
            }
            finally
            {
                if (hr == 0) Marshal.Release(ppv);
            }
        }
        finally
        {
            Marshal.Release(ptr);
        }
    }

    // ═══════════════════════════════════════════════════════════════
    //  WgcCaptureSource — lifecycle (G2): o construtor NÃO exige HW
    //  (só Initialize() cria device/sessão). Cobre:
    //   - self-heal exige _session (HW) → coberto analiticamente no código;
    //     aqui fixamos a semântica do campo _capIntervalTicks.
    //   - Dispose idempotente (antes relançava ObjectDisposedException).
    //   - TryCaptureFrame pós-dispose → falha limpa.
    //   - StartFramePump sem init/dispose → exceção clara.
    // ═══════════════════════════════════════════════════════════════

    private static long ReadCapIntervalTicks(WgcCaptureSource source)
    {
        var field = typeof(WgcCaptureSource).GetField("_capIntervalTicks", BindingFlags.NonPublic | BindingFlags.Instance)!;
        return (long)field.GetValue(source)!;
    }

    [Fact]
    public void SetCaptureFrameRate_SetsCapIntervalTicks()
    {
        using var source = new WgcCaptureSource();
        source.SetCaptureFrameRate(30);
        Assert.Equal(WgcCaptureSource.ComputeCapIntervalTicks(30), ReadCapIntervalTicks(source));
    }

    [Fact]
    public void SetCaptureFrameRate_ZeroOrNegative_DisablesCap()
    {
        using var source = new WgcCaptureSource();
        source.SetCaptureFrameRate(0);
        Assert.Equal(0, ReadCapIntervalTicks(source));
        source.SetCaptureFrameRate(-1);
        Assert.Equal(0, ReadCapIntervalTicks(source));
    }

    [Fact]
    public void Dispose_IsIdempotent_SecondCallDoesNotThrow()
    {
        var source = new WgcCaptureSource();
        source.Dispose();
        source.Dispose();
    }

    [Fact]
    public void TryCaptureFrame_AfterDispose_ReturnsFailure()
    {
        var source = new WgcCaptureSource();
        source.Dispose();
        var frame = source.TryCaptureFrame(5);
        Assert.False(frame.Success);
        Assert.Equal(0, frame.Width);
        Assert.Equal(0, frame.Height);
    }

    [Fact]
    public void StartFramePump_NotInitialized_Throws()
    {
        using var source = new WgcCaptureSource();
        Assert.Throws<InvalidOperationException>(() => source.StartFramePump());
    }

    [Fact]
    public void StartFramePump_AfterDispose_ThrowsObjectDisposed()
    {
        var source = new WgcCaptureSource();
        source.Dispose();
        Assert.Throws<ObjectDisposedException>(() => source.StartFramePump());
    }
}
