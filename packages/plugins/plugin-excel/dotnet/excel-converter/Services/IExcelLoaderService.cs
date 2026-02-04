using ExcelConverter.Models;

namespace ExcelConverter.Services;

public interface IExcelLoaderService : IDisposable
{
    void Open(string filePath);
    void Close();
    List<string> GetSheetNames();
    int GetSheetCount();
    RegionInfo GetSheetBounds(string? sheetName = null);
    object? GetCellValue(int row, int column, string? sheetName = null);
    string? GetCellFormula(int row, int column, string? sheetName = null);
    CellInfo GetCellInfo(int row, int column, string? sheetName = null);
    bool IsMergedCell(int row, int column, string? sheetName = null);
    (int row, int column)? GetMergedCellMaster(int row, int column, string? sheetName = null);
    List<CellInfo> GetRangeCells(RegionInfo region, string? sheetName = null);
    object?[,] GetRangeValues(RegionInfo region, string? sheetName = null);
    bool IsCellEmpty(int row, int column, string? sheetName = null);
    CellDataType GetCellDataType(int row, int column, string? sheetName = null);
    bool IsRowHidden(int row, string? sheetName = null);
    bool IsColumnHidden(int column, string? sheetName = null);
}
