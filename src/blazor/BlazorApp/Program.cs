using System.Text;
using BlazorApp.Client;
using BlazorApp.Components;

// A Blazor Web App on a Lambda Web Function. Web Functions only boot Node.js,
// so the zip carries the shared execve shim from src/node-wrapper/ as index.js
// and this apphost beside it as `server`; the shim replaces Node with `server`,
// which then POSTs /ready itself because the exec took the runtime interface
// client with it. Same contract as src/DotnetApi.
//
// No NativeAOT and no trimming on the server: Blazor's component rendering is
// reflection-based (see AGENTS.md). The WebAssembly client is a separate
// project and is trimmed by the Blazor SDK on its own.
//
// In the Web Function bundle the apphost sits at the zip root next to wwwroot,
// so the content root is pinned to it and the static web assets resolve
// whatever the working directory happens to be. Outside Lambda (dotnet run,
// dotnet watch) the default is left alone, which keeps the dev-time web root at
// the project directory instead of an output folder with no wwwroot in it.
var httpEndpoint = Environment.GetEnvironmentVariable("AWS_LAMBDA_HTTP_ENDPOINT");
var inWebFunction = httpEndpoint is { Length: > 0 };

var builder = WebApplication.CreateBuilder(new WebApplicationOptions
{
    Args = args,
    ContentRootPath = inWebFunction ? AppContext.BaseDirectory : null,
});

// Lambda tells the app where to listen through AWS_LAMBDA_HTTP_ENDPOINT.
if (httpEndpoint is { Length: > 0 })
    builder.Configuration["urls"] = $"http://{httpEndpoint}";

builder.Services.AddRazorComponents()
    .AddInteractiveWebAssemblyComponents();

var app = builder.Build();

// No UseHttpsRedirection/UseHsts: the Web Function endpoint is HTTPS-only and
// terminates TLS in front of the app, which only ever sees plain HTTP.
app.UseExceptionHandler("/Error", createScopeForErrors: true);
app.UseStatusCodePagesWithReExecute("/not-found", createScopeForStatusCodePages: true);
app.UseAntiforgery();

app.MapStaticAssets();

app.MapRazorComponents<App>()
    .AddInteractiveWebAssemblyRenderMode()
    .AddAdditionalAssemblies(typeof(BlazorApp.Client._Imports).Assembly);

// Answers the same GET /health as every other backend in this repo.
app.MapGet("/health", () => TypedResults.Ok(new HealthResponse("Ok", "blazor")));

// What the interactive WebAssembly component fetches, in the browser, from the
// Web Function itself. Server and ServedAt come from the Lambda execution
// environment, so a value on screen proves the round trip reached the backend.
app.MapGet("/api/hello", () => TypedResults.Ok(new HelloResponse(
    "Ok",
    "blazor",
    Environment.MachineName,
    DateTimeOffset.UtcNow.ToString("O"))));

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
