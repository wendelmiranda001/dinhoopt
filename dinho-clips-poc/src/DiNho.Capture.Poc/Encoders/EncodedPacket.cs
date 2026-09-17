using System.Buffers;
using DiNho.Capture.Poc.Logging;

namespace DiNho.Capture.Poc.Encoders;

public enum MediaType { Video, Audio }

public sealed class EncodedPacket
{
    public byte[] Data { get; private set; }
    public float[]? PcmSamples { get; private set; }
    public MediaType Type { get; }
    public TimeSpan Pts { get; internal set; }
    public TimeSpan Duration { get; internal set; }
    public bool IsKeyFrame { get; }
    public int Width { get; }
    public int Height { get; }
    public bool IsPooled { get; }
    public int DataLength { get; private set; }
    public bool IsPooledPcm { get; }
    private int _retainCount;

    public void Retain()
    {
        Interlocked.Increment(ref _retainCount);
    }

    public EncodedPacket(
        byte[] data,
        MediaType type,
        TimeSpan pts,
        TimeSpan duration,
        bool isKeyFrame,
        int width = 0,
        int height = 0)
    {
        Data = data;
        DataLength = data.Length;
        Type = type;
        Pts = pts;
        Duration = duration;
        IsKeyFrame = isKeyFrame;
        Width = width;
        Height = height;
        IsPooled = false;
    }

    public EncodedPacket(
        byte[] data,
        MediaType type,
        TimeSpan pts,
        TimeSpan duration,
        bool isKeyFrame,
        bool isPooled,
        int width = 0,
        int height = 0,
        int dataLength = 0)
    {
        Data = data;
        DataLength = dataLength > 0 ? dataLength : data.Length;
        Type = type;
        Pts = pts;
        Duration = duration;
        IsKeyFrame = isKeyFrame;
        Width = width;
        Height = height;
        IsPooled = isPooled;
    }

    public EncodedPacket(
        float[] pcmSamples,
        MediaType type,
        TimeSpan pts,
        TimeSpan duration,
        bool isPooled = false)
    {
        PcmSamples = pcmSamples;
        Data = [];
        Type = type;
        Pts = pts;
        Duration = duration;
        IsKeyFrame = false;
        IsPooled = false;
        DataLength = 0;
        IsPooledPcm = isPooled;
    }

    public void Release()
    {
        var next = Interlocked.Decrement(ref _retainCount);

        if (next >= 0)
            return; // ainda retido (Retain() pendente) — release parcial normal

        if (next < -1)
        {
            // Duplo Release em pacote já devolvido ao pool: o byte[] já foi
            // retornado na 1ª chamada (next == -1), então esta é uma violação
            // de contrato. Não é recuperável (o array pode estar em uso por outro
            // consumer), mas loga para detecção em vez de corromper silenciosamente.
            Log.E("EncodedPacket", $"Duplo Release! retainCount={next} type={Type} pts={Pts.TotalMilliseconds:F0}ms pooled={IsPooled}");
            return;
        }

        // next == -1: última referência liberada — devolve ao pool (uma única vez)
        if (IsPooled && DataLength > 0)
        {
            VideoPacketPool.Return(Data);
            Data = [];
            DataLength = 0;
        }
        if (IsPooledPcm && PcmSamples != null)
        {
            ArrayPool<float>.Shared.Return(PcmSamples);
            PcmSamples = null;
        }
    }
}
