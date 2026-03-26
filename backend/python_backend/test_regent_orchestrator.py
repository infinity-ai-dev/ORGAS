"""
🧪 Testes do Grafo Regente Orquestrador

Testa cada tipo de documento e o fluxo completo.
"""

import json
import logging
from agents.regent_orchestrator import get_regent_orchestrator, RegentState

# Configurar logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger(__name__)


# ═══════════════════════════════════════════════════════════════════════════
# FIXTURES - Documentos de Teste
# ═══════════════════════════════════════════════════════════════════════════

TEST_DOCUMENTS = {
    "fiscal": {
        "filename": "nfe_exemplo.pdf",
        "format": "pdf",
        "content": """
        NOTA FISCAL ELETRÔNICA - NF-e
        ═════════════════════════════════════════

        Emitente:
        - CNPJ: 12.345.678/0001-90
        - Razão Social: EMPRESA TESTE LTDA

        Destinatário:
        - CNPJ: 98.765.432/0001-01
        - Razão Social: CLIENTE TESTE LTDA

        Produtos:
        1. Serviço de Consultoria
           - Valor: R$ 10.000,00
           - ICMS: R$ 2.000,00
           - IPI: R$ 1.000,00

        Total da NF-e:
        - Valor dos Produtos: R$ 10.000,00
        - ICMS: R$ 2.000,00
        - IPI: R$ 1.000,00
        - PIS: R$ 800,00
        - COFINS: R$ 2.400,00
        - Total NF-e: R$ 10.000,00

        NFe: 12345678901234567890123456789012345678901234
        Chave de Acesso: 35240303123456780001650010000001234567890123
        Protocolo Receita Federal: 135240303000001

        Emitida em: 03/03/2024 10:30:00
        """,
    },
    "accounting": {
        "filename": "demonstracao_financeira.pdf",
        "format": "pdf",
        "content": """
        DEMONSTRAÇÃO FINANCEIRA - BALANÇO PATRIMONIAL
        ═════════════════════════════════════════════

        EMPRESA TESTE LTDA
        Balanço Patrimonial em 31/12/2023

        ATIVO
        ─────
        Ativo Circulante:
        - Caixa: R$ 50.000,00
        - Banco: R$ 150.000,00
        - Contas a Receber: R$ 200.000,00
        - Estoques: R$ 100.000,00
        Total Circulante: R$ 500.000,00

        Ativo Não Circulante:
        - Imóvel: R$ 500.000,00
        - Máquinas: R$ 300.000,00
        - (-) Depreciação: (R$ 100.000,00)
        Total Não Circulante: R$ 700.000,00

        TOTAL DO ATIVO: R$ 1.200.000,00

        PASSIVO
        ───────
        Passivo Circulante:
        - Contas a Pagar: R$ 150.000,00
        - Salários a Pagar: R$ 50.000,00
        Total Circulante: R$ 200.000,00

        PATRIMÔNIO LÍQUIDO
        ──────────────────
        - Capital Social: R$ 800.000,00
        - Lucros Acumulados: R$ 200.000,00
        Total Patrimônio: R$ 1.000.000,00

        TOTAL PASSIVO + PL: R$ 1.200.000,00

        Demonstração de Resultado - DRE:
        Receita Operacional: R$ 500.000,00
        Custo dos Produtos: (R$ 300.000,00)
        Lucro Bruto: R$ 200.000,00
        Despesas Operacionais: (R$ 50.000,00)
        EBITDA: R$ 150.000,00
        Depreciação: (R$ 20.000,00)
        Lucro Operacional: R$ 130.000,00
        Resultado Financeiro: R$ 10.000,00
        Lucro Antes do IR: R$ 140.000,00
        IR e CSLL: (R$ 42.000,00)
        Lucro Líquido: R$ 98.000,00

        CPC - Pronunciamentos Técnicos aplicados.
        IFRS - Padrões internacionais adotados.
        """,
    },
    "personal": {
        "filename": "dados_pessoais.pdf",
        "format": "pdf",
        "content": """
        FORMULÁRIO DE DADOS PESSOAIS - CONFIDENCIAL
        ════════════════════════════════════════════

        INFORMAÇÕES PESSOAIS:
        ─────────────────────
        Nome Completo: João Silva Santos
        Data de Nascimento: 15/06/1980
        CPF: 123.456.789-00
        RG: 12.345.678-9
        Nacionalidade: Brasileira

        CONTATO:
        ────────
        Email (PII): joao.silva@email.com
        Telefone (PII): (11) 98765-4321
        Celular (PII): (11) 99999-8888

        ENDEREÇO (CONFIDENCIAL):
        ───────────────────────
        Rua Exemplo, 123
        Apt 456
        São Paulo - SP - CEP: 01234-567

        INFORMAÇÕES FINANCEIRAS:
        ────────────────────────
        Banco: Banco do Brasil
        Agência: 1234
        Conta: 123456-7 (confidencial)
        Renda Mensal: R$ 5.000,00

        LGPD - Lei Geral de Proteção de Dados
        GDPR - Regulamento Geral de Proteção de Dados
        Dados Pessoais sob Proteção
        Consentimento: ☑ Fornecido
        Direito ao Esquecimento: Respeitado
        """,
    },
    "support": {
        "filename": "ticket_suporte.txt",
        "format": "txt",
        "content": """
        TICKET DE SUPORTE - SLA 4 HORAS
        ════════════════════════════════

        Ticket ID: TKT-2024-001234
        Data de Abertura: 03/03/2024 09:30
        Prioridade: ALTA
        Categoria: Erro Técnico / Bug

        PROBLEMA RELATADO:
        ──────────────────
        Título: Sistema não acessa base de dados

        Descrição:
        Ao tentar acessar o módulo de relatórios, o sistema
        exibe erro 500 "Database Connection Failed".
        O problema ocorre desde 09:00 de hoje.

        Passos para Reproduzir:
        1. Login no sistema
        2. Ir em Módulo > Relatórios
        3. Clicar em "Gerar Relatório"
        4. Observar erro

        IMPACTO:
        ────────
        - Sistema indisponível para 50 usuários
        - Impacto negócio: Alto
        - Feature Request: Implementar retry automático

        ATENDIMENTO:
        ────────────
        Agente: Maria Silva
        SLA: 4 horas
        Status: ABERTO / PENDENTE

        Help: Aguarde resposta da equipe técnica
        Assistência: Ramal 5555
        """,
    },
    "generic": {
        "filename": "documento_generico.txt",
        "format": "txt",
        "content": """
        DOCUMENTO GENÉRICO
        ══════════════════

        Este é um documento que não se enquadra
        em nenhuma categoria específica.

        Pode ser:
        - Uma pergunta geral
        - Uma solicitação de informação
        - Um documento misto
        - Q&A qualquer

        O sistema deve usar o generic_agent para processar.

        Pergunta: Como funciona o sistema?
        Contexto: Documentação geral
        """,
    },
}


# ═══════════════════════════════════════════════════════════════════════════
# FUNÇÕES DE TESTE
# ═══════════════════════════════════════════════════════════════════════════

def test_regent_orchestrator():
    """Testa o orquestrador regente com todos os tipos de documentos."""

    logger.info("🚀 Iniciando testes do Grafo Regente Orquestrador\n")

    # Obtém orquestrador
    try:
        orchestrator = get_regent_orchestrator()
        logger.info("✅ Orquestrador compilado com sucesso\n")
    except Exception as e:
        logger.error(f"❌ Erro ao compilar orquestrador: {e}")
        return

    # Testa cada tipo de documento
    for doc_type, document in TEST_DOCUMENTS.items():
        logger.info("=" * 80)
        logger.info(f"📄 Testando tipo: {doc_type.upper()}")
        logger.info("=" * 80)

        # Estado inicial
        initial_state: RegentState = {
            "document": document,
            "document_type": None,
            "document_valid": True,
            "validation_errors": [],
            "subgraph_executed": None,
            "extracted_data": {},
            "error": None,
            "status": "pending",
            "response": None,
        }

        # Executa
        try:
            result = orchestrator.invoke(initial_state)

            # Exibe resultado
            logger.info(f"✅ Status Final: {result['status']}")
            logger.info(f"📋 Tipo Detectado: {result['document_type']}")
            logger.info(f"🎯 Sub-grafo Executado: {result['subgraph_executed']}")

            if result["error"]:
                logger.error(f"⚠️  Erro: {result['error']}")

            if result["validation_errors"]:
                logger.warning(f"⚠️  Erros de Validação: {result['validation_errors']}")

            # Exibe resposta estruturada
            logger.info("\n📦 Resposta Estruturada:")
            response_json = json.dumps(
                result["response"],
                indent=2,
                ensure_ascii=False,
                default=str
            )
            for line in response_json.split("\n"):
                logger.info(f"  {line}")

        except Exception as e:
            logger.error(f"❌ Erro durante execução: {e}")
            import traceback
            traceback.print_exc()

        logger.info("\n")

    logger.info("=" * 80)
    logger.info("✅ Testes concluídos!")
    logger.info("=" * 80)


def test_single_document(doc_type: str = "fiscal"):
    """Testa um único tipo de documento."""

    logger.info(f"🔍 Testando documento tipo: {doc_type}\n")

    if doc_type not in TEST_DOCUMENTS:
        logger.error(f"❌ Tipo não encontrado: {doc_type}")
        logger.info(f"Tipos disponíveis: {list(TEST_DOCUMENTS.keys())}")
        return

    orchestrator = get_regent_orchestrator()
    document = TEST_DOCUMENTS[doc_type]

    initial_state: RegentState = {
        "document": document,
        "document_type": None,
        "document_valid": True,
        "validation_errors": [],
        "subgraph_executed": None,
        "extracted_data": {},
        "error": None,
        "status": "pending",
        "response": None,
    }

    result = orchestrator.invoke(initial_state)

    print("\n" + "=" * 80)
    print(f"📊 RESULTADO - {doc_type.upper()}")
    print("=" * 80)
    print(f"Status: {result['status']}")
    print(f"Tipo Detectado: {result['document_type']}")
    print(f"Válido: {result['document_valid']}")
    print(f"Sub-grafo: {result['subgraph_executed']}")
    print("\n📋 Resposta Completa:")
    print(json.dumps(result["response"], indent=2, ensure_ascii=False, default=str))


if __name__ == "__main__":
    import sys

    if len(sys.argv) > 1:
        # Teste um tipo específico
        doc_type = sys.argv[1]
        test_single_document(doc_type)
    else:
        # Teste todos os tipos
        test_regent_orchestrator()

    # Exemplos de execução:
    # python test_regent_orchestrator.py                 # Testa todos
    # python test_regent_orchestrator.py fiscal          # Testa fiscal
    # python test_regent_orchestrator.py accounting      # Testa accounting
    # python test_regent_orchestrator.py personal        # Testa personal
    # python test_regent_orchestrator.py support         # Testa support
    # python test_regent_orchestrator.py generic         # Testa generic
