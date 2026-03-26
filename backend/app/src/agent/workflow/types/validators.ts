export function isCalcSchema(payload: any) {
  if (!payload || typeof payload !== 'object') return false;
  if (payload.tipo !== 'SECAO8') return false;
  return Boolean(
    payload.dadosSecao1 &&
      payload.dadosSecao2 &&
      payload.dadosSecao3 &&
      payload.dadosSecao4 &&
      payload.dadosSecao5 &&
      payload.dadosSecao6 &&
      payload.dadosSecao7 &&
      payload.dadosSecao8 &&
      payload.dadosCabecalho
  );
}

export function isParecerPessoalSchema(payload: any) {
  if (!payload || typeof payload !== 'object') return false;
  if (String(payload.tipo || '').toUpperCase() !== 'PARECER_PESSOAL') return false;
  return Boolean(
    payload.dadosCabecalho &&
      payload.valoresPagamento &&
      payload.controleJornada &&
      payload.alteracoesMes &&
      payload.eventosDP &&
      payload.consignado &&
      payload.pontosAtencao &&
      payload.avisosPendencias &&
      payload.anexos &&
      payload.comentarios
  );
}
