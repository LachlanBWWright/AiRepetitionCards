using System.Diagnostics;
using System.ComponentModel;
using System.Text;
using System.Text.Json;

namespace Recall.Api.Features.Learning;

public sealed partial class LearningActivityOperations
{
    private async Task<IResult> AssessCodeAsync(JsonElement activity, JsonElement response, CancellationToken token, bool executeOnly = false, string mode = "submit")
    {
        if (!activity.TryGetProperty("payload", out var payload) || payload.ValueKind != JsonValueKind.Object ||
            !payload.TryGetProperty("tests", out var tests) || tests.ValueKind != JsonValueKind.Array || tests.GetArrayLength() is < 1 or > 20 ||
            !tests.EnumerateArray().All(test => test.ValueKind == JsonValueKind.Object && test.TryGetProperty("input", out var input) && input.ValueKind == JsonValueKind.Array && input.GetArrayLength() <= 10 && test.TryGetProperty("expected", out _)))
            return Error("invalid-coding-activity", 400);
        if (mode == "run" && payload.TryGetProperty("exampleTests", out var examples) && examples.ValueKind == JsonValueKind.Array && examples.GetArrayLength() > 0)
            tests = examples;
        if (tests.GetArrayLength() > 20 || !tests.EnumerateArray().All(test => test.ValueKind == JsonValueKind.Object && test.TryGetProperty("input", out var input) && input.ValueKind == JsonValueKind.Array && input.GetArrayLength() <= 10 && test.TryGetProperty("expected", out _)))
            return Error("invalid-coding-activity", 400);
        var language = payload.GetProperty("language").GetString();
        var source = response.GetProperty("answers").GetArrayLength() > 0 ? response.GetProperty("answers")[0].GetString() : null;
        if (string.IsNullOrWhiteSpace(source)) return Error("coding-solution-required", 400);
        var image = configuration["RECALL_CODE_IMAGE"]?.Trim() ?? "recall-code-runner:2";
        if (image.Length is 0 or > 200 || !char.IsAsciiLetterOrDigit(image[0]) || !image.All(character => char.IsAsciiLetterOrDigit(character) || character is '.' or '_' or '/' or '@' or ':' or '-')) return Error("coding-runner-unavailable", 503);
        var name = "recall-code-" + Guid.NewGuid().ToString("N");
        var args = new[] { "run", "--pull=never", "--rm", "--name", name, "-i", "--network=none", "--read-only", "--cap-drop=ALL", "--security-opt=no-new-privileges", "--pids-limit=32", "--memory=512m", "--memory-swap=512m", "--tmpfs=/tmp:rw,exec,nosuid,nodev,size=64m,mode=1777", "--cpus=0.5", "--user=65534:65534", "--ulimit=nofile=64:64", "--ulimit=cpu=25:25", image, "python3", "-I", "/runner/runner.py" };
        var start = new ProcessStartInfo("docker") { RedirectStandardInput = true, RedirectStandardOutput = true, RedirectStandardError = true, UseShellExecute = false, CreateNoWindow = true };
        foreach (var arg in args) start.ArgumentList.Add(arg);
        using var process = new Process { StartInfo = start };
        try
        {
            if (!process.Start()) return Error("coding-runner-unavailable", 503);
            var request = JsonSerializer.Serialize(new { source, language, tests }, JsonOptions);
            if (Encoding.UTF8.GetByteCount(request) > 200_000) { process.Kill(true); return Error("invalid-coding-activity", 400); }
            using var timeout = CancellationTokenSource.CreateLinkedTokenSource(token);
            timeout.CancelAfter(TimeSpan.FromSeconds(30));
            await process.StandardInput.WriteAsync(request.AsMemory(), timeout.Token);
            process.StandardInput.Close();
            var outputTask = ReadBoundedAsync(process.StandardOutput, 65_536, timeout.Token);
            var errorTask = ReadBoundedAsync(process.StandardError, 2_000, timeout.Token);
            await process.WaitForExitAsync(timeout.Token);
            var output = await outputTask;
            _ = await errorTask;
            if (process.ExitCode != 0 || output is null) return Error("coding-runner-failed", 503);
            using var resultDoc = JsonDocument.Parse(output, new JsonDocumentOptions { MaxDepth = 8 });
            var result = resultDoc.RootElement;
            if (result.ValueKind != JsonValueKind.Object || !result.TryGetProperty("passed", out var passedValue) || passedValue.ValueKind != JsonValueKind.Number || !passedValue.TryGetInt32(out var passed) ||
                !result.TryGetProperty("total", out var totalValue) || totalValue.ValueKind != JsonValueKind.Number || !totalValue.TryGetInt32(out var total) || total != tests.GetArrayLength() || passed < 0 || passed > total ||
                !result.TryGetProperty("failures", out var failures) || failures.ValueKind != JsonValueKind.Array || failures.GetArrayLength() > 20 || !ValidCodingExecutionDetails(result)) return Error("coding-runner-invalid-result", 502);
            if (executeOnly) return Results.Json(result.Clone(), options: JsonOptions);
            var score = (double)passed / total;
            var assistance = response.GetProperty("assistance").GetString();
            var evidence = activity.GetProperty("objectiveIds").EnumerateArray().Select(objective => new { objectiveId = objective.GetString(), dimension = "application", score, confidence = 0.9, assistance, assessment = "deterministic", explanation = "Bounded, isolated code execution against the activity's approved test cases." });
            var failureText = string.Join(" ", failures.EnumerateArray().Where(value => value.ValueKind == JsonValueKind.String).Select(value => value.GetString()));
            return Results.Json(new { evidence, feedback = $"{passed}/{total} tests passed. {failureText} Tests establish correctness against these examples, not algorithmic complexity.", evaluatorId = "recall.coding:json-tests", evaluatorVersion = "docker-functions-2" }, options: JsonOptions);
        }
        catch (Win32Exception) { return Error("coding-runner-unavailable", 503); }
        catch (OperationCanceledException) when (!token.IsCancellationRequested)
        {
            try { if (!process.HasExited) process.Kill(true); } catch (InvalidOperationException) { }
            return Error("coding-runner-timeout", 503);
        }
        catch (JsonException) { return Error("coding-runner-invalid-result", 502); }
        catch (IOException) { return Error("coding-runner-failed", 503); }
        finally
        {
            try { if (!process.HasExited) process.Kill(true); } catch (InvalidOperationException) { }
            await RemoveContainerAsync(name);
        }
    }

    private static async Task RemoveContainerAsync(string name)
    {
        var start = new ProcessStartInfo("docker") { UseShellExecute = false, CreateNoWindow = true };
        foreach (var argument in new[] { "rm", "-f", name }) start.ArgumentList.Add(argument);
        using var cleanup = new Process { StartInfo = start };
        try
        {
            if (!cleanup.Start()) return;
            using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(5));
            await cleanup.WaitForExitAsync(timeout.Token);
        }
        catch (Win32Exception) { }
        catch (OperationCanceledException)
        {
            try { if (!cleanup.HasExited) cleanup.Kill(true); } catch (InvalidOperationException) { }
        }
        catch (InvalidOperationException) { }
    }

    private static async Task<string?> ReadBoundedAsync(StreamReader reader, int limit, CancellationToken token)
    {
        var buffer = new char[4096];
        var builder = new StringBuilder();
        var exceeded = false;
        while (true)
        {
            var count = await reader.ReadAsync(buffer.AsMemory(), token);
            if (count == 0) return exceeded ? null : builder.ToString();
            if (builder.Length + count > limit) exceeded = true;
            if (!exceeded) builder.Append(buffer, 0, count);
        }
    }

    private static bool ValidCodingExecutionDetails(JsonElement result)
    {
        if (result.GetProperty("failures").EnumerateArray().Any(value => value.ValueKind != JsonValueKind.String || value.GetString()!.Length > 2_000)) return false;
        if (result.TryGetProperty("status", out var status) && (status.ValueKind != JsonValueKind.String || status.GetString() is not ("passed" or "failed" or "timeout" or "error"))) return false;
        if (result.TryGetProperty("diagnostics", out var diagnostics) && (diagnostics.ValueKind != JsonValueKind.Array || diagnostics.GetArrayLength() > 20 ||
            diagnostics.EnumerateArray().Any(value => value.ValueKind != JsonValueKind.String || value.GetString()!.Length > 2_000))) return false;
        if (result.TryGetProperty("stdout", out _) && !String(result, "stdout", 20_000)) return false;
        return !result.TryGetProperty("runtimeMs", out var runtime) || Number(runtime, out var duration) && duration is >= 0 and <= 3_600_000;
    }

    private static bool ValidCodingOptions(JsonElement payload)
    {
        foreach (var key in new[] { "starterCode", "signature" })
            if (payload.TryGetProperty(key, out _) && !String(payload, key, 20_000)) return false;
        foreach (var key in new[] { "constraints", "hints" })
            if (payload.TryGetProperty(key, out var values) && (values.ValueKind != JsonValueKind.Array || values.GetArrayLength() > 20 ||
                values.EnumerateArray().Any(value => value.ValueKind != JsonValueKind.String || value.GetString()!.Length > 20_000))) return false;
        if (payload.TryGetProperty("mode", out var mode) && (mode.ValueKind != JsonValueKind.String || mode.GetString() is not ("short-review" or "practice"))) return false;
        return !payload.TryGetProperty("exampleTests", out var tests) || tests.ValueKind == JsonValueKind.Array && tests.GetArrayLength() <= 20 &&
            tests.EnumerateArray().All(test => test.ValueKind == JsonValueKind.Object && test.TryGetProperty("input", out var input) && input.ValueKind == JsonValueKind.Array && input.GetArrayLength() <= 10 && test.TryGetProperty("expected", out _));
    }

}
