// Tabelas do Simples Nacional e cálculo de alíquota progressiva (baseado nos workflows n8n).

type AliquotaResult = {
  sucesso: boolean;
  aliquotaFormatada: string;
  aliquotaDecimal: number;
  aliquotaEfetiva: number;
  faixa: number;
  erro: string | null;
  detalhes?: Record<string, unknown>;
};

export const TABELAS_SIMPLES_NACIONAL = {
  I: [
    { faixa: 1, limite: 180000.0, aliquotaNominal: 4.0, deducao: 0 },
    { faixa: 2, limite: 360000.0, aliquotaNominal: 7.3, deducao: 5940.0 },
    { faixa: 3, limite: 720000.0, aliquotaNominal: 9.5, deducao: 13860.0 },
    { faixa: 4, limite: 1800000.0, aliquotaNominal: 10.7, deducao: 22500.0 },
    { faixa: 5, limite: 3600000.0, aliquotaNominal: 14.3, deducao: 87300.0 },
    { faixa: 6, limite: 4800000.0, aliquotaNominal: 19.0, deducao: 378000.0 }
  ],
  II: [
    { faixa: 1, limite: 180000.0, aliquotaNominal: 4.5, deducao: 0 },
    { faixa: 2, limite: 360000.0, aliquotaNominal: 7.8, deducao: 5940.0 },
    { faixa: 3, limite: 720000.0, aliquotaNominal: 10.0, deducao: 13860.0 },
    { faixa: 4, limite: 1800000.0, aliquotaNominal: 11.2, deducao: 22500.0 },
    { faixa: 5, limite: 3600000.0, aliquotaNominal: 14.7, deducao: 85500.0 },
    { faixa: 6, limite: 4800000.0, aliquotaNominal: 30.0, deducao: 720000.0 }
  ],
  III: [
    { faixa: 1, limite: 180000.0, aliquotaNominal: 6.0, deducao: 0 },
    { faixa: 2, limite: 360000.0, aliquotaNominal: 11.2, deducao: 9360.0 },
    { faixa: 3, limite: 720000.0, aliquotaNominal: 13.5, deducao: 17640.0 },
    { faixa: 4, limite: 1800000.0, aliquotaNominal: 16.0, deducao: 35640.0 },
    { faixa: 5, limite: 3600000.0, aliquotaNominal: 21.0, deducao: 125640.0 },
    { faixa: 6, limite: 4800000.0, aliquotaNominal: 33.0, deducao: 648000.0 }
  ],
  IV: [
    { faixa: 1, limite: 180000.0, aliquotaNominal: 4.5, deducao: 0 },
    { faixa: 2, limite: 360000.0, aliquotaNominal: 9.0, deducao: 8100.0 },
    { faixa: 3, limite: 720000.0, aliquotaNominal: 10.2, deducao: 12420.0 },
    { faixa: 4, limite: 1800000.0, aliquotaNominal: 14.0, deducao: 39780.0 },
    { faixa: 5, limite: 3600000.0, aliquotaNominal: 22.0, deducao: 183780.0 },
    { faixa: 6, limite: 4800000.0, aliquotaNominal: 33.0, deducao: 828000.0 }
  ],
  V: [
    { faixa: 1, limite: 180000.0, aliquotaNominal: 15.5, deducao: 0 },
    { faixa: 2, limite: 360000.0, aliquotaNominal: 18.0, deducao: 4500.0 },
    { faixa: 3, limite: 720000.0, aliquotaNominal: 19.5, deducao: 9900.0 },
    { faixa: 4, limite: 1800000.0, aliquotaNominal: 20.5, deducao: 17100.0 },
    { faixa: 5, limite: 3600000.0, aliquotaNominal: 23.0, deducao: 62100.0 },
    { faixa: 6, limite: 4800000.0, aliquotaNominal: 30.5, deducao: 540000.0 }
  ]
} as const;

function parseFloatBR(valor: unknown) {
  if (typeof valor === 'number') return valor;
  if (!valor) return 0;
  return parseFloat(String(valor).replace(/\./g, '').replace(',', '.')) || 0;
}

function formatarAliquota(valor: number) {
  return valor.toFixed(2).replace('.', ',');
}

export function calcularAliquotaProgressiva(anexo: unknown, receitaAcumulada12m: unknown): AliquotaResult {
  if (!anexo) {
    return {
      sucesso: false,
      aliquotaFormatada: '0,00',
      aliquotaDecimal: 0,
      aliquotaEfetiva: 0,
      faixa: 0,
      erro: 'Anexo não informado'
    };
  }

  const anexoNormalizado = String(anexo).trim().toUpperCase() as keyof typeof TABELAS_SIMPLES_NACIONAL;

  if (!TABELAS_SIMPLES_NACIONAL[anexoNormalizado]) {
    return {
      sucesso: false,
      aliquotaFormatada: '0,00',
      aliquotaDecimal: 0,
      aliquotaEfetiva: 0,
      faixa: 0,
      erro: `Anexo '${String(anexo)}' inválido. Valores aceitos: I, II, III, IV, V`
    };
  }

  const rbt12 = parseFloatBR(receitaAcumulada12m);
  if (rbt12 <= 0) {
    return {
      sucesso: false,
      aliquotaFormatada: '0,00',
      aliquotaDecimal: 0,
      aliquotaEfetiva: 0,
      faixa: 0,
      erro: 'Receita bruta acumulada deve ser maior que zero'
    };
  }

  if (rbt12 > 4800000.0) {
    return {
      sucesso: false,
      aliquotaFormatada: '0,00',
      aliquotaDecimal: 0,
      aliquotaEfetiva: 0,
      faixa: 0,
      erro: `Receita de R$ ${rbt12.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} excede o limite do Simples Nacional (R$ 4.800.000,00)`
    };
  }

  const tabela = TABELAS_SIMPLES_NACIONAL[anexoNormalizado];
  let faixaEncontrada = tabela[tabela.length - 1];

  for (const faixa of tabela) {
    if (rbt12 <= faixa.limite) {
      faixaEncontrada = faixa;
      break;
    }
  }

  const aliquotaNominalDecimal = faixaEncontrada.aliquotaNominal / 100;
  const impostoCalculado = rbt12 * aliquotaNominalDecimal - faixaEncontrada.deducao;
  const aliquotaEfetiva = (impostoCalculado / rbt12) * 100;

  return {
    sucesso: true,
    aliquotaFormatada: formatarAliquota(aliquotaEfetiva),
    aliquotaDecimal: aliquotaEfetiva / 100,
    aliquotaEfetiva: aliquotaEfetiva,
    faixa: faixaEncontrada.faixa,
    erro: null,
    detalhes: {
      anexo: anexoNormalizado,
      receitaBrutaAcumulada: rbt12,
      faixaNumero: faixaEncontrada.faixa,
      aliquotaNominal: faixaEncontrada.aliquotaNominal,
      deducao: faixaEncontrada.deducao,
      formula: `((${rbt12.toFixed(2)} × ${faixaEncontrada.aliquotaNominal}%) - ${faixaEncontrada.deducao}) ÷ ${rbt12.toFixed(2)} = ${aliquotaEfetiva.toFixed(2)}%`
    }
  };
}
