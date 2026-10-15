using System.Text.Json.Serialization;
using DotnetApiAot;

var builder = WebApplication.CreateSlimBuilder(args);

builder.ConfigureWebFunctionHosting();

builder.Services.ConfigureHttpJsonOptions(options =>
{
    options.SerializerOptions.TypeInfoResolverChain.Insert(0, AppJsonSerializerContext.Default);
});

var app = builder.Build();

app.MapGet("/health", () => TypedResults.Ok(new HealthResponse("OK", "dotnet-aot")));

await app.RunAsync();

[JsonSerializable(typeof(HealthResponse))]
internal partial class AppJsonSerializerContext : JsonSerializerContext { }

internal record HealthResponse(string Status, string Backend);
