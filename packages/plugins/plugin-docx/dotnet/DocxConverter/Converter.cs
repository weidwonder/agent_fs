using System.IO.Compression;
using System.Runtime.Versioning;
using System.Text;
using System.Text.RegularExpressions;
using NPOI.XWPF.UserModel;

namespace DocxConverter;

public class Converter
{
    public ConvertData Convert(string filePath)
    {
        if (!File.Exists(filePath))
        {
            throw new DocxException(ErrorCodes.FileNotFound, "文件不存在");
        }

        var ext = Path.GetExtension(filePath).ToLowerInvariant();
        return ext switch
        {
            ".docx" => ConvertDocx(filePath),
            ".doc" => ConvertDoc(filePath),
            _ => throw new DocxException(ErrorCodes.UnsupportedFormat, "不支持的格式"),
        };
    }

    private ConvertData ConvertDocx(string filePath)
    {
        string? normalizedPath = null;

        try
        {
            normalizedPath = NormalizeDocxForNpoiIfNeeded(filePath);
            var inputPath = normalizedPath ?? filePath;

            using var stream = File.OpenRead(inputPath);
            var document = new XWPFDocument(stream);
            var builder = new MarkdownBuilder();

            var paraIndex = 0;
            var tableIndex = 0;

            foreach (var element in document.BodyElements)
            {
                if (element is XWPFParagraph paragraph)
                {
                    var markdown = RenderParagraph(paragraph, paraIndex, out var locator);
                    builder.AppendBlock(markdown, locator);
                    paraIndex += 1;
                    continue;
                }

                if (element is XWPFTable table)
                {
                    var markdown = RenderTable(table);
                    builder.AppendBlock(markdown, $"table:{tableIndex}");
                    tableIndex += 1;
                }
            }

            return builder.Build();
        }
        catch (DocxException)
        {
            throw;
        }
        catch
        {
            return ConvertWithLibreOfficeText(filePath);
        }
        finally
        {
            if (normalizedPath != null && File.Exists(normalizedPath))
            {
                File.Delete(normalizedPath);
            }
        }
    }

    private string RenderParagraph(XWPFParagraph paragraph, int paraIndex, out string locator)
    {
        var text = paragraph.Text?.Trim() ?? string.Empty;
        var imageCount = 0;

        foreach (var run in paragraph.Runs)
        {
            var pictures = run.GetEmbeddedPictures();
            if (pictures == null) continue;

            foreach (var _ in pictures)
            {
                text = string.IsNullOrWhiteSpace(text)
                    ? $"![image](img-{paraIndex}-{imageCount})"
                    : $"{text} ![image](img-{paraIndex}-{imageCount})";
                imageCount += 1;
            }
        }

        var headingLevel = TryGetHeadingLevel(paragraph);
        if (headingLevel > 0)
        {
            locator = $"heading:{headingLevel}:{text}";
            return $"{new string('#', headingLevel)} {text}".Trim();
        }

        locator = $"para:{paraIndex}";
        return text;
    }

    private int TryGetHeadingLevel(XWPFParagraph paragraph)
    {
        var style = paragraph.Style ?? string.Empty;
        var match = Regex.Match(style, @"Heading(\d)", RegexOptions.IgnoreCase);
        if (match.Success && int.TryParse(match.Groups[1].Value, out var level))
        {
            return level;
        }
        return 0;
    }

    private string RenderTable(XWPFTable table)
    {
        if (table.Rows.Count == 0) return string.Empty;

        var sb = new StringBuilder();
        var headerCells = table.Rows[0].GetTableCells().Select(cell => CleanCell(cell.GetText())).ToList();
        sb.Append("| ").Append(string.Join(" | ", headerCells)).Append(" |");
        sb.AppendLine();
        sb.Append("| ").Append(string.Join(" | ", headerCells.Select(_ => "---"))).Append(" |");

        for (var i = 1; i < table.Rows.Count; i += 1)
        {
            var rowCells = table.Rows[i].GetTableCells().Select(cell => CleanCell(cell.GetText())).ToList();
            sb.AppendLine();
            sb.Append("| ").Append(string.Join(" | ", rowCells)).Append(" |");
        }

        return sb.ToString();
    }

    private string CleanCell(string? text)
    {
        return (text ?? string.Empty).Replace("\r", "").Replace("\n", " ").Trim();
    }

    private sealed class MarkdownBuilder
    {
        private readonly List<string> lines = new();
        private readonly List<Mapping> mappings = new();

        public void AppendBlock(string markdown, string locator)
        {
            if (string.IsNullOrWhiteSpace(markdown)) return;

            if (lines.Count > 0)
            {
                lines.Add(string.Empty);
            }

            var startLine = lines.Count + 1;
            var blockLines = markdown.Split('\n');
            lines.AddRange(blockLines);
            var endLine = lines.Count;

            mappings.Add(new Mapping(startLine, endLine, locator));
        }

        public ConvertData Build()
        {
            return new ConvertData(string.Join("\n", lines), mappings);
        }
    }

    private ConvertData ConvertDoc(string filePath)
    {
        var tempDir = Path.Combine(Path.GetTempPath(), $"agent-fs-docx-{Guid.NewGuid()}");
        Directory.CreateDirectory(tempDir);

        try
        {
            var docxPath = ConvertDocToDocx(filePath, tempDir);
            return ConvertDocx(docxPath);
        }
        finally
        {
            if (Directory.Exists(tempDir))
            {
                Directory.Delete(tempDir, true);
            }
        }
    }

    private string ConvertDocToDocx(string docPath, string outDir)
    {
        if (OperatingSystem.IsWindows())
        {
            return ConvertWithWordCom(docPath, outDir);
        }

        return ConvertWithLibreOffice(docPath, outDir);
    }

    private string ConvertWithLibreOffice(string docPath, string outDir)
    {
        return ConvertWithLibreOffice(docPath, outDir, "docx", ".docx");
    }

    private ConvertData ConvertWithLibreOfficeText(string filePath)
    {
        var tempDir = Path.Combine(Path.GetTempPath(), $"agent-fs-docx-text-{Guid.NewGuid()}");
        Directory.CreateDirectory(tempDir);

        try
        {
            var txtPath = ConvertWithLibreOffice(filePath, tempDir, "txt:Text", ".txt");
            var content = File.ReadAllText(txtPath);
            return BuildTextFallback(content);
        }
        finally
        {
            if (Directory.Exists(tempDir))
            {
                Directory.Delete(tempDir, true);
            }
        }
    }

    private string ConvertWithLibreOffice(
        string inputPath,
        string outDir,
        string convertTo,
        string outputExt)
    {
        var startInfo = new System.Diagnostics.ProcessStartInfo
        {
            FileName = "soffice",
            Arguments = $"--headless --convert-to {convertTo} --outdir \"{outDir}\" \"{inputPath}\"",
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
            CreateNoWindow = true,
        };

        try
        {
            using var process = System.Diagnostics.Process.Start(startInfo);
            if (process == null)
            {
                throw new DocxException(ErrorCodes.FallbackUnavailable, "LibreOffice 启动失败");
            }

            var stderr = process.StandardError.ReadToEnd();
            process.WaitForExit();

            var outputPath = Path.Combine(
                outDir,
                Path.GetFileNameWithoutExtension(inputPath) + outputExt);

            if (process.ExitCode != 0 || !File.Exists(outputPath))
            {
                var detail = Regex.Replace(stderr, @"\s+", " ").Trim();
                var message = string.IsNullOrWhiteSpace(detail)
                    ? "LibreOffice 转换失败"
                    : $"LibreOffice 转换失败: {detail}";
                throw new DocxException(ErrorCodes.FallbackFailed, message);
            }

            return outputPath;
        }
        catch (System.ComponentModel.Win32Exception)
        {
            throw new DocxException(ErrorCodes.FallbackUnavailable, "未找到 LibreOffice (soffice)");
        }
    }

    private ConvertData BuildTextFallback(string content)
    {
        var normalized = content.Replace("\r\n", "\n").Replace('\r', '\n');
        var rawLines = normalized.Split('\n');
        var lines = new List<string>();
        var mappings = new List<Mapping>();
        var paraIndex = 0;

        foreach (var rawLine in rawLines)
        {
            var line = rawLine.TrimEnd();
            if (string.IsNullOrWhiteSpace(line))
            {
                if (lines.Count > 0 && lines[^1] != string.Empty)
                {
                    lines.Add(string.Empty);
                }
                continue;
            }

            var lineNo = lines.Count + 1;
            lines.Add(line);
            mappings.Add(new Mapping(lineNo, lineNo, $"para:{paraIndex}"));
            paraIndex += 1;
        }

        return new ConvertData(string.Join("\n", lines), mappings);
    }

    [SupportedOSPlatform("windows")]
    private string ConvertWithWordCom(string docPath, string outDir)
    {
        var wordType = Type.GetTypeFromProgID("Word.Application");
        if (wordType == null)
        {
            throw new DocxException(ErrorCodes.FallbackUnavailable, "未安装 Microsoft Word");
        }

        dynamic? wordApp = null;
        dynamic? doc = null;
        var outputPath = Path.Combine(outDir, Path.GetFileNameWithoutExtension(docPath) + ".docx");

        try
        {
            wordApp = Activator.CreateInstance(wordType);
            if (wordApp is null)
            {
                throw new DocxException(ErrorCodes.FallbackFailed, "Word COM 启动失败");
            }
            wordApp.Visible = false;
            doc = wordApp.Documents.Open(docPath, ReadOnly: true, Visible: false);
            const int wdFormatXMLDocument = 16;
            doc.SaveAs2(outputPath, wdFormatXMLDocument);
            doc.Close(false);
            wordApp.Quit();
        }
        catch
        {
            throw new DocxException(ErrorCodes.FallbackFailed, "Word COM 转换失败");
        }
        finally
        {
            if (doc != null) System.Runtime.InteropServices.Marshal.FinalReleaseComObject(doc);
            if (wordApp != null) System.Runtime.InteropServices.Marshal.FinalReleaseComObject(wordApp);
        }

        if (!File.Exists(outputPath))
        {
            throw new DocxException(ErrorCodes.FallbackFailed, "Word COM 未生成 docx");
        }

        return outputPath;
    }

    private string? NormalizeDocxForNpoiIfNeeded(string filePath)
    {
        using var archive = ZipFile.OpenRead(filePath);
        var normalizedEntries = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);

        foreach (var entry in archive.Entries)
        {
            if (!entry.FullName.EndsWith(".xml", StringComparison.OrdinalIgnoreCase))
            {
                continue;
            }

            string xmlContent;
            using (var reader = new StreamReader(entry.Open(), Encoding.UTF8, true))
            {
                xmlContent = reader.ReadToEnd();
            }

            if (!NeedsJcNormalization(xmlContent))
            {
                continue;
            }

            normalizedEntries[entry.FullName] = NormalizeJcValues(xmlContent);
        }

        if (normalizedEntries.Count == 0) return null;

        var normalizedPath = Path.Combine(Path.GetTempPath(), $"agent-fs-docx-normalized-{Guid.NewGuid()}.docx");

        using var output = ZipFile.Open(normalizedPath, ZipArchiveMode.Create);
        foreach (var entry in archive.Entries)
        {
            if (string.IsNullOrEmpty(entry.Name) && entry.FullName.EndsWith('/'))
            {
                continue;
            }

            var outputEntry = output.CreateEntry(entry.FullName, CompressionLevel.Optimal);
            using var outputStream = outputEntry.Open();

            if (normalizedEntries.TryGetValue(entry.FullName, out var normalizedXml))
            {
                using var writer = new StreamWriter(outputStream, new UTF8Encoding(false));
                writer.Write(normalizedXml);
            }
            else
            {
                using var inputStream = entry.Open();
                inputStream.CopyTo(outputStream);
            }
        }

        return normalizedPath;
    }

    private static bool NeedsJcNormalization(string xmlContent)
    {
        return xmlContent.Contains("w:val=\"start\"")
            || xmlContent.Contains("w:val=\"end\"")
            || xmlContent.Contains("w:val='start'")
            || xmlContent.Contains("w:val='end'");
    }

    private static string NormalizeJcValues(string xmlContent)
    {
        const string pattern = "(<w:jc[^>]*\\bw:val=)(['\"])(start|end)\\2";
        return Regex.Replace(xmlContent, pattern, match =>
        {
            var value = match.Groups[3].Value == "start" ? "left" : "right";
            return $"{match.Groups[1].Value}{match.Groups[2].Value}{value}{match.Groups[2].Value}";
        });
    }
}
