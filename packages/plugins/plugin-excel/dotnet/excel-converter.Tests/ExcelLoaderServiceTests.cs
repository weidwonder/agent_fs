using ExcelConverter.Models;
using ExcelConverter.Services;
using OfficeOpenXml;
using OfficeOpenXml.Style;
using Xunit;

namespace ExcelConverter.Tests;

public class ExcelLoaderServiceTests
{
    [Fact]
    public void 打开文件_读取工作表与单元格()
    {
        ExcelPackage.License.SetNonCommercialPersonal("agent-fs");
        var filePath = CreateTempXlsx();

        try
        {
            var loader = new ExcelLoaderService(new XlsConverterService());
            loader.Open(filePath);

            var sheetNames = loader.GetSheetNames();
            Assert.Contains("Sheet1", sheetNames);

            var bounds = loader.GetSheetBounds("Sheet1");
            Assert.Equal("A1:B2", bounds.RangeString);

            var cell = loader.GetCellInfo(1, 1, "Sheet1");
            Assert.Equal("标题", cell.Value?.ToString());
            Assert.Equal(CellDataType.Text, cell.DataType);

            loader.Close();
        }
        finally
        {
            File.Delete(filePath);
        }
    }

    [Fact]
    public void 仅边框扩展区域时_SheetBounds应按有值单元格计算()
    {
        ExcelPackage.License.SetNonCommercialPersonal("agent-fs");
        var tempPath = Path.Combine(Path.GetTempPath(), $"excel-style-only-{Guid.NewGuid():N}.xlsx");

        try
        {
            using (var package = new ExcelPackage())
            {
                var sheet = package.Workbook.Worksheets.Add("Sheet1");
                sheet.Cells[1, 1].Value = "标题";
                sheet.Cells[2, 2].Value = 100;

                var styleOnlyRange = sheet.Cells[1, 14, 2000, 14];
                styleOnlyRange.Style.Border.Left.Style = ExcelBorderStyle.Thin;
                styleOnlyRange.Style.Border.Right.Style = ExcelBorderStyle.Thin;
                styleOnlyRange.Style.Border.Top.Style = ExcelBorderStyle.Thin;
                styleOnlyRange.Style.Border.Bottom.Style = ExcelBorderStyle.Thin;

                package.SaveAs(new FileInfo(tempPath));
            }

            var loader = new ExcelLoaderService(new XlsConverterService());
            loader.Open(tempPath);

            var bounds = loader.GetSheetBounds("Sheet1");
            Assert.Equal("A1:B2", bounds.RangeString);
            Assert.Equal(2, bounds.EndRow);
            Assert.Equal(2, bounds.EndColumn);

            loader.Close();
        }
        finally
        {
            File.Delete(tempPath);
        }
    }

    private static string CreateTempXlsx()
    {
        var tempPath = Path.Combine(Path.GetTempPath(), $"excel-test-{Guid.NewGuid():N}.xlsx");

        using var package = new ExcelPackage();
        var sheet = package.Workbook.Worksheets.Add("Sheet1");
        sheet.Cells[1, 1].Value = "标题";
        sheet.Cells[1, 2].Value = "值";
        sheet.Cells[2, 1].Value = "A";
        sheet.Cells[2, 2].Value = 100;

        package.SaveAs(new FileInfo(tempPath));
        return tempPath;
    }
}
