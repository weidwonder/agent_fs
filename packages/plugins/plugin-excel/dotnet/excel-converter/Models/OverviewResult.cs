namespace ExcelConverter.Models;

public class OverviewResult
{
    public string FilePath { get; set; } = string.Empty;
    public string SheetName { get; set; } = string.Empty;
    public string Range { get; set; } = string.Empty;
    public string CompressionMode { get; set; } = "none";
    public string ThresholdMode { get; set; } = "any";
    public double ThresholdValue { get; set; }
    public string? DetailRegion { get; set; }
    public string Overview { get; set; } = string.Empty;
    public OverviewStatistics? Statistics { get; set; }
}

public class OverviewStatistics
{
    public int TotalRows { get; set; }
    public int TotalColumns { get; set; }
    public int TotalCells { get; set; }
    public int DisplayedRows { get; set; }
    public int DisplayedColumns { get; set; }
    public int MergedCells { get; set; }
    public bool WillCompress { get; set; }
    public double CompressionRatio { get; set; }
}
