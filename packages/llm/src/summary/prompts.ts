/**
 * Chunk Summary 提示词
 */
export const CHUNK_SUMMARY_PROMPT = `请为以下文本生成一个简洁的摘要（50-100字）：

{content}

摘要：`;

/**
 * 文档 Summary 提示词
 */
export const DOCUMENT_SUMMARY_PROMPT = `请为以下文档生成一个综合摘要（100-200字），概括主要内容和关键信息：

文档名称：{filename}

文档内容（各章节摘要）：
{chunk_summaries}

文档摘要：`;

/**
 * 目录 Summary 提示词
 */
export const DIRECTORY_SUMMARY_PROMPT = `请为以下文件夹生成一个综合摘要（100-200字），描述该文件夹包含的主要内容：

文件夹路径：{path}

包含的文档：
{file_summaries}

包含的子目录：
{subdirectory_summaries}

文件夹摘要：`;
