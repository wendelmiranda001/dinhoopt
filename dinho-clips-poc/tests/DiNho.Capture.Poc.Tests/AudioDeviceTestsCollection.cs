using Xunit;

namespace DiNho.Capture.Poc.Tests;

// Real-device audio tests (WASAPI endpoints) may be slow/hardware-dependent and can
// leave NAudio capture threads behind on inert endpoints — never run them concurrently.
[CollectionDefinition("AudioDeviceTests", DisableParallelization = true)]
public sealed class AudioDeviceTestsCollection
{
}