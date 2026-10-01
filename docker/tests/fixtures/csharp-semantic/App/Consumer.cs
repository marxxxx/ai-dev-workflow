using Fixture.Core;

namespace Fixture.App;

public sealed class Consumer
{
    private readonly IGreeter _greeter;

    public Consumer(IGreeter greeter) => _greeter = greeter;

    public string Welcome() => _greeter.Greet("world");
}
