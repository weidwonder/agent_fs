import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

import nodejieba from 'nodejieba';

const require = createRequire(import.meta.url);
const nodejiebaRoot = dirname(require.resolve('nodejieba/package.json'));

let initialized = false;

export function resolveUnpackedAsarPath(
  filePath: string,
  pathExists: (targetPath: string) => boolean = existsSync
): string {
  const unpackedPath = filePath.replace(
    /([\\/])app\.asar([\\/])/u,
    '$1app.asar.unpacked$2'
  );

  if (unpackedPath !== filePath && pathExists(unpackedPath)) {
    return unpackedPath;
  }

  return filePath;
}

function resolveNodeJiebaAssetPath(...segments: string[]): string {
  return resolveUnpackedAsarPath(join(nodejiebaRoot, ...segments));
}

export function getNodeJieba(): typeof nodejieba {
  if (!initialized) {
    nodejieba.load({
      dict: resolveNodeJiebaAssetPath('dict', 'jieba.dict.utf8'),
      hmmDict: resolveNodeJiebaAssetPath('dict', 'hmm_model.utf8'),
      userDict: resolveNodeJiebaAssetPath('dict', 'user.dict.utf8'),
      idfDict: resolveNodeJiebaAssetPath('dict', 'idf.utf8'),
      stopWordDict: resolveNodeJiebaAssetPath('dict', 'stop_words.utf8'),
    });
    initialized = true;
  }

  return nodejieba;
}
