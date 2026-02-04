namespace ExcelConverter.Models;

public class RegionInfo
{
    public int StartRow { get; set; }
    public int EndRow { get; set; }
    public int StartColumn { get; set; }
    public int EndColumn { get; set; }
    public string RangeString { get; set; } = string.Empty;

    public int RowCount => EndRow - StartRow + 1;
    public int ColumnCount => EndColumn - StartColumn + 1;
    public int TotalCells => RowCount * ColumnCount;

    public bool Contains(int row, int column)
    {
        return row >= StartRow && row <= EndRow && column >= StartColumn && column <= EndColumn;
    }

    public bool Intersects(RegionInfo other)
    {
        return !(EndRow < other.StartRow || StartRow > other.EndRow ||
                 EndColumn < other.StartColumn || StartColumn > other.EndColumn);
    }
}
