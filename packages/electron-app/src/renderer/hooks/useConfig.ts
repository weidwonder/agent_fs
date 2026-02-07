import { useState, useCallback } from 'react';

export function useConfig() {
  const [config, setConfig] = useState<Record<string, unknown> | null>(null);
  const [rawConfig, setRawConfig] = useState<Record<string, unknown> | null>(null);
  const [envFields, setEnvFields] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadConfig = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const result = await window.electronAPI.getConfig();
      setConfig(result.resolvedConfig);
      setRawConfig(result.rawConfig);
      setEnvFields(result.envFields);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const save = useCallback(async (updates: Record<string, unknown>) => {
    setIsSaving(true);
    setError(null);
    try {
      const result = await window.electronAPI.saveConfig(updates);
      if (!result.success) {
        setError(result.error || '保存失败');
        return false;
      }
      await loadConfig();
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setIsSaving(false);
    }
  }, [loadConfig]);

  return { config, rawConfig, envFields, isLoading, isSaving, error, loadConfig, save };
}
