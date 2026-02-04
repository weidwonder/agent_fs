import { DocxPlugin } from '../src/plugin';

async function main() {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error('Usage: npx tsx scripts/test-with-docx.ts <docx-file-path>');
    process.exit(1);
  }

  const plugin = new DocxPlugin();
  await plugin.init();

  const result = await plugin.toMarkdown(filePath);
  console.log('Markdown preview:\n', result.markdown.slice(0, 500));
  console.log('Mappings preview:', result.mapping.slice(0, 5));

  await plugin.dispose();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
