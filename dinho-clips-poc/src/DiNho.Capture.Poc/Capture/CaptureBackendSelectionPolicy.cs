namespace DiNho.Capture.Poc.Capture;

// ===========================================================================
//  CaptureBackendSelectionPolicy - "texture mode" always on (Item 2)
//
//  The SemanticWgc/DesktopDuplication path (GPU->GPU, D3D11 texture) is the
//  only one that does NOT produce the "white background and smudges" artifact
//  when capturing windows. The Hybrid/PrintWindow path is what reintroduces
//  that artifact. This pure policy guarantees capture never silently regresses
//  to the non-texture (texture-off) mode while a viable texture backend exists.
// ===========================================================================

public enum CaptureBackendKind
{
    SemanticWgc,
    SemanticDesktop,
    Hybrid,
}

public enum WindowDeclaredState
{
    WgaWindow,
    ExcludedFromCapture,
    NotApplicable,
}

public sealed class CaptureBackendSelectionDecision
{
    public bool TextureModeActive { get; init; }
    public CaptureBackendKind? SelectedBackend { get; init; }
    public string? FailureReason { get; init; }
    public string TextureStatePerception { get; init; } = "texture-on";
}

public static class CaptureBackendSelectionPolicy
{
    public static IReadOnlyList<CaptureBackendKind> TextureRanking() =>
        new[] { CaptureBackendKind.SemanticWgc, CaptureBackendKind.SemanticDesktop };

    public static CaptureBackendSelectionDecision Decide(
        bool allowHybridFallback,
        bool gameIsValid,
        bool gameHwndValid,
        WindowDeclaredState wgcWindowDeclared,
        bool desktopCaptureAvailable,
        bool dxgiDesktopAvailable)
    {
        bool textureAvailable =
            wgcWindowDeclared == WindowDeclaredState.WgaWindow ||
            (gameIsValid == false && desktopCaptureAvailable);

        if (textureAvailable)
        {
            var backend = wgcWindowDeclared == WindowDeclaredState.WgaWindow
                ? CaptureBackendKind.SemanticWgc
                : CaptureBackendKind.SemanticDesktop;

            return new CaptureBackendSelectionDecision
            {
                TextureModeActive = true,
                SelectedBackend = backend,
                TextureStatePerception = "texture-on",
            };
        }

        if (allowHybridFallback)
        {
            return new CaptureBackendSelectionDecision
            {
                TextureModeActive = false,
                SelectedBackend = CaptureBackendKind.Hybrid,
                TextureStatePerception = "texture-off",
            };
        }

        return new CaptureBackendSelectionDecision
        {
            TextureModeActive = false,
            FailureReason =
                "Nenhum backend de textura viavel (WGC/DXGI) e o fallback hibrido nao " +
                "esta permitido; nao se regride silenciosamente para o modo sem-textura.",
        };
    }
}
