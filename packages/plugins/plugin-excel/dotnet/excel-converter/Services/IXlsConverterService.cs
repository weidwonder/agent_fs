namespace ExcelConverter.Services;

public interface IXlsConverterService
{
    void Convert(Stream xlsStream, Stream xlsxStream);
}
