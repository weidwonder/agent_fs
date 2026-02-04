namespace ExcelConverter.Models;

public class ConvertResponse
{
    public List<SheetResult> Sheets { get; set; } = new();
}

public class SheetResult
{
    public string Name { get; set; } = string.Empty;
    public int Index { get; set; }
    public List<RegionResult> Regions { get; set; } = new();
}

public class RegionResult
{
    public string Range { get; set; } = string.Empty;
    public List<string> Tables { get; set; } = new();
    public string Markdown { get; set; } = string.Empty;
}
