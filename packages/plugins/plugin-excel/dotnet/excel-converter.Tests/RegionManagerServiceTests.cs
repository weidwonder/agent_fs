using ExcelConverter.Services;
using Xunit;

namespace ExcelConverter.Tests;

public class RegionManagerServiceTests
{
    [Fact]
    public void 解析范围_返回正确区域()
    {
        var service = new RegionManagerService();

        var region = service.ParseRange("B2:D3");

        Assert.Equal(2, region.StartRow);
        Assert.Equal(2, region.StartColumn);
        Assert.Equal(3, region.EndRow);
        Assert.Equal(4, region.EndColumn);
        Assert.Equal("B2:D3", region.RangeString);
    }

    [Fact]
    public void 转换范围_返回正确字符串()
    {
        var service = new RegionManagerService();
        var region = service.ParseRange("A1");

        var range = service.ToRangeString(region);

        Assert.Equal("A1", range);
    }
}
