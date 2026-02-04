using ExcelConverter.JsonRpc;
using Xunit;

namespace ExcelConverter.Tests;

public class JsonRpcServerTests
{
    [Fact]
    public void Ping_返回Ok()
    {
        var server = new JsonRpcServer();
        var response = server.ProcessRequest("{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"ping\"}");

        Assert.Null(response.Error);
        Assert.NotNull(response.Result);

        var status = response.Result?.GetType().GetProperty("status")?.GetValue(response.Result)?.ToString();
        Assert.Equal("ok", status);
    }

    [Fact]
    public void 未知方法_返回错误码()
    {
        var server = new JsonRpcServer();
        var response = server.ProcessRequest("{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"unknown\"}");

        Assert.NotNull(response.Error);
        Assert.Equal(-32601, response.Error?.Code);
    }

    [Fact]
    public void 解析失败_返回错误码()
    {
        var server = new JsonRpcServer();
        var response = server.ProcessRequest("invalid-json");

        Assert.NotNull(response.Error);
        Assert.Equal(-32700, response.Error?.Code);
    }

    [Fact]
    public void 转换缺失文件_返回错误码()
    {
        var server = new JsonRpcServer();
        var response = server.ProcessRequest("{\"jsonrpc\":\"2.0\",\"id\":3,\"method\":\"convert\",\"params\":{\"filePath\":\"/no/such/file.xlsx\"}}");

        Assert.NotNull(response.Error);
        Assert.Equal(-32000, response.Error?.Code);
    }
}
