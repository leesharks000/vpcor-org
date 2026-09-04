#!/usr/bin/env python3
"""url_grammar.py — one URL grammar for a static site, and a sitemap derived from its tree.

  python3 scripts/url_grammar.py --host www.example.org --slash none  --root . --pages-dir .       [--check]
  python3 scripts/url_grammar.py --host www.example.org --slash always --root . --pages-dir dist --sitemap-out public/sitemap.xml

Rewrites <link rel=canonical>, og:url, JSON-LD url/@id/mainEntityOfPage and internal hrefs to
https://HOST/<path> with the chosen trailing-slash policy (root is always "/"); adds a canonical
where a page has none; derives sitemap.xml from every index.html / top-level .html under PAGES_DIR
with lastmod from git. Data files are never listed. Idempotent; --check verifies without writing.
Origin: the crimsonhexagonal.org repair of 2026-09-03 (Search Console: three grammars, 0 indexed of 408).
"""
import re, sys, pathlib, subprocess, datetime, argparse, json

def main():
    ap = argparse.ArgumentParser(); ap.add_argument('--host', required=True); ap.add_argument('--slash', choices=['none','always'], default='none')
    ap.add_argument('--root', default='.'); ap.add_argument('--pages-dir', default='.'); ap.add_argument('--sitemap-out', default=None)
    ap.add_argument('--skip', default='node_modules,.git,dist,.vercel,.astro'); ap.add_argument('--check', action='store_true'); ap.add_argument('--no-links', action='store_true'); ap.add_argument('--exclude', default=''); ap.add_argument('--include-pdf', action='store_true'); ap.add_argument('--include-ext', default='')
    a = ap.parse_args()
    ROOT = pathlib.Path(a.root).resolve(); PAGES = (ROOT/a.pages_dir).resolve(); skip = set(a.skip.split(','))
    WWW = f"https://{a.host}"; APEX = WWW.replace('https://www.', 'https://')
    def canon(u):
        u = u.strip()
        if u.startswith(APEX+'/') or u == APEX: u = WWW + u[len(APEX):]
        if not u.startswith(WWW): return u
        path = u[len(WWW):] or '/'
        if path == '/': return WWW + '/'
        q = ''
        if '?' in path or '#' in path:
            i = min([x for x in (path.find('?'), path.find('#')) if x >= 0]); path, q = path[:i], path[i:]
        if path in ('', '/'): return WWW + '/' + q                      # root keeps its slash (also before #fragment / ?query)
        if re.search(r'\.[a-z0-9]{2,5}$', path): return WWW + path + q   # files keep their name
        path = path.rstrip('/'); path = path + '/' if a.slash == 'always' else path
        return WWW + path + q
    def canon_href(h):  # site-relative internal links
        if not h.startswith('/') or h.startswith('//'): return h
        return canon(WWW + h)[len(WWW):]
    def pages():
        out = {}
        for p in PAGES.rglob('*.html'):
            if any(s in p.relative_to(PAGES).parts for s in skip): continue
            rel = p.relative_to(PAGES).as_posix()
            if p.name == 'index.html':
                d = rel[:-len('index.html')].rstrip('/'); path = '/' if not d else '/'+d
            else:
                path = '/' + rel[:-5]
            out[path] = p
        ex=set(x for x in a.exclude.split(',') if x)
        out={k:v for k,v in out.items() if k not in ex}
        return dict(sorted(out.items(), key=lambda kv: (kv[0] != '/', kv[0])))
    def lastmod(p):
        try:
            o = subprocess.run(['git','log','-1','--format=%cs','--',str(p)], cwd=ROOT, capture_output=True, text=True, timeout=10).stdout.strip()
            if o: return o
        except Exception: pass
        return datetime.datetime.fromtimestamp(p.stat().st_mtime, datetime.timezone.utc).strftime('%Y-%m-%d')
    pg = pages(); changed = 0; added = 0; bad = []; offsite = set()
    for path, p in pg.items():
        s = p.read_text(encoding='utf-8', errors='replace'); o = s
        want = canon(WWW + path)
        m_c = re.search(r'<link rel="canonical" href="([^"]+)"', s)
        if m_c and not (m_c.group(1).startswith(WWW) or m_c.group(1).startswith(APEX)):
            # canonical deliberately points at another host (a mirror of a record seated elsewhere):
            # leave it, and keep the page out of the sitemap — a sitemap must not list pages that
            # declare themselves non-canonical.
            offsite.add(path); continue
        if '<link rel="canonical"' in s:
            s = re.sub(r'(<link rel="canonical" href=")([^"]+)(")', lambda m: m.group(1)+want+m.group(3), s)
        elif '</head>' in s or '<head>' in s:
            s = s.replace('<head>', f'<head>\n<link rel="canonical" href="{want}">', 1) if '<head>' in s else s.replace('</head>', f'<link rel="canonical" href="{want}">\n</head>', 1); added += 1
        s = re.sub(r'(property="og:url" content=")([^"]+)(")', lambda m: m.group(1)+canon(m.group(2))+m.group(3), s)
        s = re.sub(r'("(?:url|@id|mainEntityOfPage)"\s*:\s*")(https://(?:www\.)?'+re.escape(APEX[8:])+r'[^"]*)(")', lambda m: m.group(1)+canon(m.group(2))+m.group(3), s)
        if not a.no_links:
            s = re.sub(r'href="(https://(?:www\.)?'+re.escape(APEX[8:])+r'[^"]*)"', lambda m: 'href="'+canon(m.group(1))+'"', s)
            s = re.sub(r'href="(/[^"]*)"', lambda m: 'href="'+canon_href(m.group(1))+'"', s)
        if s != o:
            if a.check: bad.append((path, 'page needs rewrite'))
            else: p.write_text(s, encoding='utf-8'); changed += 1
    if a.sitemap_out:
        lines = ['<?xml version="1.0" encoding="UTF-8"?>','<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">']
        for path, p in pg.items():
            if path in offsite: continue
            lines.append(f'  <url><loc>{canon(WWW+path)}</loc><lastmod>{lastmod(p)}</lastmod><priority>{"1.0" if path=="/" else "0.7"}</priority></url>')
        exts = ['pdf'] if a.include_pdf else []
        exts += [e.strip().lstrip('.') for e in a.include_ext.split(',') if e.strip()]
        for ext in exts:
            for p in sorted(PAGES.rglob(f'*.{ext}')):
                if any(sk in p.relative_to(PAGES).parts for sk in skip): continue
                if p.name.upper() in ('README.MD', 'LICENSE.MD', 'CHANGELOG.MD'): continue   # repository files, not publications
                lines.append(f'  <url><loc>{WWW}/{p.relative_to(PAGES).as_posix()}</loc><lastmod>{lastmod(p)}</lastmod><priority>0.5</priority></url>')
        lines.append('</urlset>'); xml = '\n'.join(lines)+'\n'
        out = (ROOT/a.sitemap_out)
        if a.check:
            cur = out.read_text() if out.exists() else ''
            if set(re.findall(r'<loc>([^<]+)</loc>', cur)) != set(re.findall(r'<loc>([^<]+)</loc>', xml)): bad.append(('sitemap', f'{len(pg)} pages on disk vs {cur.count("<loc>")} listed'))
        else:
            out.parent.mkdir(parents=True, exist_ok=True); out.write_text(xml)
    if a.check:
        print('url_grammar --check:', 'ok' if not bad else f'{len(bad)} issue(s): ' + '; '.join(f'{p}: {w}' for p, w in bad[:6])); return 1 if bad else 0
    print(f'url_grammar: {len(pg)} pages · {changed} rewritten ({added} canonicals added) · {len(offsite)} off-site-canonical pages left alone and unlisted · grammar {WWW}/<path>{"/" if a.slash=="always" else ""}' + (f' · sitemap → {a.sitemap_out} ({len(pg)} urls)' if a.sitemap_out else ''))
    return 0

if __name__ == '__main__': sys.exit(main())
