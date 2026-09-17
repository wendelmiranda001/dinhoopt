using DiNho.Capture.Poc.Hotkeys;

namespace DiNho.Capture.Poc.Tests;

// Testes puros via OnRawKeyEvent (event público) — não sobem hooks de janela reais.
public sealed class PushToTalkManagerTests
{
    [Fact]
    public void Hold_KeyDownActivates_KeyUpDeactivates()
    {
        using var hm = new HotkeyManager();
        using var ptt = new PushToTalkManager(hm);
        ptt.Mode = PttMode.Hold;
        ptt.AddPttKey(VirtualKey.VK_F5);

        hm.SimulateRawKey((int)VirtualKey.VK_F5, true);
        Assert.True(ptt.MicActive);

        hm.SimulateRawKey((int)VirtualKey.VK_F5, false);
        Assert.False(ptt.MicActive);
    }

    [Fact]
    public void Toggle_FlipsOnEachKeyDown_KeyUpNoEffect()
    {
        using var hm = new HotkeyManager();
        using var ptt = new PushToTalkManager(hm);
        ptt.Mode = PttMode.Toggle;
        ptt.AddPttKey(VirtualKey.VK_F5);

        hm.SimulateRawKey((int)VirtualKey.VK_F5, true);
        Assert.True(ptt.MicActive);

        hm.SimulateRawKey((int)VirtualKey.VK_F5, false);
        Assert.True(ptt.MicActive); // key up não alterna

        hm.SimulateRawKey((int)VirtualKey.VK_F5, true);
        Assert.False(ptt.MicActive);
    }

    [Fact]
    public void Off_Mode_IgnoresKeys()
    {
        using var hm = new HotkeyManager();
        using var ptt = new PushToTalkManager(hm);
        ptt.Mode = PttMode.Off;
        ptt.AddPttKey(VirtualKey.VK_F5);

        hm.SimulateRawKey((int)VirtualKey.VK_F5, true);
        Assert.False(ptt.MicActive);
    }

    [Fact]
    public void Hold_NonPttKey_Ignored()
    {
        using var hm = new HotkeyManager();
        using var ptt = new PushToTalkManager(hm);
        ptt.Mode = PttMode.Hold;
        ptt.AddPttKey(VirtualKey.VK_F5);

        hm.SimulateRawKey((int)VirtualKey.VK_F1, true);
        Assert.False(ptt.MicActive);
    }

    [Fact]
    public void Hold_RaisesMicStateChanged()
    {
        using var hm = new HotkeyManager();
        using var ptt = new PushToTalkManager(hm);
        bool? last = null;
        ptt.OnMicStateChanged += v => last = v;
        ptt.Mode = PttMode.Hold;
        ptt.AddPttKey(VirtualKey.VK_F5);

        hm.SimulateRawKey((int)VirtualKey.VK_F5, true);
        Assert.True(last);
    }
}