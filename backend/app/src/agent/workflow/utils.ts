export function withReferences(basePrompt: string, referenceContext: string) {
  if (!referenceContext) return basePrompt;
  return `${basePrompt}\n\n# Referências (seguir rigorosamente)\n${referenceContext}`;
}
