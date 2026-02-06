using ExcelConverter.Services;
using OfficeOpenXml;
using Xunit;

namespace ExcelConverter.Tests;

public class ExcelToMarkdownServiceTests
{
    [Fact]
    public void 转换Excel_生成区域Markdown与表格信息()
    {
        ExcelPackage.License.SetNonCommercialPersonal("agent-fs");
        var filePath = CreateTempXlsx();

        try
        {
            var loader = new ExcelLoaderService(new XlsConverterService());
            var regionManager = new RegionManagerService();
            var service = new ExcelToMarkdownService(loader, regionManager);

            var response = service.Convert(filePath);

            Assert.Single(response.Sheets);
            var sheet = response.Sheets[0];
            Assert.Equal("Sheet1", sheet.Name);
            Assert.Single(sheet.Regions);

            var region = sheet.Regions[0];
            Assert.Equal("A1:B2", region.Range);
            Assert.Empty(region.Tables);
            Assert.Contains("Range[A1:B2]:", region.Markdown);
            Assert.Contains("|A|B|", region.Markdown);
            Assert.NotEmpty(region.SearchableEntries);
            Assert.Contains(region.SearchableEntries, entry => entry.Locator == "sheet:Sheet1/range:A1:B2");
        }
        finally
        {
            File.Delete(filePath);
        }
    }

    private static string CreateTempXlsx()
    {
        var tempPath = Path.Combine(Path.GetTempPath(), $"excel-md-test-{Guid.NewGuid():N}.xlsx");

        using var package = new ExcelPackage();
        var sheet = package.Workbook.Worksheets.Add("Sheet1");
        sheet.Cells[1, 1].Value = "A";
        sheet.Cells[1, 2].Value = "B";
        sheet.Cells[2, 1].Value = "C";
        sheet.Cells[2, 2].Value = "D";

        package.SaveAs(new FileInfo(tempPath));
        return tempPath;
    }
}
