namespace BlazorApp.Client;

/// <summary>
/// The payload of <c>GET /api/hello</c>. It lives in the client project because
/// both sides need it: the server serializes it, the WebAssembly client
/// deserializes it, and the server project already references this one.
/// </summary>
/// <param name="Status">Always "Ok" when the backend answers.</param>
/// <param name="Backend">Which backend served it — "blazor" here.</param>
/// <param name="Server">The Lambda execution environment that produced it.</param>
/// <param name="ServedAt">UTC timestamp from that environment.</param>
public record HelloResponse(string Status, string Backend, string Server, string ServedAt);
