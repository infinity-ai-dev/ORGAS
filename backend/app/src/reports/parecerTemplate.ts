// @ts-nocheck
// HTML template for the approved report PDF, based on /index.ts at repo root.

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

function normalizarTextoComparacao(valor: unknown): string {
  return String(valor || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .trim()
    .toLowerCase();
}

function uniqueTextItems(items: unknown[]): string[] {
  const uniqueItems: string[] = [];
  const seen = new Set<string>();

  items.forEach((item) => {
    const text = String(item || '').trim();
    if (!text) return;
    const key = normalizarTextoComparacao(text);
    if (!key || seen.has(key)) return;
    seen.add(key);
    uniqueItems.push(text);
  });

  return uniqueItems;
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

  const jaNormalizado =
    (s1Raw as Record<string, unknown>)?.faturamento ||
    (s2Raw as Record<string, unknown>)?.movimento ||
    (s3Raw as Record<string, unknown>)?.documentosFiscais;

  if (jaNormalizado) {
    return {
      ...dados,
      dadosCabecalho: {
        ...cab,
        dataGeracaoFormatada: (cab as Record<string, unknown>)?.dataGeracaoFormatada || (cab as any).dataGeracao,
      },
    };
  }

  const dadosPgdas = (s1Raw.dadosPgdas as Record<string, unknown>) || {};
  const receitaBrutaTotal = parseValorBR(
    (s1Raw as any).receitaBrutaTotal || (s1Raw as any).receitaBrutaMes || (dadosPgdas as any).receitaBrutaMes
  );
  const impostoTotal = parseValorBR((s1Raw as any).impostoTotal || (dadosPgdas as any).valorDAS);
  const aliquotaEfetiva = formatarPercentual((s1Raw as any).aliquotaEfetiva || (dadosPgdas as any).aliquota);

  const retencoes =
    ((s1Raw as any).retencoes as Record<string, unknown>) ||
    ((dadosPgdas as any).retencoes as Record<string, unknown>) ||
    {};
  let retencoesTotal = parseValorBR((retencoes as any).total);
  if (retencoesTotal === 0) {
    retencoesTotal = Object.values(retencoes).reduce((acc, v) => acc + parseValorBR(v), 0);
  }

  const impostoPagar = Math.max(impostoTotal - retencoesTotal, 0);
  const dataVencimento =
    (s1Raw as any).dataVencimentoDAS || (dadosPgdas as any).dataVencimentoDAS || (s1Raw as any).dataVencimento;

  const estabelecimentosRaw =
    (Array.isArray((s1Raw as any).estabelecimentos) && (s1Raw as any).estabelecimentos.length > 0
      ? (s1Raw as any).estabelecimentos
      : ((dadosPgdas as any).estabelecimentos as Array<Record<string, unknown>>)) || [];

  const estabelecimentos = estabelecimentosRaw.map((estab) => {
    const receitaValor = parseValorBR((estab as any).receita);
    const impostoValor = (estab as any).imposto ? String((estab as any).imposto) : formatarValorBR(impostoTotal);
    return {
      ...estab,
      descricao: (estab as any).descricao || (estab as any).tipo || 'Matriz',
      receita: formatarNumeroBR(receitaValor),
      aliquota: (estab as any).aliquota || aliquotaEfetiva,
      imposto: impostoValor,
      dataVencimento: (estab as any).dataVencimento || dataVencimento,
    };
  });

  const impostoPct = receitaBrutaTotal > 0 ? (impostoTotal / receitaBrutaTotal) * 100 : 0;
  const impostoPctLabel = receitaBrutaTotal > 0 ? `${Math.round(impostoPct)}%` : '0%';
  const impostoAltura = receitaBrutaTotal > 0 ? Math.max(impostoPct, 10) : 10;

  const s1Normalizado = {
    ...s1Raw,
    anexo: (s1Raw as any).anexoSimples || (dadosPgdas as any).anexo,
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
  const movimentoTotalValor = parseValorBR((s2Raw as any).movimentacaoTotal || (dadosExtrato as any).totalMovimentoReal);
  const vendasCartaoValor = parseValorBR(
    (dadosExtrato as any).totalVendasCartao ||
      (s2Raw as any).vendasCartao ||
      (s2Raw as any).vendasCartaoTotal
  );
  const pixValor = parseValorBR((s2Raw as any).pix || (dadosExtrato as any).totalPix);
  const transferenciasValor = parseValorBR(
    (s2Raw as any).transferencias || (dadosExtrato as any).totalTransferencias
  );
  const depositosValor = parseValorBR((s2Raw as any).depositos || (dadosExtrato as any).totalDepositos);
  const divergenciaValor = parseValorBR((s2Raw as any).divergencia);
  const divergenciaPct = movimentoTotalValor > 0 ? (divergenciaValor / movimentoTotalValor) * 100 : 0;

  const s2Normalizado = {
    ...s2Raw,
    banco: (s2Raw as any).banco || (dadosExtrato as any).banco || 'Extrato Bancário',
    movimento: {
      total: {
        valor: movimentoTotalValor,
        valorFormatado: formatarValorBR(movimentoTotalValor),
      },
      vendasCartao: {
        valor: vendasCartaoValor,
        valorFormatado: formatarValorBR(vendasCartaoValor),
      },
      pix: {
        valor: pixValor,
        valorFormatado: formatarValorBR(pixValor),
      },
      transferencias: {
        valor: transferenciasValor,
        valorFormatado: formatarValorBR(transferenciasValor),
      },
      depositos: {
        valor: depositosValor,
        valorFormatado: formatarValorBR(depositosValor),
      },
    },
    faturamentoDeclarado: {
      valor: receitaBrutaTotal,
      valorFormatado: formatarValorBR(receitaBrutaTotal),
    },
    divergencia: {
      valor: divergenciaValor,
      valorFormatado: formatarValorBR(divergenciaValor),
      porcentagem: `${divergenciaPct.toFixed(2)}%`,
    },
  };

  const documentosFiscais = (s3Raw.documentosFiscais as Record<string, unknown>) || {};
  const notasDuplicadas = (s3Raw.notasDuplicadas as Record<string, unknown>) || {};
  const s3Normalizado = {
    ...s3Raw,
    documentosFiscais: {
      nfe: documentosFiscais?.nfe || { quantidade: 0, valorFormatado: 'R$ 0,00' },
      nfce: documentosFiscais?.nfce || { quantidade: 0, valorFormatado: 'R$ 0,00' },
      cte: documentosFiscais?.cte || { quantidade: 0, valorFormatado: 'R$ 0,00' },
      nfse: documentosFiscais?.nfse || { quantidade: 0, valorFormatado: 'R$ 0,00' },
    },
    notasDuplicadas: notasDuplicadas || { quantidade: 0 },
  };

  const meses =
    Array.isArray((s4Raw as any).meses) && (s4Raw as any).meses.length > 0
      ? (s4Raw as any).meses
      : [];
  const s4Normalizado = {
    ...s4Raw,
    meses,
    totais: (s4Raw as any).totais || {},
  };

  const s5Normalizado = {
    ...s5Raw,
    documentos: (s5Raw as any).documentos || [],
  };

  const s6Normalizado = {
    ...s6Raw,
    documentos: (s6Raw as any).documentos || [],
    resumo: (s6Raw as any).resumo || { analisados: 0, naoAnalisados: 0 },
    rbt12: (s6Raw as any).rbt12 || '',
    fatorR: (s6Raw as any).fatorR || '0%',
  };

  const montarCardSimples = (anexo: string) => {
    const simples = ((s7Raw as any).simples as Record<string, unknown>) || {};
    const ehRegimeAtual = (s7Raw as any).regimeAtual === `ANEXO_${anexo}`;
    const temDados = Boolean(simples?.valor);
    return {
      titulo: `Anexo ${anexo}`,
      anexo,
      impostoFormatado: temDados ? (simples?.valor as string) || 'N/D' : 'N/D',
      aliquotaFormatada: temDados ? (simples?.aliquotaEfetiva as string) || 'N/D' : 'N/D',
      faixaAtual: stripMoeda((s6Raw as any).rbt12 || ''),
      ehRegimeAtual,
      textoDestaque: ehRegimeAtual ? 'Regime atual' : '',
      corDestaque: ehRegimeAtual ? '#10b981' : '#3b82f6',
      bordaDestaque: ehRegimeAtual ? '2px solid #10b981' : '2px solid #e5e7eb',
      ehMaisCaro: false,
      diferencaFormatada: '',
    };
  };

  const presumido = ((s7Raw as any).lucroPresumido as Record<string, unknown>) || {};
  const s7Normalizado = {
    temDadosSuficientes: Boolean((presumido as any).valor || (s7Raw as any).simples),
    fatorR: {
      valorFormatado: String((s6Raw as any).fatorR || '0%'),
      textoExplicativo: (s6Raw as any).fatorROrigem ? `Fator R ${(s6Raw as any).fatorROrigem}` : 'Fator R',
    },
    simplesNacionalAnexoIII: montarCardSimples('III'),
    simplesNacionalAnexoV: montarCardSimples('V'),
    lucroPresumido: {
      impostoFormatado: (presumido as any).valor || 'N/D',
      aliquotaEfetivaFormatada: (presumido as any).aliquotaEfetiva || 'N/D',
      presuncao: (presumido as any).presuncao || 'N/D',
      ehMaisCaro: false,
      diferencaFormatada: '',
    },
  };

  return {
    ...dados,
    dadosCabecalho: {
      ...cab,
      dataGeracaoFormatada: (cab as any)?.dataGeracaoFormatada || (cab as any).dataGeracao,
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

function isParecerPessoal(dados: Record<string, unknown>) {
  const tipo = String((dados as any)?.tipo || '').toUpperCase();
  const tipoParecer = String((dados as any)?.dadosCabecalho?.tipo_parecer || '').toLowerCase();
  return tipo === 'PARECER_PESSOAL' || tipoParecer === 'pessoal';
}

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderList(items: unknown[]): string {
  if (!items || items.length === 0) {
    return '<p class="muted">Sem registros.</p>';
  }
  const li = items
    .map((item) => `<li>${escapeHtml(item)}</li>`)
    .join('');
  return `<ul>${li}</ul>`;
}

function renderDocs(items: unknown[]): string {
  if (!items || items.length === 0) {
    return '<p class="muted">Nenhum documento listado.</p>';
  }
  const li = items
    .map((item) => `<li>${escapeHtml(item)}</li>`)
    .join('');
  return `<ul>${li}</ul>`;
}

function renderPagamentos(itens: Array<Record<string, unknown>>): string {
  if (!itens || itens.length === 0) {
    return '<p class="muted">Sem valores informados.</p>';
  }
  const normalizeKey = (value: unknown) =>
    String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9]+/g, ' ')
      .trim()
      .toLowerCase();
  const merged = new Map<string, Record<string, unknown>>();
  itens.forEach((item) => {
    const documento = item.documento || item.descricao || '';
    const vencimento = item.vencimento || item.dataPagamento || item.data || '';
    const key = `${normalizeKey(documento)}|${normalizeKey(vencimento)}`;
    const valorNum = parseValorBR(item.valor || item.valorPagamento || 0);
    if (!merged.has(key)) {
      merged.set(key, {
        ...item,
        documento,
        vencimento,
        valor: formatarValorBR(valorNum),
        _valorNum: valorNum,
      });
      return;
    }
    const current = merged.get(key)!;
    const currentNum = Number((current as any)._valorNum || 0);
    const nextNum = currentNum + valorNum;
    current.valor = formatarValorBR(nextNum);
    (current as any)._valorNum = nextNum;
    if (!current.fonte && item.fonte) {
      current.fonte = item.fonte;
    }
  });
  const rows = Array.from(merged.values())
    .filter((item) => {
      const documento = String(item.documento || item.descricao || '').toLowerCase();
      const valorNum = typeof (item as any)._valorNum === 'number'
        ? Number((item as any)._valorNum)
        : parseValorBR(item.valor);
      if (/consignado/.test(documento) && valorNum <= 0) {
        return false;
      }
      return true;
    })
    .map((item) => {
      const documento = item.documento || item.descricao || '';
      const vencimento = item.vencimento || item.dataPagamento || item.data || '';
      return `<tr>
        <td>${escapeHtml(documento)}</td>
        <td>${escapeHtml(item.valor || '')}</td>
        <td>${escapeHtml(vencimento || '')}</td>
      </tr>`;
    })
    .join('');
  if (!rows) {
    return '<p class="muted">Sem valores informados.</p>';
  }
  return `<table class="grid-table">
    <thead>
      <tr>
        <th>Documento</th>
        <th>Valor</th>
        <th>Vencimento</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>`;
}

function parseHorasToMinutes(value: unknown): number {
  if (typeof value === 'number') return Math.round(value * 60);
  if (!value) return 0;
  const raw = String(value).trim();
  if (raw.includes(':')) {
    const [h, m] = raw.split(':').map((item) => Number(item));
    return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
  }
  const numeric = Number(raw.replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(numeric) ? Math.round(numeric * 60) : 0;
}

function formatMinutesToHours(minutes: number): string {
  if (!minutes) return '0:00';
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${hours}:${String(mins).padStart(2, '0')}`;
}

function renderJornadaTabela(jornadas: Array<Record<string, unknown>>): string {
  if (!jornadas || jornadas.length === 0) {
    return '<p class="muted">Sem jornadas informadas.</p>';
  }
  const rows = jornadas
    .map((item) => {
      return `<tr>
        <td>${escapeHtml(item.funcionario || item.nome || '')}</td>
        <td>${escapeHtml(item.diasTrabalhados || '')}</td>
        <td>${escapeHtml(item.horasExtras || '')}</td>
        <td>${escapeHtml(item.faltas || '')}</td>
      </tr>`;
    })
    .join('');
  return `<table class="grid-table">
    <thead>
      <tr>
        <th>Funcionário</th>
        <th>Dias Trabalhados</th>
        <th>Horas Extras</th>
        <th>Faltas</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>`;
}

function renderJornadaGrafico(jornadas: Array<Record<string, unknown>>): string {
  if (!jornadas || jornadas.length === 0) {
    return '';
  }
  const parsed = jornadas
    .map((item) => {
      const nome = String(item.funcionario || item.nome || '').trim();
      if (!nome) {
        return null;
      }
      const worked = parseHorasToMinutes(item.horasTrabalhadas);
      const extras = parseHorasToMinutes(item.horasExtras);
      const salarioBase = parseValorBR(item.salarioBaseMensal || 0);
      const vencimentoExtra = parseValorBR(item.vencimentoHoraExtra || 0);
      return { nome, worked, extras, salarioBase, vencimentoExtra };
    })
    .filter(Boolean) as Array<{ nome: string; worked: number; extras: number; salarioBase: number; vencimentoExtra: number }>;
  const max = parsed.reduce((acc, item) => Math.max(acc, item.worked + item.extras), 0);
  if (!max) return '';
  return parsed
    .map((item) => {
      const total = item.worked + item.extras;
      const width = max > 0 ? Math.round((total / max) * 100) : 0;
      const workedWidth = total > 0 ? Math.round((item.worked / total) * 100) : 0;
      const baseLabel = item.salarioBase ? formatarValorBR(item.salarioBase) : '-';
      const extraLabel = item.vencimentoExtra ? formatarValorBR(item.vencimentoExtra) : '-';
      return `<div class="bar-row">
        <div class="bar-label">${escapeHtml(item.nome)}</div>
        <div class="bar-track">
          <div class="bar-total" style="width: ${width}%">
            <div class="bar-worked" style="width:${workedWidth}%"></div>
          </div>
        </div>
        <div class="bar-value">${escapeHtml(formatMinutesToHours(total))}</div>
        <div class="bar-meta">${escapeHtml(`Base: ${baseLabel} · Extra: ${extraLabel}`)}</div>
      </div>`;
    })
    .join('');
}

function renderAnexosTabela(documentos: Array<Record<string, unknown>>): string {
  if (!documentos || documentos.length === 0) {
    return '<p class="muted">Sem documentos anexos.</p>';
  }
  const rows = documentos
    .map((doc) => {
      return `<tr>
        <td>${escapeHtml(doc.documento || doc.nome || '')}</td>
        <td>${escapeHtml(doc.tipo || '')}</td>
        <td>${escapeHtml(doc.periodo || '')}</td>
        <td>${escapeHtml(doc.status || '')}</td>
        <td>${escapeHtml(doc.tamanho || '')}</td>
      </tr>`;
    })
    .join('');
  return `<table class="grid-table">
    <thead>
      <tr>
        <th>Documento</th>
        <th>Tipo</th>
        <th>Período</th>
        <th>Status</th>
        <th>Tamanho</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>`;
}

function gerarHtmlParecerPessoal(dados: Record<string, unknown>): string {
  const cab = (dados as any).dadosCabecalho || {};
  const pagamentos = (dados as any).valoresPagamento || {};
  const jornada = (dados as any).controleJornada || {};
  const alteracoes = (dados as any).alteracoesMes || {};
  const eventos = (dados as any).eventosDP || {};
  const consignado = (dados as any).consignado || {};
  const atencao = (dados as any).pontosAtencao || {};
  const pendencias = (dados as any).avisosPendencias || {};
  const anexos = (dados as any).anexos || {};
  const comentarios = (dados as any).comentarios || {};

  const cliente = escapeHtml(
    cab.clienteNome || cab.cliente_nome || cab.razaoSocial || cab.cliente || 'Cliente'
  );
  const cnpj = escapeHtml(cab.clienteCnpj || cab.cliente_cnpj || cab.cnpj || '-');
  const competencia = escapeHtml(cab.competencia || cab.periodo || cab.periodoApuracao || '-');
  const periodo = escapeHtml(cab.periodoApuracao || cab.periodo || cab.competencia || '-');
  const dataEmissao = escapeHtml(
    cab.dataEmissao || cab.dataGeracao || cab.timestamp || cab.gerado_em || ''
  );

  const pagamentosHtml = renderPagamentos(pagamentos.itens || []);
  const pontosAtencaoItems = uniqueTextItems(Array.isArray(atencao.itens) ? atencao.itens : []);
  const pontosAtencaoKeys = new Set(pontosAtencaoItems.map((item) => normalizarTextoComparacao(item)));
  const pendenciasJornadaItems = uniqueTextItems(Array.isArray(jornada.pendencias) ? jornada.pendencias : []);
  const pendenciasGeraisItems = uniqueTextItems(Array.isArray(pendencias.itens) ? pendencias.itens : []);
  const jornadaAlertasItems = uniqueTextItems(String(jornada.alertas || '').split(/\s*;\s*/)).filter(
    (item) => !pontosAtencaoKeys.has(normalizarTextoComparacao(item))
  );
  const avisosFeriasItems = pendenciasGeraisItems.filter((item) => {
    const normalized = normalizarTextoComparacao(item);
    return normalized.includes('ferias') || normalized.includes('vencimento') || normalized.includes('dobra');
  });
  const pendenciasJornada = renderList(pendenciasJornadaItems);
  const jornadasList = Array.isArray(jornada.jornadas) ? jornada.jornadas : [];
  const jornadaTabela = renderJornadaTabela(jornadasList);
  const jornadaGrafico = renderJornadaGrafico(jornadasList);
  const jornadaResumo = jornada.resumo || {};
  const metodoJornada = String(jornada.metodo || '-').replace(/cartao/gi, 'cartão');

  const alteracoesEventos = renderList(alteracoes.eventos || []);
  const alteracoesVariaveis = renderList(alteracoes.variaveis || []);

  const ferias = renderList(eventos.ferias || []);
  const desligamentos = renderList(eventos.desligamentos || []);
  const admissoes = renderList(eventos.admissoes || []);
  const afastamentos = renderList(eventos.afastamentos || []);

  const consignadoContratos = renderList(consignado.contratos || []);
  const consignadoTotalNum = parseValorBR(consignado.totalConsignado || 0);
  const temConsignado =
    Boolean(consignado.temConsignado) ||
    consignadoTotalNum > 0 ||
    (Array.isArray(consignado.contratos) && consignado.contratos.length > 0);
  const pontosAtencao = renderList(pontosAtencaoItems);
  const jornadaAlertas = jornadaAlertasItems.length > 0 ? renderList(jornadaAlertasItems) : '';
  const temAvisosPendencias = avisosFeriasItems.length > 0;
  const avisosPendencias = temAvisosPendencias ? renderList(avisosFeriasItems) : '';
  const anexosPendencias = renderList(anexos.pendencias || []);
  const anexosTabela = renderAnexosTabela(anexos.documentos || []);

  const comentariosAgente = escapeHtml(comentarios.agente || '');
  const comentariosAnalista = escapeHtml(comentarios.analista || '');
  const pagamentosItens = Array.isArray(pagamentos.itens) ? pagamentos.itens : [];
  const normalizeKey = (value: unknown) =>
    String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9]+/g, ' ')
      .trim()
      .toLowerCase();
  const pagamentosAgrupados = new Map<string, { descricao: string; valorNum: number; valorFormatado: string }>();
  pagamentosItens.forEach((item) => {
    const descricao = String(item?.descricao || item?.documento || 'Pagamento');
    const key = normalizeKey(descricao);
    const valorNum = parseValorBR(item?.valor || item?.valorPagamento || 0);
    const existing = pagamentosAgrupados.get(key);
    if (!existing) {
      pagamentosAgrupados.set(key, {
        descricao,
        valorNum,
        valorFormatado: formatarValorBR(valorNum),
      });
      return;
    }
    const novoTotal = existing.valorNum + valorNum;
    existing.valorNum = novoTotal;
    existing.valorFormatado = formatarValorBR(novoTotal);
  });
  const pagamentosParsed = Array.from(pagamentosAgrupados.values());
  const pagamentosTotal = pagamentosParsed.reduce((sum, item) => sum + item.valorNum, 0);
  const pagamentosMax = pagamentosParsed.reduce((max, item) => (item.valorNum > max ? item.valorNum : max), 0);
  const pagamentosGrafico = pagamentosParsed
    .map((item) => {
      const width = pagamentosMax > 0 ? Math.round((item.valorNum / pagamentosMax) * 100) : 0;
      return `<div class="bar-row">
        <div class="bar-label">${escapeHtml(item.descricao)}</div>
        <div class="bar-track">
          <div class="bar-fill" style="width: ${width}%"></div>
        </div>
        <div class="bar-value">${escapeHtml(item.valorFormatado)}</div>
      </div>`;
    })
    .join('');

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8" />
  <title>Parecer Pessoal</title>
  <style>
    * { box-sizing: border-box; }
    body { font-family: Arial, sans-serif; color: #111; margin: 24px; }
    h1 { font-size: 20px; margin: 0 0 4px; }
    h2 { font-size: 14px; margin: 24px 0 8px; text-transform: uppercase; letter-spacing: 0.02em; }
    h3 { font-size: 12px; margin: 16px 0 6px; }
    .header { border-bottom: 1px solid #ddd; padding-bottom: 12px; margin-bottom: 16px; }
    .muted { color: #666; font-size: 12px; }
    .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px 16px; font-size: 12px; }
    .grid-item span { color: #666; display: block; font-size: 11px; }
    .card { border: 1px solid #e5e7eb; border-radius: 8px; padding: 12px; margin-bottom: 16px; }
    .grid-table { width: 100%; border-collapse: collapse; font-size: 12px; }
    .grid-table th, .grid-table td { border: 1px solid #e5e7eb; padding: 6px 8px; text-align: left; }
    .stats { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; margin: 12px 0; }
    .stat { border: 1px solid #e5e7eb; border-radius: 6px; padding: 8px; font-size: 12px; }
    .stat span { display: block; font-size: 11px; color: #666; }
    .bar-row { display: grid; grid-template-columns: 1.4fr 3fr 1fr; gap: 8px; align-items: center; font-size: 12px; margin-bottom: 6px; }
    .bar-meta { grid-column: 1 / -1; font-size: 11px; color: #666; margin-top: 4px; }
    .bar-track { height: 8px; background: #e5e7eb; border-radius: 999px; overflow: hidden; }
    .bar-fill { height: 100%; background: #1f2937; }
    .bar-total { height: 100%; background: #93c5fd; }
    .bar-worked { height: 100%; background: #1f2937; }
    .progress { height: 8px; background: #fde68a; border-radius: 999px; overflow: hidden; margin: 8px 0; }
    .progress-fill { height: 100%; background: #f59e0b; }
    ul { padding-left: 18px; margin: 0; }
    li { margin-bottom: 4px; }
  </style>
</head>
<body>
  <div class="header">
    <h1>Parecer Pessoal</h1>
    <p class="muted">Resumo</p>
    <div class="grid">
      <div class="grid-item"><span>Cliente</span>${cliente}</div>
      <div class="grid-item"><span>CNPJ</span>${cnpj}</div>
      <div class="grid-item"><span>Competência</span>${competencia}</div>
      <div class="grid-item"><span>Período de Apuração</span>${periodo}</div>
      <div class="grid-item"><span>Data de Emissão</span>${dataEmissao}</div>
    </div>
  </div>

  <div class="card">
    <h2>1 - Valores para Pagamento</h2>
    <div class="stats">
      <div class="stat"><span>Total</span>${formatarValorBR(pagamentosTotal)}</div>
      <div class="stat"><span>Itens</span>${pagamentosParsed.length}</div>
      <div class="stat"><span>Maior pagamento</span>${formatarValorBR(pagamentosMax)}</div>
    </div>
    ${pagamentosHtml}
    ${pagamentos.analiseIA ? `<p class="muted"><strong>Conclusão:</strong> ${escapeHtml(pagamentos.analiseIA)}</p>` : ''}
    ${pagamentos.observacoes ? `<p class="muted"><strong>Observações:</strong> ${escapeHtml(pagamentos.observacoes)}</p>` : ''}
    ${pagamentos.conferenciaIRRF ? `<p class="muted"><strong>Conferência IRRF (competência x pagamento):</strong> ${escapeHtml(pagamentos.conferenciaIRRF)}</p>` : ''}
    ${pagamentos.conferenciaIRRFBases ? `<p class="muted"><strong>Conferência IRRF (Extrato x Bases):</strong> ${escapeHtml(pagamentos.conferenciaIRRFBases)}</p>` : ''}
    ${pagamentosParsed.length > 0 ? `<div class="card">
      <h3>Gráfico de Pagamentos</h3>
      ${pagamentosGrafico}
    </div>` : ''}
  </div>

  <div class="card">
    <h2>2 - Controle de Jornada de Trabalho</h2>
    <p><strong>CNPJ:</strong> ${escapeHtml(jornada.cnpj || cnpj || '-')}</p>
    <p><strong>Método:</strong> ${escapeHtml(metodoJornada)}</p>
    ${jornada.resumoTexto ? `<p class="muted">${escapeHtml(jornada.resumoTexto)}</p>` : ''}
    ${jornada.completude ? `<div class="card">
      <h3>Completude do Período</h3>
      <div class="progress">
        <div class="progress-fill" style="width:${Math.min(100, Math.max(0, Number(jornada.completude.percentual || 0)))}%"></div>
      </div>
      <p class="muted">${escapeHtml(jornada.completude.diasTrabalhados)} de ${escapeHtml(jornada.completude.capacidade || jornada.completude.diasUteis)} dias úteis previstos (${escapeHtml(jornada.completude.percentual)}%)</p>
    </div>` : ''}
    ${jornadaResumo?.totalFuncionarios ? `<div class="stats">
      <div class="stat"><span>Funcionários</span>${escapeHtml(jornadaResumo.totalFuncionarios)}</div>
      <div class="stat"><span>Total Horas</span>${escapeHtml(jornadaResumo.totalHorasTrabalhadas || '')}</div>
      <div class="stat"><span>Horas Extras</span>${escapeHtml(jornadaResumo.totalHorasExtras || '')}</div>
    </div>` : ''}
    ${jornadaGrafico ? `<div class="card">
      <h3>Gráfico de Jornada</h3>
      ${jornadaGrafico}
    </div>` : ''}
    <h3>Resumo por Colaborador</h3>
    ${jornadaTabela}
    <h3>Pendências</h3>
    ${pendenciasJornada}
    ${jornada.conferenciaHorasExtras ? `<p class="muted">${escapeHtml(jornada.conferenciaHorasExtras)}</p>` : ''}
    ${Array.isArray(jornada.conferenciaHorasExtrasDetalhes) && jornada.conferenciaHorasExtrasDetalhes.length > 0
      ? `<div class="card">
      <h3>Comparativo de horas extras</h3>
      ${renderList(jornada.conferenciaHorasExtrasDetalhes)}
    </div>`
      : ''}
    ${jornadaAlertas ? `<h3>Alertas complementares</h3>${jornadaAlertas}` : ''}
  </div>

  <div class="card">
    <h2>3 - Alterações ocorridas no mês</h2>
    <p class="muted">As alterações do mês devem ser justificadas com base em eventos (férias, desligamentos, admissões) e variáveis (comissões, gratificações, prêmios, horas extras).</p>
    <table class="grid-table">
      <thead>
        <tr>
          <th>Mês anterior</th>
          <th>Valor anterior</th>
          <th>Mês atual</th>
          <th>Valor atual</th>
          <th>Variação</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>${escapeHtml(alteracoes?.comparativo?.mesAnterior || '-')}</td>
          <td>${escapeHtml(alteracoes?.comparativo?.valorAnterior || '-')}</td>
          <td>${escapeHtml(alteracoes?.comparativo?.mesAtual || '-')}</td>
          <td>${escapeHtml(alteracoes?.comparativo?.valorAtual || '-')}</td>
          <td>${escapeHtml(alteracoes?.comparativo?.variacaoPercentual || '-')}</td>
        </tr>
      </tbody>
    </table>
    <h3>Férias</h3>
    ${ferias}
    <h3>Desligamentos</h3>
    ${desligamentos}
    ${admissoes ? `<h3>Admissões</h3>${admissoes}` : ''}
    ${afastamentos ? `<h3>Afastamentos</h3>${afastamentos}` : ''}
    ${temConsignado ? `<h3>Empréstimo consignado (FGTS Digital)</h3>
    <div class="grid">
      <div class="grid-item"><span>Total consignado</span>${escapeHtml(consignado.totalConsignado || 'R$ 0,00')}</div>
      <div class="grid-item"><span>Vencimento</span>${escapeHtml(consignado.vencimento || '-')}</div>
    </div>
    <p class="muted">O desconto ocorre na folha e o repasse é feito via guia do FGTS Digital. O prazo padrão é até o dia 20. Em caso de perda do prazo, pode ser necessário acionar a instituição financeira para emissão.</p>` : ''}
  </div>

  <div class="card">
    <h2>4 - Pontos de atenção (SST/ESOCIAL)</h2>
    ${pontosAtencao}
    ${atencao.observacoes ? `<p class="muted">${escapeHtml(atencao.observacoes)}</p>` : '<p class="muted">Obrigatório envio de eventos SST ao eSocial. Há risco de multas em fiscalizações. Recomendado manter empresa de SST e cumprir exames admissionais e demissionais nos prazos legais.</p>'}
  </div>

  <div class="card">
    <h2>5 - Aviso de vencimento de férias</h2>
    ${avisosPendencias}
    ${pendencias.observacoes
    ? `<p class="muted">${escapeHtml(pendencias.observacoes)}</p>`
    : (!temAvisosPendencias
      ? '<p class="muted">Aviso de vencimento de férias: verificar datas limite para evitar dobra e confirmar retorno do cliente.</p>'
      : '')}
  </div>

  <div class="card">
    <h2>6 - Documentos anexos e observações</h2>
    <h3>Pendências</h3>
    ${anexosPendencias}
    <h3>Documentos anexos</h3>
    ${anexosTabela}
  </div>

  <div class="card">
    <h2>9. Comentários</h2>
    ${comentariosAgente ? `<p><strong>Agente:</strong> ${comentariosAgente}</p>` : '<p class="muted">Sem comentário do agente.</p>'}
    ${comentariosAnalista ? `<p><strong>Analista:</strong> ${comentariosAnalista}</p>` : '<p class="muted">Sem comentário do analista.</p>'}
  </div>
</body>
</html>`;
}

export function gerarHtmlParecer(data: Record<string, unknown>): string {
  let dados = (data as any).secoes_json as Record<string, unknown>;
  if (typeof dados === 'string') {
    dados = JSON.parse(dados);
  }
  if (isParecerPessoal(dados)) {
    return gerarHtmlParecerPessoal(dados);
  }
  dados = normalizarSecoesParaPdf(dados);

  const cab = (dados as any).dadosCabecalho || {};
  const s1 = (dados as any).dadosSecao1 || {};
  const s2 = (dados as any).dadosSecao2 || {};
  const s3 = (dados as any).dadosSecao3 || {};
  const s4 = (dados as any).dadosSecao4 || {};
  const s5 = (dados as any).dadosSecao5 || {};
  const s6 = (dados as any).dadosSecao6 || {};
  const s7 = (dados as any).dadosSecao7 || null;
  const s8 = (dados as any).dadosSecao8 || {};

  const anexo = s1?.anexo || (s8?.detalhes as Record<string, unknown>)?.anexo || 'III';
  const atividade = ['I', 'II'].includes(anexo as string) ? 'comércio' : 'prestação de serviços';

  const divergencia = s2?.divergencia as Record<string, unknown> | undefined;
  const divergenciaFormatada = (divergencia as any)?.valorFormatado || 'R$ 0,00';
  const divergenciaPct = (divergencia as any)?.porcentagem || '0%';
  const divergenciaExiste = ((divergencia as any)?.valor as number) > 0;

  const observacaoCorrigida = `A empresa ${cab?.razaoSocial} é optante pelo Simples Nacional e atua no ramo de ${atividade}, enquadrada no Anexo ${anexo}. O extrato bancário (${s2?.banco || 'não informado'}) ${divergenciaExiste ? 'apresenta divergência de ' + divergenciaFormatada + ' (' + divergenciaPct + ')' : 'está em conformidade'} entre o movimento financeiro e a receita declarada. O DAS da competência ${cab?.periodo} está pendente de pagamento.`;
  const observacaoFinal =
    (s8 as any)?.observacoes ||
    (s8 as any)?.observacao ||
    observacaoCorrigida ||
    'Sem observações.';

  const ehComercio = ['I', 'II'].includes(anexo as string);
  const mostrarSecao7 = !ehComercio && s7 !== null && (s7 as Record<string, unknown>)?.temDadosSuficientes;

  const movimento = s2?.movimento as Record<string, unknown> | undefined;
  const vendasCartao = movimento?.vendasCartao as Record<string, unknown> | undefined;
  const temVendasCartao = (vendasCartao as any)?.valor > 0;

  const s6Docs = s6?.documentos as Array<Record<string, unknown>> | undefined;
  const s6Resumo = s6?.resumo as Record<string, number> | undefined;
  const comentarios = (dados as any).comentarios || {};
  const s9 = (dados as any).dadosSecao9 || {};
  const comentarioAgente = escapeHtml(comentarios.agente || '');
  const comentarioAnalista = escapeHtml(
    s9.comentario ||
    s9.observacoes ||
    comentarios.analista ||
    ''
  );
  const comentarioAnalistaNome = escapeHtml(
    s9.analista ||
    ''
  );

  if (s6Docs && s6Resumo) {
    for (const doc of s6Docs) {
      if ((doc.nome as string)?.toLowerCase().includes('cartão') || (doc.nome as string)?.toLowerCase().includes('administradora')) {
        if (temVendasCartao) {
          (doc as any).analisado = true;
          (doc as any).icone = '✓';
          (doc as any).cor = '#10b981';
        }
      }
    }
    s6Resumo.analisados = s6Docs.filter(d => (d as any).analisado).length;
    s6Resumo.naoAnalisados = s6Docs.filter(d => !(d as any).analisado).length;
  }

  const faturamento = s1?.faturamento as Record<string, unknown> | undefined;
  const imposto = s1?.imposto as Record<string, unknown> | undefined;
  const grafico = s1?.grafico as Record<string, unknown> | undefined;
  const totais = s1?.totais as Record<string, unknown> | undefined;
  const estabelecimentos = s1?.estabelecimentos as Array<Record<string, unknown>> | undefined;
  const aliquotaEfetivaLabel =
    (grafico as any)?.aliquotaEfetivaLabel ||
    (imposto as any)?.aliquotaEfetivaFormatada ||
    (grafico as any)?.impostoLabel ||
    '0%';
  const aliquotaFinalLabel =
    (grafico as any)?.aliquotaFinalLabel ||
    (imposto as any)?.aliquotaFinalFormatada ||
    '';
  const mostrarDuasAliquotas = Boolean((grafico as any)?.mostrarDuasAliquotas || (imposto as any)?.temRetencao);
  const diferencaAliquotasLabel = (grafico as any)?.diferencaAliquotasLabel || '';
  const impostoAltura =
    (grafico as any)?.aliquotaEfetivaAltura || (grafico as any)?.impostoAltura || 10;

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

  const htmlCompleto = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
    <meta charset="UTF-8">
    <title>Parecer Fiscal - ${cab?.periodo}</title>
    <style>
        @page { size: A4; margin: 15mm 10mm; }
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: 'Segoe UI', sans-serif; font-size: 11px; color: #374151; }
        .header { background: linear-gradient(135deg, #1e40af 0%, #3b82f6 100%); color: white; padding: 15px; text-align: center; margin-bottom: 15px; border-radius: 6px; }
        .header h1 { font-size: 18px; margin-bottom: 5px; }
        .empresa-info { display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; margin-bottom: 20px; background: #f8fafc; padding: 15px; border-radius: 6px; border: 1px solid #e5e7eb; }
        .info-item { display: flex; gap: 8px; }
        .info-label { font-size: 9px; color: #6b7280; text-transform: uppercase; font-weight: 600; }
        .info-value { font-size: 11px; font-weight: 600; color: #1e293b; }
        .section { margin-bottom: 25px; page-break-inside: avoid; }
        .section h2 { background: #f1f5f9; color: #334155; padding: 10px 15px; margin-bottom: 15px; font-size: 14px; font-weight: 700; border-left: 4px solid #3b82f6; border-radius: 4px; }
        .section h3 { color: #475569; font-size: 12px; font-weight: 600; margin-bottom: 12px; }
        table { width: 100%; border-collapse: collapse; font-size: 10px; border: 2px solid #d97706; margin-bottom: 15px; }
        th, td { padding: 8px 6px; border: 1px solid #d97706; }
        th { background: #fbbf24; color: #78350f; font-weight: 700; }
        .text-center { text-align: center; }
        .linha-total { background: #fef3c7 !important; font-weight: bold; }
        .alert { padding: 12px 15px; border-radius: 6px; margin: 15px 0; }
        .alert-info { background: #eff6ff; border: 1px solid #bfdbfe; color: #1e3a8a; }
        .alert-warning { background: #fef3c7; border: 1px solid #fde68a; color: #78350f; }
        .muted { color: #6b7280; font-size: 10px; }
        .grid-2x2 { display: grid; grid-template-columns: repeat(2, 1fr); gap: 15px; margin-bottom: 15px; }
        .grid-item { background: #e0f2fe; padding: 15px; border-radius: 6px; border-left: 4px solid #0284c7; }
        .grid-item h4 { margin: 0 0 8px 0; color: #0369a1; font-size: 11px; }
        .chart-wrapper { background: white; padding: 25px; border-radius: 8px; border: 2px solid #e5e7eb; margin: 20px 0; }
        .chart-title { text-align: center; color: #1f2937; margin-bottom: 35px; font-size: 16px; font-weight: bold; padding-bottom: 10px; border-bottom: 1px solid #e5e7eb; }
        .chart-bars-area { display: flex; justify-content: space-around; align-items: flex-end; height: 280px; margin: 0 40px; background: #f8fafc; padding: 20px; border-radius: 8px; }
        .chart-legend { margin-top: 15px; display: flex; justify-content: center; gap: 10px; flex-wrap: wrap; }
        .chart-legend-item { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 999px; padding: 4px 10px; font-size: 10px; color: #475569; }
        .chart-legend-item strong { color: #1f2937; }
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
        <header class="header">
            <h1>PARECER SOBRE A APURAÇÃO FISCAL</h1>
            <div>${cab?.periodoFormatado || cab?.periodo || cab?.competencia || cab?.periodoApuracao || '-'}</div>
        </header>

        <div class="empresa-info">
            <div class="info-item">
                <div>
                    <div class="info-label">Razão Social</div>
                    <div class="info-value">${cab?.razaoSocial || cab?.cliente_nome || cab?.clienteNome || cab?.cliente || ''}</div>
                </div>
            </div>
            <div class="info-item">
                <div>
                    <div class="info-label">CNPJ</div>
                    <div class="info-value">${cab?.cnpj || cab?.cliente_cnpj || cab?.clienteCnpj || ''}</div>
                </div>
            </div>
            <div class="info-item">
                <div>
                    <div class="info-label">Regime Tributário</div>
                    <div class="info-value">${cab?.regimeTributario || cab?.cliente_regime_tributario || ''}</div>
                </div>
            </div>
            <div class="info-item">
                <div>
                    <div class="info-label">Período Analisado</div>
                    <div class="info-value">${cab?.periodo || cab?.competencia || cab?.periodoApuracao || ''}</div>
                </div>
            </div>
        </div>

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
                        <td style="font-weight: bold;">${(estab as any).descricao}</td>
                        <td class="text-center">R$ ${(estab as any).receita || '0,00'}</td>
                        <td class="text-center">${(estab as any).aliquota}</td>
                        <td class="text-center">${(estab as any).imposto}</td>
                        <td class="text-center" style="color: ${(imposto as any)?.temRetencao ? '#f59e0b' : '#6b7280'};">${(imposto as any)?.totalRetidoFormatado || 'R$ 0,00'}</td>
                        <td class="text-center" style="color: #10b981; font-weight: bold;">${(imposto as any)?.impostoPagarFormatado || (estab as any).imposto}</td>
                        ${index === 0 ? `<td class="text-center" rowspan="${estabelecimentos.length}" style="color: #dc2626; font-weight: bold; vertical-align: middle;">${(estab as any).dataVencimento || (estabelecimentos as any)[estabelecimentos.length - 1].dataVencimento}</td>` : ''}
                    </tr>
                    `).join('') : `
                    <tr>
                        <td style="font-weight: bold;">${(faturamento as any)?.descricao || 'Matriz'}</td>
                        <td class="text-center">${(faturamento as any)?.valorFormatado || 'R$ 0,00'}</td>
                        <td class="text-center">${(imposto as any)?.aliquotaEfetivaFormatada || '0%'}</td>
                        <td class="text-center">${(imposto as any)?.valorFormatado || 'R$ 0,00'}</td>
                        <td class="text-center">${(imposto as any)?.totalRetidoFormatado || 'R$ 0,00'}</td>
                        <td class="text-center">${(imposto as any)?.impostoPagarFormatado || 'R$ 0,00'}</td>
                        <td class="text-center">${(s1 as any)?.dataVencimento || '-'}</td>
                    </tr>
                    `}
                    <tr class="linha-total">
                        <td style="font-weight: bold;">TOTAL</td>
                        <td class="text-center">${(totais as any)?.faturamento || (faturamento as any)?.valorFormatado || 'R$ 0,00'}</td>
                        <td class="text-center">-</td>
                        <td class="text-center">${(totais as any)?.imposto || (imposto as any)?.valorFormatado || 'R$ 0,00'}</td>
                        <td class="text-center">${(imposto as any)?.totalRetidoFormatado || 'R$ 0,00'}</td>
                        <td class="text-center">${(imposto as any)?.impostoPagarFormatado || 'R$ 0,00'}</td>
                        <td class="text-center">${(s1 as any)?.dataVencimento || '-'}</td>
                    </tr>
                </tbody>
            </table>

            <h3>b) Variação de Faturamentos e Impostos</h3>
            <div class="chart-wrapper">
                <div class="chart-title">Comparativo: Faturamento x Impostos</div>
                <div class="chart-bars-area">
                    <div class="bar-column">
                        <div class="bar-value-box">
                            <div class="bar-value">${(faturamento as any)?.valorFormatado || 'R$ 0,00'}</div>
                        </div>
                        <div class="bar-container">
                            <div class="bar bar-faturamento" style="height: ${(grafico as any)?.faturamentoAltura || 100}%;">
                                <span class="bar-percentage">${(grafico as any)?.faturamentoLabel || '100%'}</span>
                            </div>
                        </div>
                        <div class="bar-label">
                            <div class="bar-label-text bar-label-faturamento">Faturamento</div>
                        </div>
                    </div>
                    <div class="bar-column">
                        <div class="bar-value-box">
                            <div class="bar-value">${(imposto as any)?.valorFormatado || 'R$ 0,00'}</div>
                        </div>
                        <div class="bar-container">
                            <div class="bar bar-impostos" style="height: ${impostoAltura}%;">
                                <span class="bar-percentage">${aliquotaEfetivaLabel}</span>
                            </div>
                        </div>
                        <div class="bar-label">
                            <div class="bar-label-text bar-label-impostos">Impostos</div>
                        </div>
                    </div>
                </div>
                <div class="chart-legend">
                    <div class="chart-legend-item">Alíquota efetiva: <strong>${aliquotaEfetivaLabel}</strong></div>
                    ${mostrarDuasAliquotas && aliquotaFinalLabel ? `<div class="chart-legend-item">Alíquota final: <strong>${aliquotaFinalLabel}</strong> ${diferencaAliquotasLabel ? `<span class="muted">${diferencaAliquotasLabel}</span>` : ''}</div>` : ''}
                </div>
            </div>
        </section>

        <section class="section">
            <h2>💳 2. Análise Faturamento Declarado x Movimento Financeiro</h2>
            <h3>Vendas Administradoras e Movimento Extrato Bancário - ${(s2 as any)?.banco || 'Banco'}</h3>
            <table>
                <thead>
                    <tr>
                        <th>FATURAMENTO</th>
                        <th class="text-center">VALOR</th>
                    </tr>
                </thead>
                <tbody>
                    <tr><td>Vendas Cartão</td><td class="text-center">${(movimento as any)?.vendasCartao?.valorFormatado || 'R$ 0,00'}</td></tr>
                    <tr><td>PIX</td><td class="text-center">${(movimento as any)?.pix?.valorFormatado || 'R$ 0,00'}</td></tr>
                    <tr><td>Transferências</td><td class="text-center">${(movimento as any)?.transferencias?.valorFormatado || 'R$ 0,00'}</td></tr>
                    <tr><td>Depósitos</td><td class="text-center">${(movimento as any)?.depositos?.valorFormatado || 'R$ 0,00'}</td></tr>
                    <tr class="linha-total"><td>Total Movimento</td><td class="text-center">${(movimentoTotal as any)?.valorFormatado || 'R$ 0,00'}</td></tr>
                    <tr><td>Faturamento Declarado</td><td class="text-center">${(faturamentoDeclarado as any)?.valorFormatado || 'R$ 0,00'}</td></tr>
                </tbody>
            </table>
        </section>

        <section class="section">
            <h2>📄 3. Análise dos Documentos Fiscais</h2>
            <h3>a) Status dos Documentos Fiscais</h3>
            <table>
                <tbody>
                    <tr><td>NFe</td><td class="text-center">${(nfe as any)?.quantidade ? 'COM MOVIMENTO' : 'SEM MOVIMENTO'}</td></tr>
                    <tr><td>NFCe</td><td class="text-center">${(nfce as any)?.quantidade ? 'COM MOVIMENTO' : 'SEM MOVIMENTO'}</td></tr>
                    <tr><td>CTe</td><td class="text-center">${(cte as any)?.quantidade ? 'COM MOVIMENTO' : 'SEM MOVIMENTO'}</td></tr>
                    <tr><td>NFSe</td><td class="text-center">${(nfse as any)?.quantidade ? 'COM MOVIMENTO' : 'SEM MOVIMENTO'}</td></tr>
                </tbody>
            </table>
            <p>Notas Totais ${(notasDuplicadas as any)?.quantidade || 0}</p>
        </section>

        <section class="section">
            <h2>📅 4. Tabela de Lucro/Prejuízo Mensal</h2>
            <table>
                <thead>
                    <tr>
                        <th>Mês</th>
                        <th class="text-center">Receita</th>
                        <th class="text-center">Imposto</th>
                        <th class="text-center">Folha</th>
                        <th class="text-center">Compras</th>
                        <th class="text-center">Lucro</th>
                    </tr>
                </thead>
                <tbody>
                    ${(meses || []).map((item) => `
                    <tr>
                        <td>${(item as any).mes || '-'}</td>
                        <td class="text-center">${(item as any).receita?.valorFormatado || formatarValorBR(parseValorBR((item as any).receita?.valor))}</td>
                        <td class="text-center">${(item as any).imposto?.valorFormatado || formatarValorBR(parseValorBR((item as any).imposto?.valor))}</td>
                        <td class="text-center">${(item as any).folha?.valorFormatado || formatarValorBR(parseValorBR((item as any).folha?.valor))}</td>
                        <td class="text-center">${(item as any).compras?.valorFormatado || formatarValorBR(parseValorBR((item as any).compras?.valor))}</td>
                        <td class="text-center">${(item as any).lucro?.valorFormatado || formatarValorBR(parseValorBR((item as any).lucro?.valor))}</td>
                    </tr>
                    `).join('')}
                    <tr class="linha-total">
                        <td>Total</td>
                        <td class="text-center">${(totaisS4 as any)?.receita || 'R$ 0,00'}</td>
                        <td class="text-center">${(totaisS4 as any)?.imposto || 'R$ 0,00'}</td>
                        <td class="text-center">${(totaisS4 as any)?.folha || 'R$ 0,00'}</td>
                        <td class="text-center">${(totaisS4 as any)?.compras || 'R$ 0,00'}</td>
                        <td class="text-center">${(totaisS4 as any)?.lucro || 'R$ 0,00'}</td>
                    </tr>
                </tbody>
            </table>
        </section>

        <section class="section">
            <h2>📌 5. Documentos que Acompanham</h2>
            <ul>
                ${(s5Docs || []).map((doc) => `<li>${(doc as any).nome || (doc as any).descricao || '-'}</li>`).join('')}
            </ul>
        </section>

        <section class="section">
            <h2>📚 6. Documentos Analisados</h2>
            <table>
                <thead>
                    <tr><th>Documento</th><th class="text-center">Status</th></tr>
                </thead>
                <tbody>
                    ${(s6Docs || []).map((doc) => `
                    <tr>
                        <td>${(doc as any).nome || '-'}</td>
                        <td class="text-center" style="color: ${(doc as any).cor || '#6b7280'};">${(doc as any).icone || ((doc as any).analisado ? '✓' : '✗')}</td>
                    </tr>`).join('')}
                </tbody>
            </table>
        </section>

        ${mostrarSecao7 ? `
        <section class="section">
            <h2>⚖️ 7. Comparação de Regimes Tributários</h2>
            <div class="regimes-grid">
                <div class="regime-card">
                    <div class="regime-titulo">Simples Nacional (Anexo III)</div>
                    <div class="regime-valor">${(s7 as any)?.simplesNacionalAnexoIII?.impostoFormatado || 'N/D'}</div>
                    <div class="regime-detalhes">Alíquota: ${(s7 as any)?.simplesNacionalAnexoIII?.aliquotaFormatada || 'N/D'}</div>
                </div>
                <div class="regime-card">
                    <div class="regime-titulo">Simples Nacional (Anexo V)</div>
                    <div class="regime-valor">${(s7 as any)?.simplesNacionalAnexoV?.impostoFormatado || 'N/D'}</div>
                    <div class="regime-detalhes">Alíquota: ${(s7 as any)?.simplesNacionalAnexoV?.aliquotaFormatada || 'N/D'}</div>
                </div>
                <div class="regime-card">
                    <div class="regime-titulo">Lucro Presumido</div>
                    <div class="regime-valor">${(s7 as any)?.lucroPresumido?.impostoFormatado || 'N/D'}</div>
                    <div class="regime-detalhes">Alíquota: ${(s7 as any)?.lucroPresumido?.aliquotaEfetivaFormatada || 'N/D'}</div>
                </div>
            </div>
        </section>
        ` : ''}

        <section class="section">
            <h2>📝 8. Observações</h2>
            <div class="alert alert-info">
                ${observacaoFinal}
            </div>
        </section>

        <section class="section">
            <h2>💬 9. Comentários</h2>
            <div class="alert alert-info">
                ${comentarioAgente
                  ? `<p><strong>Agente:</strong> ${comentarioAgente}</p>`
                  : '<p class="muted">Sem comentário do agente.</p>'}
                ${comentarioAnalista
                  ? `<p style="margin-top: 8px;"><strong>Analista${comentarioAnalistaNome ? ` (${comentarioAnalistaNome})` : ''}:</strong> ${comentarioAnalista}</p>`
                  : '<p class="muted" style="margin-top: 8px;">Sem comentário do analista.</p>'}
            </div>
        </section>
    </div>
</body>
</html>`;

  return htmlCompleto;
}
