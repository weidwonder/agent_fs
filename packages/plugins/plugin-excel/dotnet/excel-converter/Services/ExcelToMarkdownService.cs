using ExcelConverter.Analyzers;
using ExcelConverter.Models;

namespace ExcelConverter.Services;

public class ExcelToMarkdownService
{
    private readonly IExcelLoaderService _loader;
    private readonly IRegionManagerService _regionManager;
    private readonly TableDetector _tableDetector;
    private readonly OverviewGenerator _overviewGenerator;

    public ExcelToMarkdownService(IExcelLoaderService loader, IRegionManagerService regionManager)
    {
        _loader = loader;
        _regionManager = regionManager;
        _tableDetector = new TableDetector(regionManager);
        _overviewGenerator = new OverviewGenerator(regionManager);
    }

    public ConvertResponse Convert(string filePath)
    {
        _loader.Open(filePath);
        try
        {
            var response = new ConvertResponse();
            var sheetNames = _loader.GetSheetNames();

            for (int i = 0; i < sheetNames.Count; i++)
            {
                var sheetName = sheetNames[i];
                var sheetResult = new SheetResult
                {
                    Name = sheetName,
                    Index = i
                };

                var regions = _regionManager.SplitWorksheet(_loader, sheetName);

                foreach (var region in regions)
                {
                    var tableResult = _tableDetector.DetectTables(_loader, sheetName, "border", region, false);
                    var tables = tableResult.Tables.Select(t => t.Range).ToList();
                    var range = _regionManager.ToRangeString(region);

                    var overview = _overviewGenerator.GenerateOverview(
                        _loader,
                        region,
                        sheetName,
                        compressionMode: "none",
                        thresholdMode: "any",
                        thresholdValue: 0.8,
                        detailRegion: null,
                        showStyle: false);

                    sheetResult.Regions.Add(new RegionResult
                    {
                        Range = range,
                        Tables = tables,
                        Markdown = overview.Overview,
                        SearchableEntries = BuildSearchableEntries(sheetName, range, tables, overview.Overview)
                    });
                }

                response.Sheets.Add(sheetResult);
            }

            return response;
        }
        finally
        {
            _loader.Close();
        }
    }

    private static List<SearchableEntryResult> BuildSearchableEntries(
        string sheetName,
        string regionRange,
        List<string> tables,
        string markdown)
    {
        var entries = new List<SearchableEntryResult>();
        var regionLocator = $"sheet:{sheetName}/range:{regionRange}";
        var normalizedMarkdown = NormalizeSearchText(markdown);
        if (!string.IsNullOrWhiteSpace(normalizedMarkdown))
        {
            entries.Add(new SearchableEntryResult
            {
                Text = normalizedMarkdown,
                Locator = regionLocator
            });
        }

        foreach (var tableRange in tables.Distinct())
        {
            entries.Add(new SearchableEntryResult
            {
                Text = $"表格 {tableRange}",
                Locator = $"sheet:{sheetName}/range:{tableRange}"
            });
        }

        return entries;
    }

    private static string NormalizeSearchText(string value)
    {
        var normalized = value
            .Replace("|", " ")
            .Replace("#", " ")
            .Replace("\r", " ")
            .Replace("\n", " ")
            .Trim();

        return string.Join(" ", normalized.Split(' ', StringSplitOptions.RemoveEmptyEntries));
    }
}
