#!/usr/bin/env sh
set -e

BASE_URL="${BASE_URL:-http://localhost:3000}"

fail() {
  echo "ERROR: $1" >&2
  exit 1
}

assert_contains() {
  haystack="$1"
  needle="$2"
  echo "$haystack" | grep -q "$needle" || fail "expected to find '$needle' in response"
}

echo "==> Health check"
health="$(curl -sS "$BASE_URL/health")" || fail "health request failed"
assert_contains "$health" "\"status\""
assert_contains "$health" "OK"
echo "OK: $health"

echo "==> AI submit smoke (documents array)"
payload='{
  "analista_id": "24",
  "analista_nome": "Smoke Tester",
  "cliente_id": "145",
  "cliente_nome": "Cliente Padrão",
  "cliente_cnpj": null,
  "cliente_regime_tributario": null,
  "cliente_corp_group": null,
  "categoria": "geral",
  "relatorio_type": "geral",
  "is_parecer": false,
  "fiscal_tributation": null,
  "economic_group": null,
  "documents": [
    {
      "name": "documento.txt",
      "size": 30,
      "type": "text/plain",
      "lastModified": 1765376304434,
      "content": "SGVsbG8sIGRvY3VtZW50byBkZSB0ZXN0ZS4="
    }
  ],
  "observacoes": "",
  "timestamp": "2025-12-10T14:18:26.873Z",
  "source": "orgas-frontend",
  "reportId": 1765376306835
}'

ai_resp="$(curl -sS -X POST "$BASE_URL/webhook/ai-submit" -H "Content-Type: application/json" -d "$payload")" \
  || fail "ai-submit request failed"

assert_contains "$ai_resp" "\"success\""
assert_contains "$ai_resp" "\"reportId\""
assert_contains "$ai_resp" "\"agent\""
echo "OK: $ai_resp"

echo "==> Done"
