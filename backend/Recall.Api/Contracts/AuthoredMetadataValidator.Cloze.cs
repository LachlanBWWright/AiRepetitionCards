using System.Globalization;
using System.Text;
using System.Text.RegularExpressions;

namespace Recall.Api.Contracts;

public static partial class AuthoredMetadataValidator
{
    public static bool ValidCloze(string? text, int? deletionIndex)
    {
        if (string.IsNullOrWhiteSpace(text) || text.Length > 20_000 || deletionIndex is < 1 or > 20) return false;
        var indices = new HashSet<int>();
        var offset = 0;
        return ParseCloze(text, ref offset, false, 0, indices, out _) && indices.Count > 0 && (deletionIndex is null || indices.Contains(deletionIndex.Value));
    }
    private static bool ParseCloze(string text, ref int offset, bool nested, int depth, HashSet<int> indices, out string plain)
    {
        plain = string.Empty;
        if (depth > 8) return false;
        var answer = new StringBuilder();
        while (offset < text.Length)
        {
            if (text.AsSpan(offset).StartsWith("}}", StringComparison.Ordinal) || (nested && text.AsSpan(offset).StartsWith("::", StringComparison.Ordinal)))
            {
                if (!nested || string.IsNullOrWhiteSpace(answer.ToString())) return false;
                plain = answer.ToString();
                if (text.AsSpan(offset).StartsWith("}}", StringComparison.Ordinal)) { offset += 2; return true; }
                var end = text.IndexOf("}}", offset + 2, StringComparison.Ordinal);
                if (end < 0) return false;
                var hint = text[(offset + 2)..end];
                if (string.IsNullOrWhiteSpace(hint) || hint.Contains("{{", StringComparison.Ordinal) || hint.Contains("::", StringComparison.Ordinal)) return false;
                offset = end + 2;
                return true;
            }
            if (text.AsSpan(offset).StartsWith("{{", StringComparison.Ordinal))
            {
                var header = Regex.Match(text[offset..], @"^\{\{c([1-9]|1[0-9]|20)::", RegexOptions.CultureInvariant);
                if (!header.Success) return false;
                indices.Add(int.Parse(header.Groups[1].Value, CultureInfo.InvariantCulture));
                offset += header.Length;
                if (!ParseCloze(text, ref offset, true, depth + 1, indices, out var child)) return false;
                answer.Append(child);
            }
            else answer.Append(text[offset++]);
        }
        plain = answer.ToString();
        return !nested;
    }
}
