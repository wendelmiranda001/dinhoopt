using System.Collections.Concurrent;
using DiNho.Capture.Poc.Logging;
using System.Diagnostics;
using System.Runtime.InteropServices;
using DiNho.Capture.Poc.Config;
using Windows.Win32;
using Windows.Win32.Foundation;
using Windows.Win32.UI.WindowsAndMessaging;

namespace DiNho.Capture.Poc.Hotkeys;

public enum HotkeyAction
{
    SaveClip,
    ToggleCapture,
    ToggleMic,
}

public sealed class HotkeyPressedEventArgs : EventArgs
{
    public HotkeyAction Action { get; init; }
    public int? ReplayDurationSeconds { get; init; }
    public HotkeyBinding Binding { get; init; } = null!;
}

public sealed class HotkeyManager : IDisposable
{
    private readonly List<HotkeyBinding> _bindings = new();
    private readonly ConcurrentDictionary<int, byte> _keysDown = new();
    private HOOKPROC? _hookDelegate;
    private HOOKPROC? _mouseHookDelegate;
    private HHOOK _hookId = HHOOK.Null;
    private HHOOK _mouseHookId = HHOOK.Null;
    private Thread? _hookThread;
    private volatile bool _disposed;
    private readonly Lock _lock = new();

    public event Action<HotkeyPressedEventArgs>? OnHotkeyPressed;
    public event Action<int, bool>? OnRawKeyEvent;

    private const int WH_KEYBOARD_LL = 13;
    private const int WH_MOUSE_LL = 14;
    private const int WM_KEYDOWN = 0x0100;
    private const int WM_KEYUP = 0x0101;
    private const int WM_SYSKEYDOWN = 0x0104;
    private const int WM_SYSKEYUP = 0x0105;

    private const int VK_LMENU = 0xA4;
    private const int VK_RMENU = 0xA5;
    private const int VK_LCONTROL = 0xA2;
    private const int VK_RCONTROL = 0xA3;
    private const int VK_LSHIFT = 0xA0;
    private const int VK_RSHIFT = 0xA1;
    private const int WM_XBUTTONDOWN = 0x020B;
    private const int WM_XBUTTONUP = 0x020C;
    private const int WM_NCXBUTTONDOWN = 0x00AB;
    private const int WM_NCXBUTTONUP = 0x00AC;
    private const int XBUTTON1 = 0x0001;
    private const int XBUTTON2 = 0x0002;
    private const int VK_XBUTTON1 = 0x05;
    private const int VK_XBUTTON2 = 0x06;

    public void UpdateBindings(List<HotkeyBinding> bindings)
    {
        lock (_lock)
        {
            _bindings.Clear();
            _bindings.AddRange(bindings);
            Log.I("HotkeyManager", $"UpdateBindings: {bindings.Count} bindings");
            foreach (var b in _bindings)
            {
                var mods = b.Modifiers.Count > 0 ? $"+0x{string.Join("+0x", b.Modifiers.Select(m => m.ToString("X2")))}" : "";
                Log.D("HotkeyManager", $"  Vk=0x{b.Vk:X2}{mods} Action={b.Action} Enabled={b.Enabled}");
            }
        }
    }

    public void Start()
    {
        _disposed = false;
        if (_hookId.IsNull && _hookThread is { IsAlive: true })
            return; // running but hook not yet registered — wait for message loop
        if (!_hookId.IsNull)
            return;

        _hookThread = new Thread(() =>
        {
            _hookDelegate = KeyboardHookCallback;
            _mouseHookDelegate = MouseHookCallback;
            using var process = Process.GetCurrentProcess();
            using var module = process.MainModule;
            if (module == null) return;

            unsafe
            {
                fixed (char* pModuleName = module.ModuleName)
                {
                    var moduleHandle = PInvoke.GetModuleHandle(pModuleName);
                    _hookId = PInvoke.SetWindowsHookEx(WINDOWS_HOOK_ID.WH_KEYBOARD_LL, _hookDelegate, moduleHandle, 0);
                    Log.I("HotkeyManager", $"WH_KEYBOARD_LL hook: {(long)_hookId.Value:X} (0=falhou)");
                    if (_hookId.IsNull)
                        Log.W("HotkeyManager", "WH_KEYBOARD_LL FALHOU — hotkeys de teclado inativas (verifique privilégios/UIPI)");
                    _mouseHookId = PInvoke.SetWindowsHookEx(WINDOWS_HOOK_ID.WH_MOUSE_LL, _mouseHookDelegate, moduleHandle, 0);
                    Log.I("HotkeyManager", $"WH_MOUSE_LL hook: {(long)_mouseHookId.Value:X} (0=falhou)");
                    if (_mouseHookId.IsNull)
                        Log.W("HotkeyManager", "WH_MOUSE_LL FALHOU — hotkeys de mouse inativas");
                }
            }

            while (!_disposed)
            {
                if (PInvoke.GetMessage(out var msg, HWND.Null, 0, 0).Value == -1)
                    break;
                PInvoke.TranslateMessage(in msg);
                PInvoke.DispatchMessage(in msg);
            }

            if (!_hookId.IsNull)
                PInvoke.UnhookWindowsHookEx(_hookId);
            if (!_mouseHookId.IsNull)
                PInvoke.UnhookWindowsHookEx(_mouseHookId);
        })
        {
            Name = "HotkeyHook",
            IsBackground = true
        };
        _hookThread.Start();
    }

    public void Stop()
    {
        _disposed = true;
        if (_hookThread is { IsAlive: true })
        {
            PInvoke.PostThreadMessage((uint)_hookThread.ManagedThreadId, 0x0012, default, default);
            if (!_hookThread.Join(1000))
            {
                Log.W("HotkeyManager", "Hook thread did not exit within 1s — continuing");
            }
        }
        _hookThread = null;
    }

    private int _kbdCounter;
    private LRESULT KeyboardHookCallback(int nCode, WPARAM wParam, LPARAM lParam)
    {
        // Acionado após Stop() — não emitir eventos entre _disposed=true e o UnhookWindowsHookEx.
        if (_disposed) return PInvoke.CallNextHookEx(HHOOK.Null, nCode, wParam, lParam);
        try
        {
            if (nCode >= 0)
            {
                var vkCode = Marshal.ReadInt32(lParam);
                var wMsg = wParam.Value;
                var isKeyDown = wMsg == WM_KEYDOWN || wMsg == (uint)WM_SYSKEYDOWN;
                var isKeyUp = wMsg == WM_KEYUP || wMsg == (uint)WM_SYSKEYUP;

                _kbdCounter++;
                if (vkCode == 0x14 || (_kbdCounter % 50 == 0))
                    Log.D("KbdHook", $"vk=0x{vkCode:X2} down={isKeyDown} up={isKeyUp} nCode={nCode}");

                if (isKeyDown)
                {
                    if (_keysDown.ContainsKey(vkCode))
                        return PInvoke.CallNextHookEx(HHOOK.Null, nCode, wParam, lParam);

                    _keysDown.TryAdd(vkCode, 0);
                    var generic = MapToGenericVk(vkCode);
                    if (generic != null)
                        _keysDown.TryAdd(generic.Value, 0);
                    OnRawKeyEvent?.Invoke(vkCode, true);
                    MatchAndFireHotkey(vkCode);
                }
                else if (isKeyUp)
                {
                    _keysDown.TryRemove(vkCode, out _);
                    var generic = MapToGenericVk(vkCode);
                    if (generic != null)
                        _keysDown.TryRemove(generic.Value, out _);
                    OnRawKeyEvent?.Invoke(vkCode, false);
                }
            }
        }
        catch (Exception ex)
        {
            Log.E("HotkeyManager", $"Erro no callback: {ex.GetType().Name}: {ex.Message}");
        }

        return PInvoke.CallNextHookEx(HHOOK.Null, nCode, wParam, lParam);
    }

    private LRESULT MouseHookCallback(int nCode, WPARAM wParam, LPARAM lParam)
    {
        if (_disposed) return PInvoke.CallNextHookEx(HHOOK.Null, nCode, wParam, lParam);
        try
        {
            if (nCode < 0) return PInvoke.CallNextHookEx(HHOOK.Null, nCode, wParam, lParam);

            var wMsg = wParam.Value;
            var isDown = wMsg == (uint)WM_XBUTTONDOWN || wMsg == (uint)WM_NCXBUTTONDOWN;
            var isUp = wMsg == (uint)WM_XBUTTONUP || wMsg == (uint)WM_NCXBUTTONUP;
            if (!isDown && !isUp) return PInvoke.CallNextHookEx(HHOOK.Null, nCode, wParam, lParam);

            var hookStruct = Marshal.PtrToStructure<MSLLHOOKSTRUCT>((nint)lParam);
            var xButton = (int)(hookStruct.mouseData >> 16);
            int vkCode = xButton switch
            {
                XBUTTON1 => VK_XBUTTON1,
                XBUTTON2 => VK_XBUTTON2,
                _ => 0,
            };
            if (vkCode == 0) return PInvoke.CallNextHookEx(HHOOK.Null, nCode, wParam, lParam);

            if (isDown)
            {
                if (_keysDown.ContainsKey(vkCode))
                    return PInvoke.CallNextHookEx(HHOOK.Null, nCode, wParam, lParam);
                _keysDown.TryAdd(vkCode, 0);
                OnRawKeyEvent?.Invoke(vkCode, true);
                MatchAndFireHotkey(vkCode);
            }
            else
            {
                _keysDown.TryRemove(vkCode, out _);
                OnRawKeyEvent?.Invoke(vkCode, false);
            }
        }
        catch (Exception ex)
        {
            Log.E("HotkeyManager", $"Erro no callback mouse: {ex.GetType().Name}: {ex.Message}");
        }

        return PInvoke.CallNextHookEx(HHOOK.Null, nCode, wParam, lParam);
    }

    internal void MatchAndFireHotkey(int vkCode)
    {
        if (_disposed) return;
        lock (_lock)
        {
            Log.D("HotkeyManager", $"MatchAndFireHotkey: vk=0x{vkCode:X2} bindings={_bindings.Count}");
            foreach (var binding in _bindings)
            {
                Log.D("HotkeyManager", $"  check: Vk=0x{binding.Vk:X2} Mods=[{string.Join(",", binding.Modifiers)}] Enabled={binding.Enabled}");
                if (!binding.Enabled) continue;
                if (binding.Vk != vkCode) continue;

                if (binding.Modifiers.Count > 0 && !ModifiersPressed(binding.Modifiers))
                {
                    Log.D("HotkeyManager", "  mods NOT pressed");
                    continue;
                }

                if (!Enum.TryParse<HotkeyAction>(binding.Action, ignoreCase: true, out var action))
                {
                    Log.D("HotkeyManager", $"  parse action FAILED: '{binding.Action}'");
                    continue;
                }

                Log.D("HotkeyManager", $"  FIRED! Action={action}");
                OnHotkeyPressed?.Invoke(new HotkeyPressedEventArgs
                {
                    Action = action,
                    ReplayDurationSeconds = binding.ReplayDurationSeconds,
                    Binding = binding,
                });
                break;
            }
        }
    }

    internal void SetKeyPressed(int vk, bool pressed)
    {
        if (pressed)
            _keysDown.TryAdd(vk, 0);
        else
            _keysDown.TryRemove(vk, out _);
    }

    /// <summary>Seam de teste: levanta o evento raw como um hook real faria (sem registrar hooks).</summary>
    internal void SimulateRawKey(int vkCode, bool isKeyDown)
    {
        if (_disposed) return;
        OnRawKeyEvent?.Invoke(vkCode, isKeyDown);
    }

    private static int? MapToGenericVk(int vk)
    {
        return vk switch
        {
            VK_LMENU or VK_RMENU => 0x12,
            VK_LCONTROL or VK_RCONTROL => 0x11,
            VK_LSHIFT or VK_RSHIFT => 0x10,
            _ => null,
        };
    }

    private bool ModifiersPressed(List<int> modVks)
    {
        foreach (var mod in modVks)
        {
            if (!_keysDown.ContainsKey(mod))
                return false;
        }
        return true;
    }

    public void Dispose()
    {
        Stop();
        OnHotkeyPressed = null;
        OnRawKeyEvent = null;
    }
}

public enum VirtualKey : int
{
    VK_XBUTTON1 = 0x05,
    VK_XBUTTON2 = 0x06,
    VK_F1 = 0x70,
    VK_F2 = 0x71,
    VK_F3 = 0x72,
    VK_F4 = 0x73,
    VK_F5 = 0x74,
    VK_F6 = 0x75,
    VK_F7 = 0x76,
    VK_F8 = 0x77,
    VK_F9 = 0x78,
    VK_F10 = 0x79,
    VK_F11 = 0x7A,
    VK_F12 = 0x7B,
    VK_CAPITAL = 0x14,
    VK_CONTROL = 0x11,
    VK_SHIFT = 0x10,
    VK_MENU = 0x12,
}
