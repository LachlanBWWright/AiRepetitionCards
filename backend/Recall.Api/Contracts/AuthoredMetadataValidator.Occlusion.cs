using System.Text.Json;

namespace Recall.Api.Contracts;

public static partial class AuthoredMetadataValidator
{
    private static bool ValidOcclusion(JsonElement image)
    {
        if (image.ValueKind != JsonValueKind.Object || !RequiredText(image, "imageMediaId", 1, 100) || !OptionalText(image, "sourceId", 1, 100) || !RequiredText(image, "mode") || image.GetProperty("mode").GetString() is not ("hide-one" or "hide-all") || !Array(image, "masks", 1, 100, out var masks) || !Array(image, "targetMaskIds", 1, 100, out var targets) || !UniqueStrings(targets)) return false;
        var ids = new HashSet<string>(StringComparer.Ordinal);
        foreach (var mask in masks.EnumerateArray())
            if (!ValidMask(mask) || !ids.Add(mask.GetProperty("id").GetString()!)) return false;
        return targets.EnumerateArray().All(target => ids.Contains(target.GetString()!));
    }
    private static bool ValidMask(JsonElement mask)
    {
        if (mask.ValueKind != JsonValueKind.Object || !RequiredText(mask, "id", 1, 100) || !RequiredText(mask, "label", 0, 200) || !OptionalText(mask, "groupId", 1, 100) || !RequiredText(mask, "shape") || mask.GetProperty("shape").GetString() is not ("rectangle" or "ellipse" or "polygon") || !Array(mask, "points", 2, 32, out var points)) return false;
        foreach (var point in points.EnumerateArray())
            if (point.ValueKind != JsonValueKind.Object || !Number(point, "x", 0, 1) || !Number(point, "y", 0, 1)) return false;
        if (mask.GetProperty("shape").GetString() != "polygon") return points.GetArrayLength() == 2 && points[0].GetProperty("x").GetDouble() != points[1].GetProperty("x").GetDouble() && points[0].GetProperty("y").GetDouble() != points[1].GetProperty("y").GetDouble();
        if (points.GetArrayLength() < 3) return false;
        double area = 0;
        for (var index = 0; index < points.GetArrayLength(); index++)
        {
            var point = points[index];
            var next = points[(index + 1) % points.GetArrayLength()];
            area += point.GetProperty("x").GetDouble() * next.GetProperty("y").GetDouble() - next.GetProperty("x").GetDouble() * point.GetProperty("y").GetDouble();
        }
        return Math.Abs(area) > .00001;
    }
}
