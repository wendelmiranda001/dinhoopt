using DiNho.Capture.Poc.Logging;
using System.Text.Json;

namespace DiNho.Capture.Poc.GameDetection;

public class GameEntry
{
    [System.Text.Json.Serialization.JsonPropertyName("processName")]
    public string ProcessName { get; set; } = "";
    [System.Text.Json.Serialization.JsonPropertyName("windowClass")]
    public string WindowClass { get; set; } = "";
    [System.Text.Json.Serialization.JsonPropertyName("displayName")]
    public string DisplayName { get; set; } = "";
    [System.Text.Json.Serialization.JsonPropertyName("aliases")]
    public List<string> Aliases { get; set; } = [];
    [System.Text.Json.Serialization.JsonPropertyName("backends")]
    public List<string> Backends { get; set; } = [];
}

public class GameDatabase
{
    [System.Text.Json.Serialization.JsonPropertyName("version")]
    public int Version { get; set; }
    [System.Text.Json.Serialization.JsonPropertyName("games")]
    public List<GameEntry> Games { get; set; } = [];
    [System.Text.Json.Serialization.JsonPropertyName("nonGames")]
    public List<string> NonGames { get; set; } = [];

    private Dictionary<string, GameEntry> _byWindowClass = new(StringComparer.OrdinalIgnoreCase);
    private Dictionary<string, GameEntry> _byProcessName = new(StringComparer.OrdinalIgnoreCase);
    private volatile bool _loaded;
    private readonly Lock _loadLock = new();

    private static readonly Lazy<GameDatabase> _instance = new(() => new GameDatabase());
    public static GameDatabase Instance => _instance.Value;

    public bool IsLoaded => _loaded;
    public int GameCount => _loaded ? Games.Count : 0;

    public void Reload(string jsonPath)
    {
        _loaded = false;
        Load(jsonPath);
    }

    public void Load(string? jsonPath = null)
    {
        if (_loaded) return;
        lock (_loadLock)
        {
            if (_loaded) return;

        // Try provided path, then executable directory, then fallback paths
        var candidates = new List<string>();
        if (!string.IsNullOrEmpty(jsonPath))
            candidates.Add(jsonPath);

        candidates.AddRange(CatalogPaths());

        foreach (var candidate in candidates)
        {
            try
            {
                if (File.Exists(candidate))
                {
                    var json = File.ReadAllText(candidate);
                    var db = JsonSerializer.Deserialize<GameDatabase>(json);
                    if (db?.Games != null && db.Games.Count > 0)
                    {
                        Games = db.Games;
                        Version = db.Version;
                        NonGames = db.NonGames;
                        BuildIndexes();
                        _loaded = true;
                        Log.I("GameDatabase", $"Loaded {Games.Count} games from {candidate}");
                        return;
                    }
                }
            }
            catch (Exception ex)
            {
                Log.E("GameDatabase", $"Failed to load {candidate}: {ex.Message}");
            }
        }

            Log.W("GameDatabase", "No games.json found, using hardcoded fallback");
        }
    }

    private static IEnumerable<string> CatalogPaths()
    {
        var baseDir = AppContext.BaseDirectory;
        yield return Path.Combine(baseDir, "games.json");

        var projectRoot = Path.GetFullPath(Path.Combine(baseDir, "..", "..", "..", "..", ".."));
        yield return Path.Combine(projectRoot, "dinho-clips-poc", "src", "DiNho.Capture.Poc", "games.json");
        yield return Path.Combine(projectRoot, "games.json");
    }

    // Lê o catálogo da nonGames do arquivo físico, independente do estado de
    // instância/lazy-load, para que o merge no EngineCoordinator seja determinístico.
    public static HashSet<string> ReadCatalogNonGames()
    {
        var result = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var candidate in CatalogPaths())
        {
            try
            {
                if (!File.Exists(candidate)) continue;
                var json = File.ReadAllText(candidate);
                var db = JsonSerializer.Deserialize<GameDatabase>(json);
                if (db?.NonGames is { Count: > 0 })
                {
                    foreach (var process in db.NonGames)
                        result.Add(process);
                    return result;
                }
            }
            catch (Exception ex)
            {
                Log.E("GameDatabase", $"Failed to read nonGames from {candidate}: {ex.Message}");
            }
        }

        return result;
    }

    private void BuildIndexes()
    {
        _byWindowClass.Clear();
        _byProcessName.Clear();

        foreach (var game in Games)
        {
            if (!string.IsNullOrEmpty(game.WindowClass))
            {
                // Only first entry per windowClass wins
                _byWindowClass.TryAdd(game.WindowClass, game);
            }

            if (!string.IsNullOrEmpty(game.ProcessName))
            {
                _byProcessName.TryAdd(game.ProcessName, game);
            }
        }
    }

    public string? FindDisplayNameByWindowClass(string windowClass)
    {
        return _byWindowClass.TryGetValue(windowClass, out var game) ? game.DisplayName : null;
    }

    public GameEntry? FindByProcessName(string processName)
    {
        return _byProcessName.TryGetValue(processName, out var game) ? game : null;
    }

    public GameEntry? FindByAlias(string alias)
    {
        return Games.Find(g =>
            g.Aliases.Exists(a => string.Equals(a, alias, StringComparison.OrdinalIgnoreCase)));
    }

    public GameEntry? FindByAny(string? windowClass, string? processName)
    {
        if (!string.IsNullOrEmpty(windowClass))
        {
            var byClass = FindDisplayNameByWindowClass(windowClass);
            if (byClass != null)
                return _byWindowClass[windowClass];
        }

        if (!string.IsNullOrEmpty(processName))
        {
            var byProcess = FindByProcessName(processName);
            if (byProcess != null)
                return byProcess;

            var byAlias = FindByAlias(processName);
            if (byAlias != null)
                return byAlias;

            // Fallback: verificar Steam/Epic libraries escaneadas
            var byScanned = LibraryScanner.LookupProcessName(processName);
            if (byScanned != null)
                return byScanned;
        }

        return null;
    }

    // Hardcoded fallback map (same as original KnownGames)
    private static readonly Dictionary<string, string> HardcodedMap = new(StringComparer.OrdinalIgnoreCase)
    {
        ["grcWindow"] = "FiveM",
        ["WINDOW"] = "Roblox",
        ["SDL_app"] = "CS2/Source Engine",
        ["CEF-OSC-WIDGET"] = "Valorant",
        ["UnrealWindow"] = "Unreal Engine",
        ["UnityWndClass"] = "Unity",
        ["FORTNITE"] = "Fortnite",
    };

    public string GetDisplayName(string windowClass)
    {
        if (_loaded)
        {
            var name = FindDisplayNameByWindowClass(windowClass);
            if (name != null)
                return name;
        }

        return HardcodedMap.TryGetValue(windowClass, out var fallback) ? fallback : "";
    }
}
