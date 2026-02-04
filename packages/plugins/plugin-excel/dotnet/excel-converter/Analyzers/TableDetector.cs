using ExcelConverter.Models;
using ExcelConverter.Services;

namespace ExcelConverter.Analyzers;

public class TableDetector
{
    private readonly IRegionManagerService _regionManager;

    public TableDetector(IRegionManagerService regionManager)
    {
        _regionManager = regionManager;
    }

    public TableDetectionResult DetectTables(
        IExcelLoaderService loader,
        string? sheetName = null,
        string method = "border",
        RegionInfo? region = null,
        bool splitRegions = false)
    {
        if (region == null)
        {
            region = loader.GetSheetBounds(sheetName);
        }

        var result = new TableDetectionResult
        {
            FilePath = string.Empty,
            SheetName = sheetName ?? "Sheet1",
            DetectionMethod = method,
            Region = region != null ? _regionManager.ToRangeString(region) : null,
            SplitRegions = splitRegions
        };

        List<TableInfo> tables;

        if (splitRegions)
        {
            var regions = _regionManager.SplitWorksheet(loader, sheetName);
            tables = new List<TableInfo>();

            foreach (var subRegion in regions)
            {
                var subTables = method == "border"
                    ? DetectTablesByBorder(loader, subRegion, sheetName)
                    : DetectTablesByBackground(loader, subRegion, sheetName);

                foreach (var table in subTables)
                {
                    table.RegionRange = _regionManager.ToRangeString(subRegion);
                    tables.Add(table);
                }
            }
        }
        else
        {
            if (region != null)
            {
                tables = method == "border"
                    ? DetectTablesByBorder(loader, region, sheetName)
                    : DetectTablesByBackground(loader, region, sheetName);
            }
            else
            {
                tables = new List<TableInfo>();
            }
        }

        result.Tables = tables;
        result.TotalTables = tables.Count;

        return result;
    }

    private List<TableInfo> DetectTablesByBorder(
        IExcelLoaderService loader,
        RegionInfo region,
        string? sheetName)
    {
        var tables = new List<TableInfo>();


        var visited = new HashSet<(int row, int col)>();

        for (int row = region.StartRow; row <= region.EndRow; row++)
        {
            for (int col = region.StartColumn; col <= region.EndColumn; col++)
            {
                if (visited.Contains((row, col)))
                    continue;

                var cellInfo = loader.GetCellInfo(row, col, sheetName);

                if (cellInfo.Style?.Border?.HasAny == true)
                {
                    var tableRegion = ExpandTableRegion(loader, row, col, region, sheetName, visited);

                    if (tableRegion != null && tableRegion.RowCount > 1 && tableRegion.ColumnCount > 1)
                    {
                        tables.Add(new TableInfo
                        {
                            Range = _regionManager.ToRangeString(tableRegion)
                        });
                    }
                }
            }
        }

        return tables;
    }

    private List<TableInfo> DetectTablesByBackground(
        IExcelLoaderService loader,
        RegionInfo region,
        string? sheetName,
        int startCol = 3)
    {
        var tables = new List<TableInfo>();


        var visited = new HashSet<(int row, int col)>();

        for (int row = region.StartRow; row <= region.EndRow; row++)
        {
            for (int col = Math.Max(region.StartColumn, startCol); col <= region.EndColumn; col++)
            {
                if (visited.Contains((row, col)))
                    continue;

                var cellInfo = loader.GetCellInfo(row, col, sheetName);

                if (!string.IsNullOrEmpty(cellInfo.Style?.BackgroundColor))
                {
                    var tableRegion = ExpandTableRegionByColor(loader, row, col, region, sheetName, visited);

                    if (tableRegion != null && tableRegion.RowCount > 1 && tableRegion.ColumnCount > 1)
                    {
                        tables.Add(new TableInfo
                        {
                            Range = _regionManager.ToRangeString(tableRegion)
                        });
                    }
                }
            }
        }

        return tables;
    }

    private RegionInfo? ExpandTableRegion(
        IExcelLoaderService loader,
        int startRow,
        int startCol,
        RegionInfo bounds,
        string? sheetName,
        HashSet<(int row, int col)> visited)
    {
        var queue = new Queue<(int row, int col)>();
        var tableCells = new HashSet<(int row, int col)>();

        queue.Enqueue((startRow, startCol));
        tableCells.Add((startRow, startCol));

        int minRow = startRow, maxRow = startRow;
        int minCol = startCol, maxCol = startCol;

        while (queue.Count > 0)
        {
            var (row, col) = queue.Dequeue();

            var neighbors = new[]
            {
                (row - 1, col),
                (row + 1, col),
                (row, col - 1),
                (row, col + 1)
            };

            foreach (var (nRow, nCol) in neighbors)
            {
                if (nRow < bounds.StartRow || nRow > bounds.EndRow ||
                    nCol < bounds.StartColumn || nCol > bounds.EndColumn)
                    continue;

                if (tableCells.Contains((nRow, nCol)))
                    continue;

                var cellInfo = loader.GetCellInfo(nRow, nCol, sheetName);

                if (cellInfo.Style?.Border?.HasAny == true)
                {
                    tableCells.Add((nRow, nCol));
                    queue.Enqueue((nRow, nCol));

                    minRow = Math.Min(minRow, nRow);
                    maxRow = Math.Max(maxRow, nRow);
                    minCol = Math.Min(minCol, nCol);
                    maxCol = Math.Max(maxCol, nCol);
                }
            }
        }

        foreach (var cell in tableCells)
        {
            visited.Add(cell);
        }

        return new RegionInfo
        {
            StartRow = minRow,
            StartColumn = minCol,
            EndRow = maxRow,
            EndColumn = maxCol,
            RangeString = _regionManager.ToCellAddress(minRow, minCol) + ":" +
                         _regionManager.ToCellAddress(maxRow, maxCol)
        };
    }

    private RegionInfo? ExpandTableRegionByColor(
        IExcelLoaderService loader,
        int startRow,
        int startCol,
        RegionInfo bounds,
        string? sheetName,
        HashSet<(int row, int col)> visited)
    {
        var startCellInfo = loader.GetCellInfo(startRow, startCol, sheetName);
        var targetColor = startCellInfo.Style?.BackgroundColor;

        if (string.IsNullOrEmpty(targetColor))
            return null;

        var queue = new Queue<(int row, int col)>();
        var tableCells = new HashSet<(int row, int col)>();

        queue.Enqueue((startRow, startCol));
        tableCells.Add((startRow, startCol));

        int minRow = startRow, maxRow = startRow;
        int minCol = startCol, maxCol = startCol;

        while (queue.Count > 0)
        {
            var (row, col) = queue.Dequeue();

            var neighbors = new[]
            {
                (row - 1, col),
                (row + 1, col),
                (row, col - 1),
                (row, col + 1)
            };

            foreach (var (nRow, nCol) in neighbors)
            {
                if (nRow < bounds.StartRow || nRow > bounds.EndRow ||
                    nCol < bounds.StartColumn || nCol > bounds.EndColumn)
                    continue;

                if (tableCells.Contains((nRow, nCol)))
                    continue;

                var cellInfo = loader.GetCellInfo(nRow, nCol, sheetName);

                if (cellInfo.Style?.BackgroundColor == targetColor)
                {
                    tableCells.Add((nRow, nCol));
                    queue.Enqueue((nRow, nCol));

                    minRow = Math.Min(minRow, nRow);
                    maxRow = Math.Max(maxRow, nRow);
                    minCol = Math.Min(minCol, nCol);
                    maxCol = Math.Max(maxCol, nCol);
                }
            }
        }

        foreach (var cell in tableCells)
        {
            visited.Add(cell);
        }

        return new RegionInfo
        {
            StartRow = minRow,
            StartColumn = minCol,
            EndRow = maxRow,
            EndColumn = maxCol,
            RangeString = _regionManager.ToCellAddress(minRow, minCol) + ":" +
                         _regionManager.ToCellAddress(maxRow, maxCol)
        };
    }
}
