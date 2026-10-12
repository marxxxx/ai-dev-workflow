using System.Net;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Mvc.Testing;

namespace DemoTodo.Tests;

// Every test starts its own app, so each one gets an empty store.
public class TodoApiTests : IDisposable
{
    private readonly WebApplicationFactory<Program> _factory = new();
    private readonly HttpClient _client;

    public TodoApiTests() => _client = _factory.CreateClient();

    public void Dispose() => _factory.Dispose();

    [Fact]
    public async Task CreatesAndListsTodos()
    {
        var created = await _client.PostAsJsonAsync("/todos", new { title = "Milch kaufen" });
        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        var list = await _client.GetStringAsync("/todos");
        Assert.Equal("""[{"id":1,"title":"Milch kaufen","done":false}]""", list);
    }

    [Fact]
    public async Task RejectsAnEmptyTitle()
    {
        var res = await _client.PostAsJsonAsync("/todos", new { title = " " });
        Assert.Equal(HttpStatusCode.BadRequest, res.StatusCode);
    }

    [Fact]
    public async Task RejectsMalformedJson()
    {
        var res = await _client.PostAsync("/todos", new StringContent("{", null, "application/json"));
        Assert.Equal(HttpStatusCode.BadRequest, res.StatusCode);
    }

    [Fact]
    public async Task MarksATodoDone()
    {
        await _client.PostAsJsonAsync("/todos", new { title = "A" });
        var res = await _client.PatchAsJsonAsync("/todos/1", new { done = true });
        Assert.True((await res.Content.ReadFromJsonAsync<Todo>())!.Done);
    }

    [Fact]
    public async Task AnUnknownIdIsNotFound()
    {
        var res = await _client.GetAsync("/todos/42");
        Assert.Equal(HttpStatusCode.NotFound, res.StatusCode);
    }

    [Fact]
    public async Task ServesTheListPage()
    {
        await _client.PostAsJsonAsync("/todos", new { title = "Milch kaufen" });
        var res = await _client.GetAsync("/");
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        var html = await res.Content.ReadAsStringAsync();
        Assert.Contains("data-testid=\"todo-list\"", html);
        Assert.Contains("Milch kaufen", html);
    }
}
