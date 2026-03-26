/**
 * Interfaces TypeScript para os payloads estruturados do Parecer Fiscal
 * Documentação completa em: docs/payloads-parecer-fiscal.md
 */

// ============================================================================
// CABEÇALHO
// ============================================================================
export interface SecaoCabecalho {
  cnpj: string;
  periodo: string;
  dataGeracao: string;
  razaoSocial: string;
  periodoFormatado: string;
  regimeTributario: string;
  dataGeracaoFormatada: string;
  regimeTributarioCompleto: string;
}

// ============================================================================
// SEÇÃO 1: RESUMO TRIBUTÁRIO (FATURAMENTO)
// ============================================================================
export interface RetencaoItem {
  valor: number;
  valorFormatado: string;
}

export interface Retencoes {
  iss: number;
  pis: number;
  irrf: number;
  cofins: number;
  issFormatado: string;
  pisFormatado: string;
  irrfFormatado: string;
  cofinsFormatado: string;
}

export interface GraficoFaturamento {
  impostoLabel: string;
  impostoAltura: number;
  faturamentoLabel: string;
  faturamentoAltura: number;
  aliquotaFinalLabel: string;
  diferencaAliquotas: string;
  aliquotaFinalAltura: number;
  aliquotaFinalTitulo: string;
  aliquotaEfetivaLabel: string;
  mostrarDuasAliquotas: boolean;
  aliquotaEfetivaAltura: number;
  aliquotaEfetivaTitulo: string;
  diferencaAliquotasLabel: string;
}

export interface ImpostoDetalhe {
  valor: number;
  retencoes: Retencoes;
  temRetencao: boolean;
  totalRetido: number;
  impostoPagar: number;
  aliquotaFinal: string;
  valorFormatado: string;
  aliquotaEfetiva: number;
  correcaoAplicada: boolean;
  fonteDadosImposto: string;
  totalRetidoFormatado: string;
  impostoPagarFormatado: string;
  aliquotaFinalFormatada: string;
  aliquotaEfetivaFormatada: string;
}

export interface FaturamentoDetalhe {
  valor: number;
  descricao: string;
  valorFormatado: string;
}

export interface EstabelecimentoItem {
  imposto: string;
  receita: string;
  aliquota: string;
  descricao: string;
  dataVencimento: string;
}

export interface Secao1Faturamento {
  anexo: string;
  totais: {
    imposto: string;
    faturamento: string;
  };
  grafico: GraficoFaturamento;
  imposto: ImpostoDetalhe;
  faturamento: FaturamentoDetalhe;
  aplicouFatorR: boolean;
  dataVencimento: string;
  estabelecimentos: EstabelecimentoItem[];
}

// ============================================================================
// SEÇÃO 2: MOVIMENTAÇÃO FINANCEIRA
// ============================================================================
export interface MovimentoItem {
  valor: number;
  valorFormatado: string;
}

export interface MovimentoFinanceiro {
  pix: MovimentoItem;
  total: MovimentoItem;
  depositos: MovimentoItem;
  vendasCartao: MovimentoItem;
  transferencias: MovimentoItem;
}

export interface DivergenciaFinanceira {
  valor: number;
  corTexto: string;
  ehNegativa: boolean;
  porcentagem: string;
  valorFormatado: string;
}

export interface Secao2Financeiro {
  banco: string;
  movimento: MovimentoFinanceiro;
  divergencia: DivergenciaFinanceira;
  temMovimento: boolean;
  interpretacao: string;
  faturamentoDeclarado: MovimentoItem;
}

// ============================================================================
// SEÇÃO 3: AUDITORIA FISCAL (DOCUMENTOS)
// ============================================================================
export interface DocumentoFiscalStatus {
  status: string;
  regular: boolean;
  gaps?: string[];
  observacoes?: string;
  notasCanceladas?: string[];
  quantidadeCanceladas?: number;
}

export interface DocumentosFiscais {
  cte: DocumentoFiscalStatus;
  nfe: DocumentoFiscalStatus;
  nfce: DocumentoFiscalStatus;
  nfse: DocumentoFiscalStatus;
}

export interface NotasDuplicadas {
  mensagem: string;
  encontradas: boolean;
}

export interface Secao3Documentos {
  notasDuplicadas: NotasDuplicadas;
  documentosFiscais: DocumentosFiscais;
}

// ============================================================================
// SEÇÃO 4: EVOLUÇÃO MENSAL
// ============================================================================
export interface ValorComFonte {
  fonte?: string;
  valor: number;
  valorFormatado: string;
}

export interface LucroMensal {
  cor: string;
  valor: number;
  ehPositivo: boolean;
  valorFormatado: string;
}

export interface ImpostoMensal {
  fonte: string;
  valor: number;
  aliquota: string;
  valorFormatado: string;
}

export interface MesEvolucao {
  mes: string;
  folha: ValorComFonte;
  lucro: LucroMensal;
  compras: MovimentoItem;
  impostos: ImpostoMensal;
  faturamento: MovimentoItem;
  mesOriginal: string;
}

export interface TotaisEvolucao {
  folha: MovimentoItem;
  lucro: LucroMensal & { margemLiquida: string };
  compras: MovimentoItem;
  impostos: {
    valor: number;
    aliquotaMedia: string;
    valorFormatado: string;
  };
  faturamento: MovimentoItem;
}

export interface IndicadoresEvolucao {
  ticketMedio: string;
  margemLiquida: string;
  custoFolhaPercentual: string;
}

export interface Secao4TabelaMensal {
  meses: MesEvolucao[];
  totais: TotaisEvolucao;
  alertas: string[];
  temDados: boolean;
  indicadores: IndicadoresEvolucao;
  quantidadeMeses: number;
}

// ============================================================================
// SEÇÃO 5: DOCUMENTOS QUE ACOMPANHAM
// ============================================================================
export interface DocumentoAcompanha {
  nome: string;
  icone: string;
  enviado: boolean;
}

export interface Secao5Acompanham {
  documentos: DocumentoAcompanha[];
}

// ============================================================================
// SEÇÃO 6: RESUMO DA ANÁLISE
// ============================================================================
export interface ResumoAnalise {
  total: number;
  analisados: number;
  naoAnalisados: number;
}

export interface DocumentoAnalisado {
  cor: string;
  nome: string;
  icone: string;
  numero: number;
  analisado: boolean;
}

export interface Secao6Analisados {
  resumo: ResumoAnalise;
  documentos: DocumentoAnalisado[];
}

// ============================================================================
// SEÇÃO 7: PLANEJAMENTO TRIBUTÁRIO
// ============================================================================
export interface FatorRInfo {
  valor: number;
  aplicaAnexoIII: boolean;
  valorFormatado: string;
  textoExplicativo: string;
}

export interface AnaliseRegime {
  economia: number;
  mensagem: string;
  regimeAtual: string;
  impostoAtual: number;
  recomendacao: string;
  economiaAnual: number;
  economiaFormatada: string;
  jEstaMelhorRegime: boolean;
  regimeMaisVantajoso: string;
  impostoMaisVantajoso: number;
  impostoAtualFormatado: string;
  economiaAnualFormatada: string;
  impostoMaisVantajosoFormatado: string;
}

export interface RankingRegime {
  regime: string;
  ehAtual: boolean;
  imposto: number;
  posicao: number;
  ehMaisVantajoso: boolean;
  impostoFormatado: string;
}

export interface DetalhamentoImpostoLP {
  valor: number;
  aliquota: string;
  valorFormatado: string;
  calculo?: string;
}

export interface DetalhamentoLucroPresumido {
  iss: DetalhamentoImpostoLP;
  pis: DetalhamentoImpostoLP;
  csll: DetalhamentoImpostoLP;
  irpj: DetalhamentoImpostoLP;
  cofins: DetalhamentoImpostoLP;
  lucroPresumido: {
    valor: number;
    calculo: string;
    valorFormatado: string;
  };
}

export interface LucroPresumidoInfo {
  imposto: number;
  presuncao: string;
  composicao: string;
  ehMaisCaro: boolean;
  detalhamento: DetalhamentoLucroPresumido;
  aliquotaEfetiva: number;
  impostoFormatado: string;
  diferencaSimples: number;
  diferencaFormatada: string;
  aliquotaEfetivaFormatada: string;
}

export interface SimplesNacionalInfo {
  anexo: string;
  imposto: number;
  aliquota: number;
  faixaAtual?: string;
  corDestaque: string;
  bordaDestaque: string;
  ehRegimeAtual: boolean;
  textoDestaque: string;
  impostoFormatado: string;
  aliquotaFormatada: string;
  diferencaFormatada?: string;
  diferencaAnexoIII?: number;
  ehMaisCaro?: boolean;
}

export interface Secao7Tributaria {
  fatorR: FatorRInfo;
  analise: AnaliseRegime;
  ranking: RankingRegime[];
  folhaAnual: MovimentoItem;
  lucroPresumido: LucroPresumidoInfo;
  receitaBruta12Meses: MovimentoItem;
  temDadosSuficientes: boolean;
  simplesNacionalAnexoV: SimplesNacionalInfo;
  simplesNacionalAnexoIII: SimplesNacionalInfo;
}

// ============================================================================
// SEÇÃO 8: OBSERVAÇÕES FINAIS
// ============================================================================
export interface DetalhesObservacao {
  anexo: string;
  banco: string;
  regime: string;
  empresa: string;
  periodo: string;
  dasPendente: boolean;
  aplicaFatorR: boolean;
  notasCanceladas: string[];
  temVendasCartao: boolean;
  divergenciaFinanceira: {
    valor: number;
    existe: boolean;
    valorAbsoluto: number;
  };
  quantidadeNotasCanceladas: number;
}

export interface Secao8Assinatura {
  detalhes: DetalhesObservacao;
  observacao: string;
}

// ============================================================================
// TIPO CONSOLIDADO
// ============================================================================
export interface RelatorioPayloadCompleto {
  cabecalho: SecaoCabecalho;
  secao1: Secao1Faturamento;
  secao2: Secao2Financeiro;
  secao3: Secao3Documentos;
  secao4: Secao4TabelaMensal;
  secao5: Secao5Acompanham;
  secao6: Secao6Analisados;
  secao7: Secao7Tributaria;
  secao8: Secao8Assinatura;
}
