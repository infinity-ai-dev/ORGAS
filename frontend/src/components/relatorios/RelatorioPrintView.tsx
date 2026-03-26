import { forwardRef } from 'react';
import { RelatorioWithCliente, formatCurrency } from '@/hooks/useRelatorios';
import { format, isValid } from 'date-fns';
import { ptBR } from 'date-fns/locale';

interface RelatorioPrintViewProps {
  relatorio: RelatorioWithCliente;
}

const formatDateSafe = (value: unknown, fallback = '-') => {
  if (value === null || value === undefined || value === '') return fallback;
  const date = value instanceof Date ? value : new Date(value as string | number);
  if (!isValid(date)) return fallback;
  return format(date, 'dd/MM/yyyy', { locale: ptBR });
};

// Helper para extrair dados JSON com segurança
const safeGet = <T,>(obj: Record<string, unknown> | null, key: string, defaultValue: T): T => {
  if (!obj || obj[key] === undefined || obj[key] === null) return defaultValue;
  return obj[key] as T;
};

// Interfaces para tipagem dos dados das seções
interface Estabelecimento {
  cnpj?: string;
  tipo?: string;
  razaoSocial?: string;
  faturamento?: number;
  aliquota?: number;
  imposto?: number;
}

interface MesHistorico {
  mes?: string;
  receita?: number;
  imposto?: number;
  aliquota?: number;
  folha?: number;
  compras?: number;
  lucro?: number;
}

interface DocumentoAnalisado {
  numero?: number;
  nome?: string;
  analisado?: boolean;
  tipo?: string;
}

interface DocumentoAcompanha {
  nome?: string;
  enviado?: boolean;
}

interface Secao7Tributaria {
  fatorR?: number;
  fatorRPercent?: string;
  anexoEfetivo?: string;
  faixaRBT12?: string;
  tipoAtividade?: string;
  presuncaoLP?: number;
  simplesAnexoIII?: { valor: number; aliquota: number };
  simplesAnexoV?: { valor: number; aliquota: number };
  lucroPresumido?: { valor: number; aliquota: number; detalhamento?: Record<string, number> };
  regimeAtual?: string;
  regimeMaisVantajoso?: string;
  economiaAnual?: number;
}

// Gera texto narrativo automático para Seção 8
function gerarObservacoesFinais(relatorio: RelatorioWithCliente): string {
  const razaoSocial = relatorio.clientes_pj.razao_social;
  const regimeTributario = relatorio.clientes_pj.regime_tributario;
  const regime = regimeTributario?.replace('_', ' ') || 'Simples Nacional';
  
  // Usar dados dinâmicos da seção 7
  const secao7 = relatorio.secao7_tributaria as Secao7Tributaria | null;
  const anexo = secao7?.anexoEfetivo || relatorio.anexo_efetivo || relatorio.simples_anexo || 'III';
  const tipoAtividade = secao7?.tipoAtividade || 'SERVIÇOS';
  const fatorR = secao7?.fatorR ?? relatorio.fator_r;
  const competencia = relatorio.competencia;
  
  // Seção 2 - Financeiro
  const secao2 = relatorio.secao2_financeiro as Record<string, unknown> | null;
  const banco = safeGet<string>(secao2, 'banco', '');
  const divergencia = safeGet<Record<string, unknown>>(secao2, 'divergencia', {});
  const valorDivergencia = safeGet<number>(divergencia, 'valor', 0);
  
  // Seção 3 - Documentos
  const secao3 = relatorio.secao3_documentos as Record<string, unknown> | null;
  const notasCanceladas = safeGet<unknown[]>(secao3, 'notasCanceladas', []);
  
  let texto = `A empresa ${razaoSocial} é optante pelo ${regime}`;
  
  // Tipo de atividade baseado no anexo (dinâmico)
  if (tipoAtividade === 'SERVIÇOS') {
    texto += ` e atua somente com prestação de serviços, enquadrada no Anexo ${anexo}`;
    if (fatorR !== null && fatorR !== undefined && fatorR > 0) {
      const fatorRPercent = (fatorR * 100).toFixed(2);
      texto += ` e sujeita ao Fator R (${fatorRPercent}%)`;
    }
  } else if (tipoAtividade === 'COMÉRCIO') {
    texto += ` e atua no comércio, enquadrada no Anexo I`;
  } else if (tipoAtividade === 'INDÚSTRIA') {
    texto += ` e atua na indústria, enquadrada no Anexo II`;
  }
  texto += '.';
  
  // Informação do banco (dinâmica)
  if (banco && banco !== '') {
    texto += ` O extrato bancário (${banco}) não detalha vendas por cartão, sendo o movimento de entrada identificado como PIX e transferências.`;
  }
  
  // Notas canceladas (dinâmicas)
  if (notasCanceladas.length > 0) {
    const numeros = notasCanceladas.map((n: unknown) => 
      typeof n === 'object' && n !== null && 'numero' in n ? (n as { numero: unknown }).numero : n
    ).join(', ');
    texto += ` A(s) Nota(s) Fiscal(is) de Serviço de número ${numeros} foi(foram) cancelada(s) no período.`;
  }
  
  // Divergência (dinâmica)
  if (valorDivergencia > 0) {
    const statusDivergencia = safeGet<string>(divergencia, 'status', 'ATENÇÃO');
    texto += ` Há uma divergência de ${formatCurrency(valorDivergencia)} (${statusDivergencia}) entre o movimento financeiro e a receita declarada.`;
  }
  
  // Status DAS - usar informação da seção 8 se disponível
  const secao8 = relatorio.secao8_assinatura as Record<string, unknown> | null;
  const statusDAS = safeGet<string>(secao8, 'statusDAS', '');
  if (statusDAS) {
    texto += ` O DAS da competência ${competencia} está ${statusDAS}.`;
  }
  
  return texto;
}

export const RelatorioPrintView = forwardRef<HTMLDivElement, RelatorioPrintViewProps>(
  ({ relatorio }, ref) => {
    const isPessoal =
      String(relatorio.tipo_parecer || relatorio.type || '').toLowerCase() === 'pessoal' ||
      String((relatorio.secoes_json as Record<string, unknown> | null)?.tipo || '').toUpperCase() === 'PARECER_PESSOAL';

    if (isPessoal) {
      const secoesJson = (relatorio.secoes_json || {}) as Record<string, any>;
      const cabecalho = secoesJson.dadosCabecalho || {};
      const valoresPagamento = secoesJson.valoresPagamento || {};
      const controleJornada = secoesJson.controleJornada || {};
      const alteracoesMes = secoesJson.alteracoesMes || {};
      const eventosDP = secoesJson.eventosDP || {};
      const consignado = secoesJson.consignado || {};
      const pontosAtencao = secoesJson.pontosAtencao || {};
      const avisosPendencias = secoesJson.avisosPendencias || {};
      const anexos = secoesJson.anexos || {};
      const comentarios = secoesJson.comentarios || {};

      const pagamentos = Array.isArray(valoresPagamento.itens) ? valoresPagamento.itens : [];
      const jornadasList = Array.isArray(controleJornada.jornadas) ? controleJornada.jornadas : [];
      const anexosDocs = Array.isArray(anexos.documentos) ? anexos.documentos : [];
      const conferenciaIRRF = String(valoresPagamento.conferenciaIRRF || '').trim();
      const analiseIA = String(valoresPagamento.analiseIA || '').trim();
      const conferenciaHorasExtras = String(controleJornada.conferenciaHorasExtras || '').trim();
      const conferenciaHorasExtrasDetalhes = Array.isArray(controleJornada.conferenciaHorasExtrasDetalhes)
        ? controleJornada.conferenciaHorasExtrasDetalhes
        : [];
      const metodoJornadaDisplay = String(controleJornada.metodo || '-').replace(/cartao/gi, 'cartão');
      const parseDurationToMinutes = (value: unknown) => {
        if (!value) return 0;
        if (typeof value === 'number') return Math.round(value * 60);
        const raw = String(value);
        if (raw.includes(':')) {
          const [h, m] = raw.split(':').map((item) => Number(item));
          return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
        }
        const numeric = Number(raw.replace(/\./g, '').replace(',', '.'));
        return Number.isFinite(numeric) ? Math.round(numeric * 60) : 0;
      };
      const formatMinutes = (minutes: number) => {
        if (!minutes) return '0:00';
        const hours = Math.floor(minutes / 60);
        const mins = minutes % 60;
        return `${hours}:${String(mins).padStart(2, '0')}`;
      };

      return (
        <div ref={ref} className="bg-white p-8 text-black">
          <div className="mb-6">
            <h1 className="text-xl font-bold">PARECER PESSOAL</h1>
            <p className="text-sm">Cliente: {cabecalho.clienteNome || relatorio.clientes_pj.razao_social}</p>
            <p className="text-sm">CNPJ: {cabecalho.clienteCnpj || relatorio.clientes_pj.cnpj}</p>
            <p className="text-sm">Competência: {cabecalho.competencia || relatorio.competencia}</p>
            <p className="text-sm">Período: {cabecalho.periodoApuracao || '-'}</p>
            <p className="text-sm">Data de Emissão: {cabecalho.dataEmissao || relatorio.gerado_em}</p>
          </div>

          <section className="mb-5">
            <h2 className="font-semibold text-base mb-2">1 - Valores para Pagamento</h2>
            {pagamentos.length === 0 ? (
              <p className="text-sm">Sem valores informados.</p>
            ) : (
              <table className="w-full text-sm border">
                <thead>
                  <tr className="bg-gray-100">
                    <th className="border px-2 py-1 text-left">Documento</th>
                    <th className="border px-2 py-1 text-left">Valor</th>
                    <th className="border px-2 py-1 text-left">Vencimento</th>
                  </tr>
                </thead>
                <tbody>
                  {pagamentos.map((item: any, index: number) => (
                    <tr key={index}>
                      <td className="border px-2 py-1">{item?.documento || item?.descricao || `Documento ${index + 1}`}</td>
                      <td className="border px-2 py-1">{item?.valor || '-'}</td>
                      <td className="border px-2 py-1">{item?.vencimento || item?.dataPagamento || item?.data || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {analiseIA && <p className="text-sm mt-2"><strong>Conclusão:</strong> {analiseIA}</p>}
            {valoresPagamento?.observacoes && (
              <p className="text-sm mt-2"><strong>Observações:</strong> {valoresPagamento.observacoes}</p>
            )}
            {conferenciaIRRF && <p className="text-sm mt-2"><strong>IRRF (competência x pagamento):</strong> {conferenciaIRRF}</p>}
          </section>

          <section className="mb-5">
            <h2 className="font-semibold text-base mb-2">2 - Controle de Jornada de Trabalho</h2>
            <p className="text-sm">Método: {metodoJornadaDisplay}</p>
            {jornadasList.length > 0 && (
              <div className="mt-2 space-y-1 text-sm">
                {jornadasList.map((item: any, index: number) => {
                  const horasTrabalhadas = parseDurationToMinutes(item?.horasTrabalhadas);
                  const horasExtras = parseDurationToMinutes(item?.horasExtras);
                  const salarioBaseMensal = Number(item?.salarioBaseMensal || 0);
                  const valorHoraBase = Number(item?.valorHoraBase || 0);
                  const valorHoraExtra = Number(item?.valorHoraExtra || 0);
                  const vencimentoHoraExtra =
                    Number(item?.vencimentoHoraExtra || 0) ||
                    (valorHoraExtra && horasExtras ? (horasExtras / 60) * valorHoraExtra : 0);
                  return (
                    <p key={index}>
                      {item?.funcionario || item?.nome || `Funcionário ${index + 1}`} · Horas:{' '}
                      {formatMinutes(horasTrabalhadas)} · Extras: {formatMinutes(horasExtras)} · Base mensal:{' '}
                      {salarioBaseMensal ? formatCurrency(salarioBaseMensal) : 'R$ -'} · Hora padrão:{' '}
                      {valorHoraBase ? formatCurrency(valorHoraBase) : 'R$ -'} · Venc. extra:{' '}
                      {vencimentoHoraExtra ? formatCurrency(vencimentoHoraExtra) : 'R$ -'}
                    </p>
                  );
                })}
              </div>
            )}
            {Array.isArray(controleJornada.pendencias) && controleJornada.pendencias.length > 0 && (
              <p className="text-sm">Pendências: {controleJornada.pendencias.join(', ')}</p>
            )}
            {conferenciaHorasExtras && <p className="text-sm">{conferenciaHorasExtras}</p>}
            {conferenciaHorasExtrasDetalhes.length > 0 && (
              <p className="text-sm">Detalhes: {conferenciaHorasExtrasDetalhes.join(' · ')}</p>
            )}
            {controleJornada.alertas && <p className="text-sm">{controleJornada.alertas}</p>}
          </section>

          <section className="mb-5">
            <h2 className="font-semibold text-base mb-2">3. Alterações do Mês</h2>
            <p className="text-sm">
              Comparativo: {alteracoesMes?.comparativo?.mesAnterior || '-'} →{' '}
              {alteracoesMes?.comparativo?.mesAtual || '-'} ({alteracoesMes?.comparativo?.variacaoPercentual || '-'})
            </p>
            {Array.isArray(alteracoesMes.eventos) && alteracoesMes.eventos.length > 0 && (
              <p className="text-sm">Eventos: {alteracoesMes.eventos.join(', ')}</p>
            )}
            {Array.isArray(alteracoesMes.variaveis) && alteracoesMes.variaveis.length > 0 && (
              <p className="text-sm">Variáveis: {alteracoesMes.variaveis.join(', ')}</p>
            )}
            {alteracoesMes.observacoes && <p className="text-sm">{alteracoesMes.observacoes}</p>}
          </section>

          <section className="mb-5">
            <h2 className="font-semibold text-base mb-2">4. Eventos do DP</h2>
            <p className="text-sm">Férias: {(eventosDP.ferias || []).join(', ') || '-'}</p>
            <p className="text-sm">Desligamentos: {(eventosDP.desligamentos || []).join(', ') || '-'}</p>
            <p className="text-sm">Admissões: {(eventosDP.admissoes || []).join(', ') || '-'}</p>
            <p className="text-sm">Afastamentos: {(eventosDP.afastamentos || []).join(', ') || '-'}</p>
          </section>

          <section className="mb-5">
            <h2 className="font-semibold text-base mb-2">5. Consignado</h2>
            <p className="text-sm">{consignado.temConsignado ? 'Há consignado.' : 'Sem consignado.'}</p>
            {Array.isArray(consignado.contratos) && consignado.contratos.length > 0 && (
              <p className="text-sm">Contratos: {consignado.contratos.join(', ')}</p>
            )}
            {consignado.observacoes && <p className="text-sm">{consignado.observacoes}</p>}
          </section>

          <section className="mb-5">
            <h2 className="font-semibold text-base mb-2">6. Pontos de Atenção</h2>
            {Array.isArray(pontosAtencao.itens) && pontosAtencao.itens.length > 0 ? (
              <p className="text-sm">{pontosAtencao.itens.join(', ')}</p>
            ) : (
              <p className="text-sm">Nenhum ponto de atenção informado.</p>
            )}
            {pontosAtencao.observacoes && <p className="text-sm">{pontosAtencao.observacoes}</p>}
          </section>

          <section className="mb-5">
            <h2 className="font-semibold text-base mb-2">7. Avisos e Pendências</h2>
            {Array.isArray(avisosPendencias.itens) && avisosPendencias.itens.length > 0 ? (
              <p className="text-sm">{avisosPendencias.itens.join(', ')}</p>
            ) : (
              <p className="text-sm">Nenhuma pendência registrada.</p>
            )}
            {avisosPendencias.observacoes && <p className="text-sm">{avisosPendencias.observacoes}</p>}
          </section>

          <section className="mb-5">
            <h2 className="font-semibold text-base mb-2">8. Anexos</h2>
            {anexosDocs.length === 0 ? (
              <p className="text-sm">Nenhum anexo listado.</p>
            ) : (
              <ul className="text-sm space-y-1">
                {anexosDocs.map((doc: any, index: number) => (
                  <li key={index}>{doc?.nome || `Documento ${index + 1}`}</li>
                ))}
              </ul>
            )}
          </section>

          {comentarios?.analista && (
            <section className="mt-6">
              <h2 className="font-semibold text-base mb-2">9. Comentários</h2>
              <p className="text-sm whitespace-pre-line">{comentarios.analista}</p>
            </section>
          )}
        </div>
      );
    }
    // Extrair seções do relatório
    const secao1 = relatorio.secao1_faturamento as Record<string, unknown> | null;
    const secao2 = relatorio.secao2_financeiro as Record<string, unknown> | null;
    const secao3 = relatorio.secao3_documentos as Record<string, unknown> | null;
    const secao4 = relatorio.secao4_tabela_mensal as Array<MesHistorico> | null;
    const secao5 = relatorio.secao5_acompanham as Array<DocumentoAcompanha> | null;
    const secao6 = relatorio.secao6_analisados as Array<DocumentoAnalisado> | null;
    const secao7 = relatorio.secao7_tributaria as Secao7Tributaria | null;
    const secao9 = relatorio.secao9_analista as Record<string, unknown> | null;
    const comentarioAnalista = safeGet<string>(secao9, 'comentario', '') || safeGet<string>(secao9, 'observacoes', '');

    // Dados de faturamento (dinâmicos da seção 1)
    const estabelecimentos = safeGet<Estabelecimento[]>(secao1, 'estabelecimentos', []);
    const totalFaturamento = safeGet<number>(secao1, 'faturamentoDeclarado', 0) || 
                             estabelecimentos.reduce((acc, e) => acc + (e.faturamento || 0), 0) || 
                             relatorio.receita_bruta_mes;
    const totalImposto = safeGet<number>(secao1, 'impostoCalculado', 0) ||
                         estabelecimentos.reduce((acc, e) => acc + (e.imposto || 0), 0) || 
                         relatorio.simples_valor_devido;
    const aliquotaEfetiva = safeGet<number>(secao1, 'aliquotaEfetiva', 0) || 
                            (relatorio.simples_aliquota_efetiva * 100) || 0;
    const dataVencimento = safeGet<string>(secao1, 'dataVencimentoDAS', '');
    
    // Tipo de atividade (dinâmico da seção 7)
    const tipoAtividade = secao7?.tipoAtividade || 'SERVIÇOS';
    
    // Dados de movimento financeiro (dinâmicos da seção 2)
    const vendasCartao = safeGet<number>(secao2, 'totalCartao', 0);
    const pixRecebidos = safeGet<number>(secao2, 'pixRecebidos', 0);
    const transferencias = safeGet<number>(secao2, 'transferenciasRecebidas', 0);
    const depositos = safeGet<number>(secao2, 'depositos', 0);
    const totalMovimento = safeGet<number>(secao2, 'totalMovimento', 0) ||
                           vendasCartao + pixRecebidos + transferencias + depositos;
    const banco = safeGet<string>(secao2, 'banco', 'Banco');
    const divergencia = safeGet<Record<string, unknown>>(secao2, 'divergencia', {});
    const valorDivergencia = safeGet<number>(divergencia, 'valor', 0);
    const percentDivergencia = safeGet<number>(divergencia, 'porcentagem', 0);
    
    // Dados de documentos fiscais (dinâmicos da seção 3)
    const docsFiscais = safeGet<Record<string, unknown>>(secao3, 'documentosFiscais', {});
    const notasCanceladas = safeGet<unknown[]>(secao3, 'notasCanceladas', []);
    const notasDuplicadas = safeGet<unknown[]>(secao3, 'notasDuplicadas', []);
    
    // Helper para status de documento (dinâmico)
    const getStatusDoc = (tipo: string): string => {
      const doc = safeGet<Record<string, unknown>>(docsFiscais, tipo, {});
      const status = safeGet<string>(doc, 'status', 'nenhum');
      const quantidade = safeGet<number>(doc, 'quantidade', 0);
      const canceladas = safeGet<number>(doc, 'canceladas', 0);
      
      if (status === 'nenhum' || quantidade === 0) {
        return 'SEM MOVIMENTO';
      }
      if (canceladas > 0) {
        return `REGULAR - ${canceladas} nota(s) cancelada(s)`;
      }
      return 'REGULAR';
    };
    
    // Calcular totais da tabela mensal (dinâmico da seção 4)
    const totaisMensal = secao4?.reduce((acc, mes) => ({
      receita: acc.receita + (mes.receita || 0),
      imposto: acc.imposto + (mes.imposto || 0),
      folha: acc.folha + (mes.folha || 0),
      compras: acc.compras + (mes.compras || 0),
      lucro: acc.lucro + (mes.lucro || 0),
    }), { receita: 0, imposto: 0, folha: 0, compras: 0, lucro: 0 });
    
    // Fator R e Comparativo (dinâmicos da seção 7)
    const fatorR = secao7?.fatorR ?? relatorio.fator_r;
    const fatorRPercent = secao7?.fatorRPercent || (fatorR ? (fatorR * 100).toFixed(2) : null);
    const anexoEfetivo = secao7?.anexoEfetivo || relatorio.anexo_efetivo || relatorio.simples_anexo || 'III';
    const faixaRBT12 = secao7?.faixaRBT12 || '';
    const presuncaoLP = secao7?.presuncaoLP || 0.32;
    const regimeAtual = secao7?.regimeAtual || relatorio.clientes_pj.regime_tributario || 'simples_nacional';
    
    // Valores do comparativo (dinâmicos)
    const simplesAnexoIII = secao7?.simplesAnexoIII?.valor ?? relatorio.simples_valor_devido;
    const aliquotaAnexoIII = secao7?.simplesAnexoIII?.aliquota ?? (relatorio.simples_aliquota_efetiva * 100);
    const simplesAnexoV = secao7?.simplesAnexoV?.valor ?? 0;
    const aliquotaAnexoV = secao7?.simplesAnexoV?.aliquota ?? 0;
    const lucroPresumido = secao7?.lucroPresumido?.valor ?? relatorio.presumido_total;
    const aliquotaLP = secao7?.lucroPresumido?.aliquota ?? (relatorio.receita_bruta_mes > 0 ? (relatorio.presumido_total / relatorio.receita_bruta_mes) : 0);
    
    // Determinar qual é o regime atual para mostrar checkmark
    const isAnexoIIIAtual = anexoEfetivo === 'III' || (regimeAtual === 'simples_nacional' && anexoEfetivo === 'III');
    const isAnexoVAtual = anexoEfetivo === 'V';
    const isLPAtual = regimeAtual === 'lucro_presumido';
    
    // Documentos analisados (dinâmicos da seção 6)
    const totalDocsAnalisados = secao6?.filter(d => d.analisado).length || 0;
    const totalDocs = secao6?.length || 0;

    return (
      <div ref={ref} className="print-view p-8 bg-white text-black font-sans text-[11pt] leading-relaxed">
        {/* ═══════════════════════════════════════════════════════════════════
            CABEÇALHO
        ═══════════════════════════════════════════════════════════════════ */}
        <header className="text-center mb-6">
          <h1 className="text-xl font-bold tracking-wide mb-1">PARECER SOBRE A APURAÇÃO FISCAL</h1>
          <h2 className="text-lg font-bold mb-4">Competência: {relatorio.competencia}</h2>
          
          <table className="w-full border-collapse mb-0">
            <tbody>
              <tr>
                <td className="border border-gray-400 p-2 w-1/2">
                  <div className="text-xs text-gray-600 font-semibold">RAZÃO SOCIAL</div>
                  <div className="font-bold">{relatorio.clientes_pj.razao_social}</div>
                </td>
                <td className="border border-gray-400 p-2 w-1/2">
                  <div className="text-xs text-gray-600 font-semibold">CNPJ</div>
                  <div className="font-bold">{relatorio.clientes_pj.cnpj}</div>
                </td>
              </tr>
              <tr>
                <td className="border border-gray-400 p-2">
                  <div className="text-xs text-gray-600 font-semibold">REGIME TRIBUTÁRIO</div>
                  <div>{relatorio.clientes_pj.regime_tributario?.replace('_', ' ') || 'Simples Nacional'}</div>
                </td>
                <td className="border border-gray-400 p-2">
                  <div className="text-xs text-gray-600 font-semibold">PERÍODO ANALISADO</div>
                  <div>{relatorio.competencia}</div>
                </td>
              </tr>
            </tbody>
          </table>
        </header>

        {/* ═══════════════════════════════════════════════════════════════════
            SEÇÃO 1: ANÁLISE FATURAMENTO DECLARADO X IMPOSTOS
        ═══════════════════════════════════════════════════════════════════ */}
        <section className="mb-5 print-section">
          <h2 className="text-base font-bold mb-3">1. Análise Faturamento Declarado x Impostos</h2>
          
          <h3 className="text-sm font-semibold mb-2">a) Valores da Apuração da Competência Atual</h3>
          
          <table className="w-full border-collapse mb-4 text-sm">
            <thead>
              <tr className="bg-gray-100">
                <th className="border border-gray-400 px-2 py-1 text-left">SIMPLES NACIONAL</th>
                <th className="border border-gray-400 px-2 py-1 text-right">FATURAMENTO</th>
                <th className="border border-gray-400 px-2 py-1 text-right">ALQ(%)</th>
                <th className="border border-gray-400 px-2 py-1 text-right">IMPOSTO</th>
                <th className="border border-gray-400 px-2 py-1 text-right">DATA VENCIMENTO</th>
              </tr>
            </thead>
            <tbody>
              {estabelecimentos.length > 0 ? (
                estabelecimentos.map((est, idx) => (
                  <tr key={idx}>
                    <td className="border border-gray-400 px-2 py-1">
                      {est.tipo || tipoAtividade} ({est.razaoSocial || 'MATRIZ'})
                    </td>
                    <td className="border border-gray-400 px-2 py-1 text-right">{formatCurrency(est.faturamento || 0)}</td>
                    <td className="border border-gray-400 px-2 py-1 text-right">{(est.aliquota || aliquotaEfetiva).toFixed(2)}%</td>
                    <td className="border border-gray-400 px-2 py-1 text-right">{formatCurrency(est.imposto || 0)}</td>
                    <td className="border border-gray-400 px-2 py-1 text-right">{idx === 0 ? dataVencimento : ''}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td className="border border-gray-400 px-2 py-1">{tipoAtividade} (MATRIZ)</td>
                  <td className="border border-gray-400 px-2 py-1 text-right">{formatCurrency(totalFaturamento)}</td>
                  <td className="border border-gray-400 px-2 py-1 text-right">{aliquotaEfetiva.toFixed(2)}%</td>
                  <td className="border border-gray-400 px-2 py-1 text-right">{formatCurrency(totalImposto)}</td>
                  <td className="border border-gray-400 px-2 py-1 text-right">{dataVencimento}</td>
                </tr>
              )}
              <tr className="font-bold">
                <td className="border border-gray-400 px-2 py-1">TOTAL</td>
                <td className="border border-gray-400 px-2 py-1 text-right">{formatCurrency(totalFaturamento)}</td>
                <td className="border border-gray-400 px-2 py-1 text-right"></td>
                <td className="border border-gray-400 px-2 py-1 text-right">{formatCurrency(totalImposto)}</td>
                <td className="border border-gray-400 px-2 py-1 text-right"></td>
              </tr>
            </tbody>
          </table>

          <h3 className="text-sm font-semibold mb-2">b) Variação de Faturamentos e Impostos</h3>
          
          <div className="flex gap-8 mb-2">
            <div className="flex-1">
              <div className="text-xs text-gray-600 mb-1">Faturamento</div>
              <div className="bg-gray-200 h-8 relative">
                <div className="bg-gray-500 h-8" style={{ width: '100%' }}></div>
                <div className="absolute inset-0 flex items-center justify-center text-sm font-bold">
                  {formatCurrency(totalFaturamento)} (100%)
                </div>
              </div>
            </div>
            <div className="flex-1">
              <div className="text-xs text-gray-600 mb-1">Impostos</div>
              <div className="bg-gray-200 h-8 relative">
                <div className="bg-gray-400 h-8" style={{ width: `${Math.min(aliquotaEfetiva, 100)}%` }}></div>
                <div className="absolute inset-0 flex items-center justify-center text-sm font-bold">
                  {formatCurrency(totalImposto)} ({aliquotaEfetiva.toFixed(2)}%)
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ═══════════════════════════════════════════════════════════════════
            SEÇÃO 2: ANÁLISE FATURAMENTO DECLARADO X MOVIMENTO FINANCEIRO
        ═══════════════════════════════════════════════════════════════════ */}
        <section className="mb-5 print-section">
          <h2 className="text-base font-bold mb-3">2. Análise Faturamento Declarado x Movimento Financeiro</h2>
          
          {banco && banco !== '' && (
            <h3 className="text-sm font-semibold mb-2">Vendas Administradoras e Movimento Extrato Bancário - {banco}</h3>
          )}
          
          <h4 className="text-sm font-medium mb-2">Comparativo: Movimento Financeiro x Faturamento Declarado</h4>
          
          <table className="w-64 border-collapse mb-3 text-sm">
            <tbody>
              <tr>
                <td className="border border-gray-400 px-2 py-1">Vendas Cartão</td>
                <td className="border border-gray-400 px-2 py-1 text-right">{vendasCartao > 0 ? formatCurrency(vendasCartao) : 'R$ -'}</td>
              </tr>
              <tr>
                <td className="border border-gray-400 px-2 py-1">PIX</td>
                <td className="border border-gray-400 px-2 py-1 text-right">{formatCurrency(pixRecebidos)}</td>
              </tr>
              <tr>
                <td className="border border-gray-400 px-2 py-1">Transferências</td>
                <td className="border border-gray-400 px-2 py-1 text-right">{formatCurrency(transferencias)}</td>
              </tr>
              <tr>
                <td className="border border-gray-400 px-2 py-1">Depósitos</td>
                <td className="border border-gray-400 px-2 py-1 text-right">{depositos > 0 ? formatCurrency(depositos) : 'R$ -'}</td>
              </tr>
              <tr className="font-bold">
                <td className="border border-gray-400 px-2 py-1">Total Movimento</td>
                <td className="border border-gray-400 px-2 py-1 text-right">{formatCurrency(totalMovimento)}</td>
              </tr>
              <tr>
                <td className="border border-gray-400 px-2 py-1">Faturamento Declarado</td>
                <td className="border border-gray-400 px-2 py-1 text-right">{formatCurrency(totalFaturamento)}</td>
              </tr>
            </tbody>
          </table>
          
          {valorDivergencia > 0 && (
            <div className="p-2 bg-gray-100 border-l-4 border-gray-500 text-sm">
              <p className="font-bold">⚠ Atenção: Divergência significativa entre o faturamento declarado e a movimentação bancária.</p>
              <p className="mt-1">Diferença detectada: {formatCurrency(valorDivergencia)} ({percentDivergencia.toFixed(2)}%)</p>
            </div>
          )}
        </section>

        {/* ═══════════════════════════════════════════════════════════════════
            SEÇÃO 3: ANÁLISE DOS DOCUMENTOS FISCAIS
        ═══════════════════════════════════════════════════════════════════ */}
        <section className="mb-5 print-section">
          <h2 className="text-base font-bold mb-3">3. Análise dos Documentos Fiscais</h2>
          
          <h3 className="text-sm font-semibold mb-2">a) Status dos Documentos Fiscais</h3>
          
          <table className="w-full border-collapse mb-3 text-sm">
            <tbody>
              <tr>
                <td className="border border-gray-400 px-2 py-1 w-16 font-semibold">NF-e:</td>
                <td className="border border-gray-400 px-2 py-1">{getStatusDoc('nfe')}</td>
              </tr>
              <tr>
                <td className="border border-gray-400 px-2 py-1 font-semibold">NFC-e:</td>
                <td className="border border-gray-400 px-2 py-1">{getStatusDoc('nfce')}</td>
              </tr>
              <tr>
                <td className="border border-gray-400 px-2 py-1 font-semibold">CT-e:</td>
                <td className="border border-gray-400 px-2 py-1">{getStatusDoc('cte')}</td>
              </tr>
              <tr>
                <td className="border border-gray-400 px-2 py-1 font-semibold">NFS-e:</td>
                <td className="border border-gray-400 px-2 py-1">{getStatusDoc('nfse')}</td>
              </tr>
            </tbody>
          </table>
          
          <p className="text-sm text-gray-700 mb-3">
            O faturamento total considera apenas as notas com natureza 'Exigível', excluindo as canceladas.
          </p>
          
          {notasCanceladas.length > 0 && (
            <p className="text-sm mb-3">{notasCanceladas.length} nota(s) cancelada(s)</p>
          )}
          
          <h3 className="text-sm font-semibold mb-2">b) Notas Duplicadas</h3>
          <p className="text-sm">
            {notasDuplicadas.length === 0 
              ? 'Não foram identificadas notas fiscais duplicadas no período analisado.'
              : `Foram identificadas ${notasDuplicadas.length} nota(s) fiscal(is) duplicada(s).`
            }
          </p>
        </section>

        {/* ═══════════════════════════════════════════════════════════════════
            SEÇÃO 4: ANÁLISE DO LUCRO/PREJUÍZO FISCAL
        ═══════════════════════════════════════════════════════════════════ */}
        {secao4 && Array.isArray(secao4) && secao4.length > 0 && (
          <section className="mb-5 print-section">
            <h2 className="text-base font-bold mb-3">4. Análise do Lucro/Prejuízo Fiscal</h2>
            
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr className="bg-gray-100">
                  <th className="border border-gray-400 px-1 py-1 text-left">Mês</th>
                  <th className="border border-gray-400 px-1 py-1 text-right">Faturamento Bruto</th>
                  <th className="border border-gray-400 px-1 py-1 text-right">Impostos</th>
                  <th className="border border-gray-400 px-1 py-1 text-right">Compras</th>
                  <th className="border border-gray-400 px-1 py-1 text-right">Folha</th>
                  <th className="border border-gray-400 px-1 py-1 text-right">Lucro/Prejuízo Estimado</th>
                </tr>
              </thead>
              <tbody>
                {secao4.slice(0, 12).map((item, idx) => (
                  <tr key={idx} className={idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                    <td className="border border-gray-400 px-1 py-1">{item.mes}</td>
                    <td className="border border-gray-400 px-1 py-1 text-right">{formatCurrency(item.receita || 0)}</td>
                    <td className="border border-gray-400 px-1 py-1 text-right">{formatCurrency(item.imposto || 0)}</td>
                    <td className="border border-gray-400 px-1 py-1 text-right">{formatCurrency(item.compras || 0)}</td>
                    <td className="border border-gray-400 px-1 py-1 text-right">{formatCurrency(item.folha || 0)}</td>
                    <td className="border border-gray-400 px-1 py-1 text-right">{formatCurrency(item.lucro || 0)}</td>
                  </tr>
                ))}
                {totaisMensal && (
                  <tr className="bg-gray-200 font-bold">
                    <td className="border border-gray-400 px-1 py-1">TOTAL ACUMULADO</td>
                    <td className="border border-gray-400 px-1 py-1 text-right">{formatCurrency(totaisMensal.receita)}</td>
                    <td className="border border-gray-400 px-1 py-1 text-right">{formatCurrency(totaisMensal.imposto)}</td>
                    <td className="border border-gray-400 px-1 py-1 text-right">{formatCurrency(totaisMensal.compras)}</td>
                    <td className="border border-gray-400 px-1 py-1 text-right">{formatCurrency(totaisMensal.folha)}</td>
                    <td className="border border-gray-400 px-1 py-1 text-right">{formatCurrency(totaisMensal.lucro)}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </section>
        )}

        {/* ═══════════════════════════════════════════════════════════════════
            SEÇÃO 5: DOCUMENTOS QUE ACOMPANHAM ESSE PARECER
        ═══════════════════════════════════════════════════════════════════ */}
        <section className="mb-5 print-section">
          <h2 className="text-base font-bold mb-3">5. Documentos que Acompanham esse Parecer</h2>
          
          {secao5 && secao5.length > 0 ? (
            <ul className="text-sm list-none space-y-1">
              {secao5.map((doc, idx) => (
                <li key={idx}>
                  {doc.enviado ? '✓' : '○'} {doc.nome}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-gray-600 italic">
              Nenhum documento adicional anexado a este parecer.
            </p>
          )}
        </section>

        {/* ═══════════════════════════════════════════════════════════════════
            SEÇÃO 6: DOCUMENTOS ANALISADOS PARA CONFECÇÃO DESSE PARECER
        ═══════════════════════════════════════════════════════════════════ */}
        <section className="mb-5 print-section">
          <h2 className="text-base font-bold mb-3">6. Documentos Analisados para Confecção desse Parecer</h2>
          
          {secao6 && secao6.length > 0 ? (
            <>
              <p className="text-sm mb-2">
                <strong>Resumo:</strong> {totalDocsAnalisados} de {totalDocs} documentos foram analisados.
              </p>
              <ul className="text-sm list-none space-y-1">
                {secao6.map((doc, idx) => (
                  <li key={idx}>
                    {doc.analisado ? '✓' : '○'} {doc.numero || idx + 1}. {doc.nome} - {doc.analisado ? 'ANALISADO' : 'PENDENTE'}
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="text-sm text-gray-600 italic">
              Informações de documentos analisados não disponíveis.
            </p>
          )}
        </section>

        {/* ═══════════════════════════════════════════════════════════════════
            SEÇÃO 7: COMPARAÇÃO COM OUTROS REGIMES TRIBUTÁRIOS
        ═══════════════════════════════════════════════════════════════════ */}
        <section className="mb-5 print-section">
          <h2 className="text-base font-bold mb-3">7. Comparação com outros Regimes Tributários</h2>
          
          {/* Fator R (dinâmico) */}
          {fatorRPercent && Number(fatorRPercent) > 0 && (
            <table className="border-collapse mb-4 text-sm">
              <tbody>
                <tr>
                  <td className="border border-gray-400 px-2 py-1 font-semibold">Fator R:</td>
                  <td className="border border-gray-400 px-2 py-1">{fatorRPercent}%</td>
                  <td className="border border-gray-400 px-2 py-1 font-semibold">Fator R ≥ 28%:</td>
                  <td className="border border-gray-400 px-2 py-1">
                    Empresa enquadrada no Anexo {anexoEfetivo}
                  </td>
                </tr>
              </tbody>
            </table>
          )}
          
          {/* Comparativo dos 3 Regimes (dinâmico) */}
          <table className="w-full border-collapse text-sm mb-3">
            <thead>
              <tr className="bg-gray-100">
                <th className="border border-gray-400 px-2 py-1">Simples Nacional<br/>Anexo III</th>
                <th className="border border-gray-400 px-2 py-1">Simples Nacional<br/>Anexo V</th>
                <th className="border border-gray-400 px-2 py-1">Lucro Presumido</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="border border-gray-400 px-2 py-2 text-center">
                  {isAnexoIIIAtual && (
                    <>
                      <div className="font-bold">✓ Anexo III</div>
                      <div className="text-xs text-gray-600">Regime Atual</div>
                    </>
                  )}
                  {!isAnexoIIIAtual && <div className="font-bold">Anexo III</div>}
                  <div className="text-lg font-bold my-1">{formatCurrency(simplesAnexoIII)}</div>
                  <div className="text-xs">Alíquota: {(aliquotaAnexoIII * 100).toFixed(2)}%</div>
                  {faixaRBT12 && <div className="text-xs">Faixa: {faixaRBT12}</div>}
                </td>
                <td className="border border-gray-400 px-2 py-2 text-center">
                  {isAnexoVAtual && (
                    <>
                      <div className="font-bold">✓ Anexo V</div>
                      <div className="text-xs text-gray-600">Regime Atual</div>
                    </>
                  )}
                  {!isAnexoVAtual && <div className="font-bold">Anexo V</div>}
                  <div className="text-lg font-bold my-1">{formatCurrency(simplesAnexoV)}</div>
                  <div className="text-xs">Alíquota Efetiva: {(aliquotaAnexoV * 100).toFixed(2)}%</div>
                  {simplesAnexoV > simplesAnexoIII && simplesAnexoIII > 0 && (
                    <div className="text-xs mt-1">⚠ {formatCurrency(simplesAnexoV - simplesAnexoIII)} mais caro que Anexo III</div>
                  )}
                </td>
                <td className="border border-gray-400 px-2 py-2 text-center">
                  {isLPAtual && (
                    <>
                      <div className="font-bold">✓ Lucro Presumido</div>
                      <div className="text-xs text-gray-600">Regime Atual</div>
                    </>
                  )}
                  {!isLPAtual && <div className="font-bold">Lucro Presumido</div>}
                  <div className="text-lg font-bold my-1">{formatCurrency(lucroPresumido)}</div>
                  <div className="text-xs">Presunção: {(presuncaoLP * 100).toFixed(0)}%</div>
                  {lucroPresumido > simplesAnexoIII && simplesAnexoIII > 0 && (
                    <div className="text-xs mt-1">⚠ {formatCurrency(lucroPresumido - simplesAnexoIII)} mais caro</div>
                  )}
                </td>
              </tr>
            </tbody>
          </table>
        </section>

        {/* ═══════════════════════════════════════════════════════════════════
            SEÇÃO 8: OBSERVAÇÕES FINAIS DA ANÁLISE
        ═══════════════════════════════════════════════════════════════════ */}
        <section className="mb-5 print-section">
          <h2 className="text-base font-bold mb-3">8. Observações Finais da Análise</h2>
          
          <p className="text-sm leading-relaxed text-justify">
            {gerarObservacoesFinais(relatorio)}
          </p>
          
          <p className="text-sm mt-4">
            Documento gerado em {formatDateSafe(relatorio.gerado_em)}
          </p>
        </section>

        {comentarioAnalista && (
          <section className="mb-5 print-section">
            <h2 className="text-base font-bold mb-3">9. Comentário do Analista</h2>
            <p className="text-sm leading-relaxed text-justify">
              {comentarioAnalista}
            </p>
          </section>
        )}
      </div>
    );
  }
);

RelatorioPrintView.displayName = 'RelatorioPrintView';
