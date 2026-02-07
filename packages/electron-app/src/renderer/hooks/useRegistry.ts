import { useState, useEffect, useCallback } from 'react';

export function useRegistry() {
  const [projects, setProjects] = useState<RegisteredProject[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const loadRegistry = useCallback(async () => {
    setIsLoading(true);
    try {
      const registry = await window.electronAPI.getRegistry();
      setProjects(registry.projects?.filter((p) => p.valid) || []);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadRegistry();
  }, [loadRegistry]);

  return { projects, isLoading, refresh: loadRegistry };
}
