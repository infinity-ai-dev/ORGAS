// @ts-nocheck
// Source: [RECEBIMENTO DOCUMENTOS PESSOA JURIDICA][AMBIENTES-TESTE][HOMOLOG][V2].json
import { calcularAliquotaProgressiva as calcularAliquotaProgressivaBase } from './tax';

export function consolidarDados(
  input: any[],
  helpers: { calcularAliquotaProgressiva?: typeof calcularAliquotaProgressivaBase } = {}
) {
  const calcularAliquotaProgressiva =
    helpers.calcularAliquotaProgressiva || calcularAliquotaProgressivaBase;
  // ========================================
  // NÓ: CONSOLIDAR DADOS PARA WORKFLOW 2
  // Versão 2.3 - Suporta múltiplos estabelecimentos + Cálculo correto de alíquota
  //              + Mesclagem de folha do AGENTE_3 + Extração de compras do AGENTE_4
  // ========================================
  
  // ========================================
  // IMPORTAR DADOS DO AGGREGATE
  // ========================================
  // Buscar dados diretamente do node Aggregate (sintaxe N8N)
  const aggregate = input;
  
  // ========================================
  // IMPORTAR FUNÇÃO DE CÁLCULO DE ALÍQUOTA
  // ========================================
  // Buscar função do node "Calcular Alíquota Progressiva"
  
  console.log('=== INÍCIO DA CONSOLIDAÇÃO ===');
  console.log('Total de itens no aggregate:', aggregate.length);
  
  // ========================================
  // 1. AGRUPAR POR TIPO DE AGENTE
  // ========================================
  
  const extratosList = aggregate.filter(d => d.agenteProcessador === 'AGENTE_1_EXTRATOS');
  const notasList = aggregate.filter(d => d.agenteProcessador === 'AGENTE_4_NOTAS');
  const folhasListRaw = aggregate.filter(d => d.agenteProcessador === 'AGENTE_3_FOLHA');
  const pgdasList = aggregate.filter(d => d.agenteProcessador === 'AGENTE_2_PGDAS');
  
  const isFolhaCompleta = (folha) => {
    const obs = String(folha?.observacoes || folha?.observacao || '').toLowerCase();
    if (/(nao|não)[^\\n]{0,40}folha/.test(obs)) {
      return false;
    }
    const nome = String(
      folha?.documentoNome ||
      folha?.nomeArquivoOriginal ||
      folha?.file_name ||
      folha?.fileName ||
      ''
    ).toLowerCase();
    if (/(programa(c|ç)ao de ferias|encargos de irrf|documento de arrecadacao|guia do fgts|gfd\\b|darf\\b)/.test(nome)) {
      return false;
    }
    return true;
  };
  
  const folhasList = folhasListRaw.filter(isFolhaCompleta);
  
  console.log('Extratos encontrados:', extratosList.length);
  console.log('Folhas encontradas:', folhasListRaw.length);
  console.log('Folhas válidas:', folhasList.length);
  console.log('PGDAS encontrados:', pgdasList.length);
  console.log('Notas encontradas:', notasList.length);
  
  // ========================================
  // 2. CONSOLIDAR EXTRATOS (MATRIZ + FILIAL)
  // ========================================
  
  function consolidarExtratos(lista) {
    if (!lista || lista.length === 0) {
      return {
        vendasCartao: {
          stone: '0,00',
          cielo: '0,00',
          pagBank: '0,00',
          rede: '0,00',
          getnet: '0,00',
          mercadoPago: '0,00',
          outras: '0,00',
          total: '0,00'
        },
        pix: { total: '0,00', quantidade: 0 },
        transferenciasRecebidas: { total: '0,00', quantidade: 0, detalhes: '' },
        depositos: { total: '0,00', quantidade: 0 },
        totalMovimentoReal: '0,00',
        banco: 'Não informado',
        cnpjs: [],
        estabelecimentos: 0
      };
    }
    
    let consolidado = {
      stone: 0,
      cielo: 0,
      pagBank: 0,
      rede: 0,
      getnet: 0,
      mercadoPago: 0,
      outras: 0,
      pix: 0,
      pixQtd: 0,
      transferencias: 0,
      transferenciasQtd: 0,
      depositos: 0,
      depositosQtd: 0
    };
    
    let bancos = [];
    let cnpjs = [];
    
    for (const extrato of lista) {
      // Vendas por bandeira
      consolidado.stone += parseValor(extrato.vendasCartao?.stone);
      consolidado.cielo += parseValor(extrato.vendasCartao?.cielo);
      consolidado.pagBank += parseValor(extrato.vendasCartao?.pagBank);
      consolidado.rede += parseValor(extrato.vendasCartao?.rede);
      consolidado.getnet += parseValor(extrato.vendasCartao?.getnet);
      consolidado.mercadoPago += parseValor(extrato.vendasCartao?.mercadoPago);
      consolidado.outras += parseValor(extrato.vendasCartao?.outras);
      
      // PIX
      consolidado.pix += parseValor(extrato.pix?.total);
      consolidado.pixQtd += extrato.pix?.quantidade || 0;
      
      // Transferências
      consolidado.transferencias += parseValor(extrato.transferenciasRecebidas?.total);
      consolidado.transferenciasQtd += extrato.transferenciasRecebidas?.quantidade || 0;
      
      // Depósitos
      consolidado.depositos += parseValor(extrato.depositos?.total);
      consolidado.depositosQtd += extrato.depositos?.quantidade || 0;
      
      // Banco e CNPJ
      if (extrato.banco && !bancos.includes(extrato.banco)) {
        bancos.push(extrato.banco);
      }
      if (extrato.cnpj && !cnpjs.includes(extrato.cnpj)) {
        cnpjs.push(extrato.cnpj);
      }
    }
    
    const totalCartao = consolidado.stone + consolidado.cielo + consolidado.pagBank + 
                        consolidado.rede + consolidado.getnet + consolidado.mercadoPago + 
                        consolidado.outras;
    
    const totalMovimento = totalCartao + consolidado.pix + consolidado.transferencias + 
                           consolidado.depositos;
    
    console.log('=== CONSOLIDAÇÃO EXTRATOS ===');
    console.log('Total Cartão:', totalCartao.toFixed(2));
    console.log('Total PIX:', consolidado.pix.toFixed(2));
    console.log('Total Movimento:', totalMovimento.toFixed(2));
    console.log('Estabelecimentos:', cnpjs.length);
    
    return {
      vendasCartao: {
        stone: formatarValor(consolidado.stone),
        cielo: formatarValor(consolidado.cielo),
        pagBank: formatarValor(consolidado.pagBank),
        rede: formatarValor(consolidado.rede),
        getnet: formatarValor(consolidado.getnet),
        mercadoPago: formatarValor(consolidado.mercadoPago),
        outras: formatarValor(consolidado.outras),
        total: formatarValor(totalCartao)
      },
      pix: {
        total: formatarValor(consolidado.pix),
        quantidade: consolidado.pixQtd
      },
      transferenciasRecebidas: {
        total: formatarValor(consolidado.transferencias),
        quantidade: consolidado.transferenciasQtd,
        detalhes: ''
      },
      depositos: {
        total: formatarValor(consolidado.depositos),
        quantidade: consolidado.depositosQtd
      },
      totalMovimentoReal: formatarValor(totalMovimento),
      banco: bancos.length === 1 ? bancos[0] : bancos.join(' + '),
      cnpjs: cnpjs,
      estabelecimentos: cnpjs.length
    };
  }
  
  // ========================================
  // 3. CONSOLIDAR FOLHAS (MATRIZ + FILIAL)
  // ========================================
  
  function consolidarFolhas(lista) {
    if (!lista || lista.length === 0) {
      return {
        totalSalarioBruto: '0,00',
        totalINSS: '0,00',
        totalFGTS: '0,00',
        quantidadeFuncionarios: 0,
        totalLiquido: '0,00',
        totalCustoFolha: '0,00',
        estabelecimentos: 0
      };
    }
    
    let consolidado = {
      salarioBruto: 0,
      inss: 0,
      fgts: 0,
      funcionarios: 0,
      liquido: 0,
      custoTotal: 0
    };
    
    for (const folha of lista) {
      consolidado.salarioBruto += parseValor(folha.totalSalarioBruto);
      consolidado.inss += parseValor(folha.totalINSS);
      consolidado.fgts += parseValor(folha.totalFGTS);
      consolidado.funcionarios += folha.quantidadeFuncionarios || 0;
      consolidado.liquido += parseValor(folha.totalLiquido);
      consolidado.custoTotal += parseValor(folha.totalCustoFolha);
    }
    
    console.log('=== CONSOLIDAÇÃO FOLHAS ===');
    console.log('Total Custo Folha:', consolidado.custoTotal.toFixed(2));
    console.log('Total Funcionários:', consolidado.funcionarios);
    console.log('Estabelecimentos:', lista.length);
    
    return {
      totalSalarioBruto: formatarValor(consolidado.salarioBruto),
      totalINSS: formatarValor(consolidado.inss),
      totalFGTS: formatarValor(consolidado.fgts),
      quantidadeFuncionarios: consolidado.funcionarios,
      totalLiquido: formatarValor(consolidado.liquido),
      totalCustoFolha: formatarValor(consolidado.custoTotal),
      estabelecimentos: lista.length
    };
  }
  
  // ========================================
  // 4. CONSOLIDAR NOTAS (MATRIZ + FILIAL)
  // ========================================
  
  function consolidarNotas(lista) {
    if (!lista || lista.length === 0) {
      return {
        quantidadeNotas: 0,
        faturamentoTotal: '0,00',
        notasCanceladas: [],
        gapsNumeracao: [],
        impostosRetidos: {
          iss: '0,00',
          irrf: '0,00',
          pis: '0,00',
          cofins: '0,00',
          total: '0,00'
        },
        observacoes: '',
        tipoNota: 'NFSE',
        // ✅ NOVO - Dados de compras do Resumo por Acumulador
        compras: {
          total: '0,00',
          itensCompras: []
        },
        comprasMes: '0,00'
      };
    }
  
    let consolidado = {
      quantidade: 0,
      faturamento: 0,
      iss: 0,
      irrf: 0,
      pis: 0,
      cofins: 0
    };
  
    let canceladas = [];
    let gaps = [];
    let observacoes = [];
    let tipoNota = lista[0]?.tipoNota || 'NFSE';
  
    // ✅ NOVO - Consolidar compras de todos os documentos do AGENTE_4
    // Apenas ENTRADAS com "COMPRA" na descrição (sem devoluções)
    let comprasTotal = 0;
    let todosItensCompras = [];
  
    // ✅ FIX: Deduplicar impostos retidos por período para evitar duplicação
    // quando múltiplos documentos do mesmo mês são processados (ex: Livro Fiscal + Resumo por Acumulador)
    const periodosImpostosProcessados = new Set();
  
    for (const nota of lista) {
      consolidado.quantidade += nota.quantidadeNotas || 0;
      consolidado.faturamento += parseValor(nota.faturamentoTotal);
  
      // ✅ FIX: Só processar impostos retidos se o período ainda não foi processado
      // Isso evita duplicação quando o AGENTE_4 processa múltiplos documentos do mesmo mês
      const periodoNota = nota.periodo || 'sem_periodo';
  
      if (nota.impostosRetidos && !periodosImpostosProcessados.has(periodoNota)) {
        consolidado.iss += parseValor(nota.impostosRetidos.iss);
        consolidado.irrf += parseValor(nota.impostosRetidos.irrf);
        consolidado.pis += parseValor(nota.impostosRetidos.pis);
        consolidado.cofins += parseValor(nota.impostosRetidos.cofins);
        periodosImpostosProcessados.add(periodoNota);
        console.log(`✅ Impostos retidos processados para período ${periodoNota}: ISS=${nota.impostosRetidos.iss}, IRRF=${nota.impostosRetidos.irrf}`);
      } else if (nota.impostosRetidos && periodosImpostosProcessados.has(periodoNota)) {
        console.log(`⚠️ Impostos retidos IGNORADOS (duplicata) para período ${periodoNota}: ISS=${nota.impostosRetidos.iss}`);
      }
  
      if (nota.notasCanceladas?.length > 0) {
        canceladas = canceladas.concat(nota.notasCanceladas);
      }
  
      if (nota.gapsNumeracao?.length > 0) {
        gaps = gaps.concat(nota.gapsNumeracao);
      }
  
      if (nota.observacoes) {
        observacoes.push(nota.observacoes);
      }
  
      // ✅ NOVO - Processar compras do Resumo por Acumulador (apenas ENTRADAS)
      if (nota.compras) {
        comprasTotal += parseValor(nota.compras.total);
  
        if (nota.compras.itensCompras?.length > 0) {
          todosItensCompras = todosItensCompras.concat(nota.compras.itensCompras);
        }
  
        console.log(`✅ Compras encontradas no documento: R$ ${nota.compras.total}`);
      }
  
      // Alternativa: usar campo simplificado comprasMes
      if (nota.comprasMes && !nota.compras) {
        comprasTotal += parseValor(nota.comprasMes);
        console.log(`✅ Compras (campo simplificado): R$ ${nota.comprasMes}`);
      }
    }
  
    const totalImpostos = consolidado.iss + consolidado.irrf + consolidado.pis + consolidado.cofins;
  
    console.log('=== CONSOLIDAÇÃO COMPRAS ===');
    console.log('Total Compras (ENTRADAS):', formatarValor(comprasTotal));
  
    return {
      quantidadeNotas: consolidado.quantidade,
      faturamentoTotal: formatarValor(consolidado.faturamento),
      notasCanceladas: canceladas,
      gapsNumeracao: gaps,
      impostosRetidos: {
        iss: formatarValor(consolidado.iss),
        irrf: formatarValor(consolidado.irrf),
        pis: formatarValor(consolidado.pis),
        cofins: formatarValor(consolidado.cofins),
        total: formatarValor(totalImpostos)
      },
      observacoes: observacoes.join(' | '),
      tipoNota: tipoNota,
      // ✅ NOVO - Dados de compras consolidados (apenas ENTRADAS)
      compras: {
        total: formatarValor(comprasTotal),
        itensCompras: todosItensCompras
      },
      comprasMes: formatarValor(comprasTotal)
    };
  }
  
  // ========================================
  // 5. PROCESSAR PGDAS - MATRIZ + FILIAIS (CORRIGIDO)
  // ========================================
  
  function processarPGDAS(lista) {
    if (!lista || lista.length === 0) {
      return {
        estabelecimentos: [],
        totalReceita: '0,00',
        totalImposto: '0,00',
        aliquotaMedia: '0,00',
        anexo: null,
        dataVencimento: null,
        receitaAcumulada: '0,00',
        receitasMensais: [],
        folhasMensais: []
      };
    }
  
    // ✅ FILTRAR APENAS PGDAS COM RECEITA (ignorar só guias)
    const pgdasComReceita = lista.filter(p =>
      p.somenteGuia !== true &&
      parseValor(p.receitaBrutaMes) > 0
    );
  
    console.log('=== PROCESSAMENTO PGDAS ===');
    console.log('Total de PGDAS:', lista.length);
    console.log('PGDAS com receita:', pgdasComReceita.length);
  
    if (pgdasComReceita.length === 0) {
      // Fallback: usar o primeiro PGDAS disponível
      const pgdasFallback = lista[0];
      return {
        estabelecimentos: [],
        totalReceita: pgdasFallback.receitaBrutaMes || '0,00',
        totalImposto: pgdasFallback.valorDAS || '0,00',
        aliquotaMedia: pgdasFallback.aliquota || '0,00',
        anexo: pgdasFallback.anexo,
        dataVencimento: pgdasFallback.dataVencimentoDAS,
        receitaAcumulada: pgdasFallback.receitaBrutaAcumulada || '0,00',
        receitasMensais: pgdasFallback.receitasMensaisAnoCorrente || [],
        folhasMensais: pgdasFallback.folhasMensais || []
      };
    }
  
    // ✅ PEGAR O PGDAS COMPLETO (com receita)
    const pgdasCompleto = pgdasComReceita[0];
  
    // ✅✅ USAR ARRAY ESTABELECIMENTOS DO AGENTE (SE EXISTIR)
    let estabelecimentos = [];
  
    if (pgdasCompleto.estabelecimentos && pgdasCompleto.estabelecimentos.length > 0) {
      // ✅ CASO 1: AGENTE JÁ EXTRAIU OS ESTABELECIMENTOS
      console.log(`✅ ${pgdasCompleto.estabelecimentos.length} estabelecimentos encontrados no PGDAS`);
  
      estabelecimentos = pgdasCompleto.estabelecimentos.map((estab, index) => {
        const receita = parseValor(estab.receita);
  
        // ========================================
        // ✅ PRIORIZAR VALORES REAIS DO PGDAS, CALCULAR APENAS COMO FALLBACK
        // ========================================
        let aliquota = 0;
        let impostoCalculado = 0;
        let fonteValores = 'naoCalculado';
        const anexo = pgdasCompleto.anexo;
        const receitaAcumulada = pgdasCompleto.receitaBrutaAcumulada;
  
        // ✅ CASO 1: Usar valores REAIS extraídos pelo Agente (se disponíveis)
        const aliquotaReal = estab.aliquota ? parseValor(estab.aliquota) : 0;
        const impostoReal = estab.imposto ? parseValor(estab.imposto) : 0;
  
        if (aliquotaReal > 0 && impostoReal > 0) {
          // ✅ Usar valores REAIS do PGDAS (mais precisos, incluem reduções especiais)
          aliquota = aliquotaReal;
          impostoCalculado = impostoReal;
          fonteValores = 'real';
          console.log(`✅ ${estab.descricao}: Usando valores REAIS do PGDAS`);
          console.log(`   Alíquota Real: ${aliquota}% | Imposto Real: R$ ${impostoCalculado.toFixed(2)}`);
        }
        // ✅ CASO 2: Fallback - Calcular usando tabela progressiva
        else if (anexo && receitaAcumulada && parseValor(receitaAcumulada) > 0) {
          console.log(`🔍 ${estab.descricao}: Valores reais não disponíveis, calculando via tabela progressiva...`);
          const resultadoCalculo = calcularAliquotaProgressiva(anexo, receitaAcumulada);
  
          if (resultadoCalculo && resultadoCalculo.sucesso) {
            aliquota = resultadoCalculo.aliquotaEfetiva;
            impostoCalculado = receita * (aliquota / 100);
            fonteValores = 'calculado';
            console.log(`✅ ${estab.descricao}: Alíquota calculada ${aliquota.toFixed(2)}% (Faixa ${resultadoCalculo.faixa})`);
          } else {
            console.warn(`⚠️ ${estab.descricao}: Erro ao calcular alíquota - ${resultadoCalculo ? resultadoCalculo.erro : 'erro desconhecido'}`);
          }
        } else {
          console.warn(`⚠️ ${estab.descricao}: Impossível calcular alíquota - dados insuficientes`);
        }
  
        console.log(`🔍 DEBUG: ${estab.descricao} - FINAL (${fonteValores}): Receita ${formatarValor(receita)}, Imposto ${formatarValor(impostoCalculado)}, Alíquota ${aliquota.toFixed(2)}%`);
  
        return {
          tipo: index === 0 ? 'MATRIZ' : `FILIAL`,
          descricao: estab.descricao,
          cnpj: pgdasCompleto.cnpj,
          receita: {
            valor: receita,
            valorFormatado: formatarValor(receita)
          },
          imposto: {
            valor: impostoCalculado, // ✅ Usar imposto CALCULADO
            valorFormatado: formatarValor(impostoCalculado)
          },
          aliquota: {
            valor: aliquota,
            valorFormatado: aliquota.toFixed(2).replace('.', ',')
          },
          anexo: pgdasCompleto.anexo || 'I',
          // ✅ Data de vencimento APENAS no último estabelecimento
          dataVencimento: index === pgdasCompleto.estabelecimentos.length - 1 ? (pgdasCompleto.dataVencimentoDAS || '') : ''
        };
      });
  
    } else {
      // ✅ CASO 2: FALLBACK - CRIAR UM ESTABELECIMENTO COM DADOS CONSOLIDADOS
      console.log('⚠️ Fallback: criando estabelecimento único com dados consolidados');
  
      const anexo = pgdasCompleto.anexo || 'I';
      const atividade = (['I', 'II'].includes(anexo)) ? 'COMÉRCIO' : 'SERVIÇOS';
  
      const receita = parseValor(pgdasCompleto.receitaBrutaMes);
      let aliquota = 0;
      let impostoCalculado = 0;
      let fonteValores = 'naoCalculado';
  
      // ========================================
      // ✅ PRIORIZAR VALORES REAIS DO PGDAS, CALCULAR APENAS COMO FALLBACK
      // ========================================
      const receitaAcumulada = pgdasCompleto.receitaBrutaAcumulada;
  
      // ✅ CASO 1: Usar valores REAIS extraídos pelo Agente (se disponíveis)
      const aliquotaReal = pgdasCompleto.aliquota ? parseValor(pgdasCompleto.aliquota) : 0;
      const impostoReal = pgdasCompleto.valorDAS ? parseValor(pgdasCompleto.valorDAS) : 0;
  
      if (aliquotaReal > 0 && impostoReal > 0) {
        // ✅ Usar valores REAIS do PGDAS (mais precisos, incluem reduções especiais)
        aliquota = aliquotaReal;
        impostoCalculado = impostoReal;
        fonteValores = 'real';
        console.log(`✅ Fallback: Usando valores REAIS do PGDAS`);
        console.log(`   Alíquota Real: ${aliquota}% | Imposto Real: R$ ${impostoCalculado.toFixed(2)}`);
      }
      // ✅ CASO 2: Fallback - Calcular usando tabela progressiva
      else if (anexo && receitaAcumulada && parseValor(receitaAcumulada) > 0) {
        console.log(`🔍 Fallback: Valores reais não disponíveis, calculando via tabela progressiva...`);
        const resultadoCalculo = calcularAliquotaProgressiva(anexo, receitaAcumulada);
  
        if (resultadoCalculo && resultadoCalculo.sucesso) {
          aliquota = resultadoCalculo.aliquotaEfetiva;
          impostoCalculado = receita * (aliquota / 100);
          fonteValores = 'calculado';
          console.log(`✅ Alíquota calculada (tabela progressiva): ${aliquota.toFixed(2)}%`);
          console.log(`   Faixa: ${resultadoCalculo.faixa} | Anexo: ${anexo} | RBT12: ${receitaAcumulada}`);
        } else {
          console.warn(`⚠️ Erro ao calcular alíquota: ${resultadoCalculo ? resultadoCalculo.erro : 'erro desconhecido'}`);
        }
      } else {
        console.warn(`⚠️ Impossível calcular alíquota - Anexo: ${anexo || 'não informado'} | RBT12: ${receitaAcumulada || 'não informado'}`);
      }
  
      console.log(`🔍 DEBUG: Fallback - FINAL (${fonteValores}): Receita ${formatarValor(receita)}, Imposto ${formatarValor(impostoCalculado)}, Alíquota ${aliquota.toFixed(2)}%`);
  
      estabelecimentos.push({
        tipo: 'MATRIZ',
        descricao: `${atividade} (MATRIZ)`,
        cnpj: pgdasCompleto.cnpj,
        receita: {
          valor: receita,
          valorFormatado: formatarValor(receita)
        },
        imposto: {
          valor: impostoCalculado, // ✅ Usar imposto CALCULADO
          valorFormatado: formatarValor(impostoCalculado)
        },
        aliquota: {
          valor: aliquota,
          valorFormatado: aliquota.toFixed(2).replace('.', ',')
        },
        anexo: anexo,
        dataVencimento: pgdasCompleto.dataVencimentoDAS || ''
      });
    }
  
    // ✅ CALCULAR TOTAIS
    const totalReceita = estabelecimentos.reduce((sum, e) => sum + e.receita.valor, 0);
    const totalImposto = estabelecimentos.reduce((sum, e) => sum + e.imposto.valor, 0);
    const aliquotaMedia = totalReceita > 0 ? (totalImposto / totalReceita) * 100 : 0;
  
    console.log('=== TOTAIS CONSOLIDADOS ===');
    console.log('Total Receita:', formatarValor(totalReceita));
    console.log('Total Imposto:', formatarValor(totalImposto));
    console.log('Alíquota Média:', aliquotaMedia.toFixed(2) + '%');
    console.log('Total Estabelecimentos:', estabelecimentos.length);
  
    return {
      estabelecimentos: estabelecimentos,
      totalReceita: formatarValor(totalReceita),
      totalImposto: formatarValor(totalImposto),
      aliquotaMedia: aliquotaMedia.toFixed(2).replace('.', ','),
      anexo: estabelecimentos[0]?.anexo || null,
      dataVencimento: estabelecimentos[estabelecimentos.length - 1]?.dataVencimento || null,
      receitaAcumulada: pgdasCompleto.receitaBrutaAcumulada || '0,00',
      receitasMensais: pgdasCompleto.receitasMensaisAnoCorrente || [],
      folhasMensais: pgdasCompleto.folhasMensais || [],
      impostosMensais: pgdasCompleto.impostosMensais || []  // ← NOVO
    };
  }
  
  
  
  // ========================================
  // 6. EXECUTAR CONSOLIDAÇÕES
  // ========================================
  
  const extratosConsolidado = consolidarExtratos(extratosList);
  const folhasConsolidado = consolidarFolhas(folhasList);
  const notasConsolidado = consolidarNotas(notasList);
  const pgdasConsolidado = processarPGDAS(pgdasList);  // ✅ MUDOU AQUI
  
  // ========================================
  // 6.1 MESCLAR FOLHA DO MÊS ATUAL NO HISTÓRICO
  // ========================================
  // O PGDAS-D não contém histórico de folhas para Anexos III/IV/V (Fator R não se aplica)
  // Portanto, mesclamos os dados do AGENTE_3_FOLHA no mês correspondente
  
  function mesclarFolhaMesAtual(pgdasConsolidado, folhasList) {
    // Se não há dados de folha do AGENTE_3, retornar sem alteração
    if (!folhasList || folhasList.length === 0) {
      console.log('⚠️ Nenhum dado de folha do AGENTE_3_FOLHA para mesclar');
      return pgdasConsolidado.folhasMensais || [];
    }
  
    // Criar cópia do array de folhas mensais (pode estar vazio)
    let folhasMensais = [...(pgdasConsolidado.folhasMensais || [])];
  
    // Para cada folha processada pelo AGENTE_3_FOLHA
    for (const folha of folhasList) {
      const periodo = folha.periodo; // Ex: "10/2025"
      const valorFolha = folha.totalSalarioBruto || '0,00';
      const valorNum = parseValor(valorFolha);

      if (!periodo) {
        console.warn('⚠️ Folha sem período definido, ignorando...');
        continue;
      }
      
      if (valorNum <= 0) {
        console.warn(`⚠️ Folha com valor zerado para ${periodo}, ignorando...`);
        continue;
      }

      // Verificar se já existe entrada para este mês
      const indexExistente = folhasMensais.findIndex(f => f.mes === periodo);

      if (indexExistente >= 0) {
        const valorExistente = parseValor(folhasMensais[indexExistente].valor);
        if (valorExistente > 0 && valorNum <= 0) {
          console.log(`⚠️ Mantendo folha existente para ${periodo}: ${folhasMensais[indexExistente].valor}`);
          continue;
        }
        // Atualizar valor existente
        console.log(`🔄 Atualizando folha existente para ${periodo}: ${valorFolha}`);
        folhasMensais[indexExistente].valor = valorFolha;
        folhasMensais[indexExistente].fonte = 'AGENTE_3_FOLHA';
      } else {
        // Adicionar nova entrada
        console.log(`✅ Adicionando folha do mês ${periodo}: ${valorFolha}`);
        folhasMensais.push({
          mes: periodo,
          valor: valorFolha,
          fonte: 'AGENTE_3_FOLHA'
        });
      }
    }
  
    // Ordenar por mês/ano
    folhasMensais.sort((a, b) => {
      const [mesA, anoA] = a.mes.split('/').map(Number);
      const [mesB, anoB] = b.mes.split('/').map(Number);
      if (anoA !== anoB) return anoA - anoB;
      return mesA - mesB;
    });
  
    console.log(`📊 Total de meses com folha após mesclagem: ${folhasMensais.length}`);
    return folhasMensais;
  }
  
  // Executar mesclagem
  const folhasMensaisMescladas = mesclarFolhaMesAtual(pgdasConsolidado, folhasList);
  
  // ========================================
  // 6.2 MESCLAR COMPRAS DO MÊS ATUAL NO HISTÓRICO
  // ========================================
  // As compras vêm do AGENTE_4_NOTAS (Resumo por Acumulador)
  // Mesclamos no histórico de compras para a tabela da Seção 4
  
  function mesclarComprasMesAtual(pgdasConsolidado, notasConsolidado, periodo) {
    // Criar cópia do array de compras mensais (pode estar vazio)
    let comprasMensais = [...(pgdasConsolidado.comprasMensais || [])];
  
    // Verificar se há compras do AGENTE_4
    const comprasMes = notasConsolidado.comprasMes;
    const valorCompras = parseValor(comprasMes);
  
    if (valorCompras > 0 && periodo) {
      // Verificar se já existe entrada para este mês
      const indexExistente = comprasMensais.findIndex(c => c.mes === periodo);
  
      if (indexExistente >= 0) {
        // Atualizar valor existente
        console.log(`🔄 Atualizando compras existente para ${periodo}: ${comprasMes}`);
        comprasMensais[indexExistente].valor = comprasMes;
        comprasMensais[indexExistente].fonte = 'AGENTE_4_NOTAS';
      } else {
        // Adicionar nova entrada
        console.log(`✅ Adicionando compras do mês ${periodo}: ${comprasMes}`);
        comprasMensais.push({
          mes: periodo,
          valor: comprasMes,
          fonte: 'AGENTE_4_NOTAS'
        });
      }
  
      // Ordenar por mês/ano
      comprasMensais.sort((a, b) => {
        const [mesA, anoA] = a.mes.split('/').map(Number);
        const [mesB, anoB] = b.mes.split('/').map(Number);
        if (anoA !== anoB) return anoA - anoB;
        return mesA - mesB;
      });
    } else {
      console.log('⚠️ Nenhuma compra encontrada no AGENTE_4_NOTAS para mesclar');
    }
  
    console.log(`📊 Total de meses com compras após mesclagem: ${comprasMensais.length}`);
    return comprasMensais;
  }
  
  // ========================================
  // 7. EXTRAIR INFORMAÇÕES BÁSICAS
  // ========================================
  // (movido para antes da mesclagem de compras que usa 'periodo')
  
  const razaoSocial = (pgdasList[0]?.razaoSocial || extratosConsolidado?.razaoSocial || notasConsolidado?.razaoSocial || 'Cliente')
    .replace(/^2071-\s*/, '')
    .replace(/^2072-\s*/, '')
    .replace(' - EPP', '')
    .trim();
  
  const cnpj = pgdasList[0]?.cnpj || extratosConsolidado?.cnpjs?.[0] || '00.000.000/0000-00';
  const periodo = pgdasList[0]?.periodo || extratosList[0]?.periodo || folhasList[0]?.periodo || folhasListRaw[0]?.periodo || '';
  
  // ========================================
  // 7.1 PROCESSAR COMPRAS
  // ========================================
  
  // Determinar anexo atual
  const anexoAtual = pgdasConsolidado.anexo;
  console.log(`📋 Anexo: ${anexoAtual}`);
  
  // Executar mesclagem de compras
  const comprasMensaisMescladas = mesclarComprasMesAtual(pgdasConsolidado, notasConsolidado, periodo);
  
  // Verificar se há compras (do PGDAS ou do AGENTE_4)
  const temCompras = comprasMensaisMescladas.length > 0 || parseValor(notasConsolidado.comprasMes) > 0;
  console.log(`📦 Tem compras: ${temCompras ? 'SIM' : 'NÃO'}`);
  console.log(`📦 Compras do mês: R$ ${notasConsolidado.comprasMes}`);
  
  // ========================================
  // 8. MONTAR OBJETO CONSOLIDADO FINAL
  // ========================================
  
  const dadosConsolidados = {
    reportId: `REP-${Date.now()}`,
    dataProcessamento: new Date().toISOString(),
    versao: '2.3',  // ✅ VERSÃO ATUALIZADA - Mesclagem folha + compras do AGENTE_4
    
    cliente: {
      nome: razaoSocial,
      cnpj: cnpj,
      regimeTributario: 'Simples Nacional',
      periodo: periodo,
      periodoFormatado: `Competência: ${periodo}`
    },
    
    // ✅ SEÇÃO 1 ATUALIZADA COM ESTABELECIMENTOS
    secao1_FaturamentoImpostos: {
      estabelecimentos: pgdasConsolidado.estabelecimentos,  // ✅ NOVO
  
      faturamentoDeclarado: pgdasConsolidado.totalReceita,
      aliquota: pgdasConsolidado.aliquotaMedia,
      aliquotaFormatada: `${pgdasConsolidado.aliquotaMedia}%`,
      impostoCalculado: pgdasConsolidado.totalImposto,
      dataVencimentoDAS: pgdasConsolidado.dataVencimento,
      anexoSimples: pgdasConsolidado.anexo,
      aplicouFatorR: pgdasList.some(p => p.aplicouFatorR),
      receitaAcumuladaAno: pgdasConsolidado.receitaAcumulada,
      receitasMensaisAnoCorrente: pgdasConsolidado.receitasMensais,
      folhasMensais: folhasMensaisMescladas,  // ✅ AGORA USA DADOS MESCLADOS
      comprasAplicavel: temCompras,           // ✅ Indica se há compras disponíveis
      comprasMes: notasConsolidado.comprasMes, // ✅ NOVO - Compras do mês do AGENTE_4
      comprasDetalhes: notasConsolidado.compras, // ✅ NOVO - Detalhes das compras (itens)
      // ✅ NOVO - Impostos retidos para cálculo de imposto a pagar
      impostosRetidos: notasConsolidado.impostosRetidos
    },
    
    secao2_MovimentoFinanceiro: {
      vendasCartao: extratosConsolidado.vendasCartao,
      pix: extratosConsolidado.pix,
      transferenciasRecebidas: extratosConsolidado.transferenciasRecebidas,
      depositos: extratosConsolidado.depositos,
      totalMovimento: extratosConsolidado.totalMovimentoReal,
      banco: extratosConsolidado.banco,
      divergencia: calcularDivergencia(
        pgdasConsolidado.totalReceita,
        extratosConsolidado.totalMovimentoReal
      )
    },
    
    secao3_DocumentosFiscais: {
      notasEmitidas: {
        quantidade: notasConsolidado.quantidadeNotas,
        faturamentoTotal: notasConsolidado.faturamentoTotal,
        tipoNota: notasConsolidado.tipoNota
      },
      notasCanceladas: notasConsolidado.notasCanceladas,
      gapsNumeracao: notasConsolidado.gapsNumeracao,
      impostosRetidos: notasConsolidado.impostosRetidos,
      observacoes: notasConsolidado.observacoes
    },
    
    secao4_FolhaPagamento: {
      totalSalarioBruto: folhasConsolidado.totalSalarioBruto,
      totalINSS: folhasConsolidado.totalINSS,
      totalFGTS: folhasConsolidado.totalFGTS,
      quantidadeFuncionarios: folhasConsolidado.quantidadeFuncionarios,
      totalLiquido: folhasConsolidado.totalLiquido,
      custoTotalFolha: folhasConsolidado.totalCustoFolha
    },
    
    secao5_LucroPrejuizo: {
      receitaBruta: pgdasConsolidado.totalReceita,
      impostos: pgdasConsolidado.totalImposto,
      custoFolha: folhasConsolidado.totalCustoFolha,
      lucroEstimado: calcularLucro(
        pgdasConsolidado.totalReceita,
        pgdasConsolidado.totalImposto,
        folhasConsolidado.totalCustoFolha
      ),
      dadosHistoricos: {
        receitas: pgdasConsolidado.receitasMensais,
        folhas: folhasMensaisMescladas,    // ✅ Dados mesclados do AGENTE_3_FOLHA
        compras: comprasMensaisMescladas,  // ✅ NOVO - Dados mesclados do AGENTE_4_NOTAS
        comprasAplicavel: temCompras,      // ✅ Indica se há compras disponíveis
        impostos: pgdasConsolidado.impostosMensais,
        aliquota: pgdasConsolidado.aliquotaMedia,
        anexo: anexoAtual
      }
    },
    
    alertas: gerarAlertas(
      extratosConsolidado, 
      { receitaBrutaMes: pgdasConsolidado.totalReceita, dataVencimentoDAS: pgdasConsolidado.dataVencimento }, 
      notasConsolidado, 
      folhasConsolidado
    ),
    
    documentosAnalisados: {
      total: extratosList.length + pgdasList.length + folhasListRaw.length + notasList.length,
      detalhes: [
        { 
          tipo: 'Extrato Bancário', 
          quantidade: extratosList.length, 
          analisado: extratosList.length > 0 
        },
        { 
          tipo: 'PGDAS', 
          quantidade: pgdasList.length, 
          analisado: pgdasConsolidado.estabelecimentos.length > 0 
        },
        { 
          tipo: 'Folha de Pagamento', 
          quantidade: folhasListRaw.length, 
          analisado: folhasListRaw.length > 0 
        },
        { 
          tipo: 'Notas Fiscais', 
          quantidade: notasList.length, 
          analisado: notasList.length > 0 
        }
      ]
    },
    
    _dadosBrutos: {
      extratos: extratosList,
      pgdas: pgdasList,
      folha: folhasListRaw,
      notas: notasList
    }
  };
  
  // ========================================
  // FUNÇÕES AUXILIARES
  // ========================================
  
  function parseValor(valor) {
    if (typeof valor === 'number') return valor;
    if (!valor) return 0;
    return parseFloat(String(valor).replace(/[R$\s]/g, '').replace(/\./g, '').replace(',', '.')) || 0;
  }
  
  function formatarValor(valor) {
    if (typeof valor === 'string') {
      valor = parseValor(valor);
    }
    return valor.toLocaleString('pt-BR', { 
      minimumFractionDigits: 2, 
      maximumFractionDigits: 2 
    });
  }
  
  function calcularDivergencia(faturamentoDeclara, movimentoReal) {
    const fat = parseValor(faturamentoDeclara);
    const mov = parseValor(movimentoReal);
    
    const diferencaAbsoluta = Math.abs(fat - mov);
    const diferencaRelativa = fat - mov;
    
    const porcentagem = fat !== 0 
      ? Math.abs((diferencaAbsoluta / fat) * 100).toFixed(2) 
      : '0.00';
    
    let status = 'OK';
    let interpretacao = 'Valores em conformidade';
    let nivelAlerta = 'success';
    
    if (diferencaAbsoluta < 1) {
      status = 'PERFEITO';
      interpretacao = 'Movimento financeiro em perfeita conformidade com faturamento declarado';
      nivelAlerta = 'success';
    } else if (diferencaAbsoluta < (fat * 0.02)) {
      status = 'EXCELENTE';
      interpretacao = 'Divergência mínima, provavelmente relacionada ao timing de recebimentos';
      nivelAlerta = 'success';
    } else if (diferencaAbsoluta < (fat * 0.05)) {
      status = 'BOM';
      interpretacao = 'Divergência pequena e dentro do aceitável';
      nivelAlerta = 'info';
    } else if (diferencaAbsoluta < (fat * 0.10)) {
      status = 'ATENÇÃO';
      interpretacao = 'Divergência moderada - recomenda-se verificação';
      nivelAlerta = 'warning';
    } else {
      status = 'CRÍTICO';
      interpretacao = 'Divergência significativa - requer análise detalhada';
      nivelAlerta = 'error';
    }
    
    console.log('=== CÁLCULO DIVERGÊNCIA ===');
    console.log('Faturamento:', fat.toFixed(2));
    console.log('Movimento:', mov.toFixed(2));
    console.log('Diferença:', diferencaAbsoluta.toFixed(2));
    console.log('Percentual:', porcentagem + '%');
    console.log('Status:', status);
    
    return {
      valor: formatarValor(diferencaAbsoluta),
      valorNumerico: diferencaAbsoluta,
      porcentagem: `${porcentagem}%`,
      porcentagemNumerica: parseFloat(porcentagem),
      status: status,
      nivelAlerta: nivelAlerta,
      interpretacao: interpretacao,
      detalhes: {
        faturamentoDeclara: formatarValor(fat),
        movimentoReal: formatarValor(mov),
        diferencaRelativa: formatarValor(diferencaRelativa),
        movimentoMaior: mov > fat
      }
    };
  }
  
  function calcularLucro(receita, impostos, folha) {
    const r = parseValor(receita);
    const i = parseValor(impostos);
    const f = parseValor(folha);
    return formatarValor(r - i - f);
  }
  
  function gerarAlertas(extratos, pgdas, notas, folha) {
    const alertas = [];
    
    const mov = parseValor(extratos?.totalMovimentoReal || '0,00');
    const fat = parseValor(pgdas?.receitaBrutaMes || '0,00');
    const dif = Math.abs(mov - fat);
    const pct = fat !== 0 ? (dif / fat) * 100 : 0;
    
    if (dif > fat * 0.10 && fat > 0) {
      alertas.push({
        tipo: 'DIVERGENCIA_CRITICA',
        mensagem: `Divergência crítica de R$ ${formatarValor(dif)} (${pct.toFixed(2)}%) entre movimento e faturamento`,
        nivel: 'error',
        prioridade: 1
      });
    } else if (dif > fat * 0.05 && fat > 0) {
      alertas.push({
        tipo: 'DIVERGENCIA_MODERADA',
        mensagem: `Divergência de R$ ${formatarValor(dif)} (${pct.toFixed(2)}%) entre movimento e faturamento`,
        nivel: 'warning',
        prioridade: 2
      });
    }
    
    if (notas?.notasCanceladas?.length > 0) {
      alertas.push({
        tipo: 'NOTAS_CANCELADAS',
        mensagem: `${notas.notasCanceladas.length} nota(s) cancelada(s)`,
        nivel: 'info',
        prioridade: 3
      });
    }
    
    if (notas?.gapsNumeracao?.length > 0) {
      alertas.push({
        tipo: 'GAPS_NUMERACAO',
        mensagem: `Saltos na numeração de notas fiscais detectados`,
        nivel: 'warning',
        prioridade: 2
      });
    }
    
    const totalCartao = parseValor(extratos?.vendasCartao?.total || '0,00');
    if (totalCartao === 0 && fat > 0) {
      alertas.push({
        tipo: 'SEM_VENDAS_CARTAO',
        mensagem: 'Nenhuma venda em cartão detectada no período',
        nivel: 'info',
        prioridade: 4
      });
    }
    
    if (pgdas?.dataVencimentoDAS) {
      const hoje = new Date();
      const vencimento = parseDataBR(pgdas.dataVencimentoDAS);
      if (vencimento && vencimento < hoje) {
        alertas.push({
          tipo: 'DAS_VENCIDO',
          mensagem: `DAS com vencimento em ${pgdas.dataVencimentoDAS} pode estar pendente`,
          nivel: 'warning',
          prioridade: 1
        });
      }
    }
    
    return alertas.sort((a, b) => a.prioridade - b.prioridade);
  }
  
  function parseDataBR(dataStr) {
    if (!dataStr) return null;
    const partes = dataStr.split('/');
    if (partes.length !== 3) return null;
    return new Date(partes[2], partes[1] - 1, partes[0]);
  }
  
  console.log('=== FIM DA CONSOLIDAÇÃO ===');
  console.log('Estabelecimentos processados:');
  console.log('- PGDAS:', pgdasConsolidado.estabelecimentos.length);
  console.log('- Extratos:', extratosConsolidado.estabelecimentos);
  console.log('- Folhas:', folhasConsolidado.estabelecimentos);
  
  return dadosConsolidados;
}
