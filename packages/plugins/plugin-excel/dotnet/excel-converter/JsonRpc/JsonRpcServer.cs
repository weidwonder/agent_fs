using System.Text.Json;
using ExcelConverter.Models;
using ExcelConverter.Services;

namespace ExcelConverter.JsonRpc;

public class JsonRpcServer
{
    private readonly ExcelToMarkdownService _converter;
    private readonly JsonSerializerOptions _jsonOptions;
    private bool _running = true;

    public JsonRpcServer()
    {
        var loader = new ExcelLoaderService(new XlsConverterService());
        var regionManager = new RegionManagerService();
        _converter = new ExcelToMarkdownService(loader, regionManager);

        _jsonOptions = new JsonSerializerOptions
        {
            PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
            WriteIndented = false
        };
    }

    public async Task RunAsync()
    {
        using var reader = new StreamReader(Console.OpenStandardInput());

        while (_running)
        {
            var line = await reader.ReadLineAsync();
            if (line == null) break;

            var response = ProcessRequest(line);
            Console.WriteLine(JsonSerializer.Serialize(response, _jsonOptions));
        }
    }

    internal JsonRpcResponse ProcessRequest(string requestJson)
    {
        JsonRpcRequest? request;
        try
        {
            request = JsonSerializer.Deserialize<JsonRpcRequest>(requestJson, _jsonOptions);
        }
        catch (Exception ex)
        {
            return new JsonRpcResponse
            {
                Id = 0,
                Error = new JsonRpcError { Code = -32700, Message = $"Parse error: {ex.Message}" }
            };
        }

        if (request == null)
        {
            return new JsonRpcResponse
            {
                Id = 0,
                Error = new JsonRpcError { Code = -32600, Message = "Invalid request" }
            };
        }

        try
        {
            return request.Method switch
            {
                "convert" => HandleConvert(request),
                "ping" => HandlePing(request),
                "shutdown" => HandleShutdown(request),
                _ => new JsonRpcResponse
                {
                    Id = request.Id,
                    Error = new JsonRpcError { Code = -32601, Message = $"Method not found: {request.Method}" }
                }
            };
        }
        catch (Exception ex)
        {
            return new JsonRpcResponse
            {
                Id = request.Id,
                Error = new JsonRpcError { Code = -32000, Message = ex.Message }
            };
        }
    }

    private JsonRpcResponse HandleConvert(JsonRpcRequest request)
    {
        var paramsJson = request.Params?.GetRawText() ?? "{}";
        var convertRequest = JsonSerializer.Deserialize<ConvertRequest>(paramsJson, _jsonOptions);

        if (convertRequest == null || string.IsNullOrEmpty(convertRequest.FilePath))
        {
            return new JsonRpcResponse
            {
                Id = request.Id,
                Error = new JsonRpcError { Code = -32602, Message = "Invalid params: filePath required" }
            };
        }

        var result = _converter.Convert(convertRequest.FilePath);
        return new JsonRpcResponse { Id = request.Id, Result = result };
    }

    private JsonRpcResponse HandlePing(JsonRpcRequest request)
    {
        return new JsonRpcResponse { Id = request.Id, Result = new { status = "ok" } };
    }

    private JsonRpcResponse HandleShutdown(JsonRpcRequest request)
    {
        _running = false;
        return new JsonRpcResponse { Id = request.Id, Result = new { status = "shutting down" } };
    }
}
