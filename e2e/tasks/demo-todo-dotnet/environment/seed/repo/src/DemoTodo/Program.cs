using System.ComponentModel.DataAnnotations;
using DemoTodo;
using DemoTodo.Components;

var builder = WebApplication.CreateBuilder(args);

// Add services to the container.
builder.Services.AddRazorComponents()
    .AddInteractiveServerComponents();
builder.Services.AddSingleton<TodoStore>();
// Malformed JSON bodies throw in every environment, so the handler below turns them into a 400.
builder.Services.Configure<RouteHandlerOptions>(options => options.ThrowOnBadRequest = true);

var app = builder.Build();

// Configure the HTTP request pipeline.
if (!app.Environment.IsDevelopment())
{
    app.UseExceptionHandler("/Error", createScopeForErrors: true);
    // The default HSTS value is 30 days. You may want to change this for production scenarios, see https://aka.ms/aspnetcore-hsts.
    app.UseHsts();
}
app.UseStatusCodePagesWithReExecute("/not-found", createScopeForStatusCodePages: true);
app.UseHttpsRedirection();

// Validation errors and malformed request bodies map to 400 {"error": "..."}.
app.Use(async (context, next) =>
{
    try
    {
        await next(context);
    }
    catch (Exception ex) when (ex is ValidationException or BadHttpRequestException)
    {
        context.Response.StatusCode = StatusCodes.Status400BadRequest;
        await context.Response.WriteAsJsonAsync(new { error = ex.Message });
    }
});

app.UseAntiforgery();

app.MapStaticAssets();
app.MapRazorComponents<App>()
    .AddInteractiveServerRenderMode();

// JSON API on the same store as the list page.
app.MapGet("/health", () => new { ok = true });

var todos = app.MapGroup("/todos");
todos.MapGet("", (TodoStore store) => store.List());
todos.MapPost("", (NewTodo input, TodoStore store) =>
{
    var todo = store.Add(input);
    return Results.Created($"/todos/{todo.Id}", todo);
});
todos.MapGet("/{id:int}", (int id, TodoStore store) =>
    store.Get(id) is { } todo ? Results.Ok(todo) : NotFound());
todos.MapPatch("/{id:int}", (int id, TodoPatch patch, TodoStore store) =>
    store.Update(id, patch) is { } todo ? Results.Ok(todo) : NotFound());
todos.MapDelete("/{id:int}", (int id, TodoStore store) =>
    store.Remove(id) ? Results.NoContent() : NotFound());

app.Run();

static IResult NotFound() => Results.NotFound(new { error = "not found" });

public partial class Program;
