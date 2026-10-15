using System.Diagnostics.CodeAnalysis;
using System.Text;

namespace DotnetApiAot;

public static class WebApplicationExtensions
{
    extension(WebApplicationBuilder builder)
    {
        /// <summary>
        /// Applies the Lambda Web Function contract: listen where the shim says, and
        /// report ready to the runtime API once Kestrel is listening.
        /// </summary>
        public WebApplicationBuilder ConfigureWebFunction()
        {
            if (Environment.TryGetEnvironmentVariable(
                "AWS_LAMBDA_HTTP_ENDPOINT",
                out var httpEndpoint))
                builder.WebHost.UseUrls($"http://{httpEndpoint}");

            // The execve shim replaced the runtime interface client, so nothing else
            // POSTs /ready. Outside Lambda there is no runtime API and no probe.
            if (Environment.TryGetEnvironmentVariable("AWS_LAMBDA_RUNTIME_API", out var runtimeApi))
                builder.Services.AddHostedService(_ => new ReadinessPing(runtimeApi));

            return builder;
        }
    }
}

/// <summary>
/// POSTs /2025-09-01/ready once the server is listening, then never runs again.
/// <see cref="StartedAsync"/> runs after every <see cref="IHostedService.StartAsync"/>,
/// so Kestrel has already bound; an exception here aborts startup and propagates out of
/// <c>RunAsync</c>, which then disposes the host.
/// </summary>
internal sealed class ReadinessPing(string runtimeApi) : IHostedLifecycleService
{
    public Task StartingAsync(CancellationToken ct) => Task.CompletedTask;
    public Task StartAsync(CancellationToken ct) => Task.CompletedTask;
    public Task StoppingAsync(CancellationToken ct) => Task.CompletedTask;
    public Task StopAsync(CancellationToken ct) => Task.CompletedTask;
    public Task StoppedAsync(CancellationToken ct) => Task.CompletedTask;

    public async Task StartedAsync(CancellationToken ct)
    {
        // The runtime API is on localhost; an inherited HTTP_PROXY would send this nowhere.
        using var http =
            // ReSharper disable once ShortLivedHttpClient
            new HttpClient(new SocketsHttpHandler { UseProxy = false });
        http.Timeout = TimeSpan.FromSeconds(5);
        using var body = new StringContent("{}", Encoding.UTF8, "application/json");
        using var response =
            await http.PostAsync($"http://{runtimeApi}/2025-09-01/ready", body, ct);
        response.EnsureSuccessStatusCode();
    }
}

public static class EnvironmentExtensions
{
    extension(Environment)
    {
        public static bool TryGetEnvironmentVariable(
            string name,
            [NotNullWhen(true)] out string? value)
        {
            value = Environment.GetEnvironmentVariable(name);
            return value is { Length: > 0 };
        }
    }
}
