import type { DocumentPlugin } from '@agent-fs/core';

export class PluginManager {
  private plugins: Map<string, DocumentPlugin> = new Map();

  register(plugin: DocumentPlugin): void {
    for (const ext of plugin.supportedExtensions) {
      this.plugins.set(ext.toLowerCase(), plugin);
    }
  }

  getPlugin(extension: string): DocumentPlugin | undefined {
    return this.plugins.get(extension.toLowerCase());
  }

  getSupportedExtensions(): string[] {
    return Array.from(this.plugins.keys());
  }

  async initAll(): Promise<void> {
    for (const plugin of new Set(this.plugins.values())) {
      await plugin.init?.();
    }
  }

  async disposeAll(): Promise<void> {
    for (const plugin of new Set(this.plugins.values())) {
      await plugin.dispose?.();
    }
  }
}
