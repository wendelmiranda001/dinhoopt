using Xunit;

namespace DiNho.Capture.Poc.Tests;

// Classes that mutate process-global static state (GameDatabase singleton)
// must not run concurrently with any other collection.
[CollectionDefinition("GlobalGameState", DisableParallelization = true)]
public sealed class GlobalGameStateCollection
{
}