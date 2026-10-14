using System.Text;
using System.Text.Json.Serialization;

var builder = WebApplication.CreateSlimBuilder(args);

var httpEndpoint = Environment.GetEnvironmentVariable("AWS_LAMBDA_HTTP_ENDPOINT");
if (httpEndpoint is { Length: > 0 })
    builder.Configuration["urls"] = $"http://{httpEndpoint}";

var runtimeApi = Environment.GetEnvironmentVariable("AWS_LAMBDA_RUNTIME_API");

builder.Services.ConfigureHttpJsonOptions(options =>
{
    options.SerializerOptions.TypeInfoResolverChain.Insert(0, AppJsonSerializerContext.Default);
});

var app = builder.Build();

app.MapGet("/health", () => TypedResults.Ok(new HealthResponse("OK", "ASP.NET")));

await app.StartAsync();

if (httpEndpoint is { Length: > 0 })
{
    using var http = new HttpClient(new SocketsHttpHandler { UseProxy = false });
    http.Timeout = TimeSpan.FromSeconds(5);
    using var body = new StringContent("{}", Encoding.UTF8, "application/json");
    using var response = await http.PostAsync($"http://{runtimeApi}/2025-09-01/ready", body);
    response.EnsureSuccessStatusCode();
}

await app.WaitForShutdownAsync();

[JsonSerializable(typeof(HealthResponse))]
internal partial class AppJsonSerializerContext : JsonSerializerContext { }

internal record HealthResponse(string Status, string Backend);
