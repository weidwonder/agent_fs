import React, { useState, useEffect, useCallback } from 'react';
import { Loader2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from './ui/dialog';
import { Tabs, TabsList, TabsTrigger, TabsContent } from './ui/tabs';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from './ui/select';
import { Input } from './ui/input';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { useConfig } from '../hooks/useConfig';

interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function getNestedValue(
  obj: Record<string, unknown> | null,
  path: string,
): unknown {
  if (!obj) return undefined;
  const keys = path.split('.');
  let current: unknown = obj;
  for (const key of keys) {
    if (current == null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

function setNestedValue(
  obj: Record<string, unknown>,
  path: string,
  value: unknown,
): Record<string, unknown> {
  const keys = path.split('.');
  const result = { ...obj };
  let current: Record<string, unknown> = result;
  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i];
    const next = current[key];
    if (next != null && typeof next === 'object' && !Array.isArray(next)) {
      current[key] = { ...(next as Record<string, unknown>) };
    } else {
      current[key] = {};
    }
    current = current[key] as Record<string, unknown>;
  }
  current[keys[keys.length - 1]] = value;
  return result;
}

export function SettingsDialog({ open, onOpenChange }: SettingsDialogProps) {
  const { config, envFields, isLoading, isSaving, error, loadConfig, save } =
    useConfig();
  const [formData, setFormData] = useState<Record<string, unknown> | null>(
    null,
  );

  useEffect(() => {
    if (open) {
      loadConfig();
    }
  }, [open, loadConfig]);

  useEffect(() => {
    if (config) {
      setFormData(JSON.parse(JSON.stringify(config)));
    }
  }, [config]);

  const getValue = useCallback(
    (path: string): string => {
      const v = getNestedValue(formData, path);
      if (v == null) return '';
      return String(v);
    },
    [formData],
  );

  const setValue = useCallback((path: string, value: unknown) => {
    setFormData((prev) => {
      if (!prev) return prev;
      return setNestedValue(prev, path, value);
    });
  }, []);

  const handleSave = async () => {
    if (!formData) return;
    const ok = await save(formData);
    if (ok) {
      onOpenChange(false);
    }
  };

  const isEnvField = (path: string) => envFields.includes(path);

  function renderField(
    label: string,
    path: string,
    opts?: { type?: string; readOnly?: boolean; placeholder?: string },
  ) {
    const { type = 'text', readOnly = false, placeholder } = opts ?? {};
    return (
      <div className="space-y-1.5">
        <div className="flex items-center gap-2">
          <label className="text-sm font-medium">{label}</label>
          {isEnvField(path) && (
            <Badge variant="outline" className="text-xs">
              ENV
            </Badge>
          )}
        </div>
        {readOnly ? (
          <div className="flex h-10 w-full items-center rounded-md border border-input bg-muted px-3 py-2 text-sm text-muted-foreground">
            {getValue(path)}
          </div>
        ) : (
          <Input
            type={type}
            value={getValue(path)}
            placeholder={placeholder}
            onChange={(e) => {
              const raw = e.target.value;
              if (type === 'number') {
                setValue(path, raw === '' ? '' : Number(raw));
              } else {
                setValue(path, raw);
              }
            }}
          />
        )}
      </div>
    );
  }

  function renderSelect(
    label: string,
    path: string,
    options: { value: string; label: string }[],
  ) {
    return (
      <div className="space-y-1.5">
        <label className="text-sm font-medium">{label}</label>
        <Select value={getValue(path)} onValueChange={(v) => setValue(path, v)}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {options.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    );
  }

  const embeddingDefault = getValue('embedding.default');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>设置</DialogTitle>
          <DialogDescription className="sr-only">
            应用配置设置
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <Tabs defaultValue="llm">
            <TabsList className="w-full">
              <TabsTrigger value="llm">LLM</TabsTrigger>
              <TabsTrigger value="embedding">Embedding</TabsTrigger>
              <TabsTrigger value="summary">摘要</TabsTrigger>
              <TabsTrigger value="index-search">索引 & 搜索</TabsTrigger>
              <TabsTrigger value="plugins">插件</TabsTrigger>
            </TabsList>

            {/* Tab: LLM */}
            <TabsContent value="llm">
              <div className="space-y-4 py-2">
                {renderField('Provider', 'llm.provider', { readOnly: true })}
                {renderField('API 地址', 'llm.base_url', {
                  placeholder: 'https://api.openai.com/v1',
                })}
                {renderField('API 密钥', 'llm.api_key', { type: 'password' })}
                {renderField('模型名称', 'llm.model', {
                  placeholder: 'gpt-4o-mini',
                })}
              </div>
            </TabsContent>

            {/* Tab: Embedding */}
            <TabsContent value="embedding">
              <div className="space-y-4 py-2">
                {renderSelect('默认模式', 'embedding.default', [
                  { value: 'local', label: 'local' },
                  { value: 'api', label: 'api' },
                ])}
                {embeddingDefault === 'api' && (
                  <>
                    {renderField('API 地址', 'embedding.api.base_url', {
                      placeholder: 'https://api.openai.com/v1',
                    })}
                    {renderField('API 密钥', 'embedding.api.api_key', {
                      type: 'password',
                    })}
                    {renderField('模型名称', 'embedding.api.model', {
                      placeholder: 'text-embedding-3-small',
                    })}
                  </>
                )}
                {embeddingDefault === 'local' && (
                  <>
                    {renderField('模型名称', 'embedding.local.model')}
                    {renderSelect('设备', 'embedding.local.device', [
                      { value: 'cpu', label: 'cpu' },
                      { value: 'gpu', label: 'gpu' },
                    ])}
                  </>
                )}
              </div>
            </TabsContent>

            {/* Tab: 摘要 */}
            <TabsContent value="summary">
              <div className="space-y-4 py-2">
                {renderSelect('生成模式', 'summary.mode', [
                  { value: 'batch', label: 'batch' },
                  { value: 'skip', label: 'skip' },
                ])}
                {renderField(
                  'Token 预算',
                  'summary.chunk_batch_token_budget',
                  { type: 'number' },
                )}
                {renderField('超时(ms)', 'summary.timeout_ms', {
                  type: 'number',
                })}
                {renderField('重试次数', 'summary.max_retries', {
                  type: 'number',
                })}
              </div>
            </TabsContent>

            {/* Tab: 索引 & 搜索 */}
            <TabsContent value="index-search">
              <div className="space-y-4 py-2">
                {renderField('最小 Token', 'chunk_size.min_tokens', {
                  type: 'number',
                })}
                {renderField('最大 Token', 'chunk_size.max_tokens', {
                  type: 'number',
                })}
                {renderField('默认返回数', 'default_top_k', {
                  type: 'number',
                })}
                {renderField('Fusion 方法', 'fusion.method', {
                  readOnly: true,
                })}
              </div>
            </TabsContent>

            {/* Tab: 插件 */}
            <TabsContent value="plugins">
              <div className="space-y-4 py-2">
                {renderField(
                  'MinerU API 地址',
                  'pdf.minerU.serverUrl',
                  { placeholder: 'http://localhost:8888' },
                )}
              </div>
            </TabsContent>
          </Tabs>
        )}

        {error && <p className="text-sm text-red-500">{error}</p>}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button onClick={handleSave} disabled={isSaving || isLoading}>
            {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
