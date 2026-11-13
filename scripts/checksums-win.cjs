const { createHash } = require('node:crypto');
const { readFile, readdir, writeFile } = require('node:fs/promises');
const path = require('node:path');
const { load: parseYaml } = require('js-yaml');

const root = path.join(__dirname, '..');
const releaseDirectory = path.join(root, 'release');
const { productName, version } = require(path.join(root, 'package.json'));
const artifactPrefix = productName.replace(/\s+/gu, '-');
const expectedArtifacts = [
  `${artifactPrefix}-${version}-x64.exe`,
  `${artifactPrefix}-${version}-portable.exe`,
];

async function main() {
  const entries = new Set(await readdir(releaseDirectory));
  const missingArtifacts = expectedArtifacts.filter((name) => !entries.has(name));
  if (missingArtifacts.length > 0) {
    throw new Error(`Не найдены артефакты Windows: ${missingArtifacts.join(', ')}`);
  }

  const artifacts = await Promise.all(expectedArtifacts.map(async (name) => {
    const contents = await readFile(path.join(releaseDirectory, name));
    return {
      name,
      size: contents.byteLength,
      sha256: createHash('sha256').update(contents).digest('hex'),
      sha512: createHash('sha512').update(contents).digest('base64'),
    };
  }));
  const updateMetadata = parseYaml(await readFile(path.join(releaseDirectory, 'latest.yml'), 'utf8'));
  const installer = artifacts[0];
  if (
    updateMetadata?.version !== version ||
    updateMetadata?.path !== installer.name ||
    !Array.isArray(updateMetadata.files) ||
    !updateMetadata.files.some((file) =>
      file.url === installer.name && file.size === installer.size && file.sha512 === installer.sha512,
    )
  ) {
    throw new Error('latest.yml не соответствует собранному NSIS-установщику.');
  }

  const checksums = artifacts.map(({ name, sha256 }) => `${sha256}  ${name}`);
  await writeFile(path.join(releaseDirectory, 'SHA256SUMS.txt'), `${checksums.join('\n')}\n`, 'utf8');
  console.log(`Создан release/SHA256SUMS.txt (${checksums.length} артефакта).`);
}

main().catch((error) => {
  console.error('Не удалось создать SHA-256 контрольные суммы.', error);
  process.exitCode = 1;
});
