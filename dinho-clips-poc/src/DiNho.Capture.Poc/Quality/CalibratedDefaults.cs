using System.Text.Json;
using DiNho.Capture.Poc.Config;

namespace DiNho.Capture.Poc.Quality;

/// <summary>
/// Aplica o perfil calibrado ao AppConfig do usuário, campo a campo, SOMENTE onde o
/// valor atual ainda é o default original. Override explícito do usuário nunca é
/// sobrescrito. Retorna nova instância (imutável), nunca muta a entrada.
/// </summary>
public static class CalibratedDefaults
{
    public static AppConfig Apply(AppConfig current, AppConfig defaults, MachineProfile profile)
    {
        var next = Clone(current);

        if (Equals(next.EncoderPreset, defaults.EncoderPreset))
            next.EncoderPreset = profile.EncoderPreset;

        if (Equals(next.Multipass, defaults.Multipass))
            next.Multipass = profile.Multipass;

        if (Equals(next.Fps, defaults.Fps))
            next.Fps = profile.Fps;

        // Cap de resolução aplica apenas quando largura E altura estão nos defaults —
        // nunca meia-resolução (width do usuário + height calibrado).
        if (profile.MaxWidth > 0 && profile.MaxHeight > 0
            && Equals(next.Width, defaults.Width)
            && Equals(next.Height, defaults.Height))
        {
            next.Width = profile.MaxWidth;
            next.Height = profile.MaxHeight;
        }

        if (Equals(next.ReplayTimeSeconds, defaults.ReplayTimeSeconds))
            next.ReplayTimeSeconds = profile.ReplaySeconds;

        return next;
    }

    private static AppConfig Clone(AppConfig source)
    {
        return JsonSerializer.Deserialize<AppConfig>(
            JsonSerializer.Serialize(source)) ?? new AppConfig();
    }
}