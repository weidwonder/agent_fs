namespace DocxConverter;

public class Converter
{
    public ConvertData Convert(string filePath)
    {
        if (!File.Exists(filePath))
        {
            throw new DocxException(ErrorCodes.FileNotFound, "文件不存在");
        }

        throw new DocxException(ErrorCodes.ConversionFailed, "转换逻辑未实现");
    }
}
