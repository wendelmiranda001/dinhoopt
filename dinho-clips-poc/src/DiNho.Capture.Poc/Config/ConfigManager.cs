using DiNho.Capture.Poc.Logging;
using System.Text.Json;
using System.Text.Json.Serialization;
using DiNho.Capture.Poc.Hotkeys;

namespace DiNho.Capture.Poc.Config;

public sealed class HotkeyBinding
{
    public int Vk { get; set; } = 0x77;
    public List<int> Modifiers { get; set; } = new();
    public string Action { get; set; } = "SaveClip";
    public int? ReplayDurationSeconds { get; set; }
    public bool Enabled { get; set; } = true;
}

public sealed class AppConfig
{
    [JsonPropertyName("Hotkeys")]
    public List<HotkeyBinding> HotkeyBindings { get; set; } = new()
    {
        new() { Vk = 0x77, Action = "SaveClip", Enabled = true },
        new() { Vk = 0x78, Action = "ToggleCapture", Enabled = true },
        new() { Vk = 0x79, Action = "ToggleMic", Enabled = true },
    };

    // Sessões de áudio selecionadas (PID -> nome)
    // Nota: Electron pode enviar como number[] (ex: [1234, 5678]) em vez de Dictionary<int,string>
    // O JsonConverter abaixo trata ambos os formatos silenciosamente
    [JsonConverter(typeof(IntStringDictionaryConverter))]
    public Dictionary<int, string> SelectedAudioSessions { get; set; } = new();

    // PTT keys (lista de VK codes)
    public List<int> PushToTalkKeys { get; set; } = new() { 0x77 }; // F8 default

    // Replay (fallback global, sobrescrito por binding.DurationSeconds se existir)
    public int ReplayTimeSeconds { get; set; } = 120; // 2 min

    // Buffer de replay: "ram" = só RAM (excedente descartado quando enche);
    // "hybrid" = RAM com cap de 2 min fixo + excedente vai pro disco (spill vídeo-only);
    // "disk" = só disco (RAM vira staging ~1s; vídeo E áudio espilham).
    // Default para usuário novo: "disk" (RAM quase zero, HW estável).
    public string ReplayBufferMode { get; set; } = "disk";

    // Post-clip buffer: continua gravando N segundos após o save trigger
    // para garantir que o momento não seja cortado (ex: Medal/ShadowPlay)
    public int PostClipDurationSeconds { get; set; } = 5;

    // Audio
    public bool MicEnabled { get; set; } = true;
    public int AudioSampleRate { get; set; } = 48000;
    public float MicVolume { get; set; } = 1.0f;
    public float GameVolume { get; set; } = 1.0f;

    // Video
    public int Fps { get; set; } = 60;
    public int Width { get; set; } = 1280;
    public int Height { get; set; } = 720;
    public int BitrateKbps { get; set; } = 30000;

    /// <summary>"Remover bordas pretas": preenche o box alvo inteiro no scale (sem preservar aspect).</summary>
    public bool StretchToFit { get; set; } = false;

    // CRF+VBV quality params (usados por NVENC/AV1)
    public int Cq { get; set; } = 20;
    public int MaxrateKbps { get; set; } = 30000;
    public int BufsizeKbps { get; set; } = 60000;
    public int Bframes { get; set; } = 3;
    public int Lookahead { get; set; } = 16;
    public string EncoderPreset { get; set; } = "p5";
    public string Codec { get; set; } = "auto";
    /// <summary>GPU adapter index for multi-GPU systems (-1 = auto).</summary>
    public int AdapterIndex { get; set; } = -1;

    // Paths
    public string OutputDirectory { get; set; } = "";

    // PTT mode: "Hold" or "Toggle" or "Off"
    [JsonPropertyName("pushToTalk")]
    public string PttMode { get; set; } = "Hold";

    // Forçar encoder software (útil para testes sem GPU / WARP)
    public bool ForceSoftware { get; set; }
    public bool Multipass { get; set; } = true;

    // RNNoise/anlmdn noise suppression on microphone
    [JsonPropertyName("noiseSuppression")]
    public bool NoiseSuppressionEnabled { get; set; } = false;

    // Dispositivo de microfone selecionado (vazio = padrão)
    public string MicDeviceId { get; set; } = "";

    // Auto-start capture when game is detected
    public bool AutoStartCapture { get; set; } = true;

    // EXCLUDE mode: captura TODO áudio do sistema exceto ExcludeProcessId
    public bool UseExcludeMode { get; set; } = false;

    // PID a excluir no EXCLUDE mode (ex: PID do Electron)
    public int ExcludeProcessId { get; set; } = 0;

    // Game Audio Only: captura apenas áudio do jogo detectado + microfone
    public bool GameAudioOnly { get; set; } = true;

    // Audio Loopback: captura áudio do sistema (true) ou apenas microfone (false)
    public bool AudioLoopback { get; set; } = false;

    // RAM-aware adaptive quality (true = RamManager ajusta CQ/resolução/replay conforme RAM disponível)
    [JsonPropertyName("adaptiveQuality")]
    public bool AdaptiveQualityEnabled { get; set; } = true;

    // PID do processo Electron (para ignorar foreground changes quando o Electron rouba o foco)
    public int ElectronPid { get; set; }

    // Game Detection: detecta jogos em foreground (true) ou desliga o detector (false)
    public bool GameDetection { get; set; } = true;

    // AutoCleanup: remove clips antigos quando o disco está cheio
    public bool AutoCleanupEnabled { get; set; } = true;

    // Limite em GB de espaço total que o usuário quer usar para clips (ex: 20 = limpa quando clips > 20GB)
    public int AutoCleanupThresholdGB { get; set; } = 100;

    /// <summary>
    /// Duração do replay buffer = global ReplayTimeSeconds (o teto).
    /// O global (configurado no front) é o limite MÁXIMO de replay — nenhuma
    /// hotkey pode salvar MAIS que ele. Hotkeys com duração própria salvam
    /// MENOS (customDuration &lt;= global, clampado em SaveClipAsync contra o
    /// buffer), mas nunca mais. Antes, o buffer era dimensionado pelo maior
    /// valor entre global e bindings habilitados — fazia F12 (5 min) salvar
    /// 5 min mesmo com o global em 2 min, e gastava RAM retendo o máximo.
    /// </summary>
    [JsonIgnore]
    public int EffectiveReplaySeconds => ReplayTimeSeconds;
}

public sealed class ConfigManager : IDisposable
{
    private static readonly HashSet<string> ValidEncoderPresets = new()
    {
        // Alinhado com o allowlist TS (clips.ipc.ts): apenas presets NVENC/HEVC/AV1
        // numéricos. Presets de CPU (veryfast/veryslow) são hardcoded nos args de
        // fallback libx264/libx265 — não são configuráveis pelo usuário. Aceitar
        // "veryfast" aqui o injetaria como "-preset veryfast" no NVENC (inválido) →
        // erro ffmpeg → restart loop.
        "p1", "p2", "p3", "p4", "p5", "p6", "p7",
    };

    private static readonly HashSet<string> ValidReplayBufferModes = new(StringComparer.OrdinalIgnoreCase)
    {
        // Alinhado com o allowlist TS (clips.ipc.ts): "ram" (só RAM),
        // "hybrid" (RAM 2min fixo + spill no disco) e "disk" (só disco,
        // RAM só como staging ~1s). Qualquer outro valor cai no default "hybrid".
        "ram", "hybrid", "disk",
    };

    public static bool IsValidReplayBufferMode(string? mode)
    {
        if (string.IsNullOrWhiteSpace(mode))
            return false;
        return ValidReplayBufferModes.Contains(mode);
    }

    public static bool IsValidEncoderPreset(string? preset)
    {
        if (string.IsNullOrWhiteSpace(preset))
            return false;
        return ValidEncoderPresets.Contains(preset.ToLowerInvariant());
    }

    private readonly string _configDir;
    private readonly string _configPath;
    private readonly AppConfig _defaults = new();
    private readonly Lock _lock = new();

    public AppConfig Config { get; private set; }

    // Evento disparado quando config muda em runtime
    public event Action<AppConfig>? OnConfigChanged;

    public ConfigManager(string? configPath = null)
    {
        if (configPath != null)
        {
            _configPath = configPath;
            _configDir = Path.GetDirectoryName(configPath)!;
        }
        else
        {
            _configDir = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
                "DiNhoClips");
            _configPath = Path.Combine(_configDir, "config.json");
        }
        Config = Load();
    }

    public AppConfig Load()
    {
        try
        {
            if (!File.Exists(_configPath))
            {
                SaveToDisk(_defaults);
                return CloneConfig(_defaults);
            }

            var json = File.ReadAllText(_configPath);
            var config = JsonSerializer.Deserialize<AppConfig>(json, new JsonSerializerOptions { PropertyNameCaseInsensitive = true });

            // Migração: config antigo com campos fixos → bindings dinâmicos.
            // O deserializador preenche HotkeyBindings com os DEFAULTS do initializer
            // mesmo quando o JSON antigo não tem o array "Hotkeys" — então o gate
            // baseado em valores deserializados casa SEMPRE o "novo formato" e a
            // migração nunca roda (achado 6.1: VKs customizados perdidos). A decisão
            // precisa olhar o JSON bruto: presença de "Hotkeys" = novo formato;
            // presença de "SaveClipVk" = formato antigo → migrar.
            if (config != null)
            {
                using var doc = JsonDocument.Parse(json);
                var root = doc.RootElement;
                if (!root.TryGetProperty("Hotkeys", out _) && root.TryGetProperty("SaveClipVk", out var oldSave))
                {
                    // Migra para as 3 bindings padrão SEMPRE (SaveClip/ToggleCapture/ToggleMic),
                    // puxando o VK customizado quando presente e o default quando ausente —
                    // nenhuma ação de hotkey pode ser perdida na migração.
                    var def = new AppConfig().HotkeyBindings;
                    var saveVk = oldSave.GetInt32();
                    var capVk = root.TryGetProperty("ToggleCaptureVk", out var oldCap)
                        ? oldCap.GetInt32() : def[1].Vk;
                    var micVk = root.TryGetProperty("ToggleMicVk", out var oldMic)
                        ? oldMic.GetInt32() : def[2].Vk;
                    config.HotkeyBindings = new List<HotkeyBinding>
                    {
                        new() { Vk = saveVk, Action = "SaveClip", Enabled = true },
                        new() { Vk = capVk, Action = "ToggleCapture", Enabled = true },
                        new() { Vk = micVk, Action = "ToggleMic", Enabled = true },
                    };
                    config.ReplayTimeSeconds = root.TryGetProperty("ReplayTimeSeconds", out var oldDur)
                        ? oldDur.GetInt32() : 300;
                    Log.I("Config", "Migrado formato antigo para bindings dinâmicos");
                    SaveToDisk(config);
                }
            }
            if (config == null)
            {
                Log.W("Config", "Arquivo corrompido, revertendo para defaults");
                SaveToDisk(_defaults);
                return CloneConfig(_defaults);
            }

            ValidateAndFix(config);

            return config;
        }
        catch (Exception ex)
        {
            Log.E("Config", $"Erro ao carregar: {ex.Message}, revertendo para defaults");
            // 6.2: o arquivo corrompido persiste entre boots se não for regravado.
            // Sobrescreve com defaults para o erro não se repetir em toda inicialização.
            try { SaveToDisk(_defaults); }
            catch { /* fail-closed: sem o reset, retorna defaults em memória mesmo assim */ }
            return CloneConfig(_defaults);
        }
    }

    /// <summary>
    /// Valida e corrige (clamp + anti-path-traversal) um AppConfig em place,
    /// usando os defaults como fallback. Compartilhado entre <see cref="Load"/>
    /// (arquivo) e <see cref="Update"/> (pipe do Electron) — o handler `config`
    /// do pipe não deve confiar cegamente no payload do frontend.
    /// </summary>
    public void ValidateAndFix(AppConfig config)
    {
        if (config.ReplayTimeSeconds < 30 || config.ReplayTimeSeconds > 600)
            config.ReplayTimeSeconds = _defaults.ReplayTimeSeconds;

        if (config.Fps is not (30 or 60))
            config.Fps = _defaults.Fps;

        if (config.AudioSampleRate is not (44100 or 48000 or 96000))
            config.AudioSampleRate = _defaults.AudioSampleRate;

        if (config.Width < 640 || config.Width > 1920 || config.Height < 480 || config.Height > 1080)
        {
            config.Width = _defaults.Width;
            config.Height = _defaults.Height;
        }

        if (config.BitrateKbps < 500 || config.BitrateKbps > 200_000)
            config.BitrateKbps = _defaults.BitrateKbps;

        // Valida parâmetros CRF+VBV
        if (config.Cq < 0 || config.Cq > 51)
            config.Cq = _defaults.Cq;
        if (config.MaxrateKbps < 1000 || config.MaxrateKbps > 500_000)
            config.MaxrateKbps = _defaults.MaxrateKbps;
        if (config.BufsizeKbps < 2000 || config.BufsizeKbps > 1_000_000)
            config.BufsizeKbps = _defaults.BufsizeKbps;
        if (config.Bframes < 0 || config.Bframes > 16)
            config.Bframes = _defaults.Bframes;
        if (config.Lookahead < 0 || config.Lookahead > 256)
            config.Lookahead = _defaults.Lookahead;
        if (string.IsNullOrWhiteSpace(config.EncoderPreset))
            config.EncoderPreset = _defaults.EncoderPreset;
        else if (!IsValidEncoderPreset(config.EncoderPreset))
            config.EncoderPreset = _defaults.EncoderPreset;

        if (string.IsNullOrWhiteSpace(config.ReplayBufferMode) || !IsValidReplayBufferMode(config.ReplayBufferMode))
            config.ReplayBufferMode = _defaults.ReplayBufferMode;
        else
            config.ReplayBufferMode = config.ReplayBufferMode.ToLowerInvariant();

        if (config.MicVolume < 0f || config.MicVolume > 4f)
            config.MicVolume = _defaults.MicVolume;

        config.PttMode = config.PttMode?.ToLowerInvariant() switch
        {
            "hold" => "Hold",
            "toggle" => "Toggle",
            "off" => "Off",
            _ => _defaults.PttMode,
        };

        // Clampa durações de replay por hotkey: protege EffectiveReplaySeconds,
        // que dimensiona o ReplayBuffer (memória/disk spill). Frontend envia
        // apenas 30..600 (presets 60/120/300 + slider custom [30,600]).
        config.HotkeyBindings ??= new();
        foreach (var b in config.HotkeyBindings)
            if (b.ReplayDurationSeconds.HasValue && b.ReplayDurationSeconds.Value is < 30 or > 600)
                b.ReplayDurationSeconds = null;

        // Valida diretório de saída (anti-path-traversal)
        if (!string.IsNullOrEmpty(config.OutputDirectory))
        {
            try
            {
                var resolved = Path.GetFullPath(config.OutputDirectory);
                var profileDir = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
                // 6.3: o prefixo deve quebrar no separador, senão "C:\Users\Windows2"
                // é tratado como "dentro de C:\Users\Windows".
                var isInsideProfile = string.Equals(resolved, profileDir, StringComparison.OrdinalIgnoreCase)
                    || resolved.StartsWith(profileDir.TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase);
                if (!isInsideProfile)
                {
                    Log.W("Config", $"OutputDirectory '{resolved}' fora do perfil do usuário — rejeitado");
                    config.OutputDirectory = "";
                }
                else
                {
                    config.OutputDirectory = resolved;
                    if (!Directory.Exists(config.OutputDirectory))
                        Directory.CreateDirectory(config.OutputDirectory);
                }
            }
            catch
            {
                config.OutputDirectory = "";
            }
        }
    }

    public void Save()
    {
        lock (_lock)
        {
            SaveToDisk(Config);
        }
    }

    private void SaveToDisk(AppConfig config)
    {
        try
        {
            if (!Directory.Exists(_configDir))
                Directory.CreateDirectory(_configDir);

            var json = JsonSerializer.Serialize(config, new JsonSerializerOptions
            {
                WriteIndented = true
            });
            File.WriteAllText(_configPath, json);
        }
        catch (Exception ex)
        {
            Log.E("Config", $"Erro ao salvar: {ex.Message}");
        }
    }

    public void Update(Action<AppConfig> updater)
    {
        lock (_lock)
        {
            updater(Config);
            // Valida/corrige mesmo em updates via pipe — o handler `config` copia
            // valores crus do frontend; ValidateAndFix clampa números e rejeita
            // OutputDirectory fora do perfil antes de persistir.
            ValidateAndFix(Config);
            SaveToDisk(Config);
        }
        OnConfigChanged?.Invoke(Config);
    }

    /// <summary>
    /// Troca o Config EM MEMÓRIA (sem persistir no disco) — usado pelos defaults
    /// calibrados por capacidade da máquina. O arquivo segue com os defaults limpos;
    /// a UI reflete o valor efetivo em uso via OnConfigChanged.
    /// </summary>
    internal void ApplyCalibrated(AppConfig calibrated)
    {
        lock (_lock)
        {
            Config = calibrated;
        }
        OnConfigChanged?.Invoke(Config);
    }

    private static AppConfig CloneConfig(AppConfig source)
    {
        return JsonSerializer.Deserialize<AppConfig>(
            JsonSerializer.Serialize(source)) ?? new AppConfig();
    }

    public void Dispose()
    {
    }
}

/// <summary>
/// Custom JSON converter para Dictionary&lt;int, string&gt; que também aceita arrays number[] (do Electron).
/// Electron envia selectedAudioSessions como [1234, 5678] em vez de {"1234": "FiveM.exe", ...}.
/// </summary>
internal sealed class IntStringDictionaryConverter : JsonConverter<Dictionary<int, string>>
{
    public override Dictionary<int, string> Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
    {
        if (reader.TokenType == JsonTokenType.Null)
            return new Dictionary<int, string>();

        if (reader.TokenType == JsonTokenType.StartArray)
        {
            var result = new Dictionary<int, string>();
            while (reader.Read())
            {
                if (reader.TokenType == JsonTokenType.EndArray)
                    return result;

                if (reader.TokenType == JsonTokenType.Number && reader.TryGetInt32(out var pid))
                {
                    // Use PID como chave, nome fica vazio — será populado via setAudioSessions IPC
                    result[pid] = $"PID:{pid}";
                }
            }
            return result;
        }

        if (reader.TokenType == JsonTokenType.StartObject)
        {
            var result = new Dictionary<int, string>();
            while (reader.Read())
            {
                if (reader.TokenType == JsonTokenType.EndObject)
                    return result;

                if (reader.TokenType == JsonTokenType.PropertyName)
                {
                    var keyStr = reader.GetString();
                    reader.Read();
                    var value = reader.GetString() ?? string.Empty;
                    if (int.TryParse(keyStr, out var key))
                        result[key] = value;
                }
            }
            return result;
        }

        return new Dictionary<int, string>();
    }

    public override void Write(Utf8JsonWriter writer, Dictionary<int, string> value, JsonSerializerOptions options)
    {
        JsonSerializer.Serialize(writer, value, options);
    }
}
