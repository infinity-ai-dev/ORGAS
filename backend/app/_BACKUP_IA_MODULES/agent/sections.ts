// @ts-nocheck
// Port of n8n section-prep nodes from [RECEBIMENTO DOCUMENTOS PESSOA JURIDICA][AMBIENTES-TESTE][HOMOLOG][V2].json

import { calcularAliquotaProgressiva as calcularAliquotaProgressivaBase } from './tax';

export function buildSecoesFromConsolidado(dados: any) {
  const secoes: Record<string, unknown> = {};

  try {
    const { dadosCabecalho } = prepararCabecalho(dados);
    secoes.dadosCabecalho = dadosCabecalho;
  } catch (error) {
    console.error('Erro ao preparar CABECALHO:', error);
  }

  try {
    const { dadosSecao1 } = prepararSecao1(dados);
    secoes.dadosSecao1 = dadosSecao1;
  } catch (error) {
    console.error('Erro ao preparar SECAO1:', error);
  }

  try {
    const { dadosSecao2 } = prepararSecao2(dados);
    secoes.dadosSecao2 = dadosSecao2;
  } catch (error) {
    console.error('Erro ao preparar SECAO2:', error);
  }

  try {
    const { dadosSecao3 } = prepararSecao3(dados);
    secoes.dadosSecao3 = dadosSecao3;
  } catch (error) {
    console.error('Erro ao preparar SECAO3:', error);
  }

  try {
    const { dadosSecao4 } = prepararSecao4(dados);
    secoes.dadosSecao4 = dadosSecao4;
  } catch (error) {
    console.error('Erro ao preparar SECAO4:', error);
  }

  try {
    const { dadosSecao5, dadosSecao6 } = prepararSecoes5e6(dados);
    secoes.dadosSecao5 = dadosSecao5;
    secoes.dadosSecao6 = dadosSecao6;
  } catch (error) {
    console.error('Erro ao preparar SECAO5_E_6:', error);
  }

  try {
    const { dadosSecao7 } = prepararSecao7(dados);
    secoes.dadosSecao7 = dadosSecao7;
  } catch (error) {
    console.error('Erro ao preparar SECAO7:', error);
  }

  try {
    const { dadosSecao8 } = prepararSecao8(dados);
    secoes.dadosSecao8 = dadosSecao8;
  } catch (error) {
    console.error('Erro ao preparar SECAO8:', error);
  }

  return secoes;
}

function prepararCabecalho(dados: any) {
  const cliente = dados?.cliente || {};
  const secao1 = dados?.secao1_FaturamentoImpostos || {};

  const dadosCabecalho = {
    razaoSocial: cliente.nome || 'N/A',
    cnpj: cliente.cnpj || 'N/A',
    regimeTributario: cliente.regimeTributario || 'N/A',
    regimeTributarioCompleto: secao1?.anexoSimples
      ? `${cliente.regimeTributario} - ${secao1.anexoSimples}`
      : cliente.regimeTributario,
    periodo: cliente.periodo || 'N/A',
    periodoFormatado: cliente.periodoFormatado || `Competência: ${cliente.periodo}`,
    dataGeracao: new Date().toISOString(),
    dataGeracaoFormatada: new Date().toLocaleDateString('pt-BR')
  };

  return {
    dadosCabecalho,
    tipo: 'CABECALHO'
  };
}

function prepararSecao1(dados: any) {
  const secao1Input = dados?.secao1_FaturamentoImpostos || {};

  console.log('=== PREP SEÇÃO 1 ===');
  console.log('Dados recebidos:', JSON.stringify(secao1Input, null, 2));

  function parseValorBR(valor: any) {
    if (typeof valor === 'number') return valor;
    if (!valor) return 0;
    return parseFloat(String(valor).replace(/[R$\s]/g, '').replace(/\./g, '').replace(',', '.')) || 0;
  }

  const TABELAS_SIMPLES_NACIONAL: Record<string, Array<{ limite: number; aliquotaNominal: number; deducao: number }>> = {
    I: [
      { limite: 180000, aliquotaNominal: 4.0, deducao: 0 },
      { limite: 360000, aliquotaNominal: 7.3, deducao: 5940 },
      { limite: 720000, aliquotaNominal: 9.5, deducao: 13860 },
      { limite: 1800000, aliquotaNominal: 10.7, deducao: 22500 },
      { limite: 3600000, aliquotaNominal: 14.3, deducao: 87300 },
      { limite: 4800000, aliquotaNominal: 19.0, deducao: 378000 }
    ],
    II: [
      { limite: 180000, aliquotaNominal: 4.5, deducao: 0 },
      { limite: 360000, aliquotaNominal: 7.8, deducao: 5940 },
      { limite: 720000, aliquotaNominal: 10.0, deducao: 13860 },
      { limite: 1800000, aliquotaNominal: 11.2, deducao: 22500 },
      { limite: 3600000, aliquotaNominal: 14.7, deducao: 85500 },
      { limite: 4800000, aliquotaNominal: 30.0, deducao: 720000 }
    ],
    III: [
      { limite: 180000, aliquotaNominal: 6.0, deducao: 0 },
      { limite: 360000, aliquotaNominal: 11.2, deducao: 9360 },
      { limite: 720000, aliquotaNominal: 13.5, deducao: 17640 },
      { limite: 1800000, aliquotaNominal: 16.0, deducao: 35640 },
      { limite: 3600000, aliquotaNominal: 21.0, deducao: 125640 },
      { limite: 4800000, aliquotaNominal: 33.0, deducao: 648000 }
    ],
    IV: [
      { limite: 180000, aliquotaNominal: 4.5, deducao: 0 },
      { limite: 360000, aliquotaNominal: 9.0, deducao: 8100 },
      { limite: 720000, aliquotaNominal: 10.2, deducao: 12420 },
      { limite: 1800000, aliquotaNominal: 14.0, deducao: 39780 },
      { limite: 3600000, aliquotaNominal: 22.0, deducao: 183780 },
      { limite: 4800000, aliquotaNominal: 33.0, deducao: 828000 }
    ],
    V: [
      { limite: 180000, aliquotaNominal: 15.5, deducao: 0 },
      { limite: 360000, aliquotaNominal: 18.0, deducao: 4500 },
      { limite: 720000, aliquotaNominal: 19.5, deducao: 9900 },
      { limite: 1800000, aliquotaNominal: 20.5, deducao: 17100 },
      { limite: 3600000, aliquotaNominal: 23.0, deducao: 62100 },
      { limite: 4800000, aliquotaNominal: 30.5, deducao: 540000 }
    ]
  };

  function calcularAliquotaProgressivaLocal(anexo: string, rbt12: number) {
    if (!TABELAS_SIMPLES_NACIONAL[anexo] || rbt12 <= 0) {
      return { sucesso: false, aliquotaEfetiva: 0, faixaNumero: 0 };
    }

    const tabela = TABELAS_SIMPLES_NACIONAL[anexo];
    let faixaEncontrada = tabela[tabela.length - 1];

    for (let i = 0; i < tabela.length; i++) {
      if (rbt12 <= tabela[i].limite) {
        faixaEncontrada = tabela[i];
        break;
      }
    }

    const aliquotaNominalDecimal = faixaEncontrada.aliquotaNominal / 100;
    const impostoCalculado = rbt12 * aliquotaNominalDecimal - faixaEncontrada.deducao;
    const aliquotaEfetiva = (impostoCalculado / rbt12) * 100;

    return {
      sucesso: true,
      aliquotaEfetiva: aliquotaEfetiva,
      aliquotaNominal: faixaEncontrada.aliquotaNominal,
      faixaNumero: tabela.indexOf(faixaEncontrada) + 1,
      deducao: faixaEncontrada.deducao
    };
  }

  const impostosRetidos = secao1Input?.impostosRetidos || {};
  const issRetido = parseValorBR(impostosRetidos.iss || '0');
  const irrfRetido = parseValorBR(impostosRetidos.irrf || '0');
  const pisRetido = parseValorBR(impostosRetidos.pis || '0');
  const cofinsRetido = parseValorBR(impostosRetidos.cofins || '0');
  const totalRetido = issRetido + irrfRetido + pisRetido + cofinsRetido;

  console.log('=== RETENÇÕES ENCONTRADAS ===');
  console.log(`ISS Retido: R$ ${issRetido.toFixed(2)}`);
  console.log(`IRRF Retido: R$ ${irrfRetido.toFixed(2)}`);
  console.log(`PIS Retido: R$ ${pisRetido.toFixed(2)}`);
  console.log(`COFINS Retido: R$ ${cofinsRetido.toFixed(2)}`);
  console.log(`Total Retido: R$ ${totalRetido.toFixed(2)}`);

  let estabelecimentos: Array<any> = [];

  if (secao1Input.estabelecimentos && secao1Input.estabelecimentos.length > 0) {
    estabelecimentos = secao1Input.estabelecimentos.map((estab: any) => ({
      descricao: estab.descricao,
      receita: estab.receita?.valorFormatado || estab.receita,
      aliquota: `${estab.aliquota?.valorFormatado || estab.aliquota}%`,
      imposto: `R$ ${estab.imposto?.valorFormatado || estab.imposto}`,
      dataVencimento: estab.dataVencimento || ''
    }));

    console.log(`✅ ${estabelecimentos.length} estabelecimentos encontrados`);
  } else {
    const anexoFallback = secao1Input.anexoSimples || 'I';
    const atividade = ['I', 'II'].includes(anexoFallback) ? 'COMÉRCIO' : 'SERVIÇOS';
    const impostoCalculadoRaw = secao1Input.impostoCalculado;
    const impostoCalculadoStr = typeof impostoCalculadoRaw === 'string'
      ? impostoCalculadoRaw
      : String(impostoCalculadoRaw ?? '0,00');

    estabelecimentos.push({
      descricao: `${atividade} (MATRIZ)`,
      receita: '',
      aliquota: `${secao1Input.aliquota || '0,00'}%`,
      imposto: impostoCalculadoStr.includes('R$') ? impostoCalculadoStr : `R$ ${impostoCalculadoStr}`,
      dataVencimento: secao1Input.dataVencimentoDAS || ''
    });

    console.log('⚠️ Fallback: criado 1 estabelecimento padrão');
  }

  const totalFaturamentoRaw = secao1Input.faturamentoDeclarado;
  const totalFaturamento = typeof totalFaturamentoRaw === 'string'
    ? totalFaturamentoRaw
    : String(totalFaturamentoRaw ?? '0,00');
  const faturamentoNumerico = parseValorBR(totalFaturamento);

  const anexo = secao1Input.anexoSimples || 'III';
  const rbt12 = parseValorBR(secao1Input.receitaAcumuladaAno || '0');

  console.log('=== CÁLCULO ALÍQUOTA EFETIVA ===');
  console.log(`Anexo: ${anexo}`);
  console.log(`RBT12: R$ ${rbt12.toFixed(2)}`);

  let aliquotaEfetiva = 0;
  let faixaInfo = '';

  if (rbt12 > 0) {
    const resultado = calcularAliquotaProgressivaLocal(anexo, rbt12);

    if (resultado.sucesso) {
      aliquotaEfetiva = resultado.aliquotaEfetiva;
      faixaInfo = `Faixa ${resultado.faixaNumero} (Nominal: ${resultado.aliquotaNominal}%, Efetiva: ${aliquotaEfetiva.toFixed(2)}%)`;
      console.log(`✅ Alíquota calculada: ${aliquotaEfetiva.toFixed(2)}% - ${faixaInfo}`);
    } else {
      aliquotaEfetiva = parseFloat(String(secao1Input.aliquota || '0').replace(',', '.'));
      console.warn(`⚠️ Não foi possível calcular alíquota, usando fallback: ${aliquotaEfetiva}%`);
    }
  } else {
    aliquotaEfetiva = parseFloat(String(secao1Input.aliquota || '0').replace(',', '.'));
    console.warn(`⚠️ RBT12 não disponível, usando alíquota do input: ${aliquotaEfetiva}%`);
  }

  console.log('=== CORREÇÃO APLICADA: DETECÇÃO DE RETENÇÃO DUPLICADA ===');

  const impostoPGDAS = parseValorBR(secao1Input.impostoCalculado || '0');
  let impostoTeorico;
  let aliquotaEfetivaReal;
  let fonteDadosImposto = 'calculado';

  console.log(`Imposto do PGDAS: R$ ${impostoPGDAS.toFixed(2)}`);
  console.log(`Faturamento: R$ ${faturamentoNumerico.toFixed(2)}`);

  if (impostoPGDAS > 0 && faturamentoNumerico > 0) {
    const aliquotaReversa = (impostoPGDAS / faturamentoNumerico) * 100;
    const diferencaAliquotas = Math.abs(aliquotaEfetiva - aliquotaReversa);

    console.log(`Alíquota Efetiva (tabela): ${aliquotaEfetiva.toFixed(2)}%`);
    console.log(`Alíquota Reversa (PGDAS): ${aliquotaReversa.toFixed(2)}%`);
    console.log(`Diferença entre alíquotas: ${diferencaAliquotas.toFixed(2)}%`);

    if (diferencaAliquotas > 0.5 && totalRetido > 0) {
      impostoTeorico = impostoPGDAS + totalRetido;
      aliquotaEfetivaReal = (impostoTeorico / faturamentoNumerico) * 100;
      fonteDadosImposto = 'pgdas_corrigido';

      console.log('🔧 CORREÇÃO APLICADA: Imposto do PGDAS já tinha retenções descontadas');
      console.log(`   ├─ Imposto PGDAS (com retenção): R$ ${impostoPGDAS.toFixed(2)}`);
      console.log(`   ├─ Retenções adicionadas de volta: R$ ${totalRetido.toFixed(2)}`);
      console.log(`   ├─ Imposto Teórico CORRIGIDO: R$ ${impostoTeorico.toFixed(2)}`);
      console.log(`   └─ Alíquota Efetiva Real: ${aliquotaEfetivaReal.toFixed(2)}%`);
    } else {
      impostoTeorico = faturamentoNumerico * (aliquotaEfetiva / 100);
      aliquotaEfetivaReal = aliquotaEfetiva;
      fonteDadosImposto = 'calculado';

      console.log('✅ Imposto calculado normalmente (sem correção necessária)');
      console.log(`   ├─ Faturamento × Alíquota: ${faturamentoNumerico.toFixed(2)} × ${aliquotaEfetiva.toFixed(2)}%`);
      console.log(`   └─ Imposto Teórico: R$ ${impostoTeorico.toFixed(2)}`);
    }
  } else {
    impostoTeorico = faturamentoNumerico * (aliquotaEfetiva / 100);
    aliquotaEfetivaReal = aliquotaEfetiva;
    fonteDadosImposto = 'calculado';

    console.log('⚠️ Fallback: calculando imposto pela alíquota efetiva');
    console.log(`   └─ Imposto Teórico: R$ ${impostoTeorico.toFixed(2)}`);
  }

  const formatarBR = (valor: number) =>
    `R$ ${valor.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  estabelecimentos = estabelecimentos.map((estab) => ({
    ...estab,
    aliquota: `${aliquotaEfetivaReal.toFixed(2).replace('.', ',')}%`,
    imposto: formatarBR(impostoTeorico),
    receita:
      estab.receita ||
      faturamentoNumerico.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  }));

  console.log(`✅ Estabelecimentos atualizados com alíquota efetiva: ${aliquotaEfetivaReal.toFixed(2)}%`);

  const impostoPagar = Math.max(0, impostoTeorico - totalRetido);
  const aliquotaFinalCalculada = faturamentoNumerico > 0 ? (impostoPagar / faturamentoNumerico) * 100 : 0;
  const temRetencao = totalRetido > 0;
  const diferencaAliquotas = aliquotaEfetivaReal - aliquotaFinalCalculada;

  console.log('=== CÁLCULO IMPOSTOS FINAL ===');
  console.log(`Faturamento: R$ ${faturamentoNumerico.toFixed(2)}`);
  console.log(`Alíquota Efetiva Real: ${aliquotaEfetivaReal.toFixed(2)}%`);
  console.log(`Imposto Teórico (Receita × Alíquota): R$ ${impostoTeorico.toFixed(2)}`);
  console.log(`Total Retenções: R$ ${totalRetido.toFixed(2)}`);
  console.log(`Imposto a Pagar (Teórico - Retenções): R$ ${impostoPagar.toFixed(2)}`);
  console.log(`Alíquota Final (após retenções): ${aliquotaFinalCalculada.toFixed(2)}%`);
  console.log(`Diferença Alíquotas: ${diferencaAliquotas.toFixed(2)}%`);
  console.log(`Fonte dos dados: ${fonteDadosImposto}`);

  const dadosSecao1 = {
    estabelecimentos: estabelecimentos,

    totais: {
      faturamento: totalFaturamento.includes('R$') ? totalFaturamento : `R$ ${totalFaturamento}`,
      imposto: formatarBR(impostoTeorico)
    },

    faturamento: {
      valor: faturamentoNumerico,
      valorFormatado: formatarBR(faturamentoNumerico),
      descricao:
        estabelecimentos.length > 1
          ? `${String(estabelecimentos[0].descricao).split(' (')[0]} (MATRIZ + ${
              estabelecimentos.length - 1
            } FILIAL${estabelecimentos.length > 2 ? 'S' : ''})`
          : estabelecimentos[0]?.descricao
    },

    imposto: {
      valor: impostoTeorico,
      valorFormatado: formatarBR(impostoTeorico),

      aliquotaEfetiva: aliquotaEfetivaReal,
      aliquotaEfetivaFormatada: `${aliquotaEfetivaReal.toFixed(2).replace('.', ',')}%`,

      aliquotaFinal: aliquotaFinalCalculada.toFixed(2).replace('.', ','),
      aliquotaFinalFormatada: `${aliquotaFinalCalculada.toFixed(2).replace('.', ',')}%`,

      impostoPagar: impostoPagar,
      impostoPagarFormatado: formatarBR(impostoPagar),

      temRetencao: temRetencao,
      totalRetido: totalRetido,
      totalRetidoFormatado: formatarBR(totalRetido),
      retencoes: {
        iss: issRetido,
        issFormatado: formatarBR(issRetido),
        irrf: irrfRetido,
        irrfFormatado: formatarBR(irrfRetido),
        pis: pisRetido,
        pisFormatado: formatarBR(pisRetido),
        cofins: cofinsRetido,
        cofinsFormatado: formatarBR(cofinsRetido)
      },

      fonteDadosImposto: fonteDadosImposto,
      correcaoAplicada: fonteDadosImposto === 'pgdas_corrigido'
    },

    dataVencimento: secao1Input.dataVencimentoDAS || estabelecimentos[estabelecimentos.length - 1]?.dataVencimento || '',
    anexo: secao1Input.anexoSimples || 'I',
    aplicouFatorR: secao1Input.aplicouFatorR || false,

    grafico: {
      faturamentoAltura: 100,
      faturamentoLabel: '100%',
      impostoAltura: aliquotaEfetivaReal,
      impostoLabel: `${aliquotaEfetivaReal.toFixed(2).replace('.', ',')}%`,
      aliquotaEfetivaAltura: aliquotaEfetivaReal,
      aliquotaEfetivaLabel: `${aliquotaEfetivaReal.toFixed(2).replace('.', ',')}%`,
      aliquotaEfetivaTitulo: 'Alíq. Efetiva',
      aliquotaFinalAltura: aliquotaFinalCalculada,
      aliquotaFinalLabel: `${aliquotaFinalCalculada.toFixed(2).replace('.', ',')}%`,
      aliquotaFinalTitulo: 'Alíq. Final',
      mostrarDuasAliquotas: temRetencao,
      diferencaAliquotas: diferencaAliquotas.toFixed(2).replace('.', ','),
      diferencaAliquotasLabel: temRetencao
        ? `(-${diferencaAliquotas.toFixed(2).replace('.', ',')}% retenções)`
        : ''
    }
  };

  console.log('✅ Seção 1 preparada com sucesso (correção aplicada)');
  console.log('Dados da Seção 1:', JSON.stringify(dadosSecao1, null, 2));

  return {
    dadosSecao1,
    tipo: 'SECAO1'
  };
}

function prepararSecao2(dados: any) {
  const secao1 = dados?.secao1_FaturamentoImpostos || {};
  const secao2 = dados?.secao2_MovimentoFinanceiro || {};

  function parseFloatBR(valor: any) {
    if (typeof valor === 'number') return valor;
    if (!valor) return 0;
    return parseFloat(valor.toString().replace(/\./g, '').replace(',', '.')) || 0;
  }

  function formatarValorBR(valor: any) {
    const num = typeof valor === 'string' ? parseFloatBR(valor) : valor;
    return 'R$ ' + num.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  const vendasCartao = parseFloatBR(secao2.vendasCartao?.total || '0');
  const pix = parseFloatBR(secao2.pix?.total || '0');
  const transferencias = parseFloatBR(secao2.transferenciasRecebidas?.total || '0');
  const depositos = parseFloatBR(secao2.depositos?.total || '0');
  const totalMovimento = parseFloatBR(secao2.totalMovimento || '0');
  const faturamentoDeclarado = parseFloatBR(secao1.faturamentoDeclarado || '0');

  const divergenciaValor = parseFloatBR(secao2.divergencia?.valor || '0');
  const divergenciaPorcentagem = secao2.divergencia?.porcentagem || '0%';

  const dadosSecao2 = {
    temMovimento: totalMovimento > 0,
    movimento: {
      vendasCartao: {
        valor: vendasCartao,
        valorFormatado: formatarValorBR(vendasCartao)
      },
      pix: {
        valor: pix,
        valorFormatado: formatarValorBR(pix)
      },
      transferencias: {
        valor: transferencias,
        valorFormatado: formatarValorBR(transferencias)
      },
      depositos: {
        valor: depositos,
        valorFormatado: formatarValorBR(depositos)
      },
      total: {
        valor: totalMovimento,
        valorFormatado: formatarValorBR(totalMovimento)
      }
    },
    faturamentoDeclarado: {
      valor: faturamentoDeclarado,
      valorFormatado: formatarValorBR(faturamentoDeclarado)
    },
    divergencia: {
      valor: divergenciaValor,
      valorFormatado: formatarValorBR(divergenciaValor),
      porcentagem: divergenciaPorcentagem,
      corTexto: divergenciaValor < 0 ? '#dc2626' : '#10b981',
      ehNegativa: divergenciaValor < 0
    },
    banco: secao2.banco || 'Não informado',
    interpretacao: secao2.divergencia?.interpretacao || 'Sem análise disponível'
  };

  return {
    dadosSecao2,
    tipo: 'SECAO2'
  };
}

function prepararSecao3(dados: any) {
  const secao3 = dados?.secao3_DocumentosFiscais || {};

  const gapsNumeracao = secao3.gapsNumeracao || [];
  const notasCanceladas = secao3.notasCanceladas || [];
  const observacoes = secao3.observacoes || '';

  const statusNFe = gapsNumeracao.length > 0 ? `IRREGULAR - Gaps: ${gapsNumeracao.join(', ')}` : 'REGULAR';
  const statusNFCe = 'REGULAR';
  const statusCTe = 'REGULAR';
  const statusNFSe =
    notasCanceladas.length > 0
      ? `REGULAR - ${notasCanceladas.length} nota(s) cancelada(s): ${notasCanceladas.join(', ')}`
      : 'REGULAR';

  const dadosSecao3 = {
    documentosFiscais: {
      nfe: {
        status: statusNFe,
        regular: gapsNumeracao.length === 0,
        gaps: gapsNumeracao
      },
      nfce: {
        status: statusNFCe,
        regular: true
      },
      cte: {
        status: statusCTe,
        regular: true
      },
      nfse: {
        status: statusNFSe,
        regular: true,
        notasCanceladas: notasCanceladas,
        quantidadeCanceladas: notasCanceladas.length,
        observacoes: observacoes
      }
    },
    notasDuplicadas: {
      encontradas: false,
      mensagem: 'Não foram identificadas notas fiscais duplicadas no período analisado.'
    }
  };

  return {
    dadosSecao3,
    tipo: 'SECAO3'
  };
}

function prepararSecao4(dados: any) {
  const secao1 = dados?.secao1_FaturamentoImpostos || {};
  const secao4Folha = dados?.secao4_FolhaPagamento || {};
  const secao5 = dados?.secao5_LucroPrejuizo || {};

  const anexo = secao1.anexoSimples || 'III';

  console.log('✅ Função calcularAliquotaProgressiva importada');
  console.log('Anexo do Simples Nacional:', anexo);

  function parseFloatBR(valor: any) {
    if (typeof valor === 'number') return valor;
    if (!valor) return 0;
    return parseFloat(valor.toString().replace(/\./g, '').replace(',', '.')) || 0;
  }

  function formatarValorBR(valor: any) {
    const num = typeof valor === 'string' ? parseFloatBR(valor) : valor;
    return 'R$ ' + num.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  const receitasMensaisHistoricas = secao1.receitasMensaisAnoCorrente || [];
  console.log('📊 Receitas mensais históricas (tabela 2.2.1):', receitasMensaisHistoricas.length);

  const receitaBrutaAtual = parseFloatBR(secao1.faturamentoDeclarado || '0');
  const impostoAtual = parseFloatBR(secao1.impostoCalculado || '0');
  const receitasMensaisBase = secao5.dadosHistoricos?.receitas || [];
  const folhasMensais = secao5.dadosHistoricos?.folhas || [];
  const impostosMensais = secao5.dadosHistoricos?.impostos || [];
  const comprasMensais = secao5.dadosHistoricos?.compras || [];
  const comprasAplicavel = secao5.dadosHistoricos?.comprasAplicavel || false;
  const periodoAtual = dados?.cliente?.periodo || '';
  const folhaMesAtual = parseFloatBR(secao4Folha?.custoTotalFolha || '0');

  console.log('=== PREP SEÇÃO 4 ===');
  console.log('Receitas mensais (ano corrente):', receitasMensaisBase.length);
  console.log('Folhas mensais encontradas:', folhasMensais.length);
  console.log('Impostos mensais encontrados:', impostosMensais.length);
  console.log('Compras mensais encontradas:', comprasMensais.length);
  console.log('Compras aplicável:', comprasAplicavel);
  console.log('Período atual:', periodoAtual);
  console.log('Folha do mês atual:', folhaMesAtual.toFixed(2));

  function calcularRBT12Movel(mesAlvo: string, receitasHistoricas: Array<{ mes: string; valor: string }>) {
    const [mesNum, anoNum] = mesAlvo.split('/').map(Number);
    const mesesNecessarios: string[] = [];

    for (let i = 12; i >= 1; i--) {
      let mes = mesNum - i;
      let ano = anoNum;

      while (mes <= 0) {
        mes += 12;
        ano -= 1;
      }

      const mesFormatado = String(mes).padStart(2, '0') + '/' + ano;
      mesesNecessarios.push(mesFormatado);
    }

    console.log(`🔍 RBT12 para ${mesAlvo} precisa de:`, mesesNecessarios);

    let todosEncontrados = true;
    let soma = 0;

    for (const mesNecessario of mesesNecessarios) {
      const receita = receitasHistoricas.find((r) => r.mes === mesNecessario);

      if (!receita) {
        console.warn(`⚠️ Mês ${mesNecessario} NÃO encontrado - impossível calcular RBT12 para ${mesAlvo}`);
        todosEncontrados = false;
        break;
      }

      const valor = parseFloatBR(receita.valor);
      soma += valor;
      console.log(`  ✓ ${mesNecessario}: R$ ${valor.toFixed(2)}`);
    }

    if (!todosEncontrados) {
      return null;
    }

    console.log(`✅ RBT12 para ${mesAlvo}: R$ ${soma.toFixed(2)}`);
    return soma;
  }

  const mesesNomes = [
    'Janeiro',
    'Fevereiro',
    'Março',
    'Abril',
    'Maio',
    'Junho',
    'Julho',
    'Agosto',
    'Setembro',
    'Outubro',
    'Novembro',
    'Dezembro'
  ];

  const mesesProcessados: any[] = [];
  let totalFaturamento = 0;
  let totalImpostos = 0;
  let totalFolha = 0;
  let totalCompras = 0;
  let totalLucro = 0;

  const anoCompetencia = periodoAtual ? periodoAtual.split('/')[1] : new Date().getFullYear().toString();
  const receitasMensais = Array.isArray(receitasMensaisBase) ? [...receitasMensaisBase] : [];
  const mesAtualExiste = receitasMensais.some((r: any) => String(r?.mes || '') === String(periodoAtual));
  if (periodoAtual && !mesAtualExiste) {
    receitasMensais.push({
      mes: periodoAtual,
      valor: receitaBrutaAtual.toLocaleString('pt-BR', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      })
    });
  }

  receitasMensais.sort((a: any, b: any) => {
    const [mesA, anoA] = String(a.mes || '').split('/').map(Number);
    const [mesB, anoB] = String(b.mes || '').split('/').map(Number);
    return anoA * 12 + mesA - (anoB * 12 + mesB);
  });

  const receitasAnoCorrente = receitasMensais.filter((receita: any) => {
    const anoReceita = String(receita.mes || '').split('/')[1];
    return anoReceita === anoCompetencia;
  });

  console.log(`📅 Ano da competência: ${anoCompetencia}`);
  console.log(`📊 Meses filtrados do ano ${anoCompetencia}: ${receitasAnoCorrente.length}`);

  const calcularAliquotaProgressiva = (anexoCalc: string, rbt12: number) => {
    const res = calcularAliquotaProgressivaBase(anexoCalc, rbt12);
    if (!res || !res.sucesso) {
      return { sucesso: false, aliquotaEfetiva: 0, faixaNumero: 0, aliquotaNominal: 0 };
    }
    const aliquotaNominal = typeof res.detalhes?.aliquotaNominal === 'number' ? res.detalhes.aliquotaNominal : 0;
    return {
      sucesso: true,
      aliquotaEfetiva: res.aliquotaEfetiva,
      faixaNumero: res.faixa || 0,
      aliquotaNominal
    };
  };

  receitasAnoCorrente.forEach((receita: any) => {
    const mesNumero = parseInt(String(receita.mes || '0').split('/')[0]);
    const mesNome = mesesNomes[mesNumero - 1];

    const faturamento = parseFloatBR(receita.valor);

    let impostos = 0;
    let fonteImposto = 'naoCalculavel';
    let aliquotaMes = 0;

    const rbt12 = calcularRBT12Movel(receita.mes, receitasMensaisHistoricas);

    if (rbt12 !== null && rbt12 > 0) {
      const resultado = calcularAliquotaProgressiva(anexo, rbt12);

      if (resultado && resultado.sucesso) {
        const impostoReal = impostosMensais.find((imp: any) => imp.mes === receita.mes);
        if (impostoReal && receita.mes === periodoAtual) {
          impostos = parseFloatBR(impostoReal.valor);
          fonteImposto = 'real';
          aliquotaMes = faturamento > 0 ? (impostos / faturamento) * 100 : resultado.aliquotaEfetiva;
          console.log(`✅ ${receita.mes}: Imposto real do mês atual usado (R$ ${impostos.toFixed(2)})`);
        } else {
          aliquotaMes = resultado.aliquotaEfetiva;
          impostos = faturamento * (aliquotaMes / 100);
          fonteImposto = 'calculado';
        }
        console.log(
          `✅ ${receita.mes}: Alíquota Efetiva = ${aliquotaMes.toFixed(2)}% | RBT12 = R$ ${rbt12.toFixed(
            2
          )} | Imposto Teórico = R$ ${impostos.toFixed(2)}`
        );
      } else {
        console.warn(`⚠️ ${receita.mes}: Erro ao calcular alíquota:`, resultado?.erro);
        impostos = 0;
        aliquotaMes = 0;
      }
    } else {
      const impostoReal = impostosMensais.find((imp: any) => imp.mes === receita.mes);

      if (impostoReal) {
        impostos = parseFloatBR(impostoReal.valor);
        fonteImposto = 'real';
        aliquotaMes = faturamento > 0 ? (impostos / faturamento) * 100 : 0;
        console.log(
          `⚠️ ${receita.mes}: Usando imposto REAL (fallback) = R$ ${impostos.toFixed(2)} (alíquota aprox. ${aliquotaMes.toFixed(
            2
          )}%)`
        );
      } else if (receita.mes === periodoAtual && impostoAtual > 0) {
        impostos = impostoAtual;
        fonteImposto = 'real';
        aliquotaMes = faturamento > 0 ? (impostoAtual / faturamento) * 100 : 0;
        console.log(`✅ ${receita.mes}: Imposto atual usado como fallback (R$ ${impostos.toFixed(2)})`);
      } else {
        console.warn(`⚠️ ${receita.mes}: Impossível calcular - falta dados históricos`);
        impostos = 0;
        aliquotaMes = 0;
        fonteImposto = 'naoCalculavel';
      }
    }

    let folha = 0;

    const folhaCorrespondente = folhasMensais.find((f: any) => f.mes === receita.mes);

    if (folhaCorrespondente) {
      folha = parseFloatBR(folhaCorrespondente.valor);
    } else if (receita.mes === periodoAtual) {
      folha = folhaMesAtual;
      console.log(`✓ Folha de ${receita.mes} obtida da seção4_FolhaPagamento: ${folha.toFixed(2)}`);
    } else {
      console.warn(`⚠️ Folha de ${receita.mes} não encontrada`);
      folha = 0;
    }

    let compras = 0;
    const compraCorrespondente = comprasMensais.find((c: any) => c.mes === receita.mes);

    if (compraCorrespondente) {
      compras = parseFloatBR(compraCorrespondente.valor);
      console.log(
        `✅ Compras de ${receita.mes}: R$ ${compras.toFixed(2)} (fonte: ${compraCorrespondente.fonte || 'historico'})`
      );
    } else {
      console.log(`⏭️ Compras de ${receita.mes}: R$ 0,00 (não encontrado)`);
    }

    const lucro = faturamento - impostos - folha - compras;

    totalFaturamento += faturamento;
    totalImpostos += impostos;
    totalFolha += folha;
    totalCompras += compras;
    totalLucro += lucro;

    mesesProcessados.push({
      mes: mesNome,
      mesOriginal: receita.mes,
      faturamento: {
        valor: faturamento,
        valorFormatado: formatarValorBR(faturamento)
      },
      impostos: {
        valor: impostos,
        valorFormatado: formatarValorBR(impostos),
        aliquota: aliquotaMes.toFixed(2) + '%',
        fonte: fonteImposto
      },
      folha: {
        valor: folha,
        valorFormatado: formatarValorBR(folha),
        fonte: folhaCorrespondente ? 'historico' : receita.mes === periodoAtual ? 'mesAtual' : 'naoEncontrada'
      },
      compras: {
        valor: compras,
        valorFormatado: formatarValorBR(compras)
      },
      lucro: {
        valor: lucro,
        valorFormatado: formatarValorBR(lucro),
        ehPositivo: lucro >= 0,
        cor: lucro >= 0 ? '#10b981' : '#dc2626'
      }
    });
  });

  console.log('Meses processados:', mesesProcessados.length);
  console.log('Total Faturamento:', totalFaturamento.toFixed(2));
  console.log('Total Impostos:', totalImpostos.toFixed(2));
  console.log('Total Folha:', totalFolha.toFixed(2));
  console.log('Total Lucro:', totalLucro.toFixed(2));

  const aliquotaMedia = totalFaturamento > 0 ? (totalImpostos / totalFaturamento) * 100 : 0;

  const alertas: any[] = [];

  const mesesComPrejuizo = mesesProcessados.filter((m) => m.lucro.valor < 0);
  if (mesesComPrejuizo.length > 0) {
    alertas.push({
      tipo: 'PREJUIZO_MENSAL',
      mensagem: `${mesesComPrejuizo.length} mês(es) com prejuízo detectado(s)`,
      meses: mesesComPrejuizo.map((m) => m.mes),
      nivel: 'warning'
    });
  }

  if (receitasMensais.length === 0) {
    alertas.push({
      tipo: 'SEM_DADOS_HISTORICOS',
      mensagem: 'Dados históricos não disponíveis - tabela não pôde ser preenchida',
      nivel: 'error'
    });
  }

  const mesesSemFolhaHistorico = mesesProcessados.filter((m) => m.folha.fonte === 'naoEncontrada');

  if (mesesSemFolhaHistorico.length > 0) {
    alertas.push({
      tipo: 'FOLHA_INCOMPLETA',
      mensagem: `Folha de pagamento não encontrada para ${mesesSemFolhaHistorico.length} mês(es): ${mesesSemFolhaHistorico
        .map((m) => m.mes)
        .join(', ')}`,
      nivel: 'warning'
    });
  }

  const mesesSemImposto = mesesProcessados.filter((m) => m.impostos.fonte === 'naoCalculavel');
  if (mesesSemImposto.length > 0) {
    alertas.push({
      tipo: 'IMPOSTOS_NAO_CALCULAVEIS',
      mensagem: `Imposto não calculável para ${mesesSemImposto.length} mês(es) (falta dados históricos): ${mesesSemImposto
        .map((m) => m.mes)
        .join(', ')}`,
      nivel: 'info'
    });
  }

  const dadosSecao4 = {
    temDados: receitasMensais.length > 0,
    quantidadeMeses: mesesProcessados.length,
    meses: mesesProcessados,
    totais: {
      faturamento: {
        valor: totalFaturamento,
        valorFormatado: formatarValorBR(totalFaturamento)
      },
      impostos: {
        valor: totalImpostos,
        valorFormatado: formatarValorBR(totalImpostos),
        aliquotaMedia: aliquotaMedia.toFixed(2) + '%'
      },
      folha: {
        valor: totalFolha,
        valorFormatado: formatarValorBR(totalFolha)
      },
      compras: {
        valor: totalCompras,
        valorFormatado: formatarValorBR(totalCompras)
      },
      lucro: {
        valor: totalLucro,
        valorFormatado: formatarValorBR(totalLucro),
        ehPositivo: totalLucro >= 0,
        cor: totalLucro >= 0 ? '#10b981' : '#dc2626',
        margemLiquida:
          totalFaturamento > 0 ? ((totalLucro / totalFaturamento) * 100).toFixed(2) + '%' : '0%'
      }
    },
    indicadores: {
      ticketMedio:
        mesesProcessados.length > 0
          ? formatarValorBR(totalFaturamento / mesesProcessados.length)
          : 'R$ 0,00',
      margemLiquida:
        totalFaturamento > 0 ? ((totalLucro / totalFaturamento) * 100).toFixed(2) + '%' : '0,00%',
      custoFolhaPercentual:
        totalFaturamento > 0 ? ((totalFolha / totalFaturamento) * 100).toFixed(2) + '%' : '0,00%'
    },
    alertas: alertas
  };

  return {
    dadosSecao4,
    tipo: 'SECAO4'
  };
}

function prepararSecoes5e6(dados: any) {
  function parseFloatBR(valor: any) {
    if (typeof valor === 'number') return valor;
    if (!valor) return 0;
    return parseFloat(valor.toString().replace(/\./g, '').replace(',', '.')) || 0;
  }

  const dadosSecao5 = {
    documentos: [
      {
        nome: 'Guia DAS Simples Nacional (Para pagamento)',
        enviado: true,
        icone: '✓'
      },
      {
        nome: 'Extrato PGDAS (para fonte de análise)',
        enviado: true,
        icone: '✓'
      },
      {
        nome: 'Extrato Acumuladores (para fonte de análise)',
        enviado: true,
        icone: '✓'
      }
    ]
  };

  const docsAnalisados = dados?.documentosAnalisados?.detalhes || [];

  const mapeamentoNomes: Record<string, string> = {
    'Extrato Bancário': 'Extrato Bancário',
    PGDAS: 'Extrato PGDAS',
    'Folha de Pagamento': 'Extrato da Folha',
    'Notas Fiscais': 'Relatório de Notas Fiscais'
  };

  let documentos = docsAnalisados.map((doc: any, index: number) => {
    const nomeFormatado = mapeamentoNomes[doc.tipo] || doc.tipo;
    const foiAnalisado = doc.quantidade > 0;

    return {
      numero: index + 1,
      nome: nomeFormatado,
      analisado: foiAnalisado,
      icone: foiAnalisado ? '✓' : '✗',
      cor: foiAnalisado ? '#10b981' : '#dc2626'
    };
  });

  const temVendasCartao =
    parseFloatBR(dados?.secao2_MovimentoFinanceiro?.vendasCartao?.total || '0') > 0;

  const temDocCartao = documentos.some(
    (d: any) => String(d.nome).toLowerCase().includes('cartão') || String(d.nome).toLowerCase().includes('administradora')
  );

  if (!temDocCartao && temVendasCartao) {
    documentos.push({
      numero: documentos.length + 1,
      nome: 'Extrato da Administradora do Cartão',
      analisado: true,
      icone: '✓',
      cor: '#10b981'
    });
  }

  documentos = documentos.map((doc: any) => {
    if (
      (String(doc.nome).toLowerCase().includes('cartão') ||
        String(doc.nome).toLowerCase().includes('administradora')) &&
      temVendasCartao
    ) {
      return {
        ...doc,
        analisado: true,
        icone: '✓',
        cor: '#10b981'
      };
    }
    return doc;
  });

  const temGuiaPGDAS = documentos.some((d: any) => String(d.nome).toLowerCase().includes('guia'));
  if (!temGuiaPGDAS) {
    documentos.push({
      numero: documentos.length + 1,
      nome: 'GUIA do PGDAS',
      analisado: true,
      icone: '✓',
      cor: '#10b981'
    });
  }

  const totalAnalisados = documentos.filter((d: any) => d.analisado).length;
  const totalNaoAnalisados = documentos.filter((d: any) => !d.analisado).length;

  const dadosSecao6 = {
    documentos: documentos,
    resumo: {
      total: documentos.length,
      analisados: totalAnalisados,
      naoAnalisados: totalNaoAnalisados
    }
  };

  console.log('Seção 6 - Resumo:', dadosSecao6.resumo);
  console.log(
    'Seção 6 - Documentos:',
    documentos.map((d: any) => `${d.numero}. ${d.nome} - ${d.analisado ? 'ANALISADO' : 'NÃO ANALISADO'}`)
  );

  return {
    dadosSecao5,
    dadosSecao6,
    tipo: 'SECAO5_E_6'
  };
}

function prepararSecao7(dados: any) {
  const secao1 = dados?.secao1_FaturamentoImpostos || {};
  const secao4 = dados?.secao4_FolhaPagamento || {};

  const anexoAtualTemp = secao1.anexoSimples || 'III';
  const ehComercio = ['I', 'II'].includes(anexoAtualTemp);

  if (ehComercio) {
    console.log('⚠️ SEÇÃO 7 DESABILITADA - Empresa é Anexo I ou II (Comércio)');
    console.log('Anexo detectado:', anexoAtualTemp);

    return {
      dadosSecao7: null,
      tipo: 'SECAO7',
      motivo: 'Seção 7 não se aplica a empresas de comércio (Anexo I ou II)'
    };
  }

  console.log('✅ Empresa é de serviços (Anexo III, IV ou V) - Gerando Seção 7');

  function parseFloatBR(valor: any) {
    if (typeof valor === 'number') return valor;
    if (!valor) return 0;
    return parseFloat(valor.toString().replace(/\./g, '').replace(',', '.')) || 0;
  }

  function formatarValorBR(valor: any) {
    const num = typeof valor === 'string' ? parseFloatBR(valor) : valor;
    return 'R$ ' + num.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  const TABELAS_SIMPLES_NACIONAL: Record<string, Array<{ limite: number; aliquotaNominal: number; deducao: number }>> = {
    I: [
      { limite: 180000, aliquotaNominal: 4.0, deducao: 0 },
      { limite: 360000, aliquotaNominal: 7.3, deducao: 5940 },
      { limite: 720000, aliquotaNominal: 9.5, deducao: 13860 },
      { limite: 1800000, aliquotaNominal: 10.7, deducao: 22500 },
      { limite: 3600000, aliquotaNominal: 14.3, deducao: 87300 },
      { limite: 4800000, aliquotaNominal: 19.0, deducao: 378000 }
    ],
    III: [
      { limite: 180000, aliquotaNominal: 6.0, deducao: 0 },
      { limite: 360000, aliquotaNominal: 11.2, deducao: 9360 },
      { limite: 720000, aliquotaNominal: 13.5, deducao: 17640 },
      { limite: 1800000, aliquotaNominal: 16.0, deducao: 35640 },
      { limite: 3600000, aliquotaNominal: 21.0, deducao: 125640 },
      { limite: 4800000, aliquotaNominal: 33.0, deducao: 648000 }
    ],
    V: [
      { limite: 180000, aliquotaNominal: 15.5, deducao: 0 },
      { limite: 360000, aliquotaNominal: 18.0, deducao: 4500 },
      { limite: 720000, aliquotaNominal: 19.5, deducao: 9900 },
      { limite: 1800000, aliquotaNominal: 20.5, deducao: 17100 },
      { limite: 3600000, aliquotaNominal: 23.0, deducao: 62100 },
      { limite: 4800000, aliquotaNominal: 30.5, deducao: 540000 }
    ]
  };

  function calcularAliquotaProgressivaLocal(anexoCalc: string, receitaAcumulada12m: any) {
    const rbt12 = typeof receitaAcumulada12m === 'number' ? receitaAcumulada12m : parseFloatBR(receitaAcumulada12m);

    if (!TABELAS_SIMPLES_NACIONAL[anexoCalc] || rbt12 <= 0) {
      return { sucesso: false, aliquotaEfetiva: 0, faixaNumero: 0 };
    }

    const tabela = TABELAS_SIMPLES_NACIONAL[anexoCalc];
    let faixaEncontrada = tabela[tabela.length - 1];

    for (let i = 0; i < tabela.length; i++) {
      if (rbt12 <= tabela[i].limite) {
        faixaEncontrada = tabela[i];
        break;
      }
    }

    const aliquotaNominalDecimal = faixaEncontrada.aliquotaNominal / 100;
    const impostoCalculado = rbt12 * aliquotaNominalDecimal - faixaEncontrada.deducao;
    const aliquotaEfetiva = (impostoCalculado / rbt12) * 100;

    return {
      sucesso: true,
      aliquotaEfetiva: aliquotaEfetiva,
      faixaNumero: tabela.indexOf(faixaEncontrada) + 1,
      aliquotaNominal: faixaEncontrada.aliquotaNominal
    };
  }

  const receitaBrutaMes = parseFloatBR(secao1.faturamentoDeclarado || '0');
  const receitaBruta12Meses = parseFloatBR(secao1.receitaAcumuladaAno || '0');
  const anexoAtual = secao1.anexoSimples || 'III';
  const impostoAtual = parseFloatBR(secao1.impostoCalculado || '0');

  const folhasMensais = secao1.folhasMensais || [];
  let folhaAnual = 0;

  if (folhasMensais.length > 0) {
    folhaAnual = folhasMensais.reduce((total: number, mes: any) => total + parseFloatBR(mes.valor), 0);
    console.log(`Folha anual calculada: ${folhaAnual.toFixed(2)} (${folhasMensais.length} meses)`);
  } else {
    folhaAnual = parseFloatBR(secao4?.custoTotalFolha || '0') * 12;
    console.log(`Folha anual estimada (fallback): ${folhaAnual.toFixed(2)}`);
  }

  const fatorR = receitaBruta12Meses > 0 ? folhaAnual / receitaBruta12Meses : 0;

  console.log('=== CÁLCULOS SEÇÃO 7 ===');
  console.log('Receita 12 meses:', receitaBruta12Meses.toFixed(2));
  console.log('Folha 12 meses:', folhaAnual.toFixed(2));
  console.log('Fator R:', (fatorR * 100).toFixed(2) + '%');
  console.log('Anexo atual:', anexoAtual);

  const resultadoAnexoIII = calcularAliquotaProgressivaLocal('III', receitaBruta12Meses);
  const aliquotaEfetivaAnexoIII = resultadoAnexoIII.sucesso ? resultadoAnexoIII.aliquotaEfetiva : 0;
  const impostoAnexoIII = receitaBrutaMes * (aliquotaEfetivaAnexoIII / 100);

  console.log(
    `Anexo III - Alíquota Efetiva: ${aliquotaEfetivaAnexoIII.toFixed(2)}%, Imposto: R$ ${impostoAnexoIII.toFixed(2)}`
  );

  const resultadoAnexoV = calcularAliquotaProgressivaLocal('V', receitaBruta12Meses);
  const aliquotaEfetivaAnexoV = resultadoAnexoV.sucesso ? resultadoAnexoV.aliquotaEfetiva : 0;
  const impostoAnexoV = receitaBrutaMes * (aliquotaEfetivaAnexoV / 100);

  console.log(
    `Anexo V - Alíquota Efetiva: ${aliquotaEfetivaAnexoV.toFixed(2)}%, Imposto: R$ ${impostoAnexoV.toFixed(2)}`
  );

  const presuncaoLP = 0.32;
  const lucroPresumido = receitaBrutaMes * presuncaoLP;

  const irpj = lucroPresumido * 0.15;
  const csll = lucroPresumido * 0.09;
  const pis = receitaBrutaMes * 0.0065;
  const cofins = receitaBrutaMes * 0.03;
  const iss = receitaBrutaMes * 0.05;

  const impostoLucroPresumido = irpj + csll + pis + cofins + iss;
  const aliquotaEfetivaLP = (impostoLucroPresumido / receitaBrutaMes) * 100;

  console.log('Imposto Anexo III:', impostoAnexoIII.toFixed(2));
  console.log('Imposto Anexo V:', impostoAnexoV.toFixed(2));
  console.log('Imposto LP:', impostoLucroPresumido.toFixed(2));

  const regimes = [
    { nome: 'Simples Nacional Anexo III', imposto: impostoAnexoIII, ehAtual: anexoAtual === 'III' },
    { nome: 'Simples Nacional Anexo V', imposto: impostoAnexoV, ehAtual: anexoAtual === 'V' },
    { nome: 'Lucro Presumido', imposto: impostoLucroPresumido, ehAtual: false }
  ];

  const regimeOrdenado = regimes.sort((a, b) => a.imposto - b.imposto);
  const regimeMaisVantajoso = regimeOrdenado[0];
  const economiaVsMaisVantajoso = impostoAtual - regimeMaisVantajoso.imposto;

  const dadosSecao7 = {
    temDadosSuficientes: receitaBrutaMes > 0 && receitaBruta12Meses > 0,

    fatorR: {
      valor: fatorR,
      valorFormatado: `${(fatorR * 100).toFixed(2)}%`,
      aplicaAnexoIII: fatorR >= 0.28,
      textoExplicativo: fatorR >= 0.28
        ? 'Fator R ≥ 28%: Empresa enquadrada no Anexo III'
        : 'Fator R < 28%: Empresa seria enquadrada no Anexo V'
    },

    receitaBruta12Meses: {
      valor: receitaBruta12Meses,
      valorFormatado: formatarValorBR(receitaBruta12Meses)
    },

    folhaAnual: {
      valor: folhaAnual,
      valorFormatado: formatarValorBR(folhaAnual)
    },

    simplesNacionalAnexoIII: {
      imposto: impostoAnexoIII,
      impostoFormatado: formatarValorBR(impostoAnexoIII),
      aliquota: aliquotaEfetivaAnexoIII,
      aliquotaFormatada: `${aliquotaEfetivaAnexoIII.toFixed(2)}%`,
      anexo: 'III',
      ehRegimeAtual: anexoAtual === 'III',
      bordaDestaque: anexoAtual === 'III' ? '3px solid #0284c7' : '1px solid #cbd5e1',
      textoDestaque: anexoAtual === 'III' ? '✓ Regime Atual' : '',
      corDestaque: '#0284c7',
      faixaAtual: `Faixa ${resultadoAnexoIII.faixaNumero} (Nominal: ${resultadoAnexoIII.aliquotaNominal}%, Efetiva: ${aliquotaEfetivaAnexoIII.toFixed(2)}%)`
    },

    simplesNacionalAnexoV: {
      imposto: impostoAnexoV,
      impostoFormatado: formatarValorBR(impostoAnexoV),
      aliquota: aliquotaEfetivaAnexoV,
      aliquotaFormatada: `${aliquotaEfetivaAnexoV.toFixed(2)}%`,
      anexo: 'V',
      ehRegimeAtual: anexoAtual === 'V',
      bordaDestaque: anexoAtual === 'V' ? '3px solid #0284c7' : '1px solid #cbd5e1',
      textoDestaque: fatorR < 0.28 ? '⚠️ Aplicável se Fator R < 28%' : '',
      corDestaque: '#f59e0b',
      diferençaAnexoIII: impostoAnexoV - impostoAnexoIII,
      diferencaFormatada: formatarValorBR(Math.abs(impostoAnexoV - impostoAnexoIII)),
      ehMaisCaro: impostoAnexoV > impostoAnexoIII
    },

    lucroPresumido: {
      imposto: impostoLucroPresumido,
      impostoFormatado: formatarValorBR(impostoLucroPresumido),
      aliquotaEfetiva: aliquotaEfetivaLP,
      aliquotaEfetivaFormatada: `${aliquotaEfetivaLP.toFixed(2)}%`,
      presuncao: '32%',
      detalhamento: {
        lucroPresumido: {
          valor: lucroPresumido,
          valorFormatado: formatarValorBR(lucroPresumido),
          calculo: `${formatarValorBR(receitaBrutaMes)} × 32%`
        },
        irpj: {
          valor: irpj,
          valorFormatado: formatarValorBR(irpj),
          aliquota: '15%',
          calculo: `${formatarValorBR(lucroPresumido)} × 15%`
        },
        csll: {
          valor: csll,
          valorFormatado: formatarValorBR(csll),
          aliquota: '9%',
          calculo: `${formatarValorBR(lucroPresumido)} × 9%`
        },
        pis: {
          valor: pis,
          valorFormatado: formatarValorBR(pis),
          aliquota: '0,65%'
        },
        cofins: {
          valor: cofins,
          valorFormatado: formatarValorBR(cofins),
          aliquota: '3%'
        },
        iss: {
          valor: iss,
          valorFormatado: formatarValorBR(iss),
          aliquota: '5%'
        }
      },
      composicao: 'IRPJ (15%) + CSLL (9%) + PIS (0,65%) + COFINS (3%) + ISS (5%)',
      diferençaSimples: impostoLucroPresumido - impostoAnexoIII,
      diferencaFormatada: formatarValorBR(Math.abs(impostoLucroPresumido - impostoAnexoIII)),
      ehMaisCaro: impostoLucroPresumido > impostoAnexoIII
    },

    analise: {
      regimeMaisVantajoso: regimeMaisVantajoso.nome,
      impostoMaisVantajoso: regimeMaisVantajoso.imposto,
      impostoMaisVantajosoFormatado: formatarValorBR(regimeMaisVantajoso.imposto),

      regimeAtual: regimes.find((r) => r.ehAtual)?.nome || 'Simples Nacional Anexo III',
      impostoAtual: impostoAtual,
      impostoAtualFormatado: formatarValorBR(impostoAtual),

      economia: economiaVsMaisVantajoso,
      economiaFormatada: formatarValorBR(Math.abs(economiaVsMaisVantajoso)),
      economiaAnual: economiaVsMaisVantajoso * 12,
      economiaAnualFormatada: formatarValorBR(Math.abs(economiaVsMaisVantajoso * 12)),

      jEstaMelhorRegime: Math.abs(economiaVsMaisVantajoso) < 10,

      mensagem:
        Math.abs(economiaVsMaisVantajoso) < 10
          ? `✓ A empresa já está no regime mais vantajoso (${regimeMaisVantajoso.nome}).`
          : economiaVsMaisVantajoso > 0
            ? `⚠️ Há potencial de economia de ${formatarValorBR(economiaVsMaisVantajoso)}/mês (${formatarValorBR(
                economiaVsMaisVantajoso * 12
              )}/ano) mudando para ${regimeMaisVantajoso.nome}.`
            : `✓ O regime atual já é o mais vantajoso.`,

      recomendacao:
        Math.abs(economiaVsMaisVantajoso) < 10
          ? 'Manter regime tributário atual.'
          : economiaVsMaisVantajoso > 50
            ? 'Recomenda-se análise detalhada com contador para avaliar viabilidade de mudança de regime.'
            : 'Diferença pequena. Considerar outros fatores além da tributação.'
    },

    ranking: regimeOrdenado.map((r, index) => ({
      posicao: index + 1,
      regime: r.nome,
      imposto: r.imposto,
      impostoFormatado: formatarValorBR(r.imposto),
      ehAtual: r.ehAtual,
      ehMaisVantajoso: index === 0
    }))
  };

  return {
    dadosSecao7,
    tipo: 'SECAO7'
  };
}

function prepararSecao8(dados: any) {
  const cliente = dados?.cliente || {};
  const secao1 = dados?.secao1_FaturamentoImpostos || {};
  const secao2 = dados?.secao2_MovimentoFinanceiro || {};
  const secao3 = dados?.secao3_DocumentosFiscais || {};
  const secao4 = dados?.secao4_FolhaPagamento || {};
  const documentosAnalisados = dados?.documentosAnalisados || {};
  const detalhesDocs = Array.isArray(documentosAnalisados?.detalhes)
    ? documentosAnalisados.detalhes
    : [];

  function parseFloatBR(valor: any) {
    if (typeof valor === 'number') return valor;
    if (!valor) return 0;
    return parseFloat(valor.toString().replace(/\./g, '').replace(',', '.')) || 0;
  }

  const formatarValor = (valor: any) => {
    const num = parseFloatBR(valor);
    return num.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  };

  const escapeHtml = (text: string) =>
    String(text || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');

  const faturamentoDeclarado = parseFloatBR(secao1.faturamentoDeclarado || 0);
  const impostoCalculado = parseFloatBR(secao1.impostoCalculado || 0);
  const custoFolha = parseFloatBR(secao4.custoTotalFolha || 0);
  const totalMovimento = parseFloatBR(secao2.totalMovimento || 0);
  const divergencia = parseFloatBR(secao2.divergencia?.valor || 0);
  const divergenciaPct = faturamentoDeclarado
    ? Math.abs((divergencia / faturamentoDeclarado) * 100)
    : 0;

  const notasCanceladas = secao3.notasCanceladas || [];
  const docsFaltantes = detalhesDocs.filter((doc: any) => doc && doc.analisado === false);

  const integridade = (() => {
    const erros: string[] = [];
    const avisos: string[] = [];
    if (!cliente?.nome) erros.push('Nome do cliente ausente.');
    if (!cliente?.cnpj) erros.push('CNPJ do cliente ausente.');
    if (!cliente?.periodo) avisos.push('Competência não informada.');
    if (!secao1?.faturamentoDeclarado) avisos.push('Faturamento declarado não informado.');
    if (!secao2?.totalMovimento) avisos.push('Movimento financeiro não informado.');
    if (docsFaltantes.length > 0) {
      avisos.push('Há documentos obrigatórios não analisados.');
    }
    return { erros, avisos, ok: erros.length === 0 };
  })();

  const entidades = (() => {
    const nomes = new Set<string>();
    const datas = new Set<string>();
    const valores = new Set<string>();
    const ativos = new Set<string>();

    if (cliente?.nome) nomes.add(cliente.nome);
    if (cliente?.periodo) datas.add(cliente.periodo);
    if (secao1?.dataVencimentoDAS) datas.add(secao1.dataVencimentoDAS);

    const pagamentos = secao4?.pagamentos || [];
    if (Array.isArray(pagamentos)) {
      pagamentos.forEach((item: any) => {
        if (item?.dataPagamento) datas.add(item.dataPagamento);
        if (item?.descricao) ativos.add(item.descricao);
        if (item?.valor) valores.add(String(item.valor));
      });
    }

    if (faturamentoDeclarado) valores.add(formatarValor(faturamentoDeclarado));
    if (impostoCalculado) valores.add(formatarValor(impostoCalculado));
    if (custoFolha) valores.add(formatarValor(custoFolha));
    if (totalMovimento) valores.add(formatarValor(totalMovimento));

    detalhesDocs.forEach((doc: any) => {
      if (doc?.tipo) ativos.add(doc.tipo);
    });

    return {
      nomes: Array.from(nomes),
      datas: Array.from(datas),
      valores: Array.from(valores),
      ativos: Array.from(ativos)
    };
  })();

  const categoriaParecer = (() => {
    const tipoRaw = String(cliente?.categoria || cliente?.tipo || secao1?.tipo_parecer || '').toLowerCase();
    const scores: Record<string, number> = { tecnico: 0, financeiro: 0, juridico: 0 };

    if (tipoRaw.includes('pessoal')) scores.tecnico += 2;
    if (tipoRaw.includes('jurid')) scores.juridico += 2;
    if (tipoRaw.includes('finance') || tipoRaw.includes('fiscal') || secao1) scores.financeiro += 1;
    if (secao4 && parseFloatBR(secao4.totalCustoFolha || 0) > 0) scores.tecnico += 1;
    if (secao2 && parseFloatBR(secao2.totalMovimento || 0) > 0) scores.financeiro += 1;

    const melhor = Object.entries(scores).sort((a, b) => b[1] - a[1])[0];
    const label = melhor?.[0] || 'financeiro';
    return label === 'juridico' ? 'Jurídico' : label === 'tecnico' ? 'Técnico' : 'Financeiro';
  })();

  const recomendacoes = (() => {
    const itens: string[] = [];
    if (divergencia && divergenciaPct > 5) {
      itens.push('Revisar a conciliação entre faturamento declarado e movimento financeiro.');
    }
    if (docsFaltantes.length > 0) {
      const faltantes = docsFaltantes.map((d: any) => d?.tipo || d?.documento || 'documento').join(', ');
      itens.push(`Solicitar reenvio ou comprovação dos documentos pendentes: ${faltantes}.`);
    }
    if (!secao1?.dataVencimentoDAS) {
      itens.push('Confirmar a data de vencimento do DAS para evitar atraso no recolhimento.');
    }
    if (secao1?.aplicouFatorR) {
      itens.push('Validar periodicamente o Fator R para evitar reenquadramento de anexo.');
    }
    if (itens.length === 0) {
      itens.push('Manter a documentação atualizada e monitorar a consistência dos dados mensalmente.');
    }
    return itens;
  })();

  const conformidade = (() => {
    const itens: Array<{ regra: string; status: 'ok' | 'alerta' | 'falha'; detalhe: string }> = [];
    const divergenciaStatus =
      divergenciaPct <= 5 ? 'ok' : divergenciaPct <= 15 ? 'alerta' : 'falha';
    itens.push({
      regra: 'Conciliação Movimento x Faturamento',
      status: divergenciaStatus,
      detalhe: `Divergência ${divergenciaPct.toFixed(2)}% (${formatarValor(Math.abs(divergencia))}).`
    });

    itens.push({
      regra: 'Documentação mínima',
      status: docsFaltantes.length ? 'alerta' : 'ok',
      detalhe: docsFaltantes.length
        ? `${docsFaltantes.length} documento(s) pendente(s).`
        : 'Sem pendências relevantes.'
    });

    itens.push({
      regra: 'DAS com vencimento informado',
      status: secao1?.dataVencimentoDAS ? 'ok' : 'alerta',
      detalhe: secao1?.dataVencimentoDAS
        ? `Vencimento ${secao1.dataVencimentoDAS}.`
        : 'Data de vencimento não informada.'
    });

    const statusGeral = itens.some((i) => i.status === 'falha')
      ? 'falha'
      : itens.some((i) => i.status === 'alerta')
        ? 'alerta'
        : 'ok';

    return { status: statusGeral, itens };
  })();

  const estrutura = (() => {
    const cabecalho = `Cliente ${cliente.nome || 'N/D'} (CNPJ ${cliente.cnpj || 'N/D'}) · Competência ${cliente.periodo || 'N/D'} · Regime ${cliente.regimeTributario || 'N/D'}`;
    const escopoDocs = 'Documentos analisados conforme seção de anexos.';

    const analise = [
      `Faturamento declarado: ${formatarValor(faturamentoDeclarado)}.`,
      `Movimento financeiro: ${formatarValor(totalMovimento)}.`,
      `Divergência: ${formatarValor(Math.abs(divergencia))} (${divergenciaPct.toFixed(2)}%).`,
      `Imposto calculado: ${formatarValor(impostoCalculado)}.`,
      `Custo de folha: ${formatarValor(custoFolha)}.`
    ];

    const conclusao =
      conformidade.status === 'ok'
        ? 'Não foram identificadas inconsistências relevantes com os dados disponíveis.'
        : 'Há inconsistências ou lacunas que limitam a robustez do parecer e exigem validação adicional.';

    return { cabecalho, escopo: escopoDocs, analise, conclusao };
  })();

  const observacoesHtml = (() => {
    const recomendacoesHtml = recomendacoes.map((item) => `<li>${escapeHtml(item)}</li>`).join('');
    const conformidadeHtml = conformidade.itens
      .map(
        (item) =>
          `<li><strong>${escapeHtml(item.regra)}:</strong> ${escapeHtml(
            item.status.toUpperCase()
          )} — ${escapeHtml(item.detalhe)}</li>`
      )
      .join('');

    const avisosHtml = integridade.avisos.length
      ? `<ul>${integridade.avisos.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`
      : '<p class="muted">Sem alertas de integridade.</p>';

    const errosHtml = integridade.erros.length
      ? `<ul>${integridade.erros.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`
      : '<p class="muted">Sem erros críticos de integridade.</p>';

    const analiseHtml = estrutura.analise.map((item) => `<li>${escapeHtml(item)}</li>`).join('');

    return `
      <div class="parecer-estrutura">
        <h3>1. Cabeçalho</h3>
        <p>${escapeHtml(estrutura.cabecalho)}</p>
        <h3>2. Escopo</h3>
        <p>${escapeHtml(estrutura.escopo)}</p>
        <h3>3. Análise de Dados</h3>
        <ul>${analiseHtml}</ul>
        <h3>4. Conclusão/Parecer</h3>
        <p>${escapeHtml(estrutura.conclusao)}</p>
        <h3>5. Recomendações</h3>
        <ul>${recomendacoesHtml}</ul>
        <h3>6. Conformidade</h3>
        <ul>${conformidadeHtml}</ul>
        <h3>7. Validação de Integridade</h3>
        <p><strong>Alertas:</strong></p>
        ${avisosHtml}
        <p><strong>Erros:</strong></p>
        ${errosHtml}
      </div>
    `;
  })();

  const observacoesTexto = (() => {
    return [
      `Cabeçalho: ${estrutura.cabecalho}`,
      `Escopo: ${estrutura.escopo}`,
      `Análise: ${estrutura.analise.join(' ')}`,
      `Conclusão: ${estrutura.conclusao}`,
      `Recomendações: ${recomendacoes.join(' | ')}`,
      `Conformidade: ${conformidade.status.toUpperCase()}`
    ].join('\n');
  })();

  const dadosSecao8 = {
    observacao: observacoesTexto,
    observacoes: observacoesHtml,
    categoriaParecer,
    entidades,
    recomendacoes,
    conformidade,
    validacao: integridade,
    estrutura,
    detalhes: {
      empresa: cliente.nome,
      regime: cliente.regimeTributario,
      anexo: secao1.anexoSimples || 'III',
      aplicaFatorR: secao1.aplicouFatorR || false,
      banco: secao2.banco || null,
      temVendasCartao: parseFloatBR(secao2.vendasCartao?.total || '0') > 0,
      notasCanceladas: notasCanceladas,
      quantidadeNotasCanceladas: notasCanceladas.length,
      divergenciaFinanceira: {
        existe: divergencia !== 0,
        valor: divergencia,
        valorAbsoluto: Math.abs(divergencia)
      },
      dasPendente: true,
      periodo: cliente.periodo
    }
  };

  return {
    dadosSecao8,
    tipo: 'SECAO8'
  };
}
