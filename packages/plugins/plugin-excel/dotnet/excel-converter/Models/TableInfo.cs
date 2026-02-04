namespace ExcelConverter.Models;

public class TableDetectionResult
{
    public string FilePath { get; set; } = string.Empty;
    public string SheetName { get; set; } = string.Empty;
    public string DetectionMethod { get; set; } = "border";
    public string? Region { get; set; }
    public bool SplitRegions { get; set; }
    public int TotalTables { get; set; }
    public List<TableInfo> Tables { get; set; } = new();
}

public class TableInfo
{
    public string Range { get; set; } = string.Empty;
    public string? RegionRange { get; set; }
}
