export interface ListenOptions {
  host: string;
  port: number;
}

export const DEFAULT_HOST = '127.0.0.1';
export const DEFAULT_PORT = 3001;

export function parseListenOptions(args: string[]): ListenOptions {
  let host = DEFAULT_HOST;
  let port = DEFAULT_PORT;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === '--host' || arg.startsWith('--host=')) {
      const { value, nextIndex } = readOptionValue(args, index, '--host');
      host = value;
      index = nextIndex;
      continue;
    }

    if (arg === '--port' || arg.startsWith('--port=')) {
      const { value, nextIndex } = readOptionValue(args, index, '--port');
      port = parsePort(value);
      index = nextIndex;
      continue;
    }

    throw new Error(`不支持的参数: ${arg}`);
  }

  return { host, port };
}

function readOptionValue(
  args: string[],
  index: number,
  optionName: '--host' | '--port',
): { value: string; nextIndex: number } {
  const arg = args[index];

  if (arg.startsWith(`${optionName}=`)) {
    return {
      value: arg.slice(optionName.length + 1),
      nextIndex: index,
    };
  }

  const value = args[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`${optionName} 缺少值`);
  }

  return {
    value,
    nextIndex: index + 1,
  };
}

function parsePort(value: string): number {
  if (!/^\d+$/.test(value)) {
    throw new Error('port 必须是 0-65535 之间的整数');
  }

  const port = Number(value);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error('port 必须是 0-65535 之间的整数');
  }

  return port;
}
