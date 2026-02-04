namespace DocxConverter;

public record ConvertRequest(string Id, string Method, ConvertParams? Params);

public record ConvertParams(string FilePath);

public record ConvertResponse(string Id, bool Success, ConvertData? Data, ErrorInfo? Error);

public record ConvertData(string Markdown, List<Mapping> Mappings);

public record Mapping(int StartLine, int EndLine, string Locator);

public record ErrorInfo(string Code, string Message);

public static class ErrorCodes
{
    public const string FileNotFound = "FILE_NOT_FOUND";
    public const string UnsupportedFormat = "UNSUPPORTED_FORMAT";
    public const string ConversionFailed = "CONVERSION_FAILED";
    public const string FallbackUnavailable = "FALLBACK_UNAVAILABLE";
    public const string FallbackFailed = "FALLBACK_FAILED";
    public const string InvalidRequest = "INVALID_REQUEST";
}

public class DocxException : Exception
{
    public string Code { get; }

    public DocxException(string code, string message) : base(message)
    {
        Code = code;
    }
}
