using System.IO.Compression;
using System.Text;
using DocxConverter;

namespace DocxConverter.Tests;

public class ConverterPageMarkersTests
{
    [Fact]
    public void Convert_WithRenderedPageBreaks_IgnoresPageInfoAndKeepsLegacyLocator()
    {
        var docxPath = CreateDocx("""
<w:p><w:r><w:t>第一页</w:t></w:r><w:r><w:lastRenderedPageBreak/></w:r></w:p>
<w:p><w:r><w:t>第二页</w:t></w:r></w:p>
""");

        try
        {
            var converter = new Converter();
            var data = converter.Convert(docxPath);

            Assert.DoesNotContain("<!-- page:", data.Markdown);
            Assert.Equal("para:0", data.Mappings[0].Locator);
            Assert.Equal("para:1", data.Mappings[1].Locator);
        }
        finally
        {
            File.Delete(docxPath);
        }
    }

    [Fact]
    public void Convert_WithoutRenderedPageBreaks_FallsBackToLegacyLocator()
    {
        var docxPath = CreateDocx("""
<w:p><w:r><w:t>只有一页</w:t></w:r></w:p>
<w:p><w:r><w:t>第二段</w:t></w:r></w:p>
""");

        try
        {
            var converter = new Converter();
            var data = converter.Convert(docxPath);

            Assert.DoesNotContain("<!-- page:", data.Markdown);
            Assert.Equal("para:0", data.Mappings[0].Locator);
            Assert.Equal("para:1", data.Mappings[1].Locator);
        }
        finally
        {
            File.Delete(docxPath);
        }
    }

    [Fact]
    public void Convert_TableAfterPageBreak_KeepsLegacyTableLocator()
    {
        var docxPath = CreateDocx("""
<w:p><w:r><w:t>第一页</w:t></w:r><w:r><w:lastRenderedPageBreak/></w:r></w:p>
<w:tbl>
  <w:tr>
    <w:tc><w:p><w:r><w:t>表头</w:t></w:r></w:p></w:tc>
  </w:tr>
  <w:tr>
    <w:tc><w:p><w:r><w:t>内容</w:t></w:r></w:p></w:tc>
  </w:tr>
</w:tbl>
""");

        try
        {
            var converter = new Converter();
            var data = converter.Convert(docxPath);

            Assert.Equal("table:0", data.Mappings.Last().Locator);
            Assert.DoesNotContain("<!-- page:", data.Markdown);
        }
        finally
        {
            File.Delete(docxPath);
        }
    }

    [Fact]
    public void Convert_CrossPageParagraph_KeepsLegacyParagraphLocator()
    {
        var docxPath = CreateDocx("""
<w:p>
  <w:r><w:t>第一页段落</w:t></w:r>
  <w:r><w:lastRenderedPageBreak/></w:r>
  <w:r><w:t>同段第二页内容</w:t></w:r>
</w:p>
<w:p><w:r><w:t>下一段</w:t></w:r></w:p>
""");

        try
        {
            var converter = new Converter();
            var data = converter.Convert(docxPath);

            Assert.Equal("para:0", data.Mappings[0].Locator);
            Assert.Equal("para:1", data.Mappings[1].Locator);
        }
        finally
        {
            File.Delete(docxPath);
        }
    }

    private static string CreateDocx(string bodyXml)
    {
        var docxPath = Path.Combine(Path.GetTempPath(), $"agent-fs-page-test-{Guid.NewGuid()}.docx");

        using var archive = ZipFile.Open(docxPath, ZipArchiveMode.Create);
        WriteEntry(archive, "[Content_Types].xml", ContentTypesXml);
        WriteEntry(archive, "_rels/.rels", RootRelsXml);
        WriteEntry(archive, "word/document.xml", $"""
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    {bodyXml}
  </w:body>
</w:document>
""");
        WriteEntry(archive, "word/_rels/document.xml.rels", DocumentRelsXml);
        WriteEntry(archive, "word/styles.xml", StylesXml);

        return docxPath;
    }

    private static void WriteEntry(ZipArchive archive, string entryName, string content)
    {
        var entry = archive.CreateEntry(entryName, CompressionLevel.Optimal);
        using var writer = new StreamWriter(entry.Open(), new UTF8Encoding(false));
        writer.Write(content);
    }

    private const string ContentTypesXml = """
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>
""";

    private const string RootRelsXml = """
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>
""";

    private const string DocumentRelsXml = """
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>
""";

    private const string StylesXml = """
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:style w:type="paragraph" w:styleId="Normal">
    <w:name w:val="Normal"/>
  </w:style>
</w:styles>
""";
}
