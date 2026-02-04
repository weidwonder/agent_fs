using NPOI.HSSF.UserModel;
using NPOI.SS.UserModel;
using NPOI.SS.Util;
using OfficeOpenXml;
using OfficeOpenXml.Style;
using OfficeOpenXml.Drawing;
using System.Drawing;

namespace ExcelConverter.Services;

public class XlsConverterService : IXlsConverterService
{
    public void Convert(Stream xlsStream, Stream xlsxStream)
    {
        using var hssfWorkbook = new HSSFWorkbook(xlsStream);

        using var excelPackage = new ExcelPackage();

        for (int i = 0; i < hssfWorkbook.NumberOfSheets; i++)
        {
            var sourceSheet = hssfWorkbook.GetSheetAt(i);
            var targetSheet = excelPackage.Workbook.Worksheets.Add(sourceSheet.SheetName);

            CopySheet(sourceSheet, targetSheet, hssfWorkbook);
        }

        CopyNamedRanges(hssfWorkbook, excelPackage);

        excelPackage.SaveAs(xlsxStream);
    }


    private void CopySheet(ISheet sourceSheet, ExcelWorksheet targetSheet, HSSFWorkbook workbook)
    {
        targetSheet.DefaultRowHeight = sourceSheet.DefaultRowHeight / 20.0;
        targetSheet.DefaultColWidth = sourceSheet.DefaultColumnWidth;

        int maxColumn = 256;

        for (int rowIndex = sourceSheet.FirstRowNum; rowIndex <= sourceSheet.LastRowNum; rowIndex++)
        {
            var row = sourceSheet.GetRow(rowIndex);
            if (row != null && row.LastCellNum > maxColumn)
            {
                maxColumn = row.LastCellNum;
            }
        }

        for (int col = 0; col < maxColumn; col++)
        {
            var targetColumn = targetSheet.Column(col + 1);

            double colWidth = sourceSheet.GetColumnWidth(col);
            targetColumn.Width = colWidth / 256.0;

            if (sourceSheet.IsColumnHidden(col))
            {
                targetColumn.Hidden = true;
            }
        }

        for (int rowIndex = sourceSheet.FirstRowNum; rowIndex <= sourceSheet.LastRowNum; rowIndex++)
        {
            var sourceRow = sourceSheet.GetRow(rowIndex);
            if (sourceRow == null) continue;

            var targetRow = targetSheet.Row(rowIndex + 1);

            if (sourceRow.Height >= 0)
            {
                targetRow.Height = sourceRow.Height / 20.0;
            }

            if (sourceRow.ZeroHeight)
            {
                targetRow.Hidden = true;
            }

            for (int cellIndex = sourceRow.FirstCellNum; cellIndex < sourceRow.LastCellNum; cellIndex++)
            {
                var sourceCell = sourceRow.GetCell(cellIndex);
                if (sourceCell == null) continue;

                var targetCell = targetSheet.Cells[rowIndex + 1, cellIndex + 1];

                CopyCell(sourceCell, targetCell, workbook);
            }
        }

        for (int i = 0; i < sourceSheet.NumMergedRegions; i++)
        {
            var mergedRegion = sourceSheet.GetMergedRegion(i);
            targetSheet.Cells[
                mergedRegion.FirstRow + 1, mergedRegion.FirstColumn + 1,
                mergedRegion.LastRow + 1, mergedRegion.LastColumn + 1
            ].Merge = true;
        }

        CopyFreezePanes(sourceSheet, targetSheet);

        CopyPrintSetup(sourceSheet, targetSheet);

        CopyGrouping(sourceSheet, targetSheet);

        CopySheetProperties(sourceSheet, targetSheet);

        CopyPictures(sourceSheet, targetSheet, workbook);

        CopySheetProtection(sourceSheet, targetSheet);

        for (int col = 0; col < maxColumn; col++)
        {
            if (sourceSheet.IsColumnHidden(col))
            {
                targetSheet.Column(col + 1).Hidden = true;
            }
        }
    }



    private void CopyCell(ICell sourceCell, OfficeOpenXml.ExcelRange targetCell, HSSFWorkbook workbook)
    {
        switch (sourceCell.CellType)
        {
            case CellType.Numeric:
                if (DateUtil.IsCellDateFormatted(sourceCell))
                {
                    targetCell.Value = sourceCell.DateCellValue;
                }
                else
                {
                    targetCell.Value = sourceCell.NumericCellValue;
                }
                break;

            case CellType.String:
                targetCell.Value = sourceCell.StringCellValue;
                break;

            case CellType.Boolean:
                targetCell.Value = sourceCell.BooleanCellValue;
                break;

            case CellType.Formula:
                try
                {
                    targetCell.Formula = sourceCell.CellFormula;

                    switch (sourceCell.CachedFormulaResultType)
                    {
                        case CellType.Numeric:
                            if (DateUtil.IsCellDateFormatted(sourceCell))
                            {
                                targetCell.Value = sourceCell.DateCellValue;
                            }
                            else
                            {
                                targetCell.Value = sourceCell.NumericCellValue;
                            }
                            break;

                        case CellType.String:
                            targetCell.Value = sourceCell.StringCellValue;
                            break;

                        case CellType.Boolean:
                            targetCell.Value = sourceCell.BooleanCellValue;
                            break;
                    }
                }
                catch
                {
                    try
                    {
                        switch (sourceCell.CachedFormulaResultType)
                        {
                            case CellType.Numeric:
                                if (DateUtil.IsCellDateFormatted(sourceCell))
                                {
                                    targetCell.Value = sourceCell.DateCellValue;
                                }
                                else
                                {
                                    targetCell.Value = sourceCell.NumericCellValue;
                                }
                                break;

                            case CellType.String:
                                targetCell.Value = sourceCell.StringCellValue;
                                break;

                            case CellType.Boolean:
                                targetCell.Value = sourceCell.BooleanCellValue;
                                break;
                        }
                    }
                    catch
                    {
                    }
                }
                break;

            case CellType.Blank:
            case CellType.Error:
                break;
        }

        CopyHyperlink(sourceCell, targetCell);

        if (sourceCell.CellStyle != null)
        {
            CopyCellStyle(sourceCell.CellStyle, targetCell.Style, workbook);
        }

        CopyCellComment(sourceCell, targetCell);
    }

    private void CopyHyperlink(ICell sourceCell, OfficeOpenXml.ExcelRange targetCell)
    {
        var hyperlink = sourceCell.Hyperlink;
        if (hyperlink == null) return;

        try
        {
            var address = hyperlink.Address;
            if (string.IsNullOrEmpty(address)) return;

            if (hyperlink is HSSFHyperlink hssfHyperlink)
            {
                switch (hssfHyperlink.Type)
                {
                    case HyperlinkType.Document:
                        address = address.TrimStart('#');
                        var displayText = hyperlink.Label;
                        if (!string.IsNullOrEmpty(displayText))
                        {
                            targetCell.Hyperlink = new ExcelHyperLink(address, displayText);
                        }
                        else
                        {
                            targetCell.Hyperlink = new ExcelHyperLink(address);
                        }
                        break;

                    case HyperlinkType.Url:
                        targetCell.Hyperlink = new Uri(address, UriKind.Absolute);
                        break;

                    case HyperlinkType.Email:
                        if (!address.StartsWith("mailto:"))
                        {
                            address = "mailto:" + address;
                        }
                        targetCell.Hyperlink = new Uri(address, UriKind.Absolute);
                        break;

                    case HyperlinkType.File:
                        targetCell.Hyperlink = new Uri(address, UriKind.RelativeOrAbsolute);
                        break;
                }
            }

            if (!string.IsNullOrEmpty(hyperlink.Label) && hyperlink.Label != targetCell.Text)
            {
                targetCell.Value = hyperlink.Label;
            }
        }
        catch
        {
        }
    }

    private void CopyCellComment(ICell sourceCell, OfficeOpenXml.ExcelRange targetCell)
    {
        if (sourceCell.CellComment == null) return;

        try
        {
            var sourceComment = sourceCell.CellComment;
            var comment = targetCell.AddComment(
                sourceComment.String?.String ?? "",
                sourceComment.Author ?? "");

            if (sourceComment is HSSFComment hssfComment)
            {
                var clientAnchor = hssfComment.ClientAnchor;
                if (clientAnchor != null)
                {
                    comment.From.Column = clientAnchor.Col1;
                    comment.From.Row = clientAnchor.Row1;
                    comment.To.Column = clientAnchor.Col2;
                    comment.To.Row = clientAnchor.Row2;
                }
            }

            comment.Visible = sourceComment.Visible;
        }
        catch
        {
        }
    }



    private void CopyCellStyle(ICellStyle sourceStyle, ExcelStyle targetStyle, HSSFWorkbook workbook)
    {
        var sourceFont = workbook.GetFontAt(sourceStyle.FontIndex);
        targetStyle.Font.Name = sourceFont.FontName;
        targetStyle.Font.Size = (float)sourceFont.FontHeightInPoints;
        targetStyle.Font.Bold = sourceFont.IsBold;
        targetStyle.Font.Italic = sourceFont.IsItalic;
        targetStyle.Font.Strike = sourceFont.IsStrikeout;

        if (sourceFont is HSSFFont hssfFont)
        {
            var color = workbook.GetCustomPalette().GetColor(hssfFont.Color);
            if (color?.RGB != null && color.RGB.Length == 3)
            {
                targetStyle.Font.Color.SetColor(Color.FromArgb(color.RGB[0], color.RGB[1], color.RGB[2]));
            }
        }

        if (sourceFont.Underline != FontUnderlineType.None)
        {
            targetStyle.Font.UnderLine = true;
        }

        targetStyle.HorizontalAlignment = ConvertHorizontalAlignment(sourceStyle.Alignment);
        targetStyle.VerticalAlignment = ConvertVerticalAlignment(sourceStyle.VerticalAlignment);
        targetStyle.WrapText = sourceStyle.WrapText;
        targetStyle.ShrinkToFit = sourceStyle.ShrinkToFit;

        targetStyle.TextRotation = sourceStyle.Rotation;

        if (sourceStyle.DataFormat > 0)
        {
            var format = workbook.CreateDataFormat();
            var formatString = format.GetFormat(sourceStyle.DataFormat);
            if (!string.IsNullOrEmpty(formatString))
            {
                targetStyle.Numberformat.Format = formatString;
            }
        }

        targetStyle.Border.Top.Style = ConvertBorderStyle(sourceStyle.BorderTop);
        targetStyle.Border.Bottom.Style = ConvertBorderStyle(sourceStyle.BorderBottom);
        targetStyle.Border.Left.Style = ConvertBorderStyle(sourceStyle.BorderLeft);
        targetStyle.Border.Right.Style = ConvertBorderStyle(sourceStyle.BorderRight);

        if (targetStyle.Border.Top.Style != ExcelBorderStyle.None)
            SetBorderColor(targetStyle.Border.Top.Color, sourceStyle.TopBorderColor, workbook);
        if (targetStyle.Border.Bottom.Style != ExcelBorderStyle.None)
            SetBorderColor(targetStyle.Border.Bottom.Color, sourceStyle.BottomBorderColor, workbook);
        if (targetStyle.Border.Left.Style != ExcelBorderStyle.None)
            SetBorderColor(targetStyle.Border.Left.Color, sourceStyle.LeftBorderColor, workbook);
        if (targetStyle.Border.Right.Style != ExcelBorderStyle.None)
            SetBorderColor(targetStyle.Border.Right.Color, sourceStyle.RightBorderColor, workbook);

        if (sourceStyle.FillPattern != FillPattern.NoFill)
        {
            targetStyle.Fill.PatternType = ConvertFillPattern(sourceStyle.FillPattern);

            if (sourceStyle is HSSFCellStyle hssfStyle)
            {
                var fgColor = workbook.GetCustomPalette().GetColor(sourceStyle.FillForegroundColor);
                if (fgColor?.RGB != null && fgColor.RGB.Length == 3)
                {
                    var color = Color.FromArgb(fgColor.RGB[0], fgColor.RGB[1], fgColor.RGB[2]);

                    if (sourceStyle.FillPattern == FillPattern.SolidForeground)
                    {
                        targetStyle.Fill.BackgroundColor.SetColor(color);
                    }
                    else
                    {
                        targetStyle.Fill.BackgroundColor.SetColor(color);
                    }
                }

                if (sourceStyle.FillPattern != FillPattern.SolidForeground)
                {
                    var bgColor = workbook.GetCustomPalette().GetColor(sourceStyle.FillBackgroundColor);
                    if (bgColor?.RGB != null && bgColor.RGB.Length == 3)
                    {
                        targetStyle.Fill.PatternColor.SetColor(Color.FromArgb(bgColor.RGB[0], bgColor.RGB[1], bgColor.RGB[2]));
                    }
                }
            }
        }

        targetStyle.Locked = sourceStyle.IsLocked;
        targetStyle.Hidden = sourceStyle.IsHidden;
    }

    private void SetBorderColor(ExcelColor excelColor, short colorIndex, HSSFWorkbook workbook)
    {
        var color = workbook.GetCustomPalette().GetColor(colorIndex);
        if (color?.RGB != null && color.RGB.Length == 3)
        {
            excelColor.SetColor(Color.FromArgb(color.RGB[0], color.RGB[1], color.RGB[2]));
        }
    }



    private ExcelHorizontalAlignment ConvertHorizontalAlignment(HorizontalAlignment alignment)
    {
        return alignment switch
        {
            HorizontalAlignment.Left => ExcelHorizontalAlignment.Left,
            HorizontalAlignment.Center => ExcelHorizontalAlignment.Center,
            HorizontalAlignment.Right => ExcelHorizontalAlignment.Right,
            HorizontalAlignment.Fill => ExcelHorizontalAlignment.Fill,
            HorizontalAlignment.Justify => ExcelHorizontalAlignment.Justify,
            HorizontalAlignment.CenterSelection => ExcelHorizontalAlignment.CenterContinuous,
            HorizontalAlignment.Distributed => ExcelHorizontalAlignment.Distributed,
            _ => ExcelHorizontalAlignment.General
        };
    }

    private ExcelVerticalAlignment ConvertVerticalAlignment(VerticalAlignment alignment)
    {
        return alignment switch
        {
            VerticalAlignment.Top => ExcelVerticalAlignment.Top,
            VerticalAlignment.Center => ExcelVerticalAlignment.Center,
            VerticalAlignment.Bottom => ExcelVerticalAlignment.Bottom,
            VerticalAlignment.Justify => ExcelVerticalAlignment.Justify,
            VerticalAlignment.Distributed => ExcelVerticalAlignment.Distributed,
            _ => ExcelVerticalAlignment.Bottom
        };
    }

    private ExcelBorderStyle ConvertBorderStyle(BorderStyle borderStyle)
    {
        return borderStyle switch
        {
            BorderStyle.None => ExcelBorderStyle.None,
            BorderStyle.Thin => ExcelBorderStyle.Thin,
            BorderStyle.Medium => ExcelBorderStyle.Medium,
            BorderStyle.Dashed => ExcelBorderStyle.Dashed,
            BorderStyle.Dotted => ExcelBorderStyle.Dotted,
            BorderStyle.Thick => ExcelBorderStyle.Thick,
            BorderStyle.Double => ExcelBorderStyle.Double,
            BorderStyle.Hair => ExcelBorderStyle.Hair,
            BorderStyle.MediumDashed => ExcelBorderStyle.MediumDashed,
            BorderStyle.DashDot => ExcelBorderStyle.DashDot,
            BorderStyle.MediumDashDot => ExcelBorderStyle.MediumDashDot,
            BorderStyle.DashDotDot => ExcelBorderStyle.DashDotDot,
            BorderStyle.MediumDashDotDot => ExcelBorderStyle.MediumDashDotDot,
            BorderStyle.SlantedDashDot => ExcelBorderStyle.DashDot,
            _ => ExcelBorderStyle.None
        };
    }

    private ExcelFillStyle ConvertFillPattern(FillPattern fillPattern)
    {
        return fillPattern switch
        {
            FillPattern.NoFill => ExcelFillStyle.None,
            FillPattern.SolidForeground => ExcelFillStyle.Solid,
            FillPattern.FineDots => ExcelFillStyle.DarkGray,
            FillPattern.AltBars => ExcelFillStyle.DarkVertical,
            FillPattern.SparseDots => ExcelFillStyle.LightGray,
            FillPattern.ThickHorizontalBands => ExcelFillStyle.DarkHorizontal,
            FillPattern.ThickVerticalBands => ExcelFillStyle.DarkVertical,
            FillPattern.ThickBackwardDiagonals => ExcelFillStyle.DarkDown,
            FillPattern.ThickForwardDiagonals => ExcelFillStyle.DarkUp,
            FillPattern.BigSpots => ExcelFillStyle.DarkGrid,
            FillPattern.Bricks => ExcelFillStyle.DarkTrellis,
            FillPattern.ThinHorizontalBands => ExcelFillStyle.LightHorizontal,
            FillPattern.ThinVerticalBands => ExcelFillStyle.LightVertical,
            FillPattern.ThinBackwardDiagonals => ExcelFillStyle.LightDown,
            FillPattern.ThinForwardDiagonals => ExcelFillStyle.LightUp,
            FillPattern.Squares => ExcelFillStyle.LightGrid,
            FillPattern.Diamonds => ExcelFillStyle.LightTrellis,
            _ => ExcelFillStyle.None
        };
    }



    private void CopyFreezePanes(ISheet sourceSheet, ExcelWorksheet targetSheet)
    {
        try
        {
            var paneInfo = sourceSheet.PaneInformation;
            if (paneInfo != null && paneInfo.IsFreezePane())
            {
                targetSheet.View.FreezePanes(
                    paneInfo.HorizontalSplitPosition + 1,
                    paneInfo.VerticalSplitPosition + 1);
            }
        }
        catch
        {
        }
    }

    private void CopyPrintSetup(ISheet sourceSheet, ExcelWorksheet targetSheet)
    {
        try
        {
            var sourcePrintSetup = sourceSheet.PrintSetup;
            var targetPrintSetup = targetSheet.PrinterSettings;

            if (sourcePrintSetup.PaperSize > 0)
            {
                targetPrintSetup.PaperSize = (ePaperSize)sourcePrintSetup.PaperSize;
            }

            targetPrintSetup.Orientation = sourcePrintSetup.Landscape
                ? eOrientation.Landscape
                : eOrientation.Portrait;

            if (sourcePrintSetup.Scale > 0)
            {
                targetPrintSetup.Scale = sourcePrintSetup.Scale;
            }

            targetSheet.PrinterSettings.LeftMargin = sourceSheet.GetMargin(MarginType.LeftMargin);
            targetSheet.PrinterSettings.RightMargin = sourceSheet.GetMargin(MarginType.RightMargin);
            targetSheet.PrinterSettings.TopMargin = sourceSheet.GetMargin(MarginType.TopMargin);
            targetSheet.PrinterSettings.BottomMargin = sourceSheet.GetMargin(MarginType.BottomMargin);
            targetSheet.PrinterSettings.HeaderMargin = sourceSheet.GetMargin(MarginType.HeaderMargin);
            targetSheet.PrinterSettings.FooterMargin = sourceSheet.GetMargin(MarginType.FooterMargin);
        }
        catch
        {
        }
    }

    private void CopyGrouping(ISheet sourceSheet, ExcelWorksheet targetSheet)
    {
        try
        {
            for (int i = sourceSheet.FirstRowNum; i <= sourceSheet.LastRowNum; i++)
            {
                var row = sourceSheet.GetRow(i);
                if (row != null && row.OutlineLevel > 0)
                {
                    targetSheet.Row(i + 1).OutlineLevel = row.OutlineLevel;
                }
            }

            var firstRow = sourceSheet.GetRow(sourceSheet.FirstRowNum);
            if (firstRow != null)
            {
                for (int col = 0; col < firstRow.LastCellNum; col++)
                {
                    var outlineLevel = sourceSheet.GetColumnOutlineLevel(col);
                    if (outlineLevel > 0)
                    {
                        targetSheet.Column(col + 1).OutlineLevel = outlineLevel;
                    }
                }
            }
        }
        catch
        {
        }
    }

    private void CopySheetProperties(ISheet sourceSheet, ExcelWorksheet targetSheet)
    {
        try
        {
            if (sourceSheet is HSSFSheet hssfSheet)
            {
                targetSheet.Hidden = hssfSheet.Workbook.IsSheetHidden(hssfSheet.Workbook.GetSheetIndex(hssfSheet))
                    ? eWorkSheetHidden.Hidden
                    : eWorkSheetHidden.Visible;
            }

            targetSheet.View.ShowGridLines = sourceSheet.DisplayGridlines;
            targetSheet.View.ShowHeaders = sourceSheet.DisplayRowColHeadings;
        }
        catch
        {
        }
    }

    private void CopyPictures(ISheet sourceSheet, ExcelWorksheet targetSheet, HSSFWorkbook workbook)
    {
        try
        {
            if (sourceSheet is HSSFSheet hssfSheet)
            {
                var patriarch = hssfSheet.DrawingPatriarch as HSSFPatriarch;
                if (patriarch != null)
                {
                    foreach (var shape in patriarch.Children)
                    {
                        if (shape is HSSFPicture picture)
                        {
                            var pictureData = picture.PictureData;
                            if (pictureData?.Data != null)
                            {
                                var anchor = picture.ClientAnchor;
                                if (anchor != null)
                                {
                                    var excelPicture = targetSheet.Drawings.AddPicture(
                                        $"Picture_{Guid.NewGuid()}",
                                        new MemoryStream(pictureData.Data));

                                    excelPicture.From.Column = anchor.Col1;
                                    excelPicture.From.Row = anchor.Row1;
                                    excelPicture.From.ColumnOff = anchor.Dx1;
                                    excelPicture.From.RowOff = anchor.Dy1;
                                    excelPicture.To.Column = anchor.Col2;
                                    excelPicture.To.Row = anchor.Row2;
                                    excelPicture.To.ColumnOff = anchor.Dx2;
                                    excelPicture.To.RowOff = anchor.Dy2;
                                }
                            }
                        }
                    }
                }
            }
        }
        catch
        {
        }
    }

    private void CopySheetProtection(ISheet sourceSheet, ExcelWorksheet targetSheet)
    {
        try
        {
            if (sourceSheet.Protect)
            {
                targetSheet.Protection.IsProtected = true;
                targetSheet.Protection.AllowSelectLockedCells = true;
                targetSheet.Protection.AllowSelectUnlockedCells = true;
            }
        }
        catch
        {
        }
    }

    private void CopyNamedRanges(HSSFWorkbook sourceWorkbook, ExcelPackage targetPackage)
    {
    }

}
