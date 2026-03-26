#!/usr/bin/env python3
import sys

def main() -> int:
    if len(sys.argv) < 3:
        print("usage: render_pdf_pymupdf.py <input.pdf> <output.png> [dpi] [page_index]")
        return 1

    input_path = sys.argv[1]
    output_path = sys.argv[2]
    dpi = 200
    page_index = 0
    if len(sys.argv) > 3:
        try:
            dpi = int(sys.argv[3])
        except Exception:
            dpi = 200
    if len(sys.argv) > 4:
        try:
            page_index = int(sys.argv[4])
        except Exception:
            page_index = 0

    try:
        import fitz  # PyMuPDF
    except Exception as exc:
        print(f"pymupdf_import_failed:{exc}")
        return 2

    try:
        doc = fitz.open(input_path)
        if doc.page_count == 0:
            print("pdf_empty")
            return 3
        if page_index < 0 or page_index >= doc.page_count:
            print("page_out_of_range")
            return 4
        page = doc.load_page(page_index)
        zoom = dpi / 72.0
        mat = fitz.Matrix(zoom, zoom)
        pix = page.get_pixmap(matrix=mat, alpha=False)
        pix.save(output_path)
        return 0
    except Exception as exc:
        print(f"render_failed:{exc}")
        return 5

if __name__ == "__main__":
    raise SystemExit(main())
