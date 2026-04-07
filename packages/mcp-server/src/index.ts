#!/usr/bin/env node
const subcommand = process.argv[2];

async function main() {
  if (subcommand === 'login') {
    const target = getArg('--target');
    if (!target) {
      console.error('Usage: agent-fs login --target <url>');
      process.exit(1);
    }
    const { loginCommand } = await import('./cli/login.js');
    await loginCommand(target);
    return;
  }

  if (subcommand === 'push') {
    const target = getArg('--target');
    const project = getArg('--project');
    if (!target || !project) {
      console.error('Usage: agent-fs push --target <url> --project <project-id> [path]');
      process.exit(1);
    }
    const path = getPositionalArg();
    const { pushCommand } = await import('./cli/push.js');
    await pushCommand(target, project, path);
    return;
  }

  const { startHttpServer } = await import('./http-server.js');
  const { parseListenOptions } = await import('./listen-config.js');
  const options = parseListenOptions(
    subcommand === 'serve' ? process.argv.slice(3) : process.argv.slice(2),
  );
  const server = await startHttpServer(options);

  let shuttingDown = false;
  const shutdown = async (exitCode: number) => {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;
    try {
      await server.close();
    } finally {
      process.exit(exitCode);
    }
  };

  process.on('SIGINT', () => {
    void shutdown(0);
  });

  process.on('SIGTERM', () => {
    void shutdown(0);
  });

  console.error(`Agent FS MCP Server listening on ${server.mcpUrl}`);
}

function getArg(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  if (index === -1 || index + 1 >= process.argv.length) {
    return undefined;
  }
  return process.argv[index + 1];
}

function getPositionalArg(): string | undefined {
  const args = process.argv.slice(3);
  for (let index = 0; index < args.length; index += 1) {
    if (args[index].startsWith('--')) {
      index += 1;
      continue;
    }
    return args[index];
  }
  return undefined;
}

main().catch((error) => {
  console.error('Failed:', error);
  process.exit(1);
});
