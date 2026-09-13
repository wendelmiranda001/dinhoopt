using DiNho.Capture.Poc.Capture;

namespace DiNho.Capture.Poc.Tests;

// ═══════════════════════════════════════════════════════════════════
//  CaptureBackendSelectionPolicy — "texture mode" sempre ligado
//  (Item 2: Diminui fundo branco e manchas ao capturar janelas)
//
//  O caminho SemanticWgc/DesktopDuplication (GPU→GPU, textura D3D11) é
//  o único que NÃO produz o artefato "fundo branco e manchas". O caminho
//  Hybrid/PrintWindow é o que reintroduz esse artefato. A política
//  garante que a captura nunca regride silenciosamente para o modo
//  sem-textura enquanto houver um backend de textura viável.
// ═══════════════════════════════════════════════════════════════════

public sealed class CaptureBackendSelectionPolicyTests
{
    // ── ordenação de backend por prioridade de textura ─────────────

    [Fact]
    public void Ranking_TextureBackend_ComeCheckedWithTextureSoftwareDisabledByDefault()
    {
        var ranking = CaptureBackendSelectionPolicy.TextureRanking();

        Assert.NotNull(ranking);
        Assert.NotEmpty(ranking);
    }

    [Fact]
    public void Decide_WindowValid_SemanticWgcPreferred_TextureModeOn()
    {
        var decision = CaptureBackendSelectionPolicy.Decide(
            allowHybridFallback: false,
            gameIsValid: true,
            gameHwndValid: true,
            wgcWindowDeclared: WindowDeclaredState.WgaWindow,
            desktopCaptureAvailable: true,
            dxgiDesktopAvailable: true);

        Assert.True(decision.TextureModeActive);
        Assert.Equal(CaptureBackendKind.SemanticWgc, decision.SelectedBackend);
        Assert.Null(decision.FailureReason);
    }

    [Fact]
    public void Decide_NoHybridFallback_NotATextureBackend_FailsClear()
    {
        var decision = CaptureBackendSelectionPolicy.Decide(
            allowHybridFallback: false,
            gameIsValid: true,
            gameHwndValid: true,
            wgcWindowDeclared: WindowDeclaredState.ExcludedFromCapture,
            desktopCaptureAvailable: false,
            dxgiDesktopAvailable: false);

        Assert.False(decision.TextureModeActive);
        Assert.Null(decision.SelectedBackend);
        Assert.NotNull(decision.FailureReason);
        Assert.Contains("textura", decision.FailureReason, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void Decide_AllowHybridFallback_OnlyHybridAvailable_ReturnsHybrid_WithTextureOff()
    {
        var decision = CaptureBackendSelectionPolicy.Decide(
            allowHybridFallback: true,
            gameIsValid: true,
            gameHwndValid: true,
            wgcWindowDeclared: WindowDeclaredState.ExcludedFromCapture,
            desktopCaptureAvailable: false,
            dxgiDesktopAvailable: false);

        Assert.False(decision.TextureModeActive);
        Assert.Equal(CaptureBackendKind.Hybrid, decision.SelectedBackend);
        Assert.Equal("texture-off", decision.TextureStatePerception);
    }

    [Fact]
    public void Decide_WgcDesktopOnly_StillTextureMode()
    {
        var decision = CaptureBackendSelectionPolicy.Decide(
            allowHybridFallback: false,
            gameIsValid: false,
            gameHwndValid: false,
            wgcWindowDeclared: WindowDeclaredState.NotApplicable,
            desktopCaptureAvailable: true,
            dxgiDesktopAvailable: false);

        Assert.True(decision.TextureModeActive);
        Assert.Equal(CaptureBackendKind.SemanticDesktop, decision.SelectedBackend);
    }
}
