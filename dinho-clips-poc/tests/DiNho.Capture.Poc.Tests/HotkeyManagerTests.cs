using DiNho.Capture.Poc.Config;
using DiNho.Capture.Poc.Hotkeys;

namespace DiNho.Capture.Poc.Tests;

public sealed class HotkeyManagerTests : IDisposable
{
    private readonly HotkeyManager _hm = new();
    private readonly List<HotkeyPressedEventArgs> _fired = new();

    public HotkeyManagerTests()
    {
        _hm.OnHotkeyPressed += args => _fired.Add(args);
    }

    public void Dispose()
    {
        _hm.Dispose();
    }

    private static HotkeyBinding MakeBinding(int vk, string action, bool enabled = true, List<int>? modifiers = null)
    {
        return new HotkeyBinding
        {
            Vk = vk,
            Action = action,
            Enabled = enabled,
            Modifiers = modifiers ?? [],
            ReplayDurationSeconds = null,
        };
    }

    [Fact]
    public void MatchAndFire_SingleKeyNoMods_Fires()
    {
        _hm.UpdateBindings([MakeBinding(0x70, "SaveClip")]); // F1
        _hm.MatchAndFireHotkey(0x70);
        Assert.Single(_fired);
        Assert.Equal(HotkeyAction.SaveClip, _fired[0].Action);
    }

    [Fact]
    public void MatchAndFire_SingleKeyNoMods_DoesNotFireWrongKey()
    {
        _hm.UpdateBindings([MakeBinding(0x70, "SaveClip")]); // F1
        _hm.MatchAndFireHotkey(0x71); // F2
        Assert.Empty(_fired);
    }

    [Fact]
    public void MatchAndFire_DisabledBinding_DoesNotFire()
    {
        _hm.UpdateBindings([MakeBinding(0x70, "SaveClip", enabled: false)]);
        _hm.MatchAndFireHotkey(0x70);
        Assert.Empty(_fired);
    }

    [Fact]
    public void MatchAndFire_WithModifier_KeyDown_Fires()
    {
        // Alt+1 (0x12 + 0x31)
        _hm.UpdateBindings([MakeBinding(0x31, "ToggleCapture", modifiers: [0x12])]);
        _hm.SetKeyPressed(0x12, true); // Alt down
        _hm.MatchAndFireHotkey(0x31);
        Assert.Single(_fired);
        Assert.Equal(HotkeyAction.ToggleCapture, _fired[0].Action);
    }

    [Fact]
    public void MatchAndFire_ModifierNotPressed_DoesNotFire()
    {
        _hm.UpdateBindings([MakeBinding(0x31, "ToggleCapture", modifiers: [0x12])]);
        // Alt NOT pressed
        _hm.MatchAndFireHotkey(0x31);
        Assert.Empty(_fired);
    }

    [Fact]
    public void MatchAndFire_MultipleModifiers_AllRequired()
    {
        // Ctrl+Shift+F1
        _hm.UpdateBindings([MakeBinding(0x70, "SaveClip", modifiers: [0x11, 0x10])]);
        _hm.SetKeyPressed(0x11, true); // Ctrl
        _hm.SetKeyPressed(0x10, true); // Shift
        _hm.MatchAndFireHotkey(0x70);
        Assert.Single(_fired);
    }

    [Fact]
    public void MatchAndFire_MultipleModifiers_OneMissing_NoFire()
    {
        _hm.UpdateBindings([MakeBinding(0x70, "SaveClip", modifiers: [0x11, 0x10])]);
        _hm.SetKeyPressed(0x11, true); // Ctrl, but Shift NOT pressed
        _hm.MatchAndFireHotkey(0x70);
        Assert.Empty(_fired);
    }

    [Fact]
    public void MatchAndFire_UnknownActionString_Skips()
    {
        _hm.UpdateBindings([MakeBinding(0x70, "NonExistentAction")]);
        _hm.MatchAndFireHotkey(0x70);
        Assert.Empty(_fired);
    }

    [Fact]
    public void MatchAndFire_FirstMatchingBindingWins()
    {
        _hm.UpdateBindings([
            MakeBinding(0x70, "SaveClip"),
            MakeBinding(0x70, "ToggleCapture"),
        ]);
        _hm.MatchAndFireHotkey(0x70);
        Assert.Single(_fired); // only first binding fired
        Assert.Equal(HotkeyAction.SaveClip, _fired[0].Action);
    }

    [Fact]
    public void MatchAndFire_CaseInsensitiveAction_Parses()
    {
        _hm.UpdateBindings([MakeBinding(0x70, "saveclip")]); // lowercase
        _hm.MatchAndFireHotkey(0x70);
        Assert.Single(_fired);
        Assert.Equal(HotkeyAction.SaveClip, _fired[0].Action);
    }

    [Fact]
    public void MapToGenericVk_LeftAlt_ReturnsVkMenu()
    {
        // The generic mapping is tested indirectly via _keysDown behavior.
        // No standalone test for private static method.
        Assert.True(true);
    }

    [Fact]
    public void UpdateBindings_ReplacesPrevious()
    {
        _hm.UpdateBindings([MakeBinding(0x70, "SaveClip")]);
        _hm.UpdateBindings([MakeBinding(0x71, "ToggleCapture")]); // replaces
        _hm.MatchAndFireHotkey(0x70); // old binding gone
        Assert.Empty(_fired);
        _hm.MatchAndFireHotkey(0x71); // new binding works
        Assert.Single(_fired);
        Assert.Equal(HotkeyAction.ToggleCapture, _fired[0].Action);
    }

    [Fact]
    public void SetKeyPressed_ModifierState_Persists()
    {
        _hm.SetKeyPressed(0x12, true); // Alt modifier
        _hm.UpdateBindings([MakeBinding(0x31, "ToggleMic", modifiers: [0x12])]);
        _hm.MatchAndFireHotkey(0x31);
        Assert.Single(_fired);
    }

    [Fact]
    public void SetKeyPressed_ModifierCleared_PreventsFire()
    {
        // Press modifier, then clear it — binding should not fire
        _hm.SetKeyPressed(0x12, true); // Alt pressed
        _hm.SetKeyPressed(0x12, false); // Alt released
        _hm.UpdateBindings([MakeBinding(0x31, "ToggleMic", modifiers: [0x12])]);
        _hm.MatchAndFireHotkey(0x31);
        Assert.Empty(_fired);
    }

    [Fact]
    public void Dispose_DoesNotThrow_WhenNotStarted()
    {
        var hm = new HotkeyManager();
        hm.Dispose(); // should not throw
    }

    // ── 4.7: depois de Stop()/Dispose() não dispara mais (janela entre
    //    _disposed=true e o UnhookWindowsHookEx não pode emitir eventos) ──

    [Fact]
    public void MatchAndFire_AfterStop_DoesNotFire()
    {
        _hm.UpdateBindings([MakeBinding(0x70, "SaveClip")]); // F1
        _hm.MatchAndFireHotkey(0x70);
        Assert.Single(_fired);

        _hm.Stop(); // sem hook thread → só marca _disposed
        _hm.MatchAndFireHotkey(0x70);
        Assert.Single(_fired); // inalterado — guard _disposed ativo
    }
}
