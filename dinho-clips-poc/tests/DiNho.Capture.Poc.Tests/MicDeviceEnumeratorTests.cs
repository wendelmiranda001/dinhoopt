using DiNho.Capture.Poc.Audio;

namespace DiNho.Capture.Poc.Tests;

// 4.8: NormalizeFormat é a parte pura (fallback quando MixFormat devolve 0/bufs
// inválidos). A consulta ao device real é HW-bound e fica coberta em runtime.
public sealed class MicDeviceEnumeratorTests
{
    [Theory]
    [InlineData(2, 48000, 2, 48000)]     // valores saudáveis passam intactos
    [InlineData(0, 0, 1, 16000)]         // fallback completo
    [InlineData(-3, -1, 1, 16000)]       // valores absurdos → fallback
    [InlineData(1, 0, 1, 16000)]         // taxa zero → fallback
    [InlineData(7, 44100, 7, 44100)]     // multi-canal preservado
    public void NormalizeFormat_InvalidInputs_FallsBack(int ch, int sr, int expCh, int expSr)
    {
        var (c, s) = MicDeviceEnumerator.NormalizeFormat(ch, sr);
        Assert.Equal(expCh, c);
        Assert.Equal(expSr, s);
    }
}