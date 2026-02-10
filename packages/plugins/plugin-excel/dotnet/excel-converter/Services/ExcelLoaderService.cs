using ExcelConverter.Models;
using OfficeOpenXml;

namespace ExcelConverter.Services;

public class ExcelLoaderService : IExcelLoaderService
{
    private readonly IXlsConverterService _xlsConverter;
    private ExcelPackage? _package;
    private string? _currentFilePath;
    private ExcelWorksheet? _currentWorksheet;
    private bool _isXlsFile;

    static ExcelLoaderService()
    {
        ExcelPackage.License.SetNonCommercialPersonal("agent-fs");
    }

    public ExcelLoaderService(IXlsConverterService xlsConverter)
    {
        _xlsConverter = xlsConverter ?? throw new ArgumentNullException(nameof(xlsConverter));
    }

    public void Open(string filePath)
    {
        if (string.IsNullOrEmpty(filePath))
            throw new ArgumentException("File path cannot be null or empty", nameof(filePath));

        if (!File.Exists(filePath))
            throw new FileNotFoundException($"File not found: {filePath}");

        Close();

        var extension = Path.GetExtension(filePath).ToLowerInvariant();
        _isXlsFile = extension == ".xls";

        if (_isXlsFile)
        {
            using var xlsStream = new MemoryStream();
            using (var fileStream = File.OpenRead(filePath))
            {
                fileStream.CopyTo(xlsStream);
            }
            xlsStream.Position = 0;

            var xlsxStream = new MemoryStream();
            _xlsConverter.Convert(xlsStream, xlsxStream);
            xlsxStream.Position = 0;

            _package = new ExcelPackage(xlsxStream);
        }
        else
        {
            _package = new ExcelPackage(new FileInfo(filePath));
        }

        _currentFilePath = filePath;

        if (_package.Workbook.Worksheets.Count > 0)
        {
            _currentWorksheet = _package.Workbook.Worksheets[0];
        }
    }

    public void Close()
    {
        _currentWorksheet = null;
        _package?.Dispose();
        _package = null;
        _currentFilePath = null;
    }

    public List<string> GetSheetNames()
    {
        EnsureFileOpen();
        return _package!.Workbook.Worksheets.Select(ws => ws.Name).ToList();
    }

    public int GetSheetCount()
    {
        EnsureFileOpen();
        return _package!.Workbook.Worksheets.Count;
    }

    public RegionInfo GetSheetBounds(string? sheetName = null)
    {
        var worksheet = GetWorksheet(sheetName);
        var dimension = worksheet.Dimension;

        if (dimension == null)
        {
            return new RegionInfo
            {
                StartRow = 1,
                StartColumn = 1,
                EndRow = 1,
                EndColumn = 1,
                RangeString = "A1"
            };
        }

        var startRow = Math.Max(1, dimension.Start.Row);
        var startCol = Math.Max(1, dimension.Start.Column);
        var endRow = Math.Max(startRow, dimension.End.Row);
        var endCol = Math.Max(startCol, dimension.End.Column);

        int? effectiveStartRow = null;
        int? effectiveStartCol = null;
        int? effectiveEndRow = null;
        int? effectiveEndCol = null;

        for (int row = endRow; row >= startRow; row--)
        {
            if (RowHasContent(worksheet, row, startCol, endCol))
            {
                effectiveEndRow = row;
                break;
            }
        }

        if (!effectiveEndRow.HasValue)
        {
            return new RegionInfo
            {
                StartRow = 1,
                StartColumn = 1,
                EndRow = 1,
                EndColumn = 1,
                RangeString = "A1"
            };
        }

        for (int row = startRow; row <= effectiveEndRow.Value; row++)
        {
            if (RowHasContent(worksheet, row, startCol, endCol))
            {
                effectiveStartRow = row;
                break;
            }
        }

        for (int col = endCol; col >= startCol; col--)
        {
            if (ColumnHasContent(worksheet, col, effectiveStartRow!.Value, effectiveEndRow.Value))
            {
                effectiveEndCol = col;
                break;
            }
        }

        for (int col = startCol; col <= effectiveEndCol!.Value; col++)
        {
            if (ColumnHasContent(worksheet, col, effectiveStartRow!.Value, effectiveEndRow.Value))
            {
                effectiveStartCol = col;
                break;
            }
        }

        return new RegionInfo
        {
            StartRow = effectiveStartRow!.Value,
            StartColumn = effectiveStartCol!.Value,
            EndRow = effectiveEndRow.Value,
            EndColumn = effectiveEndCol.Value,
            RangeString = worksheet.Cells[
                effectiveStartRow.Value,
                effectiveStartCol.Value,
                effectiveEndRow.Value,
                effectiveEndCol.Value
            ].Address
        };
    }

    public object? GetCellValue(int row, int column, string? sheetName = null)
    {
        var worksheet = GetWorksheet(sheetName);
        return worksheet.Cells[row, column].Value;
    }

    public string? GetCellFormula(int row, int column, string? sheetName = null)
    {
        var worksheet = GetWorksheet(sheetName);
        return worksheet.Cells[row, column].Formula;
    }

    public CellInfo GetCellInfo(int row, int column, string? sheetName = null)
    {
        var worksheet = GetWorksheet(sheetName);
        var cell = worksheet.Cells[row, column];

        var cellInfo = new CellInfo
        {
            Row = row,
            Column = column,
            Address = cell.Address,
            Value = cell.Value,
            Formula = string.IsNullOrEmpty(cell.Formula) ? null : "=" + cell.Formula,
            IsMerged = cell.Merge,
            DataType = DetermineCellDataType(cell)
        };

        if (cell.Merge)
        {
            var mergedCell = worksheet.MergedCells[row, column];
            if (mergedCell != null)
            {
                var range = worksheet.Cells[mergedCell];
                var startRow = range.Start.Row;
                var startCol = range.Start.Column;
                var endRow = range.End.Row;
                var endCol = range.End.Column;

                cellInfo.IsMergeMaster = (row == startRow && column == startCol);

                if (startRow == endRow && startCol != endCol)
                {
                    cellInfo.MergeType = "horizontal";
                }
                else if (startRow != endRow && startCol == endCol)
                {
                    cellInfo.MergeType = "vertical";
                }
                else if (startRow != endRow && startCol != endCol)
                {
                    cellInfo.MergeType = "both";
                }
            }
        }

        cellInfo.Style = GetCellStyle(cell);

        return cellInfo;
    }

    private CellStyle GetCellStyle(ExcelRange cell)
    {
        var style = new CellStyle();

        var border = cell.Style.Border;
        style.Border = new BorderInfo
        {
            Top = border.Top.Style != OfficeOpenXml.Style.ExcelBorderStyle.None,
            Bottom = border.Bottom.Style != OfficeOpenXml.Style.ExcelBorderStyle.None,
            Left = border.Left.Style != OfficeOpenXml.Style.ExcelBorderStyle.None,
            Right = border.Right.Style != OfficeOpenXml.Style.ExcelBorderStyle.None
        };

        var fill = cell.Style.Fill;
        if (fill.PatternType != OfficeOpenXml.Style.ExcelFillStyle.None)
        {
            var bgColor = fill.BackgroundColor;
            if (!string.IsNullOrEmpty(bgColor.Rgb))
            {
                var rgb = bgColor.Rgb;
                if (rgb.Length == 8 && rgb.StartsWith("FF"))
                {
                    rgb = rgb.Substring(2);
                }
                style.BackgroundColor = rgb;
            }
        }

        style.NumberFormat = cell.Style.Numberformat.Format;

        return style;
    }

    public bool IsMergedCell(int row, int column, string? sheetName = null)
    {
        var worksheet = GetWorksheet(sheetName);
        return worksheet.Cells[row, column].Merge;
    }

    public (int row, int column)? GetMergedCellMaster(int row, int column, string? sheetName = null)
    {
        var worksheet = GetWorksheet(sheetName);
        var cell = worksheet.Cells[row, column];

        if (!cell.Merge)
            return null;

        var mergedCell = worksheet.MergedCells[row, column];
        if (mergedCell == null)
            return null;

        var range = worksheet.Cells[mergedCell];
        return (range.Start.Row, range.Start.Column);
    }

    public List<CellInfo> GetRangeCells(RegionInfo region, string? sheetName = null)
    {
        var worksheet = GetWorksheet(sheetName);
        var cells = new List<CellInfo>();

        for (int row = region.StartRow; row <= region.EndRow; row++)
        {
            for (int col = region.StartColumn; col <= region.EndColumn; col++)
            {
                cells.Add(GetCellInfo(row, col, sheetName));
            }
        }

        return cells;
    }

    public object?[,] GetRangeValues(RegionInfo region, string? sheetName = null)
    {
        var worksheet = GetWorksheet(sheetName);
        var values = new object?[region.RowCount, region.ColumnCount];

        for (int i = 0; i < region.RowCount; i++)
        {
            for (int j = 0; j < region.ColumnCount; j++)
            {
                int row = region.StartRow + i;
                int col = region.StartColumn + j;
                values[i, j] = worksheet.Cells[row, col].Value;
            }
        }

        return values;
    }

    public bool IsCellEmpty(int row, int column, string? sheetName = null)
    {
        var worksheet = GetWorksheet(sheetName);
        var cell = worksheet.Cells[row, column];
        return !HasMeaningfulContent(cell);
    }

    public CellDataType GetCellDataType(int row, int column, string? sheetName = null)
    {
        var worksheet = GetWorksheet(sheetName);
        var cell = worksheet.Cells[row, column];
        return DetermineCellDataType(cell);
    }

    public bool IsRowHidden(int row, string? sheetName = null)
    {
        var worksheet = GetWorksheet(sheetName);
        return worksheet.Row(row).Hidden;
    }

    public bool IsColumnHidden(int column, string? sheetName = null)
    {
        var worksheet = GetWorksheet(sheetName);
        return worksheet.Column(column).Hidden;
    }

    public void Dispose()
    {
        Close();
    }

    private static bool RowHasContent(ExcelWorksheet worksheet, int row, int startCol, int endCol)
    {
        for (int col = startCol; col <= endCol; col++)
        {
            if (HasMeaningfulContent(worksheet.Cells[row, col]))
            {
                return true;
            }
        }

        return false;
    }

    private static bool ColumnHasContent(ExcelWorksheet worksheet, int col, int startRow, int endRow)
    {
        for (int row = startRow; row <= endRow; row++)
        {
            if (HasMeaningfulContent(worksheet.Cells[row, col]))
            {
                return true;
            }
        }

        return false;
    }

    private static bool HasMeaningfulContent(ExcelRange cell)
    {
        if (!string.IsNullOrWhiteSpace(cell.Formula))
        {
            return true;
        }

        return cell.Value switch
        {
            null => false,
            string str => !string.IsNullOrWhiteSpace(str),
            _ => true,
        };
    }


    private void EnsureFileOpen()
    {
        if (_package == null)
            throw new InvalidOperationException("No Excel file is currently open. Call Open() first.");
    }

    private ExcelWorksheet GetWorksheet(string? sheetName)
    {
        EnsureFileOpen();

        if (string.IsNullOrEmpty(sheetName))
        {
            if (_currentWorksheet == null)
                throw new InvalidOperationException("No worksheet is selected.");
            return _currentWorksheet;
        }

        var worksheet = _package!.Workbook.Worksheets[sheetName];
        if (worksheet == null)
        {
            var availableSheets = _package.Workbook.Worksheets.Select(ws => ws.Name).ToList();
            var availableSheetsStr = string.Join("', '", availableSheets);
            throw new ArgumentException(
                $"Worksheet '{sheetName}' not found. Available worksheets: ['{availableSheetsStr}']");
        }

        return worksheet;
    }

    private static CellDataType DetermineCellDataType(ExcelRange cell)
    {
        if (cell.Value == null)
            return CellDataType.Empty;

        if (!string.IsNullOrEmpty(cell.Formula))
            return CellDataType.Formula;

        return cell.Value switch
        {
            double or decimal or int or long or float => CellDataType.Number,
            DateTime => CellDataType.Date,
            bool => CellDataType.Boolean,
            string => CellDataType.Text,
            _ => CellDataType.Text
        };
    }
}
