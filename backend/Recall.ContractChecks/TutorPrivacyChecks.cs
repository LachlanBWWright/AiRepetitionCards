using System.Net;
using System.Text;
using Microsoft.Extensions.Configuration;
using Recall.Api.Features.Tutor;

internal static class TutorPrivacyChecks
{
    public static async Task<IEnumerable<string>> Run()
    {
        var owner = Guid.NewGuid();
        using var handler = new PrivacyHandler(owner);
        using var client = new HttpClient(handler);
        var config = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["SUPABASE_URL"] = "https://supabase.example/",
            ["SUPABASE_SERVICE_ROLE_KEY"] = "test-service-key"
        }).Build();
        var operations = new TutorPrivacyOperations(client, config);
        var deleted = await operations.DeleteOwnedHistoryAsync(owner);
        var retained = await operations.PurgeExpiredAsync(DateTimeOffset.UtcNow.AddDays(-30), 10);
        var failures = new List<string>();
        if (deleted is not Result<int, TutorPrivacyFailure>.Success { Value: 1 })
            failures.Add("Owned tutor history must use the correct PostgREST endpoint.");
        if (retained is not Result<int, TutorPrivacyFailure>.Success { Value: 1 })
            failures.Add("Tutor retention must select and delete through the correct PostgREST endpoint.");
        return failures;
    }

    private sealed class PrivacyHandler(Guid owner) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            if (request.RequestUri?.AbsolutePath != "/rest/v1/tutor_sessions")
                return Task.FromResult(new HttpResponseMessage(HttpStatusCode.NotFound));
            if (request.Method == HttpMethod.Get)
                return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK)
                {
                    Content = new StringContent($"[{{\"id\":\"{Guid.NewGuid()}\",\"user_id\":\"{owner}\"}}]", Encoding.UTF8, "application/json")
                });
            var response = new HttpResponseMessage(HttpStatusCode.OK);
            response.Content.Headers.TryAddWithoutValidation("Content-Range", "*/1");
            return Task.FromResult(response);
        }
    }
}
