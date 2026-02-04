using ExcelConverter.Models;

namespace ExcelConverter.Services;

public interface IRegionManagerService
{
    RegionInfo ParseRange(string rangeString);
    string ToRangeString(RegionInfo region);
    List<RegionInfo> SplitWorksheet(IExcelLoaderService loader, string? sheetName = null, int minEmptyRows = 2, int minEmptyCols = 2);
    string GetColumnLetter(int columnNumber);
    int GetColumnNumber(string columnLetter);
    (int row, int column) ParseCellAddress(string cellAddress);
    string ToCellAddress(int row, int column);
}
