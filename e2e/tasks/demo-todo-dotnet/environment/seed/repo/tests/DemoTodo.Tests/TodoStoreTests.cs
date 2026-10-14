using System.ComponentModel.DataAnnotations;

namespace DemoTodo.Tests;

public class TodoStoreTests
{
    [Fact]
    public void AddsTodosWithSequentialIdsAndTrimmedTitles()
    {
        var store = new TodoStore();
        store.Add(new NewTodo("A"));
        var todo = store.Add(new NewTodo("  B  "));
        Assert.Equal(new Todo(2, "B", false), todo);
        Assert.Equal([new Todo(1, "A", false), todo], store.List());
    }

    [Fact]
    public void RejectsAMissingTitle()
    {
        Assert.Throws<ValidationException>(() => new TodoStore().Add(new NewTodo(null)));
    }

    [Fact]
    public void UpdatesOnlyTheGivenFields()
    {
        var store = new TodoStore();
        var todo = store.Add(new NewTodo("A"));
        Assert.Equal(todo with { Done = true }, store.Update(todo.Id, new TodoPatch(null, true)));
        Assert.Null(store.Update(42, new TodoPatch("B", null)));
    }
}
