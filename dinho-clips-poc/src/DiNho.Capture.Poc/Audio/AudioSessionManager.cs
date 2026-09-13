using NAudio.CoreAudioApi;

namespace DiNho.Capture.Poc.Audio;

public sealed class AudioSessionInfo
{
    public int ProcessId { get; set; }
    public string ProcessName { get; set; } = "";
    public string DisplayName { get; set; } = "";
    public bool IsSelected { get; set; } = true;
    public bool IsSystemSound { get; set; }
}

public sealed class AudioSessionManager : IDisposable
{
    private readonly MMDevice _device;

    public AudioSessionManager()
    {
        var enumerator = new MMDeviceEnumerator();
        try
        {
            _device = enumerator.GetDefaultAudioEndpoint(DataFlow.Render, Role.Multimedia);
        }
        finally
        {
            enumerator.Dispose();
        }
    }

    public List<AudioSessionInfo> EnumerateSessions()
    {
        var sessions = _device.AudioSessionManager.Sessions;
        var list = new List<AudioSessionInfo>();

        for (int i = 0; i < sessions.Count; i++)
        {
            var session = sessions[i];
            try
            {
                var pid = (int)session.GetProcessID;
                if (pid == 0) continue;

                string name;
                try { using var proc = System.Diagnostics.Process.GetProcessById(pid); name = proc.ProcessName; }
                catch { name = $"pid:{pid}"; }

                var info = new AudioSessionInfo
                {
                    ProcessId = pid,
                    ProcessName = name,
                    DisplayName = session.DisplayName ?? name,
                };
                list.Add(info);
            }
            catch { }
            finally { session.Dispose(); }
        }

        list.Sort((a, b) => string.Compare(a.ProcessName, b.ProcessName, StringComparison.OrdinalIgnoreCase));
        return list;
    }

    public void Dispose()
    {
        _device.Dispose();
    }
}
