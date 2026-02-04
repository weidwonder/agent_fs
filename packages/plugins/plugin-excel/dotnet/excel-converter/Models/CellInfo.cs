namespace ExcelConverter.Models;

public class CellInfo
{
    public int Row { get; set; }
    public int Column { get; set; }
    public string Address { get; set; } = string.Empty;
    public object? Value { get; set; }
    public string? Formula { get; set; }
    public bool IsMerged { get; set; }
    public string MergeType { get; set; } = "none";
    public bool IsMergeMaster { get; set; }
    public CellDataType DataType { get; set; }
    public CellStyle? Style { get; set; }
}

public enum CellDataType
{
    Empty,
    Text,
    Number,
    Date,
    Boolean,
    Formula,
    Error
}

public class CellStyle
{
    public string? BackgroundColor { get; set; }
    public string? FontColor { get; set; }
    public bool IsBold { get; set; }
    public BorderInfo? Border { get; set; }
    public string? NumberFormat { get; set; }
}

public class BorderInfo
{
    public bool Top { get; set; }
    public bool Bottom { get; set; }
    public bool Left { get; set; }
    public bool Right { get; set; }
    public bool HasAny => Top || Bottom || Left || Right;
    public bool IsFullBorder => Top && Bottom && Left && Right;
}
