using ExcelConverter.Models;
using ExcelConverter.Services;

namespace ExcelConverter.Analyzers;

public class CompressionAnalyzer
{
    private readonly TypeDifferenceAnalyzer _typeAnalyzer;

    public CompressionAnalyzer()
    {
        _typeAnalyzer = new TypeDifferenceAnalyzer();
    }

    public string DetermineCompressionMode(
        IExcelLoaderService loader,
        RegionInfo region,
        string? sheetName = null,
        string thresholdMode = "any",
        double thresholdValue = 0.8)
    {
        if (region.TotalCells < 400)
            return "none";

        var rowDifferences = _typeAnalyzer.AnalyzeRowDifferences(loader, region, sheetName);
        var columnDifferences = _typeAnalyzer.AnalyzeColumnDifferences(loader, region, sheetName);

        var rowRatios = _typeAnalyzer.CalculateRowDifferenceRatios(rowDifferences, thresholdMode);
        var columnRatios = _typeAnalyzer.CalculateColumnDifferenceRatios(columnDifferences, thresholdMode);

        var rowsToKeep = _typeAnalyzer.SelectRowsToKeep(rowRatios, thresholdValue);
        var columnsToKeep = _typeAnalyzer.SelectColumnsToKeep(columnRatios, thresholdValue);

        double rowCompressionRatio = region.RowCount > 0 ? 1.0 - (double)rowsToKeep.Count / region.RowCount : 0.0;
        double columnCompressionRatio = region.ColumnCount > 0 ? 1.0 - (double)columnsToKeep.Count / region.ColumnCount : 0.0;

        if (rowCompressionRatio > columnCompressionRatio && rowCompressionRatio > 0.1)
            return "row";
        else if (columnCompressionRatio > rowCompressionRatio && columnCompressionRatio > 0.1)
            return "column";
        else
            return "none";
    }

    public CompressionPlan CreateCompressionPlan(
        IExcelLoaderService loader,
        RegionInfo region,
        string compressionMode,
        string? sheetName = null,
        string thresholdMode = "any",
        double thresholdValue = 0.8)
    {
        var plan = new CompressionPlan
        {
            OriginalRegion = region,
            CompressionMode = compressionMode,
            ThresholdMode = thresholdMode,
            ThresholdValue = thresholdValue
        };

        if (compressionMode == "none")
        {
            plan.RowsToKeep = Enumerable.Range(region.StartRow, region.RowCount).ToList();
            plan.ColumnsToKeep = Enumerable.Range(region.StartColumn, region.ColumnCount).ToList();
            plan.CompressionRatio = 0.0;
            return plan;
        }

        if (compressionMode == "row")
        {
            var rowDifferences = _typeAnalyzer.AnalyzeRowDifferences(loader, region, sheetName);
            var rowRatios = _typeAnalyzer.CalculateRowDifferenceRatios(rowDifferences, thresholdMode);
            plan.RowsToKeep = _typeAnalyzer.SelectRowsToKeep(rowRatios, thresholdValue);
            plan.ColumnsToKeep = Enumerable.Range(region.StartColumn, region.ColumnCount).ToList();

            int originalCells = region.TotalCells;
            int compressedCells = plan.RowsToKeep.Count * region.ColumnCount;
            plan.CompressionRatio = originalCells > 0 ? 1.0 - (double)compressedCells / originalCells : 0.0;
        }
        else if (compressionMode == "column")
        {
            var columnDifferences = _typeAnalyzer.AnalyzeColumnDifferences(loader, region, sheetName);
            var columnRatios = _typeAnalyzer.CalculateColumnDifferenceRatios(columnDifferences, thresholdMode);
            plan.RowsToKeep = Enumerable.Range(region.StartRow, region.RowCount).ToList();
            plan.ColumnsToKeep = _typeAnalyzer.SelectColumnsToKeep(columnRatios, thresholdValue);

            int originalCells = region.TotalCells;
            int compressedCells = region.RowCount * plan.ColumnsToKeep.Count;
            plan.CompressionRatio = originalCells > 0 ? 1.0 - (double)compressedCells / originalCells : 0.0;
        }

        return plan;
    }

    public bool ShouldCompress(RegionInfo region, string compressionMode)
    {
        if (region.TotalCells < 400)
            return false;

        if (compressionMode == "none")
            return false;

        return true;
    }

    public CompressionStatistics CalculateStatistics(CompressionPlan plan)
    {
        var stats = new CompressionStatistics
        {
            OriginalRows = plan.OriginalRegion.RowCount,
            OriginalColumns = plan.OriginalRegion.ColumnCount,
            OriginalCells = plan.OriginalRegion.TotalCells,
            CompressedRows = plan.RowsToKeep.Count,
            CompressedColumns = plan.ColumnsToKeep.Count,
            CompressedCells = plan.RowsToKeep.Count * plan.ColumnsToKeep.Count,
            CompressionRatio = plan.CompressionRatio,
            CompressionMode = plan.CompressionMode
        };

        return stats;
    }
}

public class CompressionPlan
{
    public RegionInfo OriginalRegion { get; set; } = new();

    public string CompressionMode { get; set; } = "none";

    public string ThresholdMode { get; set; } = "any";

    public double ThresholdValue { get; set; } = 0.8;

    public List<int> RowsToKeep { get; set; } = new();

    public List<int> ColumnsToKeep { get; set; } = new();

    public double CompressionRatio { get; set; }
}

public class CompressionStatistics
{
    public int OriginalRows { get; set; }
    public int OriginalColumns { get; set; }
    public int OriginalCells { get; set; }
    public int CompressedRows { get; set; }
    public int CompressedColumns { get; set; }
    public int CompressedCells { get; set; }
    public double CompressionRatio { get; set; }
    public string CompressionMode { get; set; } = "none";
}
