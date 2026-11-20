using System.ComponentModel;
using System.Diagnostics;
using System.Text;
using System.Text.Json;

namespace Recall.Api.Features.Learning;

public sealed partial class LearningActivityOperations
{
    private const string LuaRuntimeVersion = "recall-lua-wasmoon-1.16.0-v1";
    private static readonly SemaphoreSlim LuaSlots = new(2, 2);

    public async Task<IResult> ExecuteLuaAsync(HttpContext http, CancellationToken token)
    {
        Private(http);
        var context = await ResolveAsync(http, token);
        if (context.Error is not null) return context.Error;
        var bytes = await ReadBodyAsync(http, 65_536, token);
        if (bytes is null || !TryObject(bytes, out var request) || !ValidLuaInvocation(request))
            return Error("invalid-lua-request", 400);
        if (!await LuaSlots.WaitAsync(0, token)) return Error("lua-runner-busy", 429);
        try { return await RunLuaContainerAsync(request, token); }
        finally { LuaSlots.Release(); }
    }

    private async Task<IResult> RunLuaContainerAsync(JsonElement request, CancellationToken token)
    {
        var image = configuration["RECALL_LUA_IMAGE"]?.Trim() ?? "recall-lua-runner:1";
        if (image.Length is 0 or > 200 || !char.IsAsciiLetterOrDigit(image[0]) ||
            !image.All(character => char.IsAsciiLetterOrDigit(character) || character is '.' or '_' or '/' or '@' or ':' or '-'))
            return Error("lua-runner-unavailable", 503);
        var name = "recall-lua-" + Guid.NewGuid().ToString("N");
        var start = new ProcessStartInfo("docker") { RedirectStandardInput = true, RedirectStandardOutput = true, RedirectStandardError = true, UseShellExecute = false, CreateNoWindow = true };
        foreach (var argument in new[] { "run", "--pull=never", "--rm", "--name", name, "-i", "--network=none", "--read-only", "--cap-drop=ALL", "--security-opt=no-new-privileges", "--pids-limit=16", "--memory=128m", "--memory-swap=128m", "--cpus=0.5", "--user=65534:65534", "--ulimit=nofile=64:64", "--ulimit=cpu=5:5", image }) start.ArgumentList.Add(argument);
        using var process = new Process { StartInfo = start };
        try
        {
            if (!process.Start()) return Error("lua-runner-unavailable", 503);
            using var timeout = CancellationTokenSource.CreateLinkedTokenSource(token);
            timeout.CancelAfter(TimeSpan.FromSeconds(5));
            await process.StandardInput.WriteAsync(request.GetRawText().AsMemory(), timeout.Token);
            process.StandardInput.Close();
            var outputTask = ReadBoundedAsync(process.StandardOutput, 65_536, timeout.Token);
            var errorTask = ReadBoundedAsync(process.StandardError, 2_000, timeout.Token);
            await process.WaitForExitAsync(timeout.Token);
            var output = await outputTask;
            _ = await errorTask;
            if (process.ExitCode != 0 || output is null) return Error("lua-runner-unavailable", 503);
            using var document = JsonDocument.Parse(output, new JsonDocumentOptions { MaxDepth = 24 });
            var result = document.RootElement;
            if (result.ValueKind != JsonValueKind.Object || !result.TryGetProperty("version", out var version) || version.ValueKind != JsonValueKind.String || version.GetString() != LuaRuntimeVersion ||
                !result.TryGetProperty("ok", out var ok) || ok.ValueKind is not (JsonValueKind.True or JsonValueKind.False)) return Error("lua-runner-invalid-result", 502);
            if (!ok.GetBoolean()) return Error("lua-execution-failed-check-script-or-budgets", 422);
            if (!result.TryGetProperty("value", out var value) || !BoundedJson(value)) return Error("lua-runner-invalid-result", 502);
            return Results.Json(new { value = value.Clone(), runtimeVersion = LuaRuntimeVersion }, options: JsonOptions);
        }
        catch (Win32Exception) { return Error("lua-runner-unavailable", 503); }
        catch (OperationCanceledException) when (!token.IsCancellationRequested) { return Error("lua-runner-timeout", 503); }
        catch (JsonException) { return Error("lua-runner-invalid-result", 502); }
        catch (IOException) { return Error("lua-runner-unavailable", 503); }
        finally
        {
            try { if (!process.HasExited) process.Kill(true); } catch (InvalidOperationException) { }
            await RemoveContainerAsync(name);
        }
    }

    private static bool ValidLuaInvocation(JsonElement request) => BoundedJson(request) && String(request, "script", 32_768, 1) &&
        request.TryGetProperty("configuration", out var config) && config.ValueKind == JsonValueKind.Object && Encoding.UTF8.GetByteCount(config.GetRawText()) <= 16_000 &&
        request.TryGetProperty("seed", out var seed) && seed.ValueKind == JsonValueKind.Number && seed.TryGetUInt32(out _) &&
        request.TryGetProperty("operation", out var operation) && operation.ValueKind == JsonValueKind.String && operation.GetString() is "init" or "view" or "update" or "assess" &&
        (!request.TryGetProperty("event", out var action) || action.ValueKind == JsonValueKind.Object && String(action, "id", 100, 1) && (!action.TryGetProperty("value", out _) || String(action, "value", 2000)));
}
