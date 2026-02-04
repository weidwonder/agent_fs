using ExcelConverter.Services;
using NPOI.HSSF.UserModel;
using OfficeOpenXml;
using Xunit;

namespace ExcelConverter.Tests;

public class XlsConverterServiceTests
{
    [Fact]
    public void 转换Xls_保留单元格内容()
    {
        ExcelPackage.License.SetNonCommercialPersonal("agent-fs");

        using var workbook = new HSSFWorkbook();
        var sheet = workbook.CreateSheet("Sheet1");
        var row = sheet.CreateRow(0);
        row.CreateCell(0).SetCellValue("hello");

        using var xlsStream = new MemoryStream();
        workbook.Write(xlsStream, true);
        xlsStream.Position = 0;

        using var xlsxStream = new MemoryStream();
        var converter = new XlsConverterService();

        converter.Convert(xlsStream, xlsxStream);
        xlsxStream.Position = 0;

        using var package = new ExcelPackage(xlsxStream);
        var value = package.Workbook.Worksheets[0].Cells[1, 1].Text;

        Assert.Equal("hello", value);
    }
}
