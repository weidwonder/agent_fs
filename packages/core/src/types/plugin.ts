/**
 * 文档处理插件接口
 */
export interface DocumentPlugin {
  /** 插件名称 */
  name: string;

  /** 支持的文件扩展名（不含点，如 'pdf', 'docx'） */
  supportedExtensions: string[];

  /**
   * 将文档转换为 Markdown
   * @param filePath 文件绝对路径
   * @returns Markdown 内容和位置映射
   */
  toMarkdown(filePath: string): Promise<DocumentConversionResult>;

  /**
   * 解析 locator 为可读文本
   * @param locator 原始定位符
   * @returns 可读的位置描述
   */
  parseLocator?(locator: string): LocatorInfo;

  /** 插件初始化 */
  init?(): Promise<void>;

  /** 插件销毁 */
  dispose?(): Promise<void>;
}

/**
 * 文档转换结果
 */
export interface DocumentConversionResult {
  /** 转换后的 Markdown 内容 */
  markdown: string;

  /** 位置映射表 */
  mapping: PositionMapping[];
}

/**
 * 位置映射
 * 将 Markdown 中的行范围映射到原文档位置
 */
export interface PositionMapping {
  /** Markdown 中的行范围 */
  markdownRange: {
    startLine: number;
    endLine: number;
  };

  /** 原文档定位符（插件自定义格式） */
  originalLocator: string;
}

/**
 * 定位符信息
 */
export interface LocatorInfo {
  /** 可读的位置描述 */
  displayText: string;

  /** 跳转信息（可选，供 UI 使用） */
  jumpInfo?: unknown;
}
