import fs from 'fs/promises';
import path from 'path';

export type ReferenceBundle = {
  dir: string;
  files: Array<{ name: string; content: string }>;
  merged: string;
};

export async function loadReferences(
  dir: string,
  maxChars: number,
  logTask: (task: string, detail?: string) => void,
  allowList?: string[]
): Promise<ReferenceBundle> {
  logTask('carregar_referencias', `dir=${dir}`);

  let entries: Array<{ name: string; content: string }> = [];
  try {
    const dirents = await fs.readdir(dir, { withFileTypes: true });
    let mdFiles = dirents
      .filter((d) => d.isFile() && d.name.toLowerCase().endsWith('.md'))
      .map((d) => d.name)
      .sort();

    if (allowList && allowList.length > 0) {
      const normalized = new Set(allowList.map((n) => n.trim()).filter(Boolean));
      mdFiles = mdFiles.filter((name) => normalized.has(name));
      logTask('referencias_filtradas', mdFiles.join(',') || 'nenhuma');
    }

    for (const name of mdFiles) {
      const fullPath = path.join(dir, name);
      const content = await fs.readFile(fullPath, 'utf8');
      entries.push({ name, content });
    }
  } catch (error) {
    logTask('carregar_referencias_erro', String(error));
  }

  const mergedRaw = entries
    .map((f) => `# ${f.name}\n\n${f.content}`)
    .join('\n\n');
  const merged = mergedRaw.length > maxChars ? mergedRaw.slice(0, maxChars) : mergedRaw;

  return { dir, files: entries, merged };
}
