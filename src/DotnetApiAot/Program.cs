using System.Text.Json.Serialization;

var builder = WebApplication.CreateSlimBuilder(args);

builder.Services.ConfigureHttpJsonOptions(options =>
{
    options.SerializerOptions.TypeInfoResolverChain.Insert(0, AppJsonSerializerContext.Default);
});

var app = builder.Build();

app.MapGet("/health", () => TypedResults.Ok(new HealthResponse()));

app.Run();

[JsonSerializable(typeof(HealthResponse))]
internal partial class AppJsonSerializerContext : JsonSerializerContext { }

internal record HealthResponse(string Status = "OK", string Backend = "ASP.NET");
