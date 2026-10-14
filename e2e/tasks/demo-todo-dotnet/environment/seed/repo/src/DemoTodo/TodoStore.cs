using System.ComponentModel.DataAnnotations;

namespace DemoTodo;

public record Todo(int Id, string Title, bool Done);

public record NewTodo(string? Title);

public record TodoPatch(string? Title, bool? Done);

// In-memory todo store, registered as a singleton: the API and the list page share it.
public class TodoStore
{
    private readonly Lock _lock = new();
    private readonly SortedDictionary<int, Todo> _todos = [];
    private int _nextId = 1;

    public IReadOnlyList<Todo> List()
    {
        lock (_lock) return [.. _todos.Values];
    }

    public Todo? Get(int id)
    {
        lock (_lock) return _todos.GetValueOrDefault(id);
    }

    public Todo Add(NewTodo input)
    {
        var title = input.Title?.Trim();
        if (string.IsNullOrEmpty(title)) throw new ValidationException("title is required");
        lock (_lock)
        {
            var todo = new Todo(_nextId++, title, false);
            _todos[todo.Id] = todo;
            return todo;
        }
    }

    public Todo? Update(int id, TodoPatch patch)
    {
        var title = patch.Title?.Trim();
        if (patch.Title is not null && title == "") throw new ValidationException("title must be a non-empty string");
        lock (_lock)
        {
            if (!_todos.TryGetValue(id, out var todo)) return null;
            todo = todo with { Title = title ?? todo.Title, Done = patch.Done ?? todo.Done };
            _todos[id] = todo;
            return todo;
        }
    }

    public bool Remove(int id)
    {
        lock (_lock) return _todos.Remove(id);
    }
}
