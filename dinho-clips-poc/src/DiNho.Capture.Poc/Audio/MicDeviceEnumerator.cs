using DiNho.Capture.Poc.Logging;

namespace DiNho.Capture.Poc.Audio;

/// <summary>
/// Enumerates microphone devices using NAudio COM MMDeviceEnumerator.
/// </summary>
internal static class MicDeviceEnumerator
{
    /// <summary>
    /// Query the preferred format (MixFormat) of an audio endpoint. Falls back to
    /// (1, 16000) when the device refuses the query (e.g. no shared-mode host).
    /// Antes retornava channels=2 / sampleRate=48000 hardcoded — dispositivos mono
    /// ou taxas diferentes causavam silêncio ou pitch errado (achado 4.8).
    /// </summary>
    internal static (int channels, int sampleRate) GetDeviceFormat(NAudio.CoreAudioApi.MMDevice device)
    {
        try
        {
            using var audioClient = device.CreateAudioClient();
            var format = audioClient.MixFormat;
            return NormalizeFormat(format.Channels, format.SampleRate);
        }
        catch (Exception ex)
        {
            Log.W("MicDeviceEnumerator", $"MixFormat query failed, using fallback (1, 16000): {ex.Message}");
            return (1, 16000);
        }
    }

    internal static (int channels, int sampleRate) NormalizeFormat(int channels, int sampleRate)
        => (channels > 0 ? channels : 1, sampleRate > 0 ? sampleRate : 16000);

    /// <summary>
    /// Enumerates microphone devices on an STA thread (required by NAudio/COM MMDeviceEnumerator).
    /// If already on STA, runs inline; otherwise spawns a dedicated STA thread.
    /// </summary>
    internal static List<object> EnumerateMicDevices()
    {
        // Need STA for NAudio COM MMDeviceEnumerator
        try
        {
            if (Thread.CurrentThread.GetApartmentState() == ApartmentState.STA)
                return EnumerateMicDevicesInner();
        }
        catch
        {
            Log.D("MicDeviceEnumerator", "ApartmentState check failed or non-STA, falling back to dedicated STA thread");
        }

        var tcs = new TaskCompletionSource<List<object>>();
        var thread = new Thread(() =>
        {
            try { tcs.SetResult(EnumerateMicDevicesInner()); }
            catch (Exception ex) { tcs.TrySetException(ex); }
        })
        {
            IsBackground = true,
            Name = "MicEnumSTA"
        };
        thread.SetApartmentState(ApartmentState.STA);
        thread.Start();
        if (tcs.Task.Wait(8000))
            return tcs.Task.Result;
        Log.E("MicDeviceEnumerator", "MicEnumSTA thread timed out after 8s");
        return new List<object>();
    }

    private static List<object> EnumerateMicDevicesInner()
    {
        var list = new List<object>();
        try
        {
            using var enumerator = new NAudio.CoreAudioApi.MMDeviceEnumerator();
            Log.I("MicDeviceEnumerator", $"enumerator created (STA={Thread.CurrentThread.GetApartmentState()})");
            var devices = enumerator.EnumerateAudioEndPoints(
                NAudio.CoreAudioApi.DataFlow.Capture,
                NAudio.CoreAudioApi.DeviceState.Active);
            Log.I("MicDeviceEnumerator", $"found {devices.Count} devices");
            string defaultId;
            try
            {
                defaultId = enumerator.GetDefaultAudioEndpoint(
                    NAudio.CoreAudioApi.DataFlow.Capture,
                    NAudio.CoreAudioApi.Role.Communications)?.ID ?? "";
                Log.I("MicDeviceEnumerator", $"defaultId='{defaultId}'");
            }
            catch (Exception exDef)
            {
                Log.E("MicDeviceEnumerator", $"GetDefaultAudioEndpoint failed: {exDef.Message}");
                defaultId = "";
            }

            foreach (var dev in devices)
            {
                using (dev)
                {
                    Log.I("MicDeviceEnumerator", $"dev id='{dev.ID}' name='{dev.FriendlyName}'");
                    var (devChannels, devSampleRate) = GetDeviceFormat(dev);
                    list.Add(new
                    {
                        id = dev.ID,
                        name = dev.FriendlyName,
                        isDefault = dev.ID == defaultId,
                        channels = devChannels,
                        sampleRate = devSampleRate,
                    });
                }
            }
        }
        catch (Exception ex)
        {
            Log.E("MicDeviceEnumerator", $"Erro ao enumerar mics: {ex.Message}");
        }
        Log.I("MicDeviceEnumerator", $"returning {list.Count} devices");
        return list;
    }
}
