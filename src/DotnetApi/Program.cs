using System.Text;

// The non-AOT counterpart to src/DotnetApiAot. It ships the whole .NET runtime
// in the zip (self-contained, untrimmed) so reflection keeps working: the
// serializer below is the reflection-based System.Text.Json, with no
// JsonSerializerContext anywhere. Same Lambda Web Function contract as every
// other backend here -- the execve shim starts `server`, and `server` POSTs
// /ready itself once it is listening.
var builder = WebApplication.CreateBuilder(args);

var httpEndpoint = Environment.GetEnvironmentVariable("AWS_LAMBDA_HTTP_ENDPOINT");
if (httpEndpoint is { Length: > 0 })
    builder.Configuration["urls"] = $"http://{httpEndpoint}";

var app = builder.Build();

// TypedResults serializes through reflection; that is the point of this build.
app.MapGet("/health", () => TypedResults.Ok(new HealthResponse("Ok", "dotnet")));

await app.StartAsync();

// The shim's exec replaced Lambda's runtime interface client, so nothing else
// POSTs /ready. Skip it outside Lambda (local run and the smoke check).
var runtimeApi = Environment.GetEnvironmentVariable("AWS_LAMBDA_RUNTIME_API");
if (httpEndpoint is { Length: > 0 } && runtimeApi is { Length: > 0 })
{
    using var http = new HttpClient(new SocketsHttpHandler { UseProxy = false });
    http.Timeout = TimeSpan.FromSeconds(5);
    using var body = new StringContent("{}", Encoding.UTF8, "application/json");
    using var response = await http.PostAsync($"http://{runtimeApi}/2025-09-01/ready", body);
    response.EnsureSuccessStatusCode();
}

await app.WaitForShutdownAsync();

internal record HealthResponse(string Status, string Backend);
