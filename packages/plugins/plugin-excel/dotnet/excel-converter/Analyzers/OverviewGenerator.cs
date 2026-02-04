using ExcelConverter.Models;
using ExcelConverter.Services;
using System.Text;

namespace ExcelConverter.Analyzers;

public class OverviewGenerator
{
    private readonly CompressionAnalyzer _compressionAnalyzer;
    private readonly IRegionManagerService _regionManager;

    public OverviewGenerator(IRegionManagerService regionManager)
    {
        _compressionAnalyzer = new CompressionAnalyzer();
        _regionManager = regionManager;
    }

    public OverviewResult GenerateOverview(
        IExcelLoaderService loader,
        RegionInfo region,
        string? sheetName = null,
        string compressionMode = "auto",
        string thresholdMode = "any",
        double thresholdValue = 0.8,
        RegionInfo? detailRegion = null,
        bool showStyle = false)
    {
        if (compressionMode == "auto")
        {
            compressionMode = _compressionAnalyzer.DetermineCompressionMode(
                loader, region, sheetName, thresholdMode, thresholdValue);
        }

        var compressionPlan = _compressionAnalyzer.CreateCompressionPlan(
            loader, region, compressionMode, sheetName, thresholdMode, thresholdValue);

        var overviewText = GenerateOverviewText(
            loader, region, compressionPlan, sheetName, detailRegion, showStyle);

        var statistics = CalculateStatistics(region, compressionPlan);

        return new OverviewResult
        {
            FilePath = string.Empty,
            SheetName = sheetName ?? "Sheet1",
            Range = _regionManager.ToRangeString(region),
            CompressionMode = compressionMode,
            ThresholdMode = thresholdMode,
            ThresholdValue = thresholdValue,
            DetailRegion = detailRegion != null ? _regionManager.ToRangeString(detailRegion) : null,
            Overview = overviewText,
            Statistics = statistics
        };
    }

    public OverviewResult GenerateOverviewWithPlan(
        IExcelLoaderService loader,
        RegionInfo region,
        List<int> rowsToKeep,
        List<int> columnsToKeep,
        string? sheetName = null,
        string compressionMode = "none",
        string thresholdMode = "any",
        double thresholdValue = 0.8,
        RegionInfo? detailRegion = null,
        bool showStyle = false)
    {
        var plan = new CompressionPlan
        {
            OriginalRegion = region,
            CompressionMode = compressionMode,
            ThresholdMode = thresholdMode,
            ThresholdValue = thresholdValue,
            RowsToKeep = rowsToKeep,
            ColumnsToKeep = columnsToKeep,
            CompressionRatio = region.TotalCells > 0
                ? 1.0 - (double)(rowsToKeep.Count * columnsToKeep.Count) / region.TotalCells
                : 0.0
        };

        var overviewText = GenerateOverviewText(loader, region, plan, sheetName, detailRegion, showStyle);
        var statistics = CalculateStatistics(region, plan);

        return new OverviewResult
        {
            FilePath = string.Empty,
            SheetName = sheetName ?? "Sheet1",
            Range = _regionManager.ToRangeString(region),
            CompressionMode = compressionMode,
            ThresholdMode = thresholdMode,
            ThresholdValue = thresholdValue,
            DetailRegion = detailRegion != null ? _regionManager.ToRangeString(detailRegion) : null,
            Overview = overviewText,
            Statistics = statistics
        };
    }

    private string GenerateOverviewText(
        IExcelLoaderService loader,
        RegionInfo region,
        CompressionPlan plan,
        string? sheetName,
        RegionInfo? detailRegion,
        bool showStyle)
    {
        var sb = new StringBuilder();

        sb.AppendLine($"Range[{_regionManager.ToRangeString(region)}]:");

        sb.Append(GenerateColumnHeaders(loader, plan.ColumnsToKeep, sheetName));

        int? previousRow = null;
        foreach (var row in plan.RowsToKeep)
        {
            if (previousRow.HasValue && row > previousRow.Value + 1)
            {
                sb.Append(GenerateCompressionPlaceholder(plan.ColumnsToKeep));
            }

            sb.Append(GenerateDataRow(loader, row, plan.ColumnsToKeep, sheetName, showStyle));
            previousRow = row;
        }

        return sb.ToString();
    }

    private string GenerateCompressionPlaceholder(List<int> columnsToKeep)
    {
        var sb = new StringBuilder("...: |");

        for (int i = 0; i < columnsToKeep.Count; i++)
        {
            sb.Append("*|");
        }

        sb.AppendLine();
        return sb.ToString();
    }

    private string GenerateColumnHeaders(
        IExcelLoaderService loader,
        List<int> columnsToKeep,
        string? sheetName)
    {
        var sb = new StringBuilder("|");

        foreach (var col in columnsToKeep)
        {
            var colLetter = _regionManager.GetColumnLetter(col);
            var hiddenMarker = loader.IsColumnHidden(col, sheetName) ? "(H)" : string.Empty;
            sb.Append($"{colLetter}{hiddenMarker}|");
        }

        sb.AppendLine();
        return sb.ToString();
    }

    private string GenerateDataRow(
        IExcelLoaderService loader,
        int row,
        List<int> columnsToKeep,
        string? sheetName,
        bool showStyle)
    {
        var sb = new StringBuilder();
        var hiddenMarker = loader.IsRowHidden(row, sheetName) ? "(H)" : string.Empty;
        sb.Append($"{row}{hiddenMarker}: |");

        foreach (var col in columnsToKeep)
        {
            var cellInfo = loader.GetCellInfo(row, col, sheetName);
            var cellText = FormatCellValue(cellInfo, showStyle);
            sb.Append($"{cellText}|");
        }

        sb.AppendLine();
        return sb.ToString();
    }

    private string FormatCellValue(CellInfo cellInfo, bool showStyle)
    {
        var sb = new StringBuilder();

        if (cellInfo.IsMerged && !cellInfo.IsMergeMaster)
        {
            if (cellInfo.MergeType == "horizontal")
                sb.Append("<");
            else if (cellInfo.MergeType == "vertical")
                sb.Append("^");
        }

        string valueText;
        if (cellInfo.Value == null)
        {
            valueText = string.Empty;
        }
        else
        {
            valueText = EscapeSpecialChars(cellInfo.Value.ToString() ?? string.Empty);
        }

        sb.Append(valueText);

        if (!string.IsNullOrEmpty(cellInfo.Formula))
        {
            var escapedFormula = EscapeSpecialChars(cellInfo.Formula);
            if (string.IsNullOrEmpty(valueText))
            {
                sb.Append($"[未计算]{{fx=\"{escapedFormula}\"}}");
            }
            else
            {
                sb.Append($"{{fx=\"{escapedFormula}\"}}");
            }
        }

        if (showStyle && cellInfo.Style != null)
        {
            var styleCode = GenerateStyleCode(cellInfo.Style);
            if (!string.IsNullOrEmpty(styleCode))
            {
                sb.Append($"[{styleCode}]");
            }
        }

        return sb.ToString();
    }

    private string GenerateStyleCode(CellStyle style)
    {
        var codes = new List<string>();

        if (!string.IsNullOrEmpty(style.BackgroundColor))
        {
            var colorCode = MapColorToCode(style.BackgroundColor);
            if (!string.IsNullOrEmpty(colorCode))
                codes.Add(colorCode);
        }

        if (style.Border != null && style.Border.HasAny)
        {
            var borderCode = MapBorderToCode(style.Border);
            if (!string.IsNullOrEmpty(borderCode))
                codes.Add(borderCode);
        }

        return string.Join(",", codes);
    }

    private string MapColorToCode(string colorHex)
    {
        var colorMap = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
        {
            { "FF0000", "R" },
            { "00FF00", "G" },
            { "0000FF", "B" },
            { "FFFF00", "Y" },
            { "FFA500", "O" },
            { "800080", "P" },
            { "FFC0CB", "K" },
            { "808080", "S" },
            { "000000", "N" },
            { "FFFFFF", "W" },
            { "00FFFF", "C" },
            { "FF00FF", "M" }
        };

        colorHex = colorHex.TrimStart('#');
        return colorMap.TryGetValue(colorHex, out var code) ? code : string.Empty;
    }

    private string MapBorderToCode(BorderInfo border)
    {
        if (border.IsFullBorder)
            return "F";

        var codes = new List<string>();
        if (border.Top) codes.Add("T");
        if (border.Bottom) codes.Add("B");
        if (border.Left) codes.Add("L");
        if (border.Right) codes.Add("R");

        return string.Join("", codes);
    }

    private string EscapeSpecialChars(string text)
    {
        return text
            .Replace("\\", "\\\\")
            .Replace("<", "\\<")
            .Replace("^", "\\^")
            .Replace("|", "\\|")
            .Replace("\"", "\\\"");
    }

    private OverviewStatistics CalculateStatistics(RegionInfo region, CompressionPlan plan)
    {
        var stats = _compressionAnalyzer.CalculateStatistics(plan);

        return new OverviewStatistics
        {
            TotalRows = stats.OriginalRows,
            TotalColumns = stats.OriginalColumns,
            TotalCells = stats.OriginalCells,
            DisplayedRows = stats.CompressedRows,
            DisplayedColumns = stats.CompressedColumns,
            MergedCells = 0,
            WillCompress = plan.CompressionMode != "none",
            CompressionRatio = stats.CompressionRatio
        };
    }
}
