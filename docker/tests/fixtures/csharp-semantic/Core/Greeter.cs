namespace Fixture.Core;

public sealed class Greeter : IGreeter
{
    public string Greet(string name) => $"Hello, {name}";
}
