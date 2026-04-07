import { describe, expect, it } from 'vitest';
import { parseListenOptions } from './listen-config.js';

describe('parseListenOptions', () => {
  it('默认监听本地 3001 端口', () => {
    expect(parseListenOptions([])).toEqual({
      host: '127.0.0.1',
      port: 3001,
    });
  });

  it('支持通过命令行覆盖 host 和 port', () => {
    expect(parseListenOptions(['--host=0.0.0.0', '--port=4317'])).toEqual({
      host: '0.0.0.0',
      port: 4317,
    });
  });

  it('支持通过空格分隔形式覆盖 host 和 port', () => {
    expect(parseListenOptions(['--host', '0.0.0.0', '--port', '4317'])).toEqual({
      host: '0.0.0.0',
      port: 4317,
    });
  });

  it('在端口非法时抛出错误', () => {
    expect(() => parseListenOptions(['--port=abc'])).toThrow('port 必须是 0-65535 之间的整数');
  });

  it('在出现未知参数时抛出错误', () => {
    expect(() => parseListenOptions(['--stdio'])).toThrow('不支持的参数: --stdio');
  });
});
