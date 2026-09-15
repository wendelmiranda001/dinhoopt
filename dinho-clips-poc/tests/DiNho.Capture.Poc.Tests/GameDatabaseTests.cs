using DiNho.Capture.Poc.GameDetection;
using System.Reflection;
using System.Text.Json;

namespace DiNho.Capture.Poc.Tests;

public sealed class GameDatabaseTests
{
    [Fact]
    public void LoadGameDatabase_FromJson_ReturnsExpectedGames()
    {
        var db = new GameDatabase();
        var baseDir = AppContext.BaseDirectory;
        var gamesJson = Path.Combine(baseDir, "games.json");
        Assert.True(File.Exists(gamesJson), $"games.json not found at {gamesJson}");
        db.Load(gamesJson);

        Assert.True(db.IsLoaded, "games.json should be found in test environment");
        Assert.True(db.GameCount >= 150, $"Expected >= 150 games from JSON, got {db.GameCount}");
    }

    [Fact]
    public void FindByWindowClass_ReturnsCorrectGame()
    {
        var db = new GameDatabase();
        var baseDir = AppContext.BaseDirectory;
        db.Load(Path.Combine(baseDir, "games.json"));

        Assert.Equal("FiveM (GTA V)", db.FindDisplayNameByWindowClass("grcWindow"));
        Assert.Equal("Roblox", db.FindDisplayNameByWindowClass("WINDOW"));
        Assert.Equal("Counter-Strike 2", db.FindDisplayNameByWindowClass("SDL_app"));
        Assert.Equal("Valorant", db.FindDisplayNameByWindowClass("CEF-OSC-WIDGET"));
        Assert.Equal("PUBG: Battlegrounds", db.FindDisplayNameByWindowClass("UnrealWindow"));
        Assert.Equal("Genshin Impact", db.FindDisplayNameByWindowClass("UnityWndClass"));
        Assert.Equal("Fortnite", db.FindDisplayNameByWindowClass("FORTNITE"));
    }

    [Fact]
    public void FindByProcessName_ReturnsCorrectGame()
    {
        var db = new GameDatabase();
        var baseDir = AppContext.BaseDirectory;
        db.Load(Path.Combine(baseDir, "games.json"));

        Assert.NotNull(db.FindByProcessName("FiveM_GTAProcess"));
        Assert.Equal("FiveM (GTA V)", db.FindByProcessName("FiveM_GTAProcess")!.DisplayName);

        Assert.NotNull(db.FindByProcessName("cod"));
        Assert.Equal("Call of Duty", db.FindByProcessName("cod")!.DisplayName);

        Assert.NotNull(db.FindByProcessName("VALORANT-Win64-Shipping"));
        Assert.Equal("Valorant", db.FindByProcessName("VALORANT-Win64-Shipping")!.DisplayName);

        Assert.Null(db.FindByProcessName("nonexistent_game_xyz"));
    }

    [Fact]
    public void FindByAlias_ReturnsCorrectGame()
    {
        var db = new GameDatabase();
        var baseDir = AppContext.BaseDirectory;
        db.Load(Path.Combine(baseDir, "games.json"));

        Assert.NotNull(db.FindByAlias("CSGO"));
        Assert.NotNull(db.FindByAlias("CS2"));
        Assert.NotNull(db.FindByAlias("GTA V"));
        Assert.NotNull(db.FindByAlias("RDR 2"));
        Assert.NotNull(db.FindByAlias("minecraft"));
        Assert.Null(db.FindByAlias(""));
    }

    [Fact]
    public void GetDisplayName_FallbackToHardcoded()
    {
        var db = new GameDatabase();
        // Don't load JSON — test hardcoded fallback only
        // (GameDatabase starts unloaded)

        var field = typeof(GameDatabase).GetField("_loaded",
            BindingFlags.Instance | BindingFlags.NonPublic);
        Assert.NotNull(field);

        // Ensure we test the fallback path
        Assert.Equal("FiveM", db.GetDisplayName("grcWindow"));
        Assert.Equal("Roblox", db.GetDisplayName("WINDOW"));
        // Unknown class returns empty
        Assert.Equal("", db.GetDisplayName("SomeUnknownClass"));
    }

    [Fact]
    public void FindByAny_ProcessNamePreferred()
    {
        var db = new GameDatabase();
        var baseDir = AppContext.BaseDirectory;
        db.Load(Path.Combine(baseDir, "games.json"));

        // Both windowClass and processName match — should prefer windowClass
        var result = db.FindByAny("grcWindow", "FiveM_GTAProcess");
        Assert.NotNull(result);
        Assert.Equal("FiveM (GTA V)", result!.DisplayName);

        // Only processName matches
        result = db.FindByAny("", "FiveM_GTAProcess");
        Assert.NotNull(result);

        // Neither matches
        result = db.FindByAny("", "");
        Assert.Null(result);
    }

    [Fact]
    public void Version_IsSetFromJson()
    {
        var db = new GameDatabase();
        var baseDir = AppContext.BaseDirectory;
        db.Load(Path.Combine(baseDir, "games.json"));

        // games.json should have version >= 2
        Assert.True(db.Version >= 2, $"Expected version >= 2, got {db.Version}");
    }

    [Fact]
    public void LoadGameDatabase_FromJson_LoadsNonGames()
    {
        var db = new GameDatabase();
        var baseDir = AppContext.BaseDirectory;
        var gamesJson = Path.Combine(baseDir, "games.json");
        db.Load(gamesJson);

        Assert.True(db.NonGames.Count >= 100, $"Expected >= 100 nonGames from JSON, got {db.NonGames.Count}");
        Assert.Contains("HandBrake", db.NonGames);
        Assert.Contains("heroic", db.NonGames);
        Assert.Contains("gamebarpresencewriter", db.NonGames);
    }

    [Fact]
    public void ReadCatalogNonGames_ReturnsDedupedSet()
    {
        var set = GameDatabase.ReadCatalogNonGames();

        Assert.Contains("HandBrake", set);
        Assert.Contains("heroic", set);
        Assert.Contains("gamebarpresencewriter", set);
        // Never has the games-boundary tests' game names
        Assert.DoesNotContain("FiveM", set);
        Assert.DoesNotContain("Fortnite", set);
        Assert.DoesNotContain("cs2", set);
        Assert.DoesNotContain("valorant", set);
        Assert.DoesNotContain("GTA5", set);
        Assert.DoesNotContain("Minecraft", set);
    }

    // ── 6.7: Reload sob lock — patching _loaded com _loadLock significa que
    //    Load() concorrente NÃO pode "pular" o reload. ──

    [Fact]
    public void Reload_WhenPreviouslyLoaded_ReplacesDataset()
    {
        var tmpDir = Path.Combine(Path.GetTempPath(), "DiNhoGDBTest_" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(tmpDir);
        try
        {
            var pathA = Path.Combine(tmpDir, "a.json");
            var pathB = Path.Combine(tmpDir, "b.json");
            File.WriteAllText(pathA, JsonSerializer.Serialize(new
            {
                version = 10,
                games = new[] { new { processName = "gameA.exe", windowClass = "WinA", displayName = "Game A" } }
            }));
            File.WriteAllText(pathB, JsonSerializer.Serialize(new
            {
                version = 11,
                games = new[] { new { processName = "gameB.exe", windowClass = "WinB", displayName = "Game B" } }
            }));

            var db = new GameDatabase();
            db.Load(pathA);

            Assert.True(db.IsLoaded);
            Assert.NotNull(db.FindByProcessName("gameA.exe"));
            Assert.Null(db.FindByProcessName("gameB.exe"));

            db.Reload(pathB);

            Assert.True(db.IsLoaded);
            Assert.Equal(11, db.Version);
            Assert.NotNull(db.FindByProcessName("gameB.exe"));
            Assert.Null(db.FindByProcessName("gameA.exe"));
        }
        finally { try { Directory.Delete(tmpDir, true); } catch { } }
    }

    [Fact]
    public async Task Reload_ConcurrentLoadNeverLeavesUnloaded()
    {
        var tmpDir = Path.Combine(Path.GetTempPath(), "DiNhoGDBTest_" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(tmpDir);
        try
        {
            var pathA = Path.Combine(tmpDir, "a.json");
            var pathB = Path.Combine(tmpDir, "b.json");
            File.WriteAllText(pathA, JsonSerializer.Serialize(new
            {
                version = 10,
                games = new[] { new { processName = "gameA.exe", windowClass = "WinA", displayName = "Game A" } }
            }));
            File.WriteAllText(pathB, JsonSerializer.Serialize(new
            {
                version = 11,
                games = new[] { new { processName = "gameB.exe", windowClass = "WinB", displayName = "Game B" } }
            }));

            var db = new GameDatabase();
            db.Load(pathA);

            using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(1));
            var exceptions = new System.Collections.Concurrent.ConcurrentQueue<Exception>();

            var reloader = Task.Run(() =>
            {
                while (!cts.IsCancellationRequested)
                {
                    try { db.Reload(pathB); } catch (Exception ex) { exceptions.Enqueue(ex); }
                    try { db.Reload(pathA); } catch (Exception ex) { exceptions.Enqueue(ex); }
                }
            });

            var reader = Task.Run(() =>
            {
                while (!cts.IsCancellationRequested)
                {
                    try
                    {
                        _ = db.IsLoaded;
                        _ = db.GameCount;
                        _ = db.FindByProcessName("gameA.exe");
                        _ = db.FindByProcessName("gameB.exe");
                    }
                    catch (Exception ex) { exceptions.Enqueue(ex); }
                }
            });

            await Task.WhenAll(reloader, reader);

            Assert.Empty(exceptions);
            Assert.True(db.IsLoaded);
        }
        finally { try { Directory.Delete(tmpDir, true); } catch { } }
    }
}
