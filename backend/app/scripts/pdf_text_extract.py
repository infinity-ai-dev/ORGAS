#!/usr/bin/env python3
import json
import sys


def main() -> int:
    if len(sys.argv) < 2:
        print(json.dumps({"error": "missing_pdf"}))
        return 1
    pdf_path = sys.argv[1]
    max_pages = 3
    if len(sys.argv) > 2:
        try:
            max_pages = int(sys.argv[2])
        except Exception:
            max_pages = 3
    try:
        import fitz  # PyMuPDF
    except Exception as exc:
        print(json.dumps({"error": f"pymupdf_import_failed:{exc}"}))
        return 1
    try:
        doc = fitz.open(pdf_path)
    except Exception as exc:
        print(json.dumps({"error": f"pdf_open_failed:{exc}"}))
        return 1
    texts = []
    page_count = min(max_pages, doc.page_count)
    for i in range(page_count):
        try:
            page = doc.load_page(i)
            text = page.get_text("text")
            if text:
                texts.append(text)
        except Exception:
            continue
    doc.close()
    print(json.dumps({"text": "\n\n".join(texts)}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
