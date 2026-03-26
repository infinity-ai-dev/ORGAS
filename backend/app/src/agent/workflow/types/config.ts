export type WorkflowTypeConfig = {
  id: string;
  rootTipo: string;
  allowCodeExecution: boolean;
  outputSchema: string;
  sectionKeys: string[];
  systemInstruction: string;
  promptIntro: string;
  buildPayload: (state: any, classificacoesResumo: any[], uploadResumo: any[]) => any;
  buildBaseFromConsolidado: (state: any) => any;
  buildFallback: (state: any) => any;
  isSchemaValid: (payload: any) => boolean;
  buildClassificationPrompt: (referenceContext: string) => string;
  buildClassificationContents: (doc: any, context: any) => any[];
  routeAgent: (tipo: string) => string | null;
  buildExtractionPrompt: (agent: string, referenceContext: string) => string;
  buildAgentContents: (classification: any, context: any) => any[];
};
