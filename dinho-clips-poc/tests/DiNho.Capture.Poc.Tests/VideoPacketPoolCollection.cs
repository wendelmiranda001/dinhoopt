using Xunit;

namespace DiNho.Capture.Poc.Tests;

// VideoPacketPool é um pool estático global compartilhado. Classes que ASSERTAM o
// estado dele (IdleBytes/MaxIdleBytes) ficam nesta MESMA coleção: xUnit as executa
// em sequência e fora do paralelismo entre coleções, tornando as asserções
// determinísticas (regressão: PostSaveTrim_TrimsIdleToQuarterOfMaxIdleBytes falhava
// apenas em execução paralela quando outra classe rentava/devolvia ao mesmo pool).
[CollectionDefinition("VideoPacketPool", DisableParallelization = true)]
public sealed class VideoPacketPoolCollection
{
}