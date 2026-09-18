using DiNho.Capture.Poc.GameDetection;
using System.Net;
using System.Net.Http;
using System.Text.Json;

namespace DiNho.Capture.Poc.Tests;

[Collection("GlobalGameState")]
public sealed class GameDatabaseUpdaterTests : IDisposable
{
    private readonly MockHandler _mockHandler;
    private readonly HttpClient _httpClient;
    private readonly GameDatabaseUpdater _updater;
    private readonly string _tempDir;
    private readonly string _stateFilePath;

    public GameDatabaseUpdaterTests()
    {
        _tempDir = Path.Combine(Path.GetTempPath(), "DiNhoUpdaterTests_" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(_tempDir);

        _mockHandler = new MockHandler();
        _httpClient = new HttpClient(_mockHandler);
        _updater = new GameDatabaseUpdater(_httpClient, _tempDir);
        _updater.RetryDelay = TimeSpan.Zero; // keep tests fast — no real 30s backoff

        _stateFilePath = Path.Combine(_tempDir, "games-update-check.json");
    }

    public void Dispose()
    {
        // Updater tests Reload the process-global GameDatabase.Instance with a
        // temp games.json (often a single game). Restore the real ship DB so later
        // tests (e.g. KnownGames/GameInfo lookups) see the full catalog again.
        var builtIn = Path.Combine(AppContext.BaseDirectory, "games.json");
        if (File.Exists(builtIn))
        {
            GameDatabase.Instance.Reload(builtIn);
        }

        _httpClient.Dispose();
        _mockHandler.Dispose();
        try { Directory.Delete(_tempDir, recursive: true); } catch { }
    }

    [Fact]
    public async Task ReturnsTrue_WhenRemoteVersionGreaterThanLocal()
    {
        var localVersion = GameDatabase.Instance.Version;
        var remoteVersion = localVersion + 1;

        _mockHandler.Response = new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new StringContent(JsonSerializer.Serialize(new
            {
                version = remoteVersion,
                games = new[]
                {
                    new { processName = "test.exe", windowClass = "TestWindow", displayName = "Test Game" }
                }
            }))
        };

        var result = await _updater.CheckForUpdateAsync();

        Assert.True(result);
    }

    [Fact]
    public async Task ReturnsFalse_WhenVersionsMatch()
    {
        var localVersion = GameDatabase.Instance.Version;

        _mockHandler.Response = new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new StringContent(JsonSerializer.Serialize(new
            {
                version = localVersion,
                games = new[]
                {
                    new { processName = "test.exe", windowClass = "TestWindow", displayName = "Test Game" }
                }
            }))
        };

        var result = await _updater.CheckForUpdateAsync();

        Assert.False(result);
    }

    [Fact]
    public async Task ReturnsFalse_WhenRemoteVersionLower()
    {
        _mockHandler.Response = new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new StringContent(JsonSerializer.Serialize(new
            {
                version = 0,
                games = new[]
                {
                    new { processName = "test.exe", windowClass = "TestWindow", displayName = "Test Game" }
                }
            }))
        };

        var result = await _updater.CheckForUpdateAsync();

        Assert.False(result);
    }

    [Fact]
    public async Task ReturnsFalse_WhenHttpRequestFails()
    {
        _mockHandler.Response = new HttpResponseMessage(HttpStatusCode.ServiceUnavailable);

        var result = await _updater.CheckForUpdateAsync();

        Assert.False(result);
    }

    [Fact]
    public async Task ReturnsFalse_WhenHttpThrowsException()
    {
        _mockHandler.Exception = new HttpRequestException("Network error");

        var result = await _updater.CheckForUpdateAsync();

        Assert.False(result);
    }

    [Fact]
    public async Task ReturnsFalse_WhenRemoteGamesEmpty()
    {
        _mockHandler.Response = new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new StringContent(JsonSerializer.Serialize(new
            {
                version = 999,
                games = Array.Empty<object>()
            }))
        };

        var result = await _updater.CheckForUpdateAsync();

        Assert.False(result);
    }

    [Fact]
    public async Task ReturnsFalse_WhenRemoteGamesNull()
    {
        _mockHandler.Response = new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new StringContent(JsonSerializer.Serialize(new
            {
                version = 999
            }))
        };

        var result = await _updater.CheckForUpdateAsync();

        Assert.False(result);
    }

    [Fact]
    public async Task ReturnsFalse_WhenInvalidJson()
    {
        _mockHandler.Response = new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new StringContent("not valid json")
        };

        var result = await _updater.CheckForUpdateAsync();

        Assert.False(result);
    }

    [Fact]
    public async Task SkipsCheck_WhenLessThanIntervalSinceLastCheck()
    {
        // Write a state file with a recent timestamp
        var recentState = new GameDatabaseUpdater.UpdateState
        {
            LastCheckUnixMs = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
            LastVersion = GameDatabase.Instance.Version
        };
        File.WriteAllText(_stateFilePath, JsonSerializer.Serialize(recentState));

        // If it skips the check, HTTP handler should NOT be called
        _mockHandler.Response = new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new StringContent(JsonSerializer.Serialize(new
            {
                version = GameDatabase.Instance.Version + 1,
                games = new[]
                {
                    new { processName = "test.exe", windowClass = "TestWindow", displayName = "Test Game" }
                }
            }))
        };

        var result = await _updater.CheckForUpdateAsync();

        Assert.False(result);
        Assert.False(_mockHandler.WasCalled, "HTTP request should not have been made");
    }

    [Fact]
    public async Task ChecksForUpdate_WhenStateFileMissing()
    {
        CleanupStateFile();

        _mockHandler.Response = new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new StringContent(JsonSerializer.Serialize(new
            {
                version = GameDatabase.Instance.Version,
                games = new[]
                {
                    new { processName = "test.exe", windowClass = "TestWindow", displayName = "Test Game" }
                }
            }))
        };

        var result = await _updater.CheckForUpdateAsync();

        Assert.False(result); // versions match
        Assert.True(_mockHandler.WasCalled, "HTTP request should have been made when no state file exists");
    }

    [Fact]
    public async Task ChecksForUpdate_WhenPastInterval()
    {
        var oldState = new GameDatabaseUpdater.UpdateState
        {
            LastCheckUnixMs = DateTimeOffset.UtcNow.AddDays(-(GameDatabaseUpdater.CHECK_INTERVAL_DAYS + 1)).ToUnixTimeMilliseconds(),
            LastVersion = GameDatabase.Instance.Version
        };
        File.WriteAllText(_stateFilePath, JsonSerializer.Serialize(oldState));

        _mockHandler.Response = new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new StringContent(JsonSerializer.Serialize(new
            {
                version = GameDatabase.Instance.Version,
                games = new[]
                {
                    new { processName = "test.exe", windowClass = "TestWindow", displayName = "Test Game" }
                }
            }))
        };

        var result = await _updater.CheckForUpdateAsync();

        Assert.False(result); // versions match
        Assert.True(_mockHandler.WasCalled, "HTTP request should have been made when past interval");
    }

    [Fact]
    public async Task SavesState_AfterSuccessfulCheck()
    {
        CleanupStateFile();

        _mockHandler.Response = new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new StringContent(JsonSerializer.Serialize(new
            {
                version = GameDatabase.Instance.Version,
                games = new[]
                {
                    new { processName = "test.exe", windowClass = "TestWindow", displayName = "Test Game" }
                }
            }))
        };

        await _updater.CheckForUpdateAsync();

        Assert.True(File.Exists(_stateFilePath), "State file should exist after check");

        var savedJson = File.ReadAllText(_stateFilePath);
        var savedState = JsonSerializer.Deserialize<GameDatabaseUpdater.UpdateState>(savedJson);
        Assert.NotNull(savedState);
        Assert.Equal(GameDatabase.Instance.Version, savedState.LastVersion);
    }

    [Fact]
    public async Task SavesState_AfterFailedHttpRequest()
    {
        CleanupStateFile();

        _mockHandler.Response = new HttpResponseMessage(HttpStatusCode.ServiceUnavailable);

        await _updater.CheckForUpdateAsync();

        // Falha persiste LastFailedUnixMs para backoff — evita re-try a cada 30s/launch.
        Assert.True(File.Exists(_stateFilePath), "State file should exist with failure timestamp after failed request");

        var savedJson = File.ReadAllText(_stateFilePath);
        var savedState = JsonSerializer.Deserialize<GameDatabaseUpdater.UpdateState>(savedJson);
        Assert.NotNull(savedState);
        Assert.True(savedState!.LastFailedUnixMs > 0, "LastFailedUnixMs should be set after a failed request");
    }

    [Fact]
    public async Task ThreadSafety_BlocksConcurrentCalls()
    {
        _mockHandler.Response = new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new StringContent(JsonSerializer.Serialize(new
            {
                version = GameDatabase.Instance.Version,
                games = new[]
                {
                    new { processName = "test.exe", windowClass = "TestWindow", displayName = "Test Game" }
                }
            }))
        };

        // Simulate a slow response by having the handler introduce a delay
        _mockHandler.DelayMs = 500;

        var task1 = _updater.CheckForUpdateAsync();
        var task2 = _updater.CheckForUpdateAsync();

        var results = await Task.WhenAll(task1, task2);

        // Both return false — versions match; semaphore blocked the second HTTP call
        Assert.All(results, r => Assert.False(r));
        Assert.True(_mockHandler.WasCalled);
    }

    [Fact]
    public async Task WritesUpdatedGamesJson_WhenRemoteNewer()
    {
        var localVersion = GameDatabase.Instance.Version;
        var remoteVersion = localVersion + 1;
        var testGames = new[]
        {
            new { processName = "newgame.exe", windowClass = "NewWindow", displayName = "New Game" }
        };
        var remoteJson = JsonSerializer.Serialize(new { version = remoteVersion, games = testGames });

        _mockHandler.Response = new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new StringContent(remoteJson)
        };

        var result = await _updater.CheckForUpdateAsync();

        Assert.True(result);

        // Verify the file was written in temp directory
        var targetPath = Path.Combine(_tempDir, "games.json");
        var savedJson2 = await File.ReadAllTextAsync(targetPath);
        var savedDb = JsonSerializer.Deserialize<GameDatabase>(savedJson2);
        Assert.NotNull(savedDb);
        Assert.Equal(remoteVersion, savedDb.Version);
    }

    // ── 6.6: NÃO sobrescrever o games.json local se o schema remoto nāo for
    //    um GameDatabase válido. O antigo valia apenas games.Count>0 (List<object>)
    //    e movia o arquivo ANTES do Reload — arquivo local corrompido. ──

    [Fact]
    public async Task DoesNotOverwriteExisting_WhenRemoteSchemaInvalid()
    {
        var localVersion = GameDatabase.Instance.Version;
        var seedJson = JsonSerializer.Serialize(new
        {
            version = localVersion,
            games = new[]
            {
                new { processName = "oldgame.exe", windowClass = "OldWindow", displayName = "Old Game" }
            }
        });
        File.WriteAllText(Path.Combine(_tempDir, "games.json"), seedJson);

        // List<object> com valores não-objeto: passa na checagem antiga (Count>0)
        // mas falha Deserialize<GameDatabase> — exatamente o schema da CDN corrupta.
        _mockHandler.Response = new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new StringContent(JsonSerializer.Serialize(new
            {
                version = localVersion + 1,
                games = new object[] { 1, 2, 3 }
            }))
        };

        var result = await _updater.CheckForUpdateAsync();

        Assert.False(result);
        var savedJson2 = File.ReadAllText(Path.Combine(_tempDir, "games.json"));
        var savedDb = JsonSerializer.Deserialize<GameDatabase>(savedJson2);
        Assert.NotNull(savedDb);
        Assert.Equal(localVersion, savedDb.Version);
    }

    [Fact]
    public async Task DoesNotOverwriteExisting_WhenRemoteEntriesLackIdentity()
    {
        var localVersion = GameDatabase.Instance.Version;
        var seedJson = JsonSerializer.Serialize(new
        {
            version = localVersion,
            games = new[]
            {
                new { processName = "oldgame.exe", windowClass = "OldWindow", displayName = "Old Game" }
            }
        });
        File.WriteAllText(Path.Combine(_tempDir, "games.json"), seedJson);

        // Entradas sem processName E sem windowClass são inúteis ao indexador.
        _mockHandler.Response = new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new StringContent(JsonSerializer.Serialize(new
            {
                version = localVersion + 1,
                games = new[]
                {
                    new { processName = "", windowClass = "", displayName = "Ghost" }
                }
            }))
        };

        var result = await _updater.CheckForUpdateAsync();

        Assert.False(result);
        var savedJson2 = File.ReadAllText(Path.Combine(_tempDir, "games.json"));
        var savedDb = JsonSerializer.Deserialize<GameDatabase>(savedJson2);
        Assert.NotNull(savedDb);
        Assert.Equal(localVersion, savedDb.Version);
    }

    [Fact]
    public async Task RetriesAndSucceeds_AfterTransientFailure()
    {
        var localVersion = GameDatabase.Instance.Version;
        _mockHandler.SequentialExceptions.Add(new HttpRequestException("Network error"));

        _mockHandler.Response = new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new StringContent(JsonSerializer.Serialize(new
            {
                version = localVersion + 1,
                games = new[]
                {
                    new { processName = "test.exe", windowClass = "TestWindow", displayName = "Test Game" }
                }
            }))
        };

        var result = await _updater.CheckForUpdateAsync();

        Assert.True(result, "Should succeed on the retry after a transient failure");
        Assert.Equal(2, _mockHandler.CallCount);
    }

    [Fact]
    public async Task DoesNotRetry_OnHttpClientError()
    {
        _mockHandler.Response = new HttpResponseMessage(HttpStatusCode.NotFound);

        var result = await _updater.CheckForUpdateAsync();

        Assert.False(result);
        Assert.Equal(1, _mockHandler.CallCount);
    }

    [Fact]
    public async Task FailsAfterAllRetries_AndPersistsFailureBackoff()
    {
        CleanupStateFile();

        _mockHandler.Exception = new HttpRequestException("Network error");

        var result = await _updater.CheckForUpdateAsync();

        Assert.False(result);
        Assert.Equal(2, _mockHandler.CallCount);
        // A falha persiste LastFailedUnixMs (backoff de 24h) — não fica tentando a cada launch.
        Assert.True(File.Exists(_stateFilePath), "State file should persist after all retries to enable failure backoff");

        var savedState = JsonSerializer.Deserialize<GameDatabaseUpdater.UpdateState>(File.ReadAllText(_stateFilePath));
        Assert.NotNull(savedState);
        Assert.True(savedState!.LastFailedUnixMs > 0, "LastFailedUnixMs should be persisted after retries exhausted");
    }

    [Fact]
    public async Task SkipsCheck_WhenLastFailureWithinBackoff()
    {
        var recentFailure = new GameDatabaseUpdater.UpdateState
        {
            LastCheckUnixMs = 0,
            LastVersion = 0,
            LastFailedUnixMs = DateTimeOffset.UtcNow.AddMinutes(-30).ToUnixTimeMilliseconds(),
        };
        File.WriteAllText(_stateFilePath, JsonSerializer.Serialize(recentFailure));

        _mockHandler.Response = new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new StringContent(JsonSerializer.Serialize(new
            {
                version = 99999,
                games = new[]
                {
                    new { processName = "newgame.exe", windowClass = "NewWindow", displayName = "New Game" }
                }
            }))
        };

        var result = await _updater.CheckForUpdateAsync();

        Assert.False(result);
        Assert.False(_mockHandler.WasCalled, "HTTP request should be skipped within failure backoff");
    }

    [Fact]
    public async Task ChecksAgain_WhenFailureBackoffExpired()
    {
        var oldFailure = new GameDatabaseUpdater.UpdateState
        {
            LastCheckUnixMs = 0,
            LastVersion = 0,
            LastFailedUnixMs = DateTimeOffset.UtcNow.AddHours(-25).ToUnixTimeMilliseconds(),
        };
        File.WriteAllText(_stateFilePath, JsonSerializer.Serialize(oldFailure));

        _mockHandler.Response = new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new StringContent(JsonSerializer.Serialize(new
            {
                version = 99999,
                games = new[]
                {
                    new { processName = "newgame.exe", windowClass = "NewWindow", displayName = "New Game" }
                }
            }))
        };

        var result = await _updater.CheckForUpdateAsync();

        Assert.True(result, "After backoff expires the updater should check again");
        Assert.True(_mockHandler.WasCalled, "HTTP request should be made after failure backoff expires");
    }

    [Fact]
    public async Task SuccessfulCheck_ResetsFailureBackoff()
    {
        var failedBefore = new GameDatabaseUpdater.UpdateState
        {
            LastCheckUnixMs = 0,
            LastVersion = 0,
            LastFailedUnixMs = DateTimeOffset.UtcNow.AddHours(-25).ToUnixTimeMilliseconds(),
        };
        File.WriteAllText(_stateFilePath, JsonSerializer.Serialize(failedBefore));

        _mockHandler.Response = new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new StringContent(JsonSerializer.Serialize(new
            {
                version = 99999,
                games = new[]
                {
                    new { processName = "newgame.exe", windowClass = "NewWindow", displayName = "New Game" }
                }
            }))
        };

        var result = await _updater.CheckForUpdateAsync();

        Assert.True(result, "A remote-version-larger-than-local check should succeed and reset backoff");
        var savedState = JsonSerializer.Deserialize<GameDatabaseUpdater.UpdateState>(File.ReadAllText(_stateFilePath));
        Assert.NotNull(savedState);
        Assert.Equal(0, savedState!.LastFailedUnixMs);
    }

    private void CleanupStateFile()
    {
        if (File.Exists(_stateFilePath))
            File.Delete(_stateFilePath);
    }

    private sealed class MockHandler : DelegatingHandler
    {
        public HttpResponseMessage? Response { get; set; }
        public Exception? Exception { get; set; }
        public List<Exception> SequentialExceptions { get; } = new();
        public bool WasCalled { get; private set; }
        public int CallCount { get; private set; }
        public int DelayMs { get; set; }

        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            WasCalled = true;
            CallCount++;

            if (SequentialExceptions.Count > 0)
            {
                var ex = SequentialExceptions[0];
                SequentialExceptions.RemoveAt(0);
                throw ex;
            }


            if (DelayMs > 0)
                Task.Delay(DelayMs, cancellationToken).GetAwaiter().GetResult();

            if (Exception != null)
                throw Exception;

            if (Response != null)
                return Task.FromResult(Response);

            return Task.FromResult(new HttpResponseMessage(HttpStatusCode.NotFound));
        }
    }
}
