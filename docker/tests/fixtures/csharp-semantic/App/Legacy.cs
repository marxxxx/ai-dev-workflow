namespace Fixture.App.Legacy;

// Same simple name as Fixture.Core.IGreeter but unrelated: never a reference to it.
public interface IGreeter
{
    void Wave();
}

public sealed class LegacyCaller
{
    private readonly IGreeter _legacy;

    public LegacyCaller(IGreeter legacy) => _legacy = legacy;

    public void Run() => _legacy.Wave();
}
