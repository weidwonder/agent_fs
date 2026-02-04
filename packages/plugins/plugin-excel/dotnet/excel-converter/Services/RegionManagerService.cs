using ExcelConverter.Models;
using System.Text.RegularExpressions;

namespace ExcelConverter.Services;

public class RegionManagerService : IRegionManagerService
{
    public RegionInfo ParseRange(string rangeString)
    {
        if (string.IsNullOrWhiteSpace(rangeString))
            throw new ArgumentException("Range string cannot be null or empty", nameof(rangeString));

        rangeString = rangeString.Trim();

        var match = Regex.Match(rangeString, @"^([A-Z]+)(\d+):([A-Z]+)(\d+)$", RegexOptions.IgnoreCase);
        if (match.Success)
        {
            var startCol = GetColumnNumber(match.Groups[1].Value);
            var startRow = int.Parse(match.Groups[2].Value);
            var endCol = GetColumnNumber(match.Groups[3].Value);
            var endRow = int.Parse(match.Groups[4].Value);

            return new RegionInfo
            {
                StartRow = startRow,
                StartColumn = startCol,
                EndRow = endRow,
                EndColumn = endCol,
                RangeString = rangeString.ToUpper()
            };
        }

        match = Regex.Match(rangeString, @"^([A-Z]+)(\d+)$", RegexOptions.IgnoreCase);
        if (match.Success)
        {
            var col = GetColumnNumber(match.Groups[1].Value);
            var row = int.Parse(match.Groups[2].Value);

            return new RegionInfo
            {
                StartRow = row,
                StartColumn = col,
                EndRow = row,
                EndColumn = col,
                RangeString = rangeString.ToUpper()
            };
        }

        throw new ArgumentException($"Invalid range string format: {rangeString}");
    }

    public string ToRangeString(RegionInfo region)
    {
        if (region.StartRow < 1 || region.StartColumn < 1 ||
            region.EndRow < region.StartRow || region.EndColumn < region.StartColumn)
        {
            throw new ArgumentException(
                $"Invalid region: StartRow={region.StartRow}, StartColumn={region.StartColumn}, " +
                $"EndRow={region.EndRow}, EndColumn={region.EndColumn}");
        }

        var startCell = ToCellAddress(region.StartRow, region.StartColumn);
        var endCell = ToCellAddress(region.EndRow, region.EndColumn);

        if (startCell == endCell)
            return startCell;

        return $"{startCell}:{endCell}";
    }

    public List<RegionInfo> SplitWorksheet(IExcelLoaderService loader, string? sheetName = null,
        int minEmptyRows = 2, int minEmptyCols = 2)
    {
        var bounds = loader.GetSheetBounds(sheetName);

        var regions = new List<RegionInfo> { bounds };
        return SplitRegionsRecursive(loader, regions, minEmptyRows, minEmptyCols, sheetName);
    }

    private List<RegionInfo> SplitRegionsRecursive(IExcelLoaderService loader, List<RegionInfo> regions,
        int minEmptyRows, int minEmptyCols, string? sheetName)
    {
        var newRegions = new List<RegionInfo>();
        bool anySplit = false;

        foreach (var region in regions)
        {
            var rowSplit = SplitByEmptyRows(loader, region, minEmptyRows, sheetName);

            if (rowSplit.Count > 1)
            {
                anySplit = true;
                foreach (var rowRegion in rowSplit)
                {
                    var colSplit = SplitByEmptyColumns(loader, rowRegion, minEmptyCols, sheetName);
                    if (colSplit.Count > 1)
                    {
                        newRegions.AddRange(colSplit);
                    }
                    else
                    {
                        newRegions.Add(rowRegion);
                    }
                }
            }
            else
            {
                var colSplit = SplitByEmptyColumns(loader, region, minEmptyCols, sheetName);
                if (colSplit.Count > 1)
                {
                    anySplit = true;
                    newRegions.AddRange(colSplit);
                }
                else
                {
                    newRegions.Add(region);
                }
            }
        }

        if (anySplit && newRegions.Count > regions.Count)
        {
            return SplitRegionsRecursive(loader, newRegions, minEmptyRows, minEmptyCols, sheetName);
        }

        return newRegions;
    }

    private List<RegionInfo> SplitByEmptyRows(IExcelLoaderService loader, RegionInfo bounds,
        int minEmptyRows, string? sheetName)
    {
        if (bounds.StartRow < 1 || bounds.EndRow < bounds.StartRow ||
            bounds.StartColumn < 1 || bounds.EndColumn < bounds.StartColumn)
        {
            return new List<RegionInfo>();
        }

        var regions = new List<RegionInfo>();
        var currentStartRow = bounds.StartRow;
        var emptyRowCount = 0;

        for (int row = bounds.StartRow; row <= bounds.EndRow + 1; row++)
        {
            bool isRowEmpty = row > bounds.EndRow ||
                IsRowEmpty(loader, row, bounds.StartColumn, bounds.EndColumn, sheetName);

            if (isRowEmpty)
            {
                emptyRowCount++;
            }
            else
            {
                if (emptyRowCount >= minEmptyRows && currentStartRow < row)
                {
                    var firstEmptyRow = row - emptyRowCount;
                    var lastNonEmptyRow = firstEmptyRow - 1;

                    if (lastNonEmptyRow >= bounds.StartRow && row <= bounds.EndRow)
                    {
                        bool hasBorderConnectivity = HasBorderConnectivityAcrossRows(
                            loader, lastNonEmptyRow, row, bounds.StartColumn, bounds.EndColumn, sheetName);

                        if (!hasBorderConnectivity)
                        {
                            var endRow = row - emptyRowCount - 1;
                            if (endRow >= currentStartRow && endRow >= 1)
                            {
                                var region = new RegionInfo
                                {
                                    StartRow = currentStartRow,
                                    StartColumn = bounds.StartColumn,
                                    EndRow = endRow,
                                    EndColumn = bounds.EndColumn
                                };
                                region.RangeString = ToRangeString(region);
                                regions.Add(region);
                            }

                            currentStartRow = row;
                        }
                    }
                    else
                    {
                        var endRow = row - emptyRowCount - 1;
                        if (endRow >= currentStartRow && endRow >= 1)
                        {
                            var region = new RegionInfo
                            {
                                StartRow = currentStartRow,
                                StartColumn = bounds.StartColumn,
                                EndRow = endRow,
                                EndColumn = bounds.EndColumn
                            };
                            region.RangeString = ToRangeString(region);
                            regions.Add(region);
                        }

                        currentStartRow = row;
                    }
                }
                else if (!isRowEmpty)
                {
                    emptyRowCount = 0;
                }
            }
        }

        if (currentStartRow <= bounds.EndRow)
        {
            var region = new RegionInfo
            {
                StartRow = currentStartRow,
                StartColumn = bounds.StartColumn,
                EndRow = bounds.EndRow,
                EndColumn = bounds.EndColumn
            };
            region.RangeString = ToRangeString(region);
            regions.Add(region);
        }

        if (regions.Count == 0)
        {
            regions.Add(bounds);
        }

        return regions;
    }

    private List<RegionInfo> SplitByEmptyColumns(IExcelLoaderService loader, RegionInfo bounds,
        int minEmptyCols, string? sheetName)
    {
        if (bounds.StartRow < 1 || bounds.EndRow < bounds.StartRow ||
            bounds.StartColumn < 1 || bounds.EndColumn < bounds.StartColumn)
        {
            return new List<RegionInfo>();
        }

        var regions = new List<RegionInfo>();
        var currentStartCol = bounds.StartColumn;
        var emptyColCount = 0;

        for (int col = bounds.StartColumn; col <= bounds.EndColumn + 1; col++)
        {
            bool isColEmpty = col > bounds.EndColumn ||
                IsColumnEmpty(loader, col, bounds.StartRow, bounds.EndRow, sheetName);

            if (isColEmpty)
            {
                emptyColCount++;
            }
            else
            {
                if (emptyColCount >= minEmptyCols && currentStartCol < col)
                {
                    var firstEmptyCol = col - emptyColCount;
                    var lastNonEmptyCol = firstEmptyCol - 1;

                    if (lastNonEmptyCol >= bounds.StartColumn && col <= bounds.EndColumn)
                    {
                        bool hasBorderConnectivity = HasBorderConnectivityAcrossColumns(
                            loader, lastNonEmptyCol, col, bounds.StartRow, bounds.EndRow, sheetName);

                        if (!hasBorderConnectivity)
                        {
                            var endCol = col - emptyColCount - 1;
                            if (endCol >= currentStartCol && endCol >= 1)
                            {
                                var region = new RegionInfo
                                {
                                    StartRow = bounds.StartRow,
                                    StartColumn = currentStartCol,
                                    EndRow = bounds.EndRow,
                                    EndColumn = endCol
                                };
                                region.RangeString = ToRangeString(region);
                                regions.Add(region);
                            }

                            currentStartCol = col;
                        }
                    }
                    else
                    {
                        var endCol = col - emptyColCount - 1;
                        if (endCol >= currentStartCol && endCol >= 1)
                        {
                            var region = new RegionInfo
                            {
                                StartRow = bounds.StartRow,
                                StartColumn = currentStartCol,
                                EndRow = bounds.EndRow,
                                EndColumn = endCol
                            };
                            region.RangeString = ToRangeString(region);
                            regions.Add(region);
                        }

                        currentStartCol = col;
                    }
                }
                else if (!isColEmpty)
                {
                    emptyColCount = 0;
                }
            }
        }

        if (currentStartCol <= bounds.EndColumn)
        {
            var region = new RegionInfo
            {
                StartRow = bounds.StartRow,
                StartColumn = currentStartCol,
                EndRow = bounds.EndRow,
                EndColumn = bounds.EndColumn
            };
            region.RangeString = ToRangeString(region);
            regions.Add(region);
        }

        if (regions.Count == 0)
        {
            regions.Add(bounds);
        }

        return regions;
    }

    public bool IsRowEmpty(IExcelLoaderService loader, int row, int startCol, int endCol, string? sheetName = null)
    {
        for (int col = startCol; col <= endCol; col++)
        {
            if (!loader.IsCellEmpty(row, col, sheetName))
                return false;

            var cellInfo = loader.GetCellInfo(row, col, sheetName);
            if (cellInfo?.Style?.Border?.HasAny == true)
                return false;
        }
        return true;
    }

    public bool IsColumnEmpty(IExcelLoaderService loader, int column, int startRow, int endRow, string? sheetName = null)
    {
        for (int row = startRow; row <= endRow; row++)
        {
            if (!loader.IsCellEmpty(row, column, sheetName))
                return false;

            var cellInfo = loader.GetCellInfo(row, column, sheetName);
            if (cellInfo?.Style?.Border?.HasAny == true)
                return false;
        }
        return true;
    }

    public string GetColumnLetter(int columnNumber)
    {
        if (columnNumber < 1)
            throw new ArgumentException("Column number must be greater than 0", nameof(columnNumber));

        string columnLetter = string.Empty;
        while (columnNumber > 0)
        {
            int modulo = (columnNumber - 1) % 26;
            columnLetter = Convert.ToChar(65 + modulo) + columnLetter;
            columnNumber = (columnNumber - modulo) / 26;
        }

        return columnLetter;
    }

    public int GetColumnNumber(string columnLetter)
    {
        if (string.IsNullOrWhiteSpace(columnLetter))
            throw new ArgumentException("Column letter cannot be null or empty", nameof(columnLetter));

        columnLetter = columnLetter.Trim().ToUpperInvariant();
        int columnNumber = 0;

        for (int i = 0; i < columnLetter.Length; i++)
        {
            columnNumber *= 26;
            columnNumber += (columnLetter[i] - 'A' + 1);
        }

        return columnNumber;
    }

    public (int row, int column) ParseCellAddress(string cellAddress)
    {
        if (string.IsNullOrWhiteSpace(cellAddress))
            throw new ArgumentException("Cell address cannot be null or empty", nameof(cellAddress));

        cellAddress = cellAddress.Trim();

        var match = Regex.Match(cellAddress, @"^([A-Z]+)(\d+)$", RegexOptions.IgnoreCase);
        if (!match.Success)
            throw new ArgumentException($"Invalid cell address format: {cellAddress}");

        var column = GetColumnNumber(match.Groups[1].Value);
        var row = int.Parse(match.Groups[2].Value);

        return (row, column);
    }

    public string ToCellAddress(int row, int column)
    {
        return $"{GetColumnLetter(column)}{row}";
    }

    private bool HasBorderConnectivityAcrossRows(
        IExcelLoaderService loader,
        int row1,
        int row2,
        int startCol,
        int endCol,
        string? sheetName)
    {
        for (int col = startCol; col <= endCol; col++)
        {
            var cell1 = loader.GetCellInfo(row1, col, sheetName);
            var cell2 = loader.GetCellInfo(row2, col, sheetName);

            if (cell1.Style?.Border?.Bottom == true && cell2.Style?.Border?.Top == true)
            {
                return true;
            }
        }

        return false;
    }

    private bool HasBorderConnectivityAcrossColumns(
        IExcelLoaderService loader,
        int col1,
        int col2,
        int startRow,
        int endRow,
        string? sheetName)
    {
        for (int row = startRow; row <= endRow; row++)
        {
            var cell1 = loader.GetCellInfo(row, col1, sheetName);
            var cell2 = loader.GetCellInfo(row, col2, sheetName);

            if (cell1.Style?.Border?.Right == true && cell2.Style?.Border?.Left == true)
            {
                return true;
            }
        }

        return false;
    }
}
