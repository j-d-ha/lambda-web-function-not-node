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

app.MapPost(
    "/hello",
    (HelloRequest request) => TypedResults.Ok(new HelloResponse($"Hello {request.Name}")));

await app.RunAsync();

[JsonSerializable(typeof(HealthResponse))]
[JsonSerializable(typeof(HelloRequest))]
[JsonSerializable(typeof(HelloResponse))]
internal partial class AppJsonSerializerContext : JsonSerializerContext { }

internal record HealthResponse(string Status, string Backend);

internal record HelloRequest(string Name);

internal record HelloResponse(string Greeting);
