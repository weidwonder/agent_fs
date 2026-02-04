using System.IO.Compression;
using System.Text;
using DocxConverter;

namespace DocxConverter.Tests;

public class ConverterStylesTests
{
    [Fact]
    public void Convert_AllowsStartAndEndJustificationInStyles()
    {
        var docxPath = CreateDocx(DocumentXml, StylesWithStartAndEnd);

        try
        {
            var converter = new Converter();
            var data = converter.Convert(docxPath);

            Assert.Equal("Hello", data.Markdown);
            Assert.Single(data.Mappings);
        }
        finally
        {
            if (File.Exists(docxPath))
            {
                File.Delete(docxPath);
            }
        }
    }

    [Fact]
    public void Convert_AllowsStartJustificationInDocument()
    {
        var docxPath = CreateDocx(DocumentWithStartJustification, StylesWithoutStart);

        try
        {
            var converter = new Converter();
            var data = converter.Convert(docxPath);

            Assert.Equal("Hello", data.Markdown);
            Assert.Single(data.Mappings);
        }
        finally
        {
            if (File.Exists(docxPath))
            {
                File.Delete(docxPath);
            }
        }
    }

    private static string CreateDocx(string documentXml, string stylesXml)
    {
        var docxPath = Path.Combine(Path.GetTempPath(), $"agent-fs-test-{Guid.NewGuid()}.docx");

        using var archive = ZipFile.Open(docxPath, ZipArchiveMode.Create);
        WriteEntry(archive, "[Content_Types].xml", ContentTypesXml);
        WriteEntry(archive, "_rels/.rels", RootRelsXml);
        WriteEntry(archive, "word/document.xml", documentXml);
        WriteEntry(archive, "word/_rels/document.xml.rels", DocumentRelsXml);
        WriteEntry(archive, "word/styles.xml", stylesXml);

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

    private const string DocumentXml = """
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p>
      <w:r><w:t>Hello</w:t></w:r>
    </w:p>
  </w:body>
</w:document>
""";

    private const string DocumentWithStartJustification = """
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p>
      <w:pPr><w:jc w:val="start"/></w:pPr>
      <w:r><w:t>Hello</w:t></w:r>
    </w:p>
  </w:body>
</w:document>
""";

    private const string StylesWithoutStart = """
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:style w:type="paragraph" w:styleId="Normal">
    <w:name w:val="Normal"/>
  </w:style>
</w:styles>
""";

    private const string StylesWithStartAndEnd = """
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:style w:type="paragraph" w:styleId="Normal">
    <w:name w:val="Normal"/>
    <w:pPr>
      <w:jc w:val="start"/>
    </w:pPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="NormalEnd">
    <w:name w:val="NormalEnd"/>
    <w:pPr>
      <w:jc w:val="end"/>
    </w:pPr>
  </w:style>
</w:styles>
""";
}
