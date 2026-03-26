"""
HTML Report Generator
Converts structured parecer responses into HTML reports for frontend rendering
"""

from datetime import datetime


# ─── Helper Functions (Module Level) ───────────────────────────────────────


def _get_status_class(status: str) -> str:
    """Convert status string to CSS class"""
    if status == "PERFEITO":
        return "ok"
    elif status == "ATENÇÃO":
        return "warning"
    else:
        return "alert"


def _render_alertas(alertas: list) -> str:
    """Render alerts section"""
    if not alertas:
        return ""
    rows = "".join([f"<li>{alerta}</li>" for alerta in alertas])
    return f"""
    <div class="secao">
        <h2>⚠️ Alertas</h2>
        <ul>{rows}</ul>
    </div>"""


def _render_observacoes(obs: str) -> str:
    """Render observations section"""
    if not obs:
        return ""
    return f"""
    <div class="secao">
        <h2>📝 Observações</h2>
        <p>{obs}</p>
    </div>"""


def _render_eventos_row(eventos: list, label: str) -> str:
    """Render event rows"""
    if not eventos:
        return ""
    rows = "".join([f"<tr><td>{e.get('data', 'N/A')}</td><td>{e.get('descricao', 'N/A')}</td></tr>" for e in eventos])
    return f"<h4>{label}</h4><table>{rows}</table>"


def _render_jornadas(jornadas: list) -> str:
    """Render jornadas section"""
    if not jornadas:
        return ""
    rows = "".join([f"<tr><td>{j.get('tipo', 'N/A')}</td><td>{j.get('horas', 'N/A')}h</td></tr>" for j in jornadas])
    return f"<table><tr><th>Tipo</th><th>Horas</th></tr>{rows}</table>"


# ─── HTML Generators (Use Helper Functions) ────────────────────────────────

def generate_fiscal_html(parecer_data: dict) -> str:
    """Generate HTML report for PARECER_FISCAL"""
    cliente = parecer_data.get("cliente", {})
    resumo = parecer_data.get("resumoFiscal", {})
    secao1 = parecer_data.get("secao1_Faturamento", {})
    secao2 = parecer_data.get("secao2_MovimentoFinanceiro", {})
    secao5 = parecer_data.get("secao5_LucroPrejuizo", {})

    html = f"""
    <!DOCTYPE html>
    <html lang="pt-BR">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Parecer Fiscal - {cliente.get('nome', 'Cliente')}</title>
        <style>
            body {{
                font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                margin: 0;
                padding: 20px;
                background: #f5f5f5;
            }}
            .container {{
                max-width: 1000px;
                margin: 0 auto;
                background: white;
                padding: 40px;
                box-shadow: 0 2px 4px rgba(0,0,0,0.1);
            }}
            header {{
                border-bottom: 3px solid #1e40af;
                padding-bottom: 20px;
                margin-bottom: 30px;
            }}
            h1 {{
                margin: 0;
                color: #1e40af;
                font-size: 28px;
            }}
            .cliente-info {{
                background: #f0f4ff;
                padding: 15px;
                border-radius: 4px;
                margin: 20px 0;
            }}
            .info-row {{
                display: flex;
                justify-content: space-between;
                padding: 8px 0;
                border-bottom: 1px solid #ddd;
            }}
            .info-label {{
                font-weight: bold;
                color: #444;
            }}
            .info-value {{
                color: #666;
            }}
            .secao {{
                margin: 30px 0;
                border: 1px solid #ddd;
                border-radius: 4px;
                padding: 20px;
            }}
            .secao h2 {{
                color: #1e40af;
                border-bottom: 2px solid #ddd;
                padding-bottom: 10px;
                margin-top: 0;
            }}
            .resumo-fiscal {{
                display: grid;
                grid-template-columns: 1fr 1fr;
                gap: 20px;
                margin: 20px 0;
            }}
            .card {{
                background: #f8f9fa;
                padding: 15px;
                border-left: 4px solid #1e40af;
                border-radius: 4px;
            }}
            .card-title {{
                font-size: 12px;
                color: #888;
                text-transform: uppercase;
                margin-bottom: 5px;
            }}
            .card-value {{
                font-size: 24px;
                font-weight: bold;
                color: #1e40af;
            }}
            table {{
                width: 100%;
                border-collapse: collapse;
                margin: 15px 0;
            }}
            th {{
                background: #f0f4ff;
                padding: 12px;
                text-align: left;
                font-weight: bold;
                color: #1e40af;
                border-bottom: 2px solid #1e40af;
            }}
            td {{
                padding: 10px 12px;
                border-bottom: 1px solid #ddd;
            }}
            tr:hover {{
                background: #f9f9f9;
            }}
            .status-badge {{
                display: inline-block;
                padding: 4px 12px;
                border-radius: 20px;
                font-size: 12px;
                font-weight: bold;
            }}
            .status-ok {{
                background: #d1f2eb;
                color: #065f46;
            }}
            .status-warning {{
                background: #fef3c7;
                color: #92400e;
            }}
            .status-alert {{
                background: #fee2e2;
                color: #991b1b;
            }}
            footer {{
                margin-top: 40px;
                padding-top: 20px;
                border-top: 1px solid #ddd;
                color: #888;
                font-size: 12px;
                text-align: center;
            }}
        </style>
    </head>
    <body>
        <div class="container">
            <header>
                <h1>📋 Parecer Fiscal</h1>
                <p>Período: {resumo.get('periodo', 'N/A')}</p>
            </header>

            <div class="cliente-info">
                <div class="info-row">
                    <span class="info-label">Cliente:</span>
                    <span class="info-value">{cliente.get('nome', 'N/A')}</span>
                </div>
                <div class="info-row">
                    <span class="info-label">CNPJ:</span>
                    <span class="info-value">{cliente.get('cnpj', 'N/A')}</span>
                </div>
                <div class="info-row">
                    <span class="info-label">Regime:</span>
                    <span class="info-value">{resumo.get('regime', 'N/A')}</span>
                </div>
                <div class="info-row">
                    <span class="info-label">Gerado em:</span>
                    <span class="info-value">{parecer_data.get('gerado_em', 'N/A')}</span>
                </div>
            </div>

            <div class="secao">
                <h2>📊 Resumo Fiscal</h2>
                <div class="resumo-fiscal">
                    <div class="card">
                        <div class="card-title">Receita Bruta</div>
                        <div class="card-value">{resumo.get('receitaBruta', 'R$ 0,00')}</div>
                    </div>
                    <div class="card">
                        <div class="card-title">Impostos</div>
                        <div class="card-value">{resumo.get('impostos', 'R$ 0,00')}</div>
                    </div>
                    <div class="card">
                        <div class="card-title">Alíquota</div>
                        <div class="card-value">{resumo.get('aliquota', '0%')}</div>
                    </div>
                </div>
            </div>

            <div class="secao">
                <h2>1️⃣ Faturamento</h2>
                <table>
                    <tr>
                        <th>Métrica</th>
                        <th>Valor</th>
                    </tr>
                    <tr>
                        <td>Notas Emitidas</td>
                        <td>{secao1.get('notasEmitidas', {}).get('quantidade', '0')}</td>
                    </tr>
                    <tr>
                        <td>Faturamento Total</td>
                        <td>{secao1.get('notasEmitidas', {}).get('faturamentoTotal', 'R$ 0,00')}</td>
                    </tr>
                    <tr>
                        <td>ISS Retido</td>
                        <td>{secao1.get('impostosRetidos', {}).get('iss', 'R$ 0,00')}</td>
                    </tr>
                    <tr>
                        <td>IRRF Retido</td>
                        <td>{secao1.get('impostosRetidos', {}).get('irrf', 'R$ 0,00')}</td>
                    </tr>
                </table>
            </div>

            <div class="secao">
                <h2>2️⃣ Movimento Financeiro</h2>
                <div class="resumo-fiscal">
                    <div class="card">
                        <div class="card-title">Banco</div>
                        <div class="card-value">{secao2.get('banco', 'N/A')}</div>
                    </div>
                    <div class="card">
                        <div class="card-title">Total de Movimento</div>
                        <div class="card-value">{secao2.get('totalMovimento', 'R$ 0,00')}</div>
                    </div>
                </div>
                <div style="margin: 15px 0;">
                    <strong>Divergência com Faturamento:</strong>
                    <span class="status-badge status-{_get_status_class(secao2.get('divergencia', {}).get('status', 'ALERT'))}">
                        {secao2.get('divergencia', {}).get('status', 'N/A')} ({secao2.get('divergencia', {}).get('porcentagem', '0%')})
                    </span>
                </div>
            </div>

            <div class="secao">
                <h2>5️⃣ Lucro e Prejuízo</h2>
                <table>
                    <tr>
                        <th>Descrição</th>
                        <th>Valor</th>
                    </tr>
                    <tr>
                        <td>Receita Bruta</td>
                        <td>{secao5.get('receitaBruta', 'R$ 0,00')}</td>
                    </tr>
                    <tr>
                        <td>Custo da Folha</td>
                        <td>{secao5.get('custoFolha', 'R$ 0,00')}</td>
                    </tr>
                    <tr>
                        <td>Impostos</td>
                        <td>{secao5.get('impostos', 'R$ 0,00')}</td>
                    </tr>
                    <tr style="background: #f0f4ff; font-weight: bold;">
                        <td>Lucro Estimado</td>
                        <td>{secao5.get('lucroEstimado', 'R$ 0,00')}</td>
                    </tr>
                </table>
            </div>

            {_render_alertas(parecer_data.get('alertas', []))}
            {_render_observacoes(parecer_data.get('observacoes', ''))}

            <footer>
                <p>Relatório gerado automaticamente pelo Sistema ORGAS</p>
                <p>Data de geração: {datetime.now().strftime('%d/%m/%Y %H:%M:%S')}</p>
            </footer>
        </div>
    </body>
    </html>
    """
    return html


def generate_pessoal_html(parecer_data: dict) -> str:
    """Generate HTML report for PARECER_PESSOAL"""
    cliente = parecer_data.get("cliente", {})
    eventos = parecer_data.get("eventosDP", {})
    jornadas = parecer_data.get("controleJornada", {})
    pagamentos = parecer_data.get("valoresPagamento", {})

    html = f"""
    <!DOCTYPE html>
    <html lang="pt-BR">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Parecer Pessoal - {cliente.get('nome', 'Cliente')}</title>
        <style>
            body {{
                font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                margin: 0;
                padding: 20px;
                background: #f5f5f5;
            }}
            .container {{
                max-width: 1000px;
                margin: 0 auto;
                background: white;
                padding: 40px;
                box-shadow: 0 2px 4px rgba(0,0,0,0.1);
            }}
            header {{
                border-bottom: 3px solid #059669;
                padding-bottom: 20px;
                margin-bottom: 30px;
            }}
            h1 {{
                margin: 0;
                color: #059669;
                font-size: 28px;
            }}
            .cliente-info {{
                background: #ecfdf5;
                padding: 15px;
                border-radius: 4px;
                margin: 20px 0;
            }}
            .secao {{
                margin: 30px 0;
                border: 1px solid #ddd;
                border-radius: 4px;
                padding: 20px;
            }}
            .secao h2 {{
                color: #059669;
                border-bottom: 2px solid #ddd;
                padding-bottom: 10px;
                margin-top: 0;
            }}
            table {{
                width: 100%;
                border-collapse: collapse;
                margin: 15px 0;
            }}
            th {{
                background: #ecfdf5;
                padding: 12px;
                text-align: left;
                font-weight: bold;
                color: #059669;
                border-bottom: 2px solid #059669;
            }}
            td {{
                padding: 10px 12px;
                border-bottom: 1px solid #ddd;
            }}
            footer {{
                margin-top: 40px;
                padding-top: 20px;
                border-top: 1px solid #ddd;
                color: #888;
                font-size: 12px;
                text-align: center;
            }}
        </style>
    </head>
    <body>
        <div class="container">
            <header>
                <h1>👤 Parecer Pessoal (DP)</h1>
                <p>Período: {parecer_data.get('dataReferencia', 'N/A')}</p>
            </header>

            <div class="cliente-info">
                <h3>{cliente.get('nome', 'N/A')}</h3>
                <p><strong>CNPJ:</strong> {cliente.get('cnpj', 'N/A')}</p>
            </div>

            <div class="secao">
                <h2>📅 Eventos de DP</h2>
                <table>
                    <tr>
                        <th>Tipo</th>
                        <th>Funcionário</th>
                        <th>Data/Período</th>
                    </tr>
                    {_render_eventos_row(eventos.get('ferias', []), 'Férias')}
                    {_render_eventos_row(eventos.get('admissoes', []), 'Admissões')}
                </table>
            </div>

            <div class="secao">
                <h2>⏰ Controle de Jornada</h2>
                <p><strong>Total de Funcionários:</strong> {jornadas.get('resumo', {}).get('totalFuncionarios', '0')}</p>
                <p><strong>Total de Horas Trabalhadas:</strong> {jornadas.get('resumo', {}).get('totalHorasTrabalhadas', '0')}</p>
                <p><strong>Total de Horas Extras:</strong> {jornadas.get('resumo', {}).get('totalHorasExtras', '0')}</p>
                <table>
                    <tr>
                        <th>Funcionário</th>
                        <th>Dias Trabalhados</th>
                        <th>Horas Trabalhadas</th>
                        <th>Horas Extras</th>
                    </tr>
                    {_render_jornadas(jornadas.get('jornadas', []))}
                </table>
            </div>

            <footer>
                <p>Relatório gerado automaticamente pelo Sistema ORGAS</p>
                <p>Data de geração: {datetime.now().strftime('%d/%m/%Y %H:%M:%S')}</p>
            </footer>
        </div>
    </body>
    </html>
    """
    return html


def generate_contabil_html(parecer_data: dict) -> str:
    """Generate HTML report for PARECER_CONTABIL"""
    balanco = parecer_data.get("balanco", {})
    dre = parecer_data.get("dre", {})
    indicadores = parecer_data.get("indicadores", {})

    html = f"""
    <!DOCTYPE html>
    <html lang="pt-BR">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Parecer Contábil</title>
        <style>
            body {{
                font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                margin: 0;
                padding: 20px;
                background: #f5f5f5;
            }}
            .container {{
                max-width: 1000px;
                margin: 0 auto;
                background: white;
                padding: 40px;
                box-shadow: 0 2px 4px rgba(0,0,0,0.1);
            }}
            header {{
                border-bottom: 3px solid #7c3aed;
                padding-bottom: 20px;
                margin-bottom: 30px;
            }}
            h1 {{
                margin: 0;
                color: #7c3aed;
                font-size: 28px;
            }}
            .secao {{
                margin: 30px 0;
                border: 1px solid #ddd;
                border-radius: 4px;
                padding: 20px;
            }}
            .secao h2 {{
                color: #7c3aed;
                border-bottom: 2px solid #ddd;
                padding-bottom: 10px;
                margin-top: 0;
            }}
            table {{
                width: 100%;
                border-collapse: collapse;
                margin: 15px 0;
            }}
            th {{
                background: #f3e8ff;
                padding: 12px;
                text-align: left;
                font-weight: bold;
                color: #7c3aed;
                border-bottom: 2px solid #7c3aed;
            }}
            td {{
                padding: 10px 12px;
                border-bottom: 1px solid #ddd;
            }}
            .indicador {{
                display: inline-block;
                background: #f3e8ff;
                padding: 15px 20px;
                border-radius: 4px;
                margin: 10px 10px 10px 0;
                text-align: center;
            }}
            .indicador-label {{
                font-size: 12px;
                color: #666;
                text-transform: uppercase;
                margin-bottom: 5px;
            }}
            .indicador-valor {{
                font-size: 20px;
                font-weight: bold;
                color: #7c3aed;
            }}
            footer {{
                margin-top: 40px;
                padding-top: 20px;
                border-top: 1px solid #ddd;
                color: #888;
                font-size: 12px;
                text-align: center;
            }}
        </style>
    </head>
    <body>
        <div class="container">
            <header>
                <h1>📊 Parecer Contábil</h1>
                <p>Data de Referência: {balanco.get('dataReferencia', 'N/A')}</p>
            </header>

            <div class="secao">
                <h2>💰 Balanço Patrimonial</h2>
                <table>
                    <tr>
                        <th>Classificação</th>
                        <th>Circulante</th>
                        <th>Não Circulante</th>
                        <th>Total</th>
                    </tr>
                    <tr>
                        <td><strong>ATIVO</strong></td>
                        <td>{balanco.get('ativo', {}).get('circulante', 'R$ 0,00')}</td>
                        <td>{balanco.get('ativo', {}).get('naoCirculante', 'R$ 0,00')}</td>
                        <td><strong>{balanco.get('ativo', {}).get('total', 'R$ 0,00')}</strong></td>
                    </tr>
                    <tr>
                        <td><strong>PASSIVO</strong></td>
                        <td>{balanco.get('passivo', {}).get('circulante', 'R$ 0,00')}</td>
                        <td>{balanco.get('passivo', {}).get('naoCirculante', 'R$ 0,00')}</td>
                        <td><strong>{balanco.get('passivo', {}).get('total', 'R$ 0,00')}</strong></td>
                    </tr>
                    <tr style="background: #f3e8ff; font-weight: bold;">
                        <td>PATRIMÔNIO</td>
                        <td colspan="3">{balanco.get('patrimonio', 'R$ 0,00')}</td>
                    </tr>
                </table>
            </div>

            <div class="secao">
                <h2>📈 Demonstração de Resultado (DRE)</h2>
                <table>
                    <tr>
                        <th>Descrição</th>
                        <th>Valor</th>
                    </tr>
                    <tr>
                        <td>Receita Bruta</td>
                        <td>{dre.get('receitaBruta', 'R$ 0,00')}</td>
                    </tr>
                    <tr>
                        <td>Deduções</td>
                        <td>{dre.get('deducoes', 'R$ 0,00')}</td>
                    </tr>
                    <tr style="background: #f0f4ff; font-weight: bold;">
                        <td>Receita Líquida</td>
                        <td>{dre.get('receitaLiquida', 'R$ 0,00')}</td>
                    </tr>
                    <tr>
                        <td>Custos</td>
                        <td>{dre.get('custos', 'R$ 0,00')}</td>
                    </tr>
                    <tr>
                        <td>Despesas</td>
                        <td>{dre.get('despesas', 'R$ 0,00')}</td>
                    </tr>
                    <tr style="background: #f0f4ff; font-weight: bold;">
                        <td>Lucro Líquido</td>
                        <td>{dre.get('lucroLiquido', 'R$ 0,00')}</td>
                    </tr>
                </table>
            </div>

            <div class="secao">
                <h2>📊 Indicadores Financeiros</h2>
                <div>
                    <div class="indicador">
                        <div class="indicador-label">Liquidez Corrente</div>
                        <div class="indicador-valor">{indicadores.get('liquidezCorrente', '0')}</div>
                    </div>
                    <div class="indicador">
                        <div class="indicador-label">Liquidez Geral</div>
                        <div class="indicador-valor">{indicadores.get('liquidezGeral', '0')}</div>
                    </div>
                    <div class="indicador">
                        <div class="indicador-label">Endividamento</div>
                        <div class="indicador-valor">{indicadores.get('endividamento', '0')}</div>
                    </div>
                    <div class="indicador">
                        <div class="indicador-label">ROE</div>
                        <div class="indicador-valor">{indicadores.get('ROE', '0')}</div>
                    </div>
                    <div class="indicador">
                        <div class="indicador-label">ROA</div>
                        <div class="indicador-valor">{indicadores.get('ROA', '0')}</div>
                    </div>
                </div>
            </div>

            <footer>
                <p>Relatório gerado automaticamente pelo Sistema ORGAS</p>
                <p>Data de geração: {datetime.now().strftime('%d/%m/%Y %H:%M:%S')}</p>
            </footer>
        </div>
    </body>
    </html>
    """
    return html


class HtmlGenerator:
    """Main HTML generation orchestrator"""

    @staticmethod
    def generate(parecer_data: dict, tipo_parecer: str) -> str:
        """Generate HTML report based on parecer type"""
        if tipo_parecer == "fiscal":
            return generate_fiscal_html(parecer_data)
        elif tipo_parecer == "pessoal":
            return generate_pessoal_html(parecer_data)
        elif tipo_parecer == "contabil":
            return generate_contabil_html(parecer_data)
        elif tipo_parecer == "atendimento":
            return f"<pre>{parecer_data}</pre>"
        else:
            return f"<pre>{parecer_data}</pre>"
