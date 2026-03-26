/**
 * ============================================================
 * EDGE FUNCTION: gerar-pdf-parecer
 * ============================================================
 * 
 * PROPÓSITO:
 * Gera o PDF final do Parecer Fiscal a partir do secoes_json
 * de um relatório aprovado.
 * 
 * PIPELINE:
 * 1. Busca relatório em relatorios_aprovados pelo reportId
 * 2. Gera HTML completo com todas as 8 seções
 * 3. Converte HTML para PDF via API2PDF
 * 4. Faz upload do PDF para Supabase Storage
 * 5. Atualiza registro com URL do PDF
 * 
 * ENTRADA: { reportId }
 * SAÍDA:   { success, pdfUrl, fileName }
 * 
 * TECNOLOGIAS:
 * - API2PDF: Serviço de conversão HTML -> PDF
 * - Supabase Storage: Armazenamento do arquivo PDF
 * 
 * BASEADO EM: docs/n8n-workflows/N8N__04__WF__PARTE_II_GERACAO_DOCUMENTO.md
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

// ============================================================
// CORS HEADERS
// ============================================================
// Permite chamadas cross-origin do frontend Lovable
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ============================================================
// GERADOR DE HTML DO PARECER
// ============================================================
//
// Transforma o secoes_json em um documento HTML completo com:
//   - Estilos CSS inline (para garantir renderização correta no PDF)
//   - Layout A4 com margens e quebras de página
//   - Cores e formatação profissional
//
// SEÇÕES RENDERIZADAS:
//   - Cabeçalho: Logo, título, dados da empresa
//   - Seção 1: Tabela de faturamento x impostos + gráfico de barras
//   - Seção 2: Movimento financeiro com barras horizontais
//   - Seção 3: Resumo de documentos fiscais
//   - Seção 4: Tabela de lucro/prejuízo mensal
//   - Seção 5: Lista de documentos que acompanham
//   - Seção 6: Lista de documentos analisados
//   - Seção 7: Comparação de regimes (condicional - só para serviços)
//   - Seção 8: Observações finais
//
// LÓGICA CONDICIONAL:
//   - Seção 7 só aparece se NÃO for comércio (anexos I/II) e tiver dados
//   - Status de documentos (analisado/pendente) baseado em dados reais
//   - Observação automática gerada com base nos dados encontrados
//
// Baseado em: docs/n8n-workflows/N8N__16__CODE__PARTE_II_GERACAO_DOCUMENTO.md

/**
 * Gera o HTML completo do Parecer Fiscal
 * 
 * @param data - Objeto com secoes_json do relatório aprovado
 * @returns String HTML completa pronta para conversão em PDF
 */

// ============================================================
// NORMALIZAÇÃO DE DADOS PARA O TEMPLATE DO PDF
// ============================================================
// O template abaixo espera uma estrutura legada (faturamento/imposto/movimento etc).
// As seções atuais geradas pelo processar-documentos usam dadosSecao1..8 com nomes diferentes.
// Esta camada normaliza o JSON para evitar "undefined" e preencher dados dinâmicos.

const moedaFormatter = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
});

const numeroFormatter = new Intl.NumberFormat('pt-BR', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function parseValorBR(valor: unknown): number {
  if (typeof valor === 'number') return valor;
  if (!valor || valor === 'null' || valor === 'undefined') return 0;
  const str = String(valor)
    .replace(/\u00a0/g, ' ')
    .replace(/R\$\s?/g, '')
    .replace(/\./g, '')
    .replace(',', '.')
    .trim();
  const parsed = parseFloat(str);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function formatarValorBR(valor: number): string {
  return moedaFormatter.format(valor || 0);
}

function formatarNumeroBR(valor: number): string {
  return numeroFormatter.format(valor || 0);
}

function formatarPercentual(valor: unknown): string {
  if (typeof valor === 'string' && valor.includes('%')) return valor;
  const num = parseValorBR(valor);
  return `${num.toFixed(2)}%`;
}

function stripMoeda(valor: unknown): string {
  if (!valor) return '0,00';
  const str = String(valor).replace(/\u00a0/g, ' ').replace(/R\$\s?/g, '').trim();
  if (!str) return '0,00';
  return str;
}

function normalizarSecoesParaPdf(dados: Record<string, unknown>): Record<string, unknown> {
  const cab = (dados.dadosCabecalho as Record<string, unknown>) || {};
  const s1Raw = (dados.dadosSecao1 as Record<string, unknown>) || {};
  const s2Raw = (dados.dadosSecao2 as Record<string, unknown>) || {};
  const s3Raw = (dados.dadosSecao3 as Record<string, unknown>) || {};
  const s4Raw = (dados.dadosSecao4 as Record<string, unknown>) || {};
  const s5Raw = (dados.dadosSecao5 as Record<string, unknown>) || {};
  const s6Raw = (dados.dadosSecao6 as Record<string, unknown>) || {};
  const s7Raw = (dados.dadosSecao7 as Record<string, unknown>) || {};
  const s8Raw = (dados.dadosSecao8 as Record<string, unknown>) || {};

  // Se já está no formato esperado pelo template, apenas garante data formatada
  const jaNormalizado =
    (s1Raw as Record<string, unknown>)?.faturamento ||
    (s2Raw as Record<string, unknown>)?.movimento ||
    (s3Raw as Record<string, unknown>)?.documentosFiscais;

  if (jaNormalizado) {
    return {
      ...dados,
      dadosCabecalho: {
        ...cab,
        dataGeracaoFormatada: (cab as Record<string, unknown>)?.dataGeracaoFormatada || cab.dataGeracao,
      },
    };
  }

  const dadosPgdas = (s1Raw.dadosPgdas as Record<string, unknown>) || {};
  const receitaBrutaTotal = parseValorBR(
    s1Raw.receitaBrutaTotal || s1Raw.receitaBrutaMes || dadosPgdas.receitaBrutaMes
  );
  const impostoTotal = parseValorBR(s1Raw.impostoTotal || dadosPgdas.valorDAS);
  const aliquotaEfetiva = formatarPercentual(s1Raw.aliquotaEfetiva || dadosPgdas.aliquota);

  const retencoes = (s1Raw.retencoes as Record<string, unknown>) || (dadosPgdas.retencoes as Record<string, unknown>) || {};
  let retencoesTotal = parseValorBR(retencoes.total);
  if (retencoesTotal === 0) {
    retencoesTotal = Object.values(retencoes).reduce((acc, v) => acc + parseValorBR(v), 0);
  }

  const impostoPagar = Math.max(impostoTotal - retencoesTotal, 0);
  const dataVencimento = s1Raw.dataVencimentoDAS || dadosPgdas.dataVencimentoDAS || s1Raw.dataVencimento;

  const estabelecimentosRaw =
    (Array.isArray(s1Raw.estabelecimentos) && s1Raw.estabelecimentos.length > 0
      ? s1Raw.estabelecimentos
      : (dadosPgdas.estabelecimentos as Array<Record<string, unknown>>)) || [];

  const estabelecimentos = estabelecimentosRaw.map((estab) => {
    const receitaValor = parseValorBR(estab.receita);
    const impostoValor = estab.imposto ? String(estab.imposto) : formatarValorBR(impostoTotal);
    return {
      ...estab,
      descricao: estab.descricao || estab.tipo || 'Matriz',
      receita: formatarNumeroBR(receitaValor),
      aliquota: estab.aliquota || aliquotaEfetiva,
      imposto: impostoValor,
      dataVencimento: estab.dataVencimento || dataVencimento,
    };
  });

  const impostoPct = receitaBrutaTotal > 0 ? (impostoTotal / receitaBrutaTotal) * 100 : 0;
  const impostoPctLabel = receitaBrutaTotal > 0 ? `${Math.round(impostoPct)}%` : '0%';
  const impostoAltura = receitaBrutaTotal > 0 ? Math.max(impostoPct, 10) : 10;

  const s1Normalizado = {
    ...s1Raw,
    anexo: s1Raw.anexoSimples || dadosPgdas.anexo,
    dataVencimento,
    faturamento: {
      descricao: 'Matriz',
      valor: receitaBrutaTotal,
      valorFormatado: formatarValorBR(receitaBrutaTotal),
    },
    imposto: {
      valor: impostoTotal,
      valorFormatado: formatarValorBR(impostoTotal),
      aliquotaEfetivaFormatada: aliquotaEfetiva,
      totalRetidoFormatado: formatarValorBR(retencoesTotal),
      impostoPagarFormatado: formatarValorBR(impostoPagar),
      temRetencao: retencoesTotal > 0,
    },
    grafico: {
      faturamentoAltura: 100,
      faturamentoLabel: '100%',
      impostoAltura,
      impostoLabel: impostoPctLabel,
    },
    totais: {
      faturamento: formatarValorBR(receitaBrutaTotal),
      imposto: formatarValorBR(impostoTotal),
    },
    estabelecimentos,
  };

  const dadosExtrato = (s2Raw.dadosExtrato as Record<string, unknown>) || {};
  const movimentoTotalValor = parseValorBR(s2Raw.movimentacaoTotal || dadosExtrato.totalMovimentoReal);
  const vendasCartaoValor = parseValorBR(
    (s2Raw.vendasCartao as Record<string, unknown>)?.total ||
      (dadosExtrato.vendasCartao as Record<string, unknown>)?.total
  );
  const pixValor = parseValorBR((s2Raw.pix as Record<string, unknown>)?.total || (dadosExtrato.pix as Record<string, unknown>)?.total);
  const transferenciasValor = parseValorBR(
    (s2Raw.transferenciasRecebidas as Record<string, unknown>)?.total ||
      (dadosExtrato.transferenciasRecebidas as Record<string, unknown>)?.total
  );
  const depositosValor = parseValorBR((s2Raw.depositos as Record<string, unknown>)?.total || (dadosExtrato.depositos as Record<string, unknown>)?.total);

  const faturamentoDeclaradoValor = parseValorBR(
    s1Raw.receitaBrutaMes || s1Raw.receitaBrutaTotal || dadosPgdas.receitaBrutaMes
  );

  const divergenciaValor = Math.abs(faturamentoDeclaradoValor - movimentoTotalValor);
  const divergenciaPct = movimentoTotalValor > 0 ? (divergenciaValor / movimentoTotalValor) * 100 : 0;

  const s2Normalizado = {
    ...s2Raw,
    banco: dadosExtrato.banco || s2Raw.banco,
    temMovimento: movimentoTotalValor > 0 || vendasCartaoValor > 0 || pixValor > 0 || transferenciasValor > 0 || depositosValor > 0,
    movimento: {
      total: { valor: movimentoTotalValor, valorFormatado: formatarValorBR(movimentoTotalValor) },
      vendasCartao: { valor: vendasCartaoValor, valorFormatado: formatarValorBR(vendasCartaoValor) },
      pix: { valor: pixValor, valorFormatado: formatarValorBR(pixValor) },
      transferencias: { valor: transferenciasValor, valorFormatado: formatarValorBR(transferenciasValor) },
      depositos: { valor: depositosValor, valorFormatado: formatarValorBR(depositosValor) },
    },
    movimentoTotal: { valor: movimentoTotalValor, valorFormatado: formatarValorBR(movimentoTotalValor) },
    faturamentoDeclarado: {
      valor: faturamentoDeclaradoValor,
      valorFormatado: formatarValorBR(faturamentoDeclaradoValor),
    },
    divergencia: {
      valor: divergenciaValor,
      valorFormatado: formatarValorBR(divergenciaValor),
      porcentagem: `${divergenciaPct.toFixed(2)}%`,
    },
    interpretacao:
      faturamentoDeclaradoValor < movimentoTotalValor
        ? 'Faturamento declarado menor que o movimento bancário.'
        : 'Faturamento declarado em conformidade.',
  };

  const nfse = (s3Raw.nfse as Record<string, unknown>) || {};
  const nfe = (s3Raw.nfe as Record<string, unknown>) || {};
  const cte = (s3Raw.cte as Record<string, unknown>) || {};
  const nfce = (s3Raw.nfce as Record<string, unknown>) || {};

  const nfseQtd = Number(nfse.quantidade || 0);
  const nfeQtd = Number(nfe.quantidade || 0);
  const cteQtd = Number(cte.quantidade || 0);
  const nfceQtd = Number(nfce.quantidade || 0);

  const gaps = (nfse.gapsNumeracao as Array<unknown>) || [];
  const notasCanceladas = (nfse.notasCanceladas as Array<unknown>) || [];

  const s3Normalizado = {
    ...s3Raw,
    documentosFiscais: {
      nfe: { status: nfeQtd > 0 ? `Analisado (${nfeQtd})` : 'Não analisado' },
      nfce: { status: nfceQtd > 0 ? `Analisado (${nfceQtd})` : 'Não analisado' },
      cte: { status: cteQtd > 0 ? `Analisado (${cteQtd})` : 'Não analisado' },
      nfse: {
        status: nfseQtd > 0 ? `Analisado (${nfseQtd})` : 'Não analisado',
        quantidadeCanceladas: notasCanceladas.length,
        observacoes: nfse.observacoes || '',
      },
    },
    notasDuplicadas: {
      mensagem: gaps.length > 0 ? `Foram identificadas ${gaps.length} lacunas de numeração` : 'Nenhuma nota duplicada detectada',
    },
  };

  // Seção 4 (lucro/prejuízo) - tenta montar tabela mensal a partir do histórico
  const receitasMensais = (s5Raw.receitasMensais as Array<Record<string, unknown>>) || [];
  const impostosMensais = (s5Raw.impostosMensais as Array<Record<string, unknown>>) || [];
  const folhasMensais = (s5Raw.folhasMensais as Array<Record<string, unknown>>) || [];

  const mapaMeses = new Map<string, { faturamento?: number; impostos?: number; compras?: number; folha?: number }>();

  const addValor = (lista: Array<Record<string, unknown>>, campo: 'faturamento' | 'impostos' | 'folha') => {
    for (const item of lista) {
      const mes = String(item.mes || item.competencia || '').trim();
      if (!mes) continue;
      const entry = mapaMeses.get(mes) || {};
      entry[campo] = parseValorBR(item.valor);
      mapaMeses.set(mes, entry);
    }
  };

  addValor(receitasMensais, 'faturamento');
  addValor(impostosMensais, 'impostos');
  addValor(folhasMensais, 'folha');

  const ordenarMes = (mes: string) => {
    const [mm, yyyy] = mes.split('/');
    const m = Number(mm);
    const y = Number(yyyy);
    if (!m || !y) return 0;
    return new Date(y, m - 1, 1).getTime();
  };

  const mesesOrdenados = Array.from(mapaMeses.entries()).sort((a, b) => ordenarMes(a[0]) - ordenarMes(b[0]));
  const mesesTabela = mesesOrdenados.length
    ? mesesOrdenados.map(([mes, vals]) => {
        const faturamento = vals.faturamento || 0;
        const impostos = vals.impostos || 0;
        const compras = vals.compras || 0;
        const folha = vals.folha || 0;
        const lucro = faturamento - impostos - compras - folha;
        return {
          mes,
          faturamento: { valorFormatado: formatarValorBR(faturamento) },
          impostos: { valorFormatado: formatarValorBR(impostos) },
          compras: { valorFormatado: formatarValorBR(compras) },
          folha: { valorFormatado: formatarValorBR(folha) },
          lucro: {
            valorFormatado: formatarValorBR(lucro),
            cor: lucro >= 0 ? '#10b981' : '#dc2626',
          },
        };
      })
    : null;

  const totaisS4 = mesesOrdenados.length
    ? mesesOrdenados.reduce(
        (acc, [, vals]) => {
          acc.faturamento += vals.faturamento || 0;
          acc.impostos += vals.impostos || 0;
          acc.compras += vals.compras || 0;
          acc.folha += vals.folha || 0;
          return acc;
        },
        { faturamento: 0, impostos: 0, compras: 0, folha: 0 }
      )
    : null;

  const s4Normalizado = {
    ...s4Raw,
    meses: mesesTabela || undefined,
    totais: totaisS4
      ? {
          faturamento: { valorFormatado: formatarValorBR(totaisS4.faturamento) },
          impostos: { valorFormatado: formatarValorBR(totaisS4.impostos) },
          compras: { valorFormatado: formatarValorBR(totaisS4.compras) },
          folha: { valorFormatado: formatarValorBR(totaisS4.folha) },
          lucro: {
            valorFormatado: formatarValorBR(
              totaisS4.faturamento - totaisS4.impostos - totaisS4.compras - totaisS4.folha
            ),
            cor: '#374151',
          },
        }
      : undefined,
  };

  const docsLista = (Array.isArray(s7Raw.listaDocumentos) && s7Raw.listaDocumentos.length > 0
    ? s7Raw.listaDocumentos
    : (s7Raw.documentosProcessados as Array<Record<string, unknown>>)) || [];

  const docsNormalizados = docsLista.map((doc, index) => {
    const status = String(doc.status || '').toLowerCase();
    const analisado = status === 'processado';
    const nomeBase = String(doc.nomeArquivo || doc.nome || doc.tipo || `Documento ${index + 1}`);
    const periodo = doc.periodo ? ` (${doc.periodo})` : '';
    return {
      numero: index + 1,
      nome: `${nomeBase}${periodo}`,
      analisado,
      icone: analisado ? '✓' : '✗',
      cor: analisado ? '#10b981' : '#ef4444',
      enviado: analisado,
    };
  });

  const documentosSecao5 = docsNormalizados.length
    ? docsNormalizados.map((d) => ({
        nome: d.nome,
        enviado: d.enviado,
        icone: d.enviado ? '✓' : '•',
      }))
    : undefined;

  const s5Normalizado = {
    ...s5Raw,
    documentos: documentosSecao5,
  };

  const s6Normalizado = {
    ...s6Raw,
    documentos: docsNormalizados.length ? docsNormalizados : undefined,
    resumo: {
      total: docsNormalizados.length,
      analisados: docsNormalizados.filter((d) => d.analisado).length,
      naoAnalisados: docsNormalizados.filter((d) => !d.analisado).length,
    },
  };

  const simples = (s6Raw.simples as Record<string, unknown>) || {};
  const presumido = (s6Raw.presumido as Record<string, unknown>) || {};
  const regimeAtual = String(s6Raw.regimeAtual || s6Raw.regimeCadastrado || '').toLowerCase();
  const anexoSimples = String(s1Normalizado.anexo || simples.anexo || '').toUpperCase();
  const isRegimeAtualSimples = regimeAtual.includes('simples');

  const montarCardSimples = (anexo: 'III' | 'V') => {
    const temDados = anexoSimples === anexo;
    const ehRegimeAtual = isRegimeAtualSimples && temDados;
    return {
      anexo,
      impostoFormatado: temDados ? (simples.valor as string) || 'N/D' : 'N/D',
      aliquotaFormatada: temDados ? (simples.aliquotaEfetiva as string) || 'N/D' : 'N/D',
      faixaAtual: stripMoeda(s6Raw.rbt12 || ''),
      ehRegimeAtual,
      textoDestaque: ehRegimeAtual ? 'Regime atual' : '',
      corDestaque: ehRegimeAtual ? '#10b981' : '#3b82f6',
      bordaDestaque: ehRegimeAtual ? '2px solid #10b981' : '2px solid #e5e7eb',
      ehMaisCaro: false,
      diferencaFormatada: '',
    };
  };

  const s7Normalizado = {
    temDadosSuficientes: Boolean(simples.valor || presumido.valor),
    fatorR: {
      valorFormatado: String(s6Raw.fatorR || '0%'),
      textoExplicativo: s6Raw.fatorROrigem ? `Fator R ${s6Raw.fatorROrigem}` : 'Fator R',
    },
    simplesNacionalAnexoIII: montarCardSimples('III'),
    simplesNacionalAnexoV: montarCardSimples('V'),
    lucroPresumido: {
      impostoFormatado: (presumido.valor as string) || 'N/D',
      aliquotaEfetivaFormatada: (presumido.aliquotaEfetiva as string) || 'N/D',
      presuncao: presumido.presuncao || 'N/D',
      ehMaisCaro: false,
      diferencaFormatada: '',
    },
  };

  return {
    ...dados,
    dadosCabecalho: {
      ...cab,
      dataGeracaoFormatada: (cab as Record<string, unknown>)?.dataGeracaoFormatada || cab.dataGeracao,
    },
    dadosSecao1: s1Normalizado,
    dadosSecao2: s2Normalizado,
    dadosSecao3: s3Normalizado,
    dadosSecao4: s4Normalizado,
    dadosSecao5: s5Normalizado,
    dadosSecao6: s6Normalizado,
    dadosSecao7: s7Normalizado,
    dadosSecao8: s8Raw,
  };
}

function gerarHtmlParecer(data: Record<string, unknown>): string {
  // ============================================================
  // PARSE DOS DADOS
  // ============================================================
  // O secoes_json pode vir como string JSON ou objeto
  
  let dados = data.secoes_json as Record<string, unknown>;

  // Se vier como string JSON, parsear
  if (typeof dados === 'string') {
    dados = JSON.parse(dados);
  }

  // Normaliza estrutura para o template do PDF
  dados = normalizarSecoesParaPdf(dados);

  console.log('Dados parseados com sucesso!');
  console.log('Empresa:', (dados.dadosCabecalho as Record<string, unknown>)?.razaoSocial);

  // ============================================================
  // EXTRAÇÃO DAS SEÇÕES
  // ============================================================
  // Cada seção contém dados específicos para uma parte do parecer
  
  const cab = dados.dadosCabecalho as Record<string, unknown>;
  const s1 = dados.dadosSecao1 as Record<string, unknown>;
  const s2 = dados.dadosSecao2 as Record<string, unknown>;
  const s3 = dados.dadosSecao3 as Record<string, unknown>;
  const s4 = dados.dadosSecao4 as Record<string, unknown>;
  const s5 = dados.dadosSecao5 as Record<string, unknown>;
  const s6 = dados.dadosSecao6 as Record<string, unknown>;
  const s7 = dados.dadosSecao7 as Record<string, unknown> | null;
  const s8 = dados.dadosSecao8 as Record<string, unknown>;

  // ============================================================
  // CORREÇÃO DA SEÇÃO 8 - OBSERVAÇÃO AUTOMÁTICA
  // ============================================================
  // Gera texto de observação baseado nos dados encontrados
  // Inclui: regime, atividade, divergências, status do DAS
  
  const anexo = s1?.anexo || (s8?.detalhes as Record<string, unknown>)?.anexo || 'III';
  const atividade = ['I', 'II'].includes(anexo as string) ? 'comércio' : 'prestação de serviços';

  const divergencia = s2?.divergencia as Record<string, unknown> | undefined;
  const divergenciaFormatada = divergencia?.valorFormatado || 'R$ 0,00';
  const divergenciaPct = divergencia?.porcentagem || '0%';
  const divergenciaExiste = (divergencia?.valor as number) > 0;

  // Texto automático para a observação final
  const observacaoCorrigida = `A empresa ${cab?.razaoSocial} é optante pelo Simples Nacional e atua no ramo de ${atividade}, enquadrada no Anexo ${anexo}. O extrato bancário (${s2?.banco || 'não informado'}) ${divergenciaExiste ? 'apresenta divergência de ' + divergenciaFormatada + ' (' + divergenciaPct + ')' : 'está em conformidade'} entre o movimento financeiro e a receita declarada. O DAS da competência ${cab?.periodo} está pendente de pagamento.`;

  // ============================================================
  // VALIDAÇÃO DA SEÇÃO 7 - COMPARAÇÃO DE REGIMES
  // ============================================================
  // Só exibe para prestadores de serviços (anexos III, IV, V)
  // Comércio (anexos I, II) não precisa dessa análise
  
  const ehComercio = ['I', 'II'].includes(anexo as string);
  const mostrarSecao7 = !ehComercio && s7 !== null && (s7 as Record<string, unknown>)?.temDadosSuficientes;

  console.log('Mostrar Seção 7?', mostrarSecao7);

  // ============================================================
  // CORREÇÃO DO STATUS DOS DOCUMENTOS
  // ============================================================
  // Marca documentos de cartão como "analisados" se houver vendas
  // Isso corrige o status visual na seção 6
  
  const movimento = s2?.movimento as Record<string, unknown> | undefined;
  const vendasCartao = movimento?.vendasCartao as Record<string, unknown> | undefined;
  const temVendasCartao = (vendasCartao?.valor as number) > 0;

  const s6Docs = s6?.documentos as Array<Record<string, unknown>> | undefined;
  const s6Resumo = s6?.resumo as Record<string, number> | undefined;

  if (s6Docs && s6Resumo) {
    for (const doc of s6Docs) {
      // Se o documento é de cartão/administradora e temos vendas de cartão
      if ((doc.nome as string)?.toLowerCase().includes('cartão') || (doc.nome as string)?.toLowerCase().includes('administradora')) {
        if (temVendasCartao) {
          doc.analisado = true;
          doc.icone = '✓';
          doc.cor = '#10b981'; // Verde
        }
      }
    }
    // Recalcula contadores
    s6Resumo.analisados = s6Docs.filter(d => d.analisado).length;
    s6Resumo.naoAnalisados = s6Docs.filter(d => !d.analisado).length;
  }

  // ============================================================
  // EXTRAÇÃO DE DADOS PARA O TEMPLATE
  // ============================================================
  
  const faturamento = s1?.faturamento as Record<string, unknown> | undefined;
  const imposto = s1?.imposto as Record<string, unknown> | undefined;
  const grafico = s1?.grafico as Record<string, unknown> | undefined;
  const totais = s1?.totais as Record<string, unknown> | undefined;
  const estabelecimentos = s1?.estabelecimentos as Array<Record<string, unknown>> | undefined;

  const movimentoTotal = movimento?.total as Record<string, unknown> | undefined;
  const faturamentoDeclarado = s2?.faturamentoDeclarado as Record<string, unknown> | undefined;

  const documentosFiscais = s3?.documentosFiscais as Record<string, unknown> | undefined;
  const nfe = documentosFiscais?.nfe as Record<string, unknown> | undefined;
  const nfce = documentosFiscais?.nfce as Record<string, unknown> | undefined;
  const cte = documentosFiscais?.cte as Record<string, unknown> | undefined;
  const nfse = documentosFiscais?.nfse as Record<string, unknown> | undefined;
  const notasDuplicadas = s3?.notasDuplicadas as Record<string, unknown> | undefined;

  const meses = s4?.meses as Array<Record<string, unknown>> | undefined;
  const totaisS4 = s4?.totais as Record<string, unknown> | undefined;
  const s5Docs = s5?.documentos as Array<Record<string, unknown>> | undefined;

  // ============================================================
  // TEMPLATE HTML COMPLETO
  // ============================================================
  // Usa CSS inline para garantir renderização correta no PDF
  // Layout otimizado para formato A4 com quebras de página
  
  const htmlCompleto = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
    <meta charset="UTF-8">
    <title>Parecer Fiscal - ${cab?.periodo}</title>
    <style>
        /* ============================================
           ESTILOS GLOBAIS - FORMATAÇÃO A4
           ============================================ */
        @page { size: A4; margin: 15mm 10mm; }
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: 'Segoe UI', sans-serif; font-size: 11px; color: #374151; }
        
        /* ============================================
           HEADER - CABEÇALHO DO PARECER
           ============================================ */
        .header { background: linear-gradient(135deg, #1e40af 0%, #3b82f6 100%); color: white; padding: 15px; text-align: center; margin-bottom: 15px; border-radius: 6px; }
        .header h1 { font-size: 18px; margin-bottom: 5px; }
        
        /* ============================================
           INFO DA EMPRESA - GRID 2x2
           ============================================ */
        .empresa-info { display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; margin-bottom: 20px; background: #f8fafc; padding: 15px; border-radius: 6px; border: 1px solid #e5e7eb; }
        .info-item { display: flex; gap: 8px; }
        .info-label { font-size: 9px; color: #6b7280; text-transform: uppercase; font-weight: 600; }
        .info-value { font-size: 11px; font-weight: 600; color: #1e293b; }
        
        /* ============================================
           SEÇÕES - BLOCOS PRINCIPAIS
           ============================================ */
        .section { margin-bottom: 25px; page-break-inside: avoid; }
        .section h2 { background: #f1f5f9; color: #334155; padding: 10px 15px; margin-bottom: 15px; font-size: 14px; font-weight: 700; border-left: 4px solid #3b82f6; border-radius: 4px; }
        .section h3 { color: #475569; font-size: 12px; font-weight: 600; margin-bottom: 12px; }
        
        /* ============================================
           TABELAS - ESTILO CORPORATIVO
           ============================================ */
        table { width: 100%; border-collapse: collapse; font-size: 10px; border: 2px solid #d97706; margin-bottom: 15px; }
        th, td { padding: 8px 6px; border: 1px solid #d97706; }
        th { background: #fbbf24; color: #78350f; font-weight: 700; }
        .text-center { text-align: center; }
        .linha-total { background: #fef3c7 !important; font-weight: bold; }
        
        /* ============================================
           ALERTAS - INFO E WARNING
           ============================================ */
        .alert { padding: 12px 15px; border-radius: 6px; margin: 15px 0; }
        .alert-info { background: #eff6ff; border: 1px solid #bfdbfe; color: #1e3a8a; }
        .alert-warning { background: #fef3c7; border: 1px solid #fde68a; color: #78350f; }
        
        /* ============================================
           GRIDS E CARDS
           ============================================ */
        .grid-2x2 { display: grid; grid-template-columns: repeat(2, 1fr); gap: 15px; margin-bottom: 15px; }
        .grid-item { background: #e0f2fe; padding: 15px; border-radius: 6px; border-left: 4px solid #0284c7; }
        .grid-item h4 { margin: 0 0 8px 0; color: #0369a1; font-size: 11px; }
        
        /* ============================================
           GRÁFICO DE BARRAS - FATURAMENTO X IMPOSTOS
           ============================================ */
        .chart-wrapper { background: white; padding: 25px; border-radius: 8px; border: 2px solid #e5e7eb; margin: 20px 0; }
        .chart-title { text-align: center; color: #1f2937; margin-bottom: 35px; font-size: 16px; font-weight: bold; padding-bottom: 10px; border-bottom: 1px solid #e5e7eb; }
        .chart-bars-area { display: flex; justify-content: space-around; align-items: flex-end; height: 280px; margin: 0 40px; background: #f8fafc; padding: 20px; border-radius: 8px; }
        .bar-column { display: flex; flex-direction: column; align-items: center; width: 140px; position: relative; }
        .bar-value-box { position: absolute; top: -45px; text-align: center; width: 100%; }
        .bar-value { font-size: 15px; font-weight: bold; color: #1f2937; background: white; padding: 6px 10px; border-radius: 4px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
        .bar-container { position: relative; width: 90px; height: 200px; display: flex; align-items: flex-end; }
        .bar { width: 100%; border-radius: 8px 8px 0 0; display: flex; align-items: center; justify-content: center; }
        .bar-faturamento { background: linear-gradient(to top, #2563eb, #3b82f6); border: 2px solid #1d4ed8; box-shadow: 0 4px 8px rgba(59, 130, 246, 0.3); }
        .bar-impostos { background: linear-gradient(to top, #dc2626, #ef4444); border: 2px solid #b91c1c; box-shadow: 0 4px 8px rgba(239, 68, 68, 0.3); min-height: 40px; }
        .bar-percentage { color: white; font-size: 14px; font-weight: bold; text-shadow: 0 1px 2px rgba(0,0,0,0.5); }
        .bar-label { margin-top: 15px; text-align: center; }
        .bar-label-text { font-size: 14px; font-weight: bold; }
        .bar-label-faturamento { color: #3b82f6; }
        .bar-label-impostos { color: #ef4444; }
        
        /* ============================================
           CARDS DE COMPARAÇÃO DE REGIMES
           ============================================ */
        .regimes-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 15px; margin: 20px 0; }
        .regime-card { background: white; border: 2px solid #e5e7eb; border-radius: 8px; padding: 20px; }
        .regime-titulo { font-size: 13px; font-weight: bold; color: #1f2937; margin-bottom: 12px; text-align: center; }
        .regime-valor { font-size: 18px; font-weight: bold; color: #3b82f6; text-align: center; margin: 10px 0; }
        .regime-detalhes { font-size: 10px; color: #6b7280; margin-top: 10px; }
        .vantagem { background: #d1fae5 !important; border-color: #10b981 !important; }
    </style>
</head>
<body>
    <div class="container">
        <!-- ============================================
             HEADER - TÍTULO E PERÍODO
             ============================================ -->
        <header class="header">
            <h1>PARECER SOBRE A APURAÇÃO FISCAL</h1>
            <div>${cab?.periodoFormatado || cab?.periodo}</div>
        </header>

        <!-- ============================================
             INFO DA EMPRESA - RAZÃO SOCIAL, CNPJ, ETC
             ============================================ -->
        <div class="empresa-info">
            <div class="info-item">
                <div>
                    <div class="info-label">Razão Social</div>
                    <div class="info-value">${cab?.razaoSocial}</div>
                </div>
            </div>
            <div class="info-item">
                <div>
                    <div class="info-label">CNPJ</div>
                    <div class="info-value">${cab?.cnpj}</div>
                </div>
            </div>
            <div class="info-item">
                <div>
                    <div class="info-label">Regime Tributário</div>
                    <div class="info-value">${cab?.regimeTributario}</div>
                </div>
            </div>
            <div class="info-item">
                <div>
                    <div class="info-label">Período Analisado</div>
                    <div class="info-value">${cab?.periodo}</div>
                </div>
            </div>
        </div>

        <!-- ============================================
             SEÇÃO 1: FATURAMENTO X IMPOSTOS
             Tabela de estabelecimentos + gráfico de barras
             ============================================ -->
        <section class="section">
            <h2>📊 1. Análise Faturamento Declarado x Impostos</h2>
            <h3>a) Valores da Apuração da Competência Atual</h3>
            <table>
                <thead>
                    <tr><th colspan="7" class="text-center" style="font-size: 12px; padding: 12px;">SIMPLES NACIONAL</th></tr>
                    <tr>
                        <th>FATURAMENTO</th>
                        <th class="text-center">RECEITA</th>
                        <th class="text-center">ALÍQUOTA</th>
                        <th class="text-center">TOTAL IMPOSTO</th>
                        <th class="text-center">IMPOSTO RETIDO</th>
                        <th class="text-center">IMPOSTO A PAGAR</th>
                        <th class="text-center">DATA VENCIMENTO</th>
                    </tr>
                </thead>
                <tbody>
                    ${estabelecimentos && estabelecimentos.length > 0 ? estabelecimentos.map((estab, index) => `
                    <tr>
                        <td style="font-weight: bold;">${estab.descricao}</td>
                        <td class="text-center">R$ ${estab.receita || '0,00'}</td>
                        <td class="text-center">${estab.aliquota}</td>
                        <td class="text-center">${estab.imposto}</td>
                        <td class="text-center" style="color: ${imposto?.temRetencao ? '#f59e0b' : '#6b7280'};">${imposto?.totalRetidoFormatado || 'R$ 0,00'}</td>
                        <td class="text-center" style="color: #10b981; font-weight: bold;">${imposto?.impostoPagarFormatado || estab.imposto}</td>
                        ${index === 0 ? `<td class="text-center" rowspan="${estabelecimentos.length}" style="color: #dc2626; font-weight: bold; vertical-align: middle;">${estab.dataVencimento || estabelecimentos[estabelecimentos.length - 1].dataVencimento}</td>` : ''}
                    </tr>
                    `).join('') : `
                    <tr>
                        <td style="font-weight: bold;">${faturamento?.descricao || 'Matriz'}</td>
                        <td class="text-center">${faturamento?.valorFormatado || 'R$ 0,00'}</td>
                        <td class="text-center">${imposto?.aliquotaEfetivaFormatada || '0%'}</td>
                        <td class="text-center">${imposto?.valorFormatado || 'R$ 0,00'}</td>
                        <td class="text-center" style="color: ${imposto?.temRetencao ? '#f59e0b' : '#6b7280'};">${imposto?.totalRetidoFormatado || 'R$ 0,00'}</td>
                        <td class="text-center" style="color: #10b981; font-weight: bold;">${imposto?.impostoPagarFormatado || imposto?.valorFormatado || 'R$ 0,00'}</td>
                        <td class="text-center" style="color: #dc2626; font-weight: bold;">${s1?.dataVencimento || '-'}</td>
                    </tr>
                    `}
                    <tr class="linha-total">
                        <td>TOTAL</td>
                        <td class="text-center">${totais?.faturamento || faturamento?.valorFormatado || 'R$ 0,00'}</td>
                        <td class="text-center">${imposto?.aliquotaEfetivaFormatada || ''}</td>
                        <td class="text-center">${totais?.imposto || imposto?.valorFormatado || 'R$ 0,00'}</td>
                        <td class="text-center" style="color: ${imposto?.temRetencao ? '#f59e0b' : '#6b7280'};">${imposto?.totalRetidoFormatado || 'R$ 0,00'}</td>
                        <td class="text-center" style="color: #10b981; font-weight: bold;">${imposto?.impostoPagarFormatado || totais?.imposto || imposto?.valorFormatado || 'R$ 0,00'}</td>
                        <td></td>
                    </tr>
                </tbody>
            </table>
        
            <!-- Gráfico de Barras: Faturamento x Impostos -->
            <h3>b) Variação de Faturamentos e Impostos</h3>
            <div class="chart-wrapper">
                <h4 class="chart-title">Variação de Faturamento x Impostos</h4>
                <div class="chart-bars-area">
                    <div class="bar-column">
                        <div class="bar-value-box"><span class="bar-value">${totais?.faturamento || faturamento?.valorFormatado || 'R$ 0,00'}</span></div>
                        <div class="bar-container">
                            <div class="bar bar-faturamento" style="height: ${grafico?.faturamentoAltura || 100}%;">
                                <span class="bar-percentage">${grafico?.faturamentoLabel || '100%'}</span>
                            </div>
                        </div>
                        <div class="bar-label"><span class="bar-label-text bar-label-faturamento">Faturamento</span></div>
                    </div>
                    <div class="bar-column">
                        <div class="bar-value-box"><span class="bar-value">${totais?.imposto || imposto?.valorFormatado || 'R$ 0,00'}</span></div>
                        <div class="bar-container">
                            <div class="bar bar-impostos" style="height: ${grafico?.impostoAltura || 10}%;">
                                <span class="bar-percentage">${grafico?.impostoLabel || '0%'}</span>
                            </div>
                        </div>
                        <div class="bar-label"><span class="bar-label-text bar-label-impostos">Impostos</span></div>
                    </div>
                </div>
            </div>
        </section>

        <!-- ============================================
             SEÇÃO 2: MOVIMENTO FINANCEIRO
             Barras horizontais + alerta de divergência
             ============================================ -->
        <section class="section">
            <h2>💰 2. Análise Faturamento Declarado x Movimento Financeiro</h2>
            <h3>Vendas Administradoras e Movimento Extrato Bancário - ${s2?.banco || 'Não informado'}</h3>
            
            ${s2?.temMovimento ? `
            <div class="chart-wrapper" style="margin-bottom: 20px;">
                <h4 class="chart-title">Comparativo: Movimento Financeiro x Faturamento Declarado</h4>
                <div style="display: flex; flex-direction: column; gap: 15px; padding: 20px; background: #f8fafc; border-radius: 8px;">
                    
                    <!-- Vendas Cartão -->
                    <div style="display: grid; grid-template-columns: 180px 120px 1fr; align-items: center; gap: 10px;">
                        <div style="font-weight: 600; font-size: 11px; color: #475569;">Vendas Cartão</div>
                        <div style="font-weight: bold; font-size: 12px; color: #1e293b; text-align: right;">${vendasCartao?.valorFormatado || 'R$ 0,00'}</div>
                        <div style="background: #e5e7eb; border-radius: 4px; height: 30px; position: relative; overflow: hidden;">
                            <div style="background: linear-gradient(90deg, #3b82f6, #2563eb); height: 100%; width: ${Math.min(((vendasCartao?.valor as number) || 0) / ((movimentoTotal?.valor as number) || 1) * 100, 100)}%; border-radius: 4px;"></div>
                        </div>
                    </div>
                    
                    <!-- PIX -->
                    <div style="display: grid; grid-template-columns: 180px 120px 1fr; align-items: center; gap: 10px;">
                        <div style="font-weight: 600; font-size: 11px; color: #475569;">PIX</div>
                        <div style="font-weight: bold; font-size: 12px; color: #1e293b; text-align: right;">${(movimento?.pix as Record<string, unknown>)?.valorFormatado || 'R$ 0,00'}</div>
                        <div style="background: #e5e7eb; border-radius: 4px; height: 30px; position: relative; overflow: hidden;">
                            <div style="background: linear-gradient(90deg, #10b981, #059669); height: 100%; width: ${Math.min((((movimento?.pix as Record<string, unknown>)?.valor as number) || 0) / ((movimentoTotal?.valor as number) || 1) * 100, 100)}%; border-radius: 4px;"></div>
                        </div>
                    </div>
                    
                    <!-- Transferências -->
                    <div style="display: grid; grid-template-columns: 180px 120px 1fr; align-items: center; gap: 10px;">
                        <div style="font-weight: 600; font-size: 11px; color: #475569;">Transferências</div>
                        <div style="font-weight: bold; font-size: 12px; color: #1e293b; text-align: right;">${(movimento?.transferencias as Record<string, unknown>)?.valorFormatado || 'R$ 0,00'}</div>
                        <div style="background: #e5e7eb; border-radius: 4px; height: 30px; position: relative; overflow: hidden;">
                            <div style="background: linear-gradient(90deg, #f59e0b, #d97706); height: 100%; width: ${Math.min((((movimento?.transferencias as Record<string, unknown>)?.valor as number) || 0) / ((movimentoTotal?.valor as number) || 1) * 100, 100)}%; border-radius: 4px;"></div>
                        </div>
                    </div>
                    
                    <!-- Depósitos -->
                    <div style="display: grid; grid-template-columns: 180px 120px 1fr; align-items: center; gap: 10px;">
                        <div style="font-weight: 600; font-size: 11px; color: #475569;">Depósitos</div>
                        <div style="font-weight: bold; font-size: 12px; color: #1e293b; text-align: right;">${(movimento?.depositos as Record<string, unknown>)?.valorFormatado || 'R$ 0,00'}</div>
                        <div style="background: #e5e7eb; border-radius: 4px; height: 30px; position: relative; overflow: hidden;">
                            <div style="background: linear-gradient(90deg, #8b5cf6, #7c3aed); height: 100%; width: ${Math.min((((movimento?.depositos as Record<string, unknown>)?.valor as number) || 0) / ((movimentoTotal?.valor as number) || 1) * 100, 100)}%; border-radius: 4px;"></div>
                        </div>
                    </div>
                    
                    <!-- SEPARADOR -->
                    <div style="height: 1px; background: #cbd5e1; margin: 10px 0;"></div>
                    
                    <!-- Total Movimento -->
                    <div style="display: grid; grid-template-columns: 180px 120px 1fr; align-items: center; gap: 10px;">
                        <div style="font-weight: 700; font-size: 12px; color: #1e293b;">Total Movimento</div>
                        <div style="font-weight: bold; font-size: 13px; color: #1e293b; text-align: right;">${movimentoTotal?.valorFormatado || 'R$ 0,00'}</div>
                        <div style="background: #e5e7eb; border-radius: 4px; height: 35px; position: relative; overflow: hidden;">
                            <div style="background: linear-gradient(90deg, #64748b, #475569); height: 100%; width: 100%; border-radius: 4px;"></div>
                        </div>
                    </div>
                    
                    <!-- Faturamento Declarado -->
                    <div style="display: grid; grid-template-columns: 180px 120px 1fr; align-items: center; gap: 10px;">
                        <div style="font-weight: 700; font-size: 12px; color: #1e293b;">Faturamento Declarado</div>
                        <div style="font-weight: bold; font-size: 13px; color: #dc2626; text-align: right;">${faturamentoDeclarado?.valorFormatado || 'R$ 0,00'}</div>
                        <div style="background: #e5e7eb; border-radius: 4px; height: 35px; position: relative; overflow: hidden;">
                            <div style="background: linear-gradient(90deg, #dc2626, #b91c1c); height: 100%; width: ${Math.min(((faturamentoDeclarado?.valor as number) || 0) / ((movimentoTotal?.valor as number) || 1) * 100, 100)}%; border-radius: 4px; border: 2px solid #991b1b;"></div>
                        </div>
                    </div>
                </div>
            </div>
            
            <!-- Alerta de divergência ou conformidade -->
            ${(() => {
                const movTotal = (movimentoTotal?.valor as number) || 0;
                const fatDecl = (faturamentoDeclarado?.valor as number) || 0;
                const diverg = (divergencia?.valor as number) || 0;
                
                if (fatDecl >= movTotal) {
                    return `
                    <div class="alert alert-info" style="background: #d1fae5; border-color: #10b981; color: #065f46;">
                        <strong>✓ Parabéns!</strong> Seu faturamento declarado está em conformidade com o movimento bancário.
                        <br>
                        <span style="font-size: 12px; margin-top: 8px; display: block;">
                            Faturamento declarado é <strong style="color: #059669;">${divergencia?.valorFormatado}</strong> (${divergencia?.porcentagem}) maior que o movimento bancário. Tudo certo!
                        </span>
                    </div>
                    `;
                } else if (diverg > 0) {
                    return `
                    <div class="alert alert-warning">
                        <strong>⚠️ Atenção:</strong> ${s2?.interpretacao}
                        <br>
                        <span style="font-size: 12px; margin-top: 8px; display: block;">
                            Diferença detectada: <strong style="color: #dc2626;">${divergencia?.valorFormatado}</strong> (${divergencia?.porcentagem})
                        </span>
                    </div>
                    `;
                } else {
                    return `
                    <div class="alert alert-info" style="background: #d1fae5; border-color: #10b981; color: #065f46;">
                        <strong>✓ Parabéns!</strong> Nenhuma divergência detectada entre o faturamento declarado e a movimentação bancária.
                    </div>
                    `;
                }
            })()}
            ` : `
            <div class="alert alert-info">
                <strong>ℹ️ Informação:</strong> Dados de movimento financeiro não fornecidos.
            </div>
            `}
        </section>

        <!-- ============================================
             SEÇÃO 3: DOCUMENTOS FISCAIS
             Status de NFe, NFCe, CTe, NFSe
             ============================================ -->
        <section class="section">
            <h2>📄 3. Análise dos Documentos Fiscais</h2>
            <h3>a) Status dos Documentos Fiscais</h3>
            <div class="grid-2x2">
                <div class="grid-item">
                    <h4>NF-e:</h4>
                    <p>${nfe?.status || 'Não analisado'}</p>
                </div>
                <div class="grid-item">
                    <h4>NFC-e:</h4>
                    <p>${nfce?.status || 'Não analisado'}</p>
                </div>
                <div class="grid-item">
                    <h4>CT-e:</h4>
                    <p>${cte?.status || 'Não analisado'}</p>
                </div>
                <div class="grid-item">
                    <h4>NFS-e:</h4>
                    <p>${nfse?.status || 'Não analisado'}</p>
                    ${nfse?.observacoes ? `<p style="margin-top: 8px; font-style: italic; color: #6b7280; font-size: 10px;">${nfse.observacoes}</p>` : ''}
                    ${(nfse?.quantidadeCanceladas as number) > 0 ? `<p style="margin-top: 8px; color: #dc2626; font-weight: bold;">${nfse?.quantidadeCanceladas} nota(s) cancelada(s)</p>` : ''}
                </div>
            </div>
            
            <h3>b) Notas Duplicadas</h3>
            <div class="grid-item">
                <p>${notasDuplicadas?.mensagem || 'Nenhuma nota duplicada detectada'}</p>
            </div>
        </section>

        <!-- ============================================
             SEÇÃO 4: LUCRO/PREJUÍZO FISCAL
             Tabela mensal com faturamento, impostos, compras, folha
             ============================================ -->
        <section class="section">
            <h2>📈 4. Análise do Lucro/Prejuízo Fiscal</h2>
            <h3>Tabela com valores acumulados durante o ano</h3>
            <table>
                <thead>
                    <tr>
                        <th>Mês</th>
                        <th class="text-center">Faturamento Bruto</th>
                        <th class="text-center">Impostos</th>
                        <th class="text-center">Compras</th>
                        <th class="text-center">Folha</th>
                        <th class="text-center">Lucro/Prejuízo Estimado</th>
                    </tr>
                </thead>
                <tbody>
                    ${meses ? meses.map(m => `
                    <tr>
                        <td>${m.mes}</td>
                        <td class="text-center">${(m.faturamento as Record<string, unknown>)?.valorFormatado || 'R$ 0,00'}</td>
                        <td class="text-center">${(m.impostos as Record<string, unknown>)?.valorFormatado || 'R$ 0,00'}</td>
                        <td class="text-center">${(m.compras as Record<string, unknown>)?.valorFormatado || 'R$ 0,00'}</td>
                        <td class="text-center">${(m.folha as Record<string, unknown>)?.valorFormatado || 'R$ 0,00'}</td>
                        <td class="text-center" style="color: ${(m.lucro as Record<string, unknown>)?.cor || '#374151'}; font-weight: bold;">
                            ${(m.lucro as Record<string, unknown>)?.valorFormatado || 'R$ 0,00'}
                        </td>
                    </tr>
                    `).join('') : '<tr><td colspan="6" class="text-center">Dados não disponíveis</td></tr>'}
                    <tr class="linha-total">
                        <td>TOTAL ACUMULADO</td>
                        <td class="text-center">${(totaisS4?.faturamento as Record<string, unknown>)?.valorFormatado || 'R$ 0,00'}</td>
                        <td class="text-center">${(totaisS4?.impostos as Record<string, unknown>)?.valorFormatado || 'R$ 0,00'}</td>
                        <td class="text-center">${(totaisS4?.compras as Record<string, unknown>)?.valorFormatado || 'R$ 0,00'}</td>
                        <td class="text-center">${(totaisS4?.folha as Record<string, unknown>)?.valorFormatado || 'R$ 0,00'}</td>
                        <td class="text-center" style="color: ${(totaisS4?.lucro as Record<string, unknown>)?.cor || '#374151'}; font-weight: bold; font-size: 14px;">
                            ${(totaisS4?.lucro as Record<string, unknown>)?.valorFormatado || 'R$ 0,00'}
                        </td>
                    </tr>
                </tbody>
            </table>
        </section>

        <!-- ============================================
             SEÇÃO 5: DOCUMENTOS QUE ACOMPANHAM
             Lista de documentos anexos ao parecer
             ============================================ -->
        <section class="section">
            <h2>📎 5. Documentos que Acompanham esse Parecer</h2>
            <ul style="list-style: none; padding-left: 0;">
                ${s5Docs ? s5Docs.map(doc => `
                <li style="margin-bottom: 8px;">
                    <span style="color: ${doc.enviado ? '#10b981' : '#6b7280'}; font-weight: bold; font-size: 14px;">
                        ${doc.icone}
                    </span>
                    <span>${doc.nome}</span>
                </li>
                `).join('') : '<li>Nenhum documento anexado</li>'}
            </ul>
        </section>

        <!-- ============================================
             SEÇÃO 6: DOCUMENTOS ANALISADOS
             Lista com status de análise de cada documento
             ============================================ -->
        <section class="section">
            <h2>🔍 6. Documentos Analisados para Confecção desse Parecer</h2>
            <div class="alert alert-info">
                <strong>Resumo:</strong> ${s6Resumo?.analisados || 0} de ${s6Resumo?.total || 0} documentos foram analisados.
            </div>
            <ul style="list-style: none; padding-left: 0;">
                ${s6Docs ? s6Docs.map(doc => `
                <li style="margin-bottom: 8px;">
                    <span style="color: ${doc.cor}; font-weight: bold; font-size: 14px;">
                        ${doc.icone}
                    </span>
                    <span>${doc.numero}. ${doc.nome} - ${doc.analisado ? 'ANALISADO' : 'NÃO ANALISADO'}</span>
                </li>
                `).join('') : '<li>Nenhum documento analisado</li>'}
            </ul>
        </section>

        <!-- ============================================
             SEÇÃO 7: COMPARAÇÃO DE REGIMES (CONDICIONAL)
             Só aparece para prestadores de serviços
             ============================================ -->
        ${mostrarSecao7 && s7 ? `
        <section class="section">
            <h2>⚖️ 7. Comparação com outros Regimes Tributários</h2>
            
            <div class="alert alert-info" style="margin-bottom: 20px;">
                <strong>ℹ️ Fator R:</strong> ${(s7.fatorR as Record<string, unknown>)?.valorFormatado} - ${(s7.fatorR as Record<string, unknown>)?.textoExplicativo}
            </div>
            
            <div class="regimes-grid">
                <!-- Card Simples Nacional Anexo III -->
                <div class="regime-card" style="border: ${(s7.simplesNacionalAnexoIII as Record<string, unknown>)?.bordaDestaque};">
                    <div class="regime-titulo">
                        Simples Nacional<br>Anexo ${(s7.simplesNacionalAnexoIII as Record<string, unknown>)?.anexo}
                        ${(s7.simplesNacionalAnexoIII as Record<string, unknown>)?.ehRegimeAtual ? `<br><span style="color: ${(s7.simplesNacionalAnexoIII as Record<string, unknown>)?.corDestaque}; font-size: 11px;">${(s7.simplesNacionalAnexoIII as Record<string, unknown>)?.textoDestaque}</span>` : ''}
                    </div>
                    <div class="regime-valor" style="color: ${(s7.simplesNacionalAnexoIII as Record<string, unknown>)?.ehRegimeAtual ? (s7.simplesNacionalAnexoIII as Record<string, unknown>)?.corDestaque : '#3b82f6'};">
                        ${(s7.simplesNacionalAnexoIII as Record<string, unknown>)?.impostoFormatado}
                    </div>
                    <div class="regime-detalhes">
                        Alíquota: ${(s7.simplesNacionalAnexoIII as Record<string, unknown>)?.aliquotaFormatada}<br>
                        Faixa: Até R$ ${(s7.simplesNacionalAnexoIII as Record<string, unknown>)?.faixaAtual}<br>
                        ${(s7.simplesNacionalAnexoIII as Record<string, unknown>)?.ehRegimeAtual ? '<strong style="color: #10b981;">✓ Regime atual da empresa</strong>' : ''}
                    </div>
                </div>
                
                <!-- Card Simples Nacional Anexo V -->
                <div class="regime-card" style="border: ${(s7.simplesNacionalAnexoV as Record<string, unknown>)?.bordaDestaque};">
                    <div class="regime-titulo">
                        Simples Nacional<br>Anexo ${(s7.simplesNacionalAnexoV as Record<string, unknown>)?.anexo}
                        ${(s7.simplesNacionalAnexoV as Record<string, unknown>)?.textoDestaque ? `<br><span style="color: ${(s7.simplesNacionalAnexoV as Record<string, unknown>)?.corDestaque}; font-size: 11px;">${(s7.simplesNacionalAnexoV as Record<string, unknown>)?.textoDestaque}</span>` : ''}
                    </div>
                    <div class="regime-valor" style="color: ${(s7.simplesNacionalAnexoV as Record<string, unknown>)?.ehRegimeAtual ? (s7.simplesNacionalAnexoV as Record<string, unknown>)?.corDestaque : '#3b82f6'};">
                        ${(s7.simplesNacionalAnexoV as Record<string, unknown>)?.impostoFormatado}
                    </div>
                    <div class="regime-detalhes">
                        Alíquota: ${(s7.simplesNacionalAnexoV as Record<string, unknown>)?.aliquotaFormatada}<br>
                        ${(s7.simplesNacionalAnexoV as Record<string, unknown>)?.ehMaisCaro ? `<span style="color: #dc2626;">⚠️ ${(s7.simplesNacionalAnexoV as Record<string, unknown>)?.diferencaFormatada} mais caro que Anexo III</span>` : ''}
                    </div>
                </div>
                
                <!-- Card Lucro Presumido -->
                <div class="regime-card">
                    <div class="regime-titulo">Lucro Presumido</div>
                    <div class="regime-valor">${(s7.lucroPresumido as Record<string, unknown>)?.impostoFormatado}</div>
                    <div class="regime-detalhes">
                        Alíquota Efetiva: ${(s7.lucroPresumido as Record<string, unknown>)?.aliquotaEfetivaFormatada}<br>
                        Presunção: ${(s7.lucroPresumido as Record<string, unknown>)?.presuncao}<br>
                        ${(s7.lucroPresumido as Record<string, unknown>)?.ehMaisCaro ? `<span style="color: #dc2626;">⚠️ ${(s7.lucroPresumido as Record<string, unknown>)?.diferencaFormatada} mais caro</span>` : ''}
                    </div>
                </div>
            </div>
        </section>
        ` : ''}

        <!-- ============================================
             SEÇÃO 8: OBSERVAÇÕES FINAIS
             Texto automático gerado com base nos dados
             ============================================ -->
        <section class="section">
            <h2>💬 8. Observações Finais da Análise</h2>
            <div style="background: #fef3c7; padding: 15px; border-radius: 6px; border-left: 4px solid #f59e0b; line-height: 1.6;">
                ${observacaoCorrigida}
            </div>
        </section>
        
        <!-- ============================================
             FOOTER - DATA DE GERAÇÃO
             ============================================ -->
        <div style="margin-top: 40px; padding-top: 20px; border-top: 2px solid #e5e7eb; text-align: center; color: #6b7280; font-size: 10px;">
            <p>Documento gerado em ${cab?.dataGeracaoFormatada || new Date().toLocaleDateString('pt-BR')}</p>
        </div>
    </div>
</body>
</html>`;

  console.log('HTML gerado com sucesso! Tamanho:', htmlCompleto.length, 'caracteres');
  return htmlCompleto;
}

// ============================================================
// CONVERSÃO HTML -> PDF (API2PDF)
// ============================================================
//
// Usa o serviço API2PDF para converter HTML em PDF.
// Configurações importantes:
//   - Formato A4
//   - Margens de 10mm (definidas no CSS)
//   - Headers/footers opcionais
//
// A API pode retornar:
//   - PDF direto (binário)
//   - JSON com FileUrl (link temporário)
//   - JSON com Pdf em base64
//
// Tratamos todos os cenários e retornamos Uint8Array com o PDF.

/**
 * Converte HTML para PDF usando API2PDF
 * 
 * @param html - String HTML completa
 * @param apiKey - Chave da API API2PDF
 * @param apiUrl - URL do endpoint (default: chrome/pdf/html)
 * @returns Bytes do PDF gerado
 */
async function convertHtmlToPdf(html: string, apiKey: string, apiUrl: string): Promise<Uint8Array> {
  console.log('Convertendo HTML para PDF via API2PDF...');
  
  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': apiKey,
    },
    body: JSON.stringify({
      html,
      options: {
        paperFormat: 'A4',
      },
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`API2PDF failed (${response.status}): ${text}`);
  }

  // Cenário 1: PDF retornado diretamente como binário
  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.includes('application/pdf')) {
    return new Uint8Array(await response.arrayBuffer());
  }

  // Cenário 2 e 3: JSON com URL ou base64
  const json = await response.json().catch(() => null);
  const fileUrl = json?.FileUrl || json?.fileUrl || json?.url || json?.file || null;
  
  // Cenário 2: URL temporária para download
  if (fileUrl) {
    console.log('Baixando PDF da URL:', fileUrl);
    const pdfResponse = await fetch(fileUrl);
    if (!pdfResponse.ok) {
      const text = await pdfResponse.text();
      throw new Error(`API2PDF download failed (${pdfResponse.status}): ${text}`);
    }
    return new Uint8Array(await pdfResponse.arrayBuffer());
  }

  // Cenário 3: PDF em base64 no JSON
  if (json?.Pdf) {
    const binary = atob(String(json.Pdf));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }

  throw new Error(`Resposta inesperada da API2PDF: ${JSON.stringify(json)}`);
}

// ============================================================
// HANDLER HTTP - PONTO DE ENTRADA DA EDGE FUNCTION
// ============================================================
//
// Fluxo:
// 1. Busca relatório em relatorios_aprovados
// 2. Gera HTML com gerarHtmlParecer()
// 3. Converte para PDF com convertHtmlToPdf()
// 4. Faz upload para bucket "parecer" no Storage
// 5. Tenta vincular cliente_id via razaoSocial
// 6. Atualiza registro com arquivo_url e metadados
//
// Nome do arquivo: PARECER_{CNPJ_DIGITOS}_{COMPETENCIA}.pdf
// Exemplo: PARECER_27245351000119_102025.pdf

Deno.serve(async (req) => {
  // ============================================================
  // CORS PREFLIGHT
  // ============================================================
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log('=== EDGE FUNCTION: gerar-pdf-parecer ===');
    
    // ============================================================
    // ETAPA 1: VALIDAÇÃO DA REQUISIÇÃO
    // ============================================================
    
    const { reportId } = await req.json();
    
    if (!reportId) {
      throw new Error('reportId é obrigatório');
    }
    
    console.log('Report ID:', reportId);

    // ============================================================
    // ETAPA 2: CONFIGURAÇÃO E INICIALIZAÇÃO
    // ============================================================
    
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const api2pdfUrl = Deno.env.get('API2PDF_URL') || 'https://v2.api2pdf.com/chrome/pdf/html';
    const api2pdfKey = Deno.env.get('API2PDF_API_KEY');

    if (!api2pdfKey) {
      throw new Error('API2PDF_API_KEY não configurada');
    }

    // Criar cliente Supabase com service role (bypass RLS)
    const supabase = createClient(supabaseUrl, supabaseKey);

    // ============================================================
    // ETAPA 3: BUSCAR RELATÓRIO APROVADO
    // ============================================================
    
    console.log('Buscando relatório aprovado...');
    const { data: relatorio, error: fetchError } = await supabase
      .from('relatorios_aprovados')
      .select('*')
      .eq('id', reportId)
      .single();

    if (fetchError || !relatorio) {
      throw new Error(`Relatório não encontrado: ${fetchError?.message || 'ID inválido'}`);
    }

    console.log('Relatório encontrado:', relatorio.id);
    console.log('Cliente:', relatorio.cliente_nome);

    // ============================================================
    // ETAPA 4: GERAR HTML DO PARECER
    // ============================================================
    
    console.log('Gerando HTML do parecer...');
    const html = gerarHtmlParecer(relatorio);
    console.log('HTML gerado:', html.length, 'caracteres');

    // ============================================================
    // ETAPA 5: CONVERTER HTML PARA PDF
    // ============================================================
    
    console.log('Convertendo para PDF...');
    const pdfBytes = await convertHtmlToPdf(html, api2pdfKey, api2pdfUrl);
    console.log('PDF gerado:', pdfBytes.length, 'bytes');

    // ============================================================
    // ETAPA 6: GERAR NOME DO ARQUIVO
    // ============================================================
    // Formato: PARECER_{CNPJ}_{COMPETENCIA}.pdf
    
    const cnpjDigits = String(relatorio.cnpj_matriz ?? '').replace(/[^0-9]/g, '');
    const competenciaDigits = String(relatorio.competencia ?? '').replace(/[^0-9]/g, '');
    const fileName = `PARECER_${cnpjDigits}_${competenciaDigits}.pdf`;
    console.log('Nome do arquivo:', fileName);

    // ============================================================
    // ETAPA 7: UPLOAD PARA SUPABASE STORAGE
    // ============================================================
    
    console.log('Fazendo upload para Storage...');
    const { error: uploadError } = await supabase.storage
      .from('parecer')
      .upload(fileName, pdfBytes, {
        contentType: 'application/pdf',
        upsert: true, // Sobrescreve se já existir
      });

    if (uploadError) {
      console.error('Erro no upload:', uploadError);
      throw new Error(`Erro ao fazer upload do PDF: ${uploadError.message}`);
    }

    // ============================================================
    // ETAPA 8: OBTER URL PÚBLICA DO PDF
    // ============================================================
    
    const { data: urlData } = supabase.storage
      .from('parecer')
      .getPublicUrl(fileName);

    const pdfUrl = urlData.publicUrl;
    console.log('URL pública:', pdfUrl);

    // ============================================================
    // ETAPA 9: VINCULAR CLIENTE (OPCIONAL)
    // ============================================================
    // Tenta encontrar o cliente pela razão social se não estiver vinculado
    
    let clienteId = relatorio.cliente_id;
    let clienteNome = relatorio.cliente_nome;
    let cnpjMatriz = relatorio.cnpj_matriz;

    if (!clienteId) {
      const secoesJson = typeof relatorio.secoes_json === 'string' 
        ? JSON.parse(relatorio.secoes_json) 
        : relatorio.secoes_json;
      
      const razaoSocial = secoesJson?.dadosCabecalho?.razaoSocial;
      
      if (razaoSocial) {
        const { data: clientes } = await supabase
          .from('clientesPJ')
          .select('*')
          .ilike('razaoSocial', `%${razaoSocial}%`)
          .limit(1);
        
        if (clientes && clientes.length > 0) {
          clienteId = clientes[0].id;
          clienteNome = clientes[0].razaoSocial;
          cnpjMatriz = String(clientes[0].cnpjMatriz);
          console.log('Cliente encontrado:', clienteNome);
        }
      }
    }

    // ============================================================
    // ETAPA 10: ATUALIZAR RELATÓRIO COM URL DO PDF
    // ============================================================
    
    console.log('Atualizando relatório...');
    const { error: updateError } = await supabase
      .from('relatorios_aprovados')
      .update({
        arquivo_url: pdfUrl,
        html_content: html,
        cliente_id: clienteId,
        cliente_nome: clienteNome,
        cnpj_matriz: cnpjMatriz,
        arquivo_nome: fileName,
        updated_at: new Date().toISOString(),
      })
      .eq('id', reportId);

    if (updateError) {
      console.error('Erro ao atualizar:', updateError);
      throw new Error(`Erro ao atualizar relatório: ${updateError.message}`);
    }

    // ============================================================
    // RESPOSTA DE SUCESSO
    // ============================================================
    
    console.log('=== PDF GERADO COM SUCESSO ===');
    console.log('URL:', pdfUrl);

    return new Response(
      JSON.stringify({
        success: true,
        pdfUrl,
        fileName,
        reportId,
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );

  } catch (error) {
    // ============================================================
    // TRATAMENTO DE ERROS
    // ============================================================
    
    console.error('ERRO:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Erro desconhecido',
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
