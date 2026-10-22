using System.Text;

namespace Recall.Api.Contracts;

/// <summary>Checks supported audio container signatures before accepting uploaded bytes.</summary>
public static class MediaContentSignatures
{
    public static bool IsMp4Audio(byte[] bytes)
    {
        if (bytes.Length < 16) return false;
        var size = System.Buffers.Binary.BinaryPrimitives.ReadUInt32BigEndian(bytes.AsSpan(0, 4));
        if (Encoding.ASCII.GetString(bytes, 4, 4) != "ftyp" || size < 16 || size > bytes.Length || size > 4096) return false;
        var brands = new HashSet<string>(["M4A ", "M4B ", "isom", "iso2", "mp41", "mp42", "qt  "], StringComparer.Ordinal);
        if (brands.Contains(Encoding.ASCII.GetString(bytes, 8, 4))) return true;
        for (var offset = 16; offset + 4 <= size; offset += 4)
            if (brands.Contains(Encoding.ASCII.GetString(bytes, offset, 4))) return true;
        return false;
    }
    public static bool IsWebmAudio(byte[] bytes)
    {
        if (bytes.Length < 16 || !bytes.AsSpan(0, 4).SequenceEqual(new byte[] { 0x1a, 0x45, 0xdf, 0xa3 })) return false;
        var firstSizeByte = bytes[4];
        var width = 1;
        while (width <= 8 && (firstSizeByte & (0x80 >> (width - 1))) == 0) width++;
        if (width > 8 || bytes.Length < 4 + width) return false;
        long length = firstSizeByte & (0xff >> width);
        for (var offset = 5; offset < 4 + width; offset++)
        {
            length = length * 256 + bytes[offset];
            if (length > 4096) return false;
        }
        var end = 4 + width + (int)length;
        if (length > 4096 || end + 4 > bytes.Length) return false;
        var webm = false;
        for (var offset = 4 + width; offset + 7 <= end; offset++)
            if (bytes[offset] == 0x42 && bytes[offset + 1] == 0x82 && bytes[offset + 2] == 0x84 && Encoding.ASCII.GetString(bytes, offset + 3, 4) == "webm") webm = true;
        return webm && bytes.AsSpan(end, 4).SequenceEqual(new byte[] { 0x18, 0x53, 0x80, 0x67 });
    }
}
