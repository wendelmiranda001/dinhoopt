using DiNho.Capture.Poc.Capture;

namespace DiNho.Capture.Poc.Tests;

public sealed class PrintWindowCaptureSourceTests
{
    // ═══════════════════════════════════════════════════════════════
    //  ToEvenCaptureDimension — seam pura (G2 paridade / stale dims)
    //  Garante W/H SEMPRE par (NV12/NVENC) e zera 0/1 (degenerado).
    // ═══════════════════════════════════════════════════════════════

    [Theory]
    [InlineData(0, 0)]
    [InlineData(-5, 0)]   // negativos → degenerado → 0
    [InlineData(-1, 0)]
    [InlineData(1, 0)]    // 1px (ímpar) → degenerado → 0 (antes: 1 — paridade quebrada)
    [InlineData(2, 2)]
    [InlineData(3, 2)]    // 3 → arredonda para baixo no par
    [InlineData(4, 4)]
    [InlineData(5, 4)]
    [InlineData(100, 100)]
    [InlineData(101, 100)]
    public void ToEvenCaptureDimension_ReturnsExpected(int input, int expected)
    {
        Assert.Equal(expected, PrintWindowCaptureSource.ToEvenCaptureDimension(input));
    }

    [Fact]
    public void ToEvenCaptureDimension_NeverReturnsOdd_ForAllNonNegatives()
    {
        for (int i = 0; i <= 2000; i++)
        {
            var result = PrintWindowCaptureSource.ToEvenCaptureDimension(i);
            Assert.True((result & 1) == 0, $"input={i} → {result} é ímpar");
        }
    }

    // ═══════════════════════════════════════════════════════════════
    //  Name — propriedade estática, não exige HW
    // ═══════════════════════════════════════════════════════════════

    [Fact]
    public void Name_IsPrintWindow()
    {
        using var source = new PrintWindowCaptureSource();
        Assert.Equal("PrintWindow", source.Name);
    }
}
