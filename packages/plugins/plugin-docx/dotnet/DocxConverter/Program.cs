using System.Text.Json;
using DocxConverter;

var converter = new Converter();
var jsonOptions = new JsonSerializerOptions
{
    PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
};

string? line;
while ((line = Console.ReadLine()) != null)
{
    if (string.IsNullOrWhiteSpace(line)) continue;

    ConvertRequest? request = null;
    try
    {
        request = JsonSerializer.Deserialize<ConvertRequest>(line, jsonOptions);
    }
    catch
    {
        continue;
    }

    if (request == null || string.IsNullOrWhiteSpace(request.Method))
    {
        WriteError("unknown", ErrorCodes.InvalidRequest, "无效请求", jsonOptions);
        continue;
    }

    if (request.Method == "shutdown")
    {
        WriteSuccess(request.Id, new ConvertData(string.Empty, new List<Mapping>()), jsonOptions);
        break;
    }

    if (request.Method != "convert" || request.Params == null)
    {
        WriteError(request.Id, ErrorCodes.InvalidRequest, "无效请求", jsonOptions);
        continue;
    }

    try
    {
        var data = converter.Convert(request.Params.FilePath);
        WriteSuccess(request.Id, data, jsonOptions);
    }
    catch (DocxException ex)
    {
        WriteError(request.Id, ex.Code, ex.Message, jsonOptions);
    }
    catch (Exception ex)
    {
        WriteError(request.Id, ErrorCodes.ConversionFailed, ex.Message, jsonOptions);
    }
}

static void WriteSuccess(string id, ConvertData data, JsonSerializerOptions options)
{
    var response = new ConvertResponse(id, true, data, null);
    Console.WriteLine(JsonSerializer.Serialize(response, options));
}

static void WriteError(string id, string code, string message, JsonSerializerOptions options)
{
    var response = new ConvertResponse(id, false, null, new ErrorInfo(code, message));
    Console.WriteLine(JsonSerializer.Serialize(response, options));
}
