using ExcelConverter.Models;
using ExcelConverter.Services;

namespace ExcelConverter.Analyzers;

public class TypeDifferenceAnalyzer
{
    public Dictionary<int, double[]> AnalyzeRowDifferences(
        IExcelLoaderService loader,
        RegionInfo region,
        string? sheetName = null)
    {
        var rowDifferences = new Dictionary<int, double[]>();

        var firstRowDiffs = new double[region.ColumnCount];
        for (int i = 0; i < firstRowDiffs.Length; i++)
            firstRowDiffs[i] = 0.0;
        rowDifferences[region.StartRow] = firstRowDiffs;

        for (int row = region.StartRow + 1; row <= region.EndRow; row++)
        {
            var rowDiffs = new double[region.ColumnCount];
            int colIdx = 0;

            for (int col = region.StartColumn; col <= region.EndColumn; col++)
            {
                var currentType = loader.GetCellDataType(row, col, sheetName);
                var previousRowType = loader.GetCellDataType(row - 1, col, sheetName);

                rowDiffs[colIdx] = (currentType != previousRowType) ? 1.0 : 0.0;
                colIdx++;
            }

            rowDifferences[row] = rowDiffs;
        }

        return rowDifferences;
    }

    public Dictionary<int, double[]> AnalyzeColumnDifferences(
        IExcelLoaderService loader,
        RegionInfo region,
        string? sheetName = null)
    {
        var columnDifferences = new Dictionary<int, double[]>();

        var firstColDiffs = new double[region.RowCount];
        for (int i = 0; i < firstColDiffs.Length; i++)
            firstColDiffs[i] = 0.0;
        columnDifferences[region.StartColumn] = firstColDiffs;

        for (int col = region.StartColumn + 1; col <= region.EndColumn; col++)
        {
            var colDiffs = new double[region.RowCount];
            int rowIdx = 0;

            for (int row = region.StartRow; row <= region.EndRow; row++)
            {
                var currentType = loader.GetCellDataType(row, col, sheetName);
                var previousColType = loader.GetCellDataType(row, col - 1, sheetName);

                colDiffs[rowIdx] = (currentType != previousColType) ? 1.0 : 0.0;
                rowIdx++;
            }

            columnDifferences[col] = colDiffs;
        }

        return columnDifferences;
    }

    public Dictionary<int, double> CalculateRowDifferenceRatios(
        Dictionary<int, double[]> rowDifferences,
        string thresholdMode = "any")
    {
        var ratios = new Dictionary<int, double>();

        foreach (var (rowIdx, diffs) in rowDifferences)
        {
            if (diffs.Length == 0)
            {
                ratios[rowIdx] = 0.0;
                continue;
            }

            if (thresholdMode == "any")
            {
                ratios[rowIdx] = diffs.Max();
            }
            else
            {
                ratios[rowIdx] = diffs.Average();
            }
        }

        return ratios;
    }

    public Dictionary<int, double> CalculateColumnDifferenceRatios(
        Dictionary<int, double[]> columnDifferences,
        string thresholdMode = "any")
    {
        var ratios = new Dictionary<int, double>();

        foreach (var (colIdx, diffs) in columnDifferences)
        {
            if (diffs.Length == 0)
            {
                ratios[colIdx] = 0.0;
                continue;
            }

            if (thresholdMode == "any")
            {
                ratios[colIdx] = diffs.Max();
            }
            else
            {
                ratios[colIdx] = diffs.Average();
            }
        }

        return ratios;
    }

    public List<int> SelectRowsToKeep(Dictionary<int, double> differenceRatios, double threshold = 0.8)
    {
        return differenceRatios
            .Where(kvp => kvp.Value >= threshold)
            .Select(kvp => kvp.Key)
            .OrderBy(row => row)
            .ToList();
    }

    public List<int> SelectColumnsToKeep(Dictionary<int, double> differenceRatios, double threshold = 0.8)
    {
        return differenceRatios
            .Where(kvp => kvp.Value >= threshold)
            .Select(kvp => kvp.Key)
            .OrderBy(col => col)
            .ToList();
    }

    public DifferenceStatistics GetStatistics(Dictionary<int, double[]> differences)
    {
        int totalItems = differences.Count;
        int itemsWithDifferences = 0;
        double totalDifference = 0.0;
        int totalCells = 0;

        foreach (var (_, diffs) in differences)
        {
            if (diffs.Any(d => d > 0))
                itemsWithDifferences++;

            totalDifference += diffs.Sum();
            totalCells += diffs.Length;
        }

        double averageDifference = totalCells > 0 ? totalDifference / totalCells : 0.0;

        return new DifferenceStatistics
        {
            TotalItems = totalItems,
            ItemsWithDifferences = itemsWithDifferences,
            DifferenceRatio = averageDifference
        };
    }
}

public class DifferenceStatistics
{
    public int TotalItems { get; set; }

    public int ItemsWithDifferences { get; set; }

    public double DifferenceRatio { get; set; }
}
