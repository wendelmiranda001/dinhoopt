using DiNho.Capture.Poc.Logging;
using System.Text.Json;
using System.Net.Http;

namespace DiNho.Capture.Poc.GameDetection;

public sealed class GameDatabaseUpdater
{
    public const string REMOTE_URL = "https://cdn.dinho.app/games.json";
    public const int CHECK_INTERVAL_DAYS = 7;
    private const string STATE_FILE = "games-update-check.json";
    private const int MAX_ATTEMPTS = 2;
    // Após uma falha (DNS/parede de rede, ex: cdn.dinho.app inalcançável), evita tentar
    // de novo a cada 30s por toda a sessão e a cada launch — DNS não volta em 30s. Usa o
    // cache local (games.json da última versão válida) e tenta de novo só após o backoff.
    private const double FAILURE_BACKOFF_HOURS = 24;

    private static readonly Lazy<GameDatabaseUpdater> _instance = new(() => new GameDatabaseUpdater());
    public static GameDatabaseUpdater Instance => _instance.Value;

    private readonly SemaphoreSlim _lock = new(1, 1);
    private readonly HttpClient _httpClient;
    private string _outputDirectory = AppContext.BaseDirectory;

    /// <summary>Backoff between HTTP attempts. Exposed for tests; real runtime keeps 30s.</summary>
    internal TimeSpan RetryDelay { get; set; } = TimeSpan.FromSeconds(30);

    public GameDatabaseUpdater() : this(CreateDefaultHttpClient()) { }

    internal GameDatabaseUpdater(HttpClient httpClient, string? outputDirectory = null)
    {
        _httpClient = httpClient;
        if (outputDirectory != null)
            _outputDirectory = outputDirectory;
    }

    private static HttpClient CreateDefaultHttpClient()
    {
        var client = new HttpClient();
        client.DefaultRequestHeaders.UserAgent.ParseAdd("DiNhoOptimizer/1.0");
        client.DefaultRequestHeaders.Add("Accept", "application/json");
        return client;
    }

    public async Task<bool> CheckForUpdateAsync()
    {
        if (!await _lock.WaitAsync(0))
        {
            Log.I("GameDatabaseUpdater", "Update check already in progress, skipping");
            return false;
        }

        try
        {
            var state = LoadState();

            if (state != null && !IsDueForCheck(state))
            {
                Log.I("GameDatabaseUpdater", $"Last check was {(DateTime.UtcNow - DateTimeOffset.FromUnixTimeMilliseconds(state.LastCheckUnixMs).UtcDateTime).TotalDays:F1}d ago, skipping (interval: {CHECK_INTERVAL_DAYS}d)");
                return false;
            }

            // Backoff de falha: DNS/rede indisponível não volta em 30s nem a cada launch.
            // Persistimos LastFailedUnixMs e pulamos re-checks durante o backoff — o
            // games.json local (última versão válida) segue servindo o GameDatabase.
            if (state != null && state.LastFailedUnixMs > 0)
            {
                var sinceFail = DateTime.UtcNow - DateTimeOffset.FromUnixTimeMilliseconds(state.LastFailedUnixMs).UtcDateTime;
                if (sinceFail.TotalHours < FAILURE_BACKOFF_HOURS)
                {
                    Log.I("GameDatabaseUpdater", $"Last update check failed {sinceFail.TotalHours:F1}h ago, skipping (backoff {FAILURE_BACKOFF_HOURS:0}h) — usando games.json local");
                    return false;
                }
            }

            Log.I("GameDatabaseUpdater", $"Checking for updates from {REMOTE_URL}");
            RemoteGameDatabase? remoteDb = null;
            string json = null!;
            for (int attempt = 1; attempt <= MAX_ATTEMPTS; attempt++)
            {
                if (attempt > 1)
                {
                    Log.D("GameDatabaseUpdater", $"Update check failed, retrying in {(int)RetryDelay.TotalSeconds}s (attempt {attempt}/{MAX_ATTEMPTS})");
                    await Task.Delay(RetryDelay);
                }

                try
                {
                    using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(15));
                    using var response = await _httpClient.GetAsync(REMOTE_URL, cts.Token);
                    response.EnsureSuccessStatusCode();
                    json = await response.Content.ReadAsStringAsync();
                    remoteDb = JsonSerializer.Deserialize<RemoteGameDatabase>(json);
                    break;
                }
                catch (HttpRequestException ex) when (IsClientError(ex))
                {
                    Log.W("GameDatabaseUpdater", $"HTTP request failed with status {(int)ex.StatusCode!.Value}: {ex.Message}");
                    SaveFailure(state);
                    return false;
                }
                catch (Exception ex)
                {
                    if (attempt == MAX_ATTEMPTS)
                    {
                        Log.W("GameDatabaseUpdater", $"Update check failed after {MAX_ATTEMPTS} attempts: {ex.Message}");
                        SaveFailure(state);
                        return false;
                    }
                    Log.D("GameDatabaseUpdater", $"Update check failed: {ex.Message}");
                }
            }

            if (remoteDb?.Games == null || remoteDb.Games.Count == 0)
            {
                Log.W("GameDatabaseUpdater", "Remote games.json has no games entries");
                return false;
            }

            var localVersion = GameDatabase.Instance.IsLoaded ? GameDatabase.Instance.Version : (state?.LastVersion ?? 0);

            if (remoteDb.Version <= localVersion)
            {
                Log.I("GameDatabaseUpdater", $"Remote version {remoteDb.Version} <= local version {localVersion}, no update needed");
                SaveState(new UpdateState { LastCheckUnixMs = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(), LastVersion = localVersion });
                return false;
            }

            var targetPath = Path.Combine(_outputDirectory, "games.json");
            var tmpPath = targetPath + ".tmp";
            try
            {
                // 6.6: validar o schema ANTES de sobrescrever. RemoteGameDatabase
                // só checa games.Count (List<object>); games.json é consumido como
                // GameDatabase real. Um schema incompatível da CDN nunca deve
                // corromper o arquivo local — mantém o último bom.
                try
                {
                    var parsed = JsonSerializer.Deserialize<GameDatabase>(json);
                    if (parsed?.Games is not { Count: > 0 }
                        || parsed.Games.Any(g =>
                            string.IsNullOrEmpty(g.ProcessName) && string.IsNullOrEmpty(g.WindowClass)))
                    {
                        Log.W("GameDatabaseUpdater", "Remote games.json failed schema validation, keeping local file");
                        return false;
                    }
                }
                catch (JsonException ex)
                {
                    Log.W("GameDatabaseUpdater", $"Remote games.json is not a valid GameDatabase schema: {ex.Message}");
                    return false;
                }

                await File.WriteAllTextAsync(tmpPath, json);
                File.Move(tmpPath, targetPath, overwrite: true);
            }
            catch (Exception ex)
            {
                Log.W("GameDatabaseUpdater", $"Failed to write updated games.json: {ex.Message}");
                return false;
            }

            GameDatabase.Instance.Reload(targetPath);

            SaveState(new UpdateState { LastCheckUnixMs = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(), LastVersion = remoteDb.Version });
            Log.I("GameDatabaseUpdater", $"Updated games.json to version {remoteDb.Version} ({remoteDb.Games.Count} games)");
            return true;
        }
        finally
        {
            _lock.Release();
        }
    }

    private UpdateState? LoadState()
    {
        var path = Path.Combine(_outputDirectory, STATE_FILE);
        try
        {
            if (File.Exists(path))
            {
                var json = File.ReadAllText(path);
                return JsonSerializer.Deserialize<UpdateState>(json);
            }
        }
        catch (Exception ex)
        {
            Log.W("GameDatabaseUpdater", $"Failed to load state file: {ex.Message}");
        }
        return null;
    }

    private void SaveState(UpdateState state)
    {
        var path = Path.Combine(_outputDirectory, STATE_FILE);
        try
        {
            var json = JsonSerializer.Serialize(state);
            File.WriteAllText(path, json);
        }
        catch (Exception ex)
        {
            Log.W("GameDatabaseUpdater", $"Failed to save state file: {ex.Message}");
        }
    }

    /// <summary>
    /// Persiste o timestamp do último check falho (para backoff) preservando o último
    /// intervalo/versão conhecidos. Falhas de rede não devem zerar LastCheckUnixMs —
    /// senão toda falha forçaria re-check na hora, anulando o backoff.
    /// </summary>
    private void SaveFailure(UpdateState? state)
    {
        SaveState(new UpdateState
        {
            LastCheckUnixMs = state?.LastCheckUnixMs ?? 0,
            LastVersion = state?.LastVersion ?? 0,
            LastFailedUnixMs = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
        });
    }

    private static bool IsDueForCheck(UpdateState state)
    {
        var lastCheck = DateTimeOffset.FromUnixTimeMilliseconds(state.LastCheckUnixMs).UtcDateTime;
        return (DateTime.UtcNow - lastCheck).TotalDays >= CHECK_INTERVAL_DAYS;
    }

    private static bool IsClientError(HttpRequestException ex)
        => ex.StatusCode.HasValue && (int)ex.StatusCode.Value >= 400 && (int)ex.StatusCode.Value < 500;

    private sealed class RemoteGameDatabase
    {
        [System.Text.Json.Serialization.JsonPropertyName("version")]
        public int Version { get; set; }
        [System.Text.Json.Serialization.JsonPropertyName("games")]
        public List<object>? Games { get; set; }
    }

    public sealed class UpdateState
    {
        [System.Text.Json.Serialization.JsonPropertyName("lastCheckUnixMs")]
        public long LastCheckUnixMs { get; set; }
        [System.Text.Json.Serialization.JsonPropertyName("lastVersion")]
        public int LastVersion { get; set; }
        [System.Text.Json.Serialization.JsonPropertyName("lastFailedUnixMs")]
        public long LastFailedUnixMs { get; set; }
    }
}
