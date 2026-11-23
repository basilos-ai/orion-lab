"""Bounded text-only extraction worker. No OCR, rendering, macros or network."""
import json
import pathlib
import sys
import zipfile

MAX_TEXT = 100000

def extract(path, kind):
    if kind == 'pdf':
        from pypdf import PdfReader
        reader = PdfReader(path, strict=True)
        if reader.is_encrypted:
            raise ValueError('document_encrypted')
        if not 1 <= len(reader.pages) <= 20:
            raise ValueError('document_page_limit')
        parts = []; readable = False
        for n, page in enumerate(reader.pages, 1):
            value = page.extract_text() or ''; readable |= bool(value.strip())
            parts.append(f'[第 {n} 页]\n' + value)
            if sum(map(len, parts)) > MAX_TEXT:
                raise ValueError('document_text_limit')
        text = '\n\n'.join(parts)
        if not readable:
            raise ValueError('document_no_text')
        return {'text': text, 'pages': len(reader.pages)}
    if kind != 'docx':
        raise ValueError('document_type')
    with zipfile.ZipFile(path) as archive:
        infos = archive.infolist()
        if len(infos) > 2000 or sum(i.file_size for i in infos) > 32 * 1024 * 1024:
            raise ValueError('document_expanded_limit')
        names = set(archive.namelist())
        if not {'[Content_Types].xml', 'word/document.xml'} <= names:
            raise ValueError('document_type')
        if any(n.lower().endswith('vbaproject.bin') or n.startswith('word/embeddings/') for n in names):
            raise ValueError('document_embedded_object')
        # No DTD/entity loading, including in OOXML parts outside the main body.
        for info in infos:
            if info.filename.endswith(('.xml', '.rels')):
                body = archive.read(info)
                if b'<!DOCTYPE' in body.upper() or b'<!ENTITY' in body.upper():
                    raise ValueError('document_xml_denied')
    from docx2python import docx2python
    with docx2python(path, html=False, duplicate_merged_cells=False) as document:
        text = document.text
        comments = '\n'.join(str(item) for item in document.comments)
        if comments:
            text += '\n[批注]\n' + comments
    if not text.strip():
        raise ValueError('document_no_text')
    if len(text) > MAX_TEXT:
        raise ValueError('document_text_limit')
    return {'text': text, 'pages': None}

if __name__ == '__main__':
    try:
        if sys.platform == 'linux':
            import resource
            resource.setrlimit(resource.RLIMIT_AS, (512 * 1024**2, 512 * 1024**2))
            resource.setrlimit(resource.RLIMIT_CPU, (15, 15))
            resource.setrlimit(resource.RLIMIT_FSIZE, (1024 * 1024, 1024 * 1024))
        result = extract(pathlib.Path(sys.argv[2]), sys.argv[1])
        if sys.platform == 'linux':
            result['peak_rss_mib'] = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024
        print(json.dumps(result, ensure_ascii=False))
    except Exception as error:
        code = str(error) if isinstance(error, ValueError) and str(error).startswith('document_') else 'document_parse_failed'
        print(json.dumps({'code': code}))
        sys.exit(1)
