#!/usr/bin/env python3
import os
import re
import sys
from urllib.parse import urlparse

def parse_html_references(content):
    refs = []
    href_pattern = r'href=["\']([^"\']+)["\']'
    src_pattern = r'src=["\']([^"\']+)["\']'

    ignored_schemes = ('http://', 'https://', 'mailto:', 'tel:', 'sms:', 'data:', 'javascript:')

    for match in re.finditer(href_pattern, content):
        url = match.group(1).strip()
        if url and not url.startswith(ignored_schemes):
            refs.append(('href', url))

    for match in re.finditer(src_pattern, content):
        url = match.group(1).strip()
        if url and not url.startswith(ignored_schemes):
            refs.append(('src', url))

    return refs


def parse_fragment_hrefs(content):
    refs = []
    href_pattern = r'href=["\']([^"\']+)["\']'
    for match in re.finditer(href_pattern, content):
        url = match.group(1).strip()
        if not url or url.startswith(('http://', 'https://', 'mailto:', 'tel:', 'sms:', 'javascript:')):
            continue
        parsed = urlparse(url)
        if parsed.fragment:
            refs.append((url, parsed.path, parsed.fragment))
    return refs


def collect_element_ids(content):
    return set(re.findall(r'\bid=["\']([^"\']+)["\']', content))


def load_html(path):
    with open(path, 'r', encoding='utf-8') as f:
        return f.read()


def main():
    root_dir = os.path.abspath(os.path.dirname(__file__))
    html_files = []
    for dirpath, _, filenames in os.walk(root_dir):
        if any(p in dirpath for p in ['.git', '.github', '.githooks']):
            continue
        for f in filenames:
            if f.endswith('.html'):
                html_files.append(os.path.join(dirpath, f))

    id_cache = {}
    errors = 0
    warnings = 0

    def ids_for(path):
        if path not in id_cache:
            try:
                id_cache[path] = collect_element_ids(load_html(path))
            except OSError:
                id_cache[path] = set()
        return id_cache[path]

    print("Checking HTML references (href, src)...")
    for file_path in html_files:
        file_dir = os.path.dirname(file_path)
        rel_file_path = os.path.relpath(file_path, root_dir)

        try:
            content = load_html(file_path)
        except Exception as e:
            print(f"Error reading {rel_file_path}: {e}")
            continue

        refs = parse_html_references(content)
        for attr, url in refs:
            parsed = urlparse(url)
            target_path = parsed.path

            if not target_path:
                continue

            target_file_path = os.path.abspath(os.path.join(file_dir, target_path))
            rel_target = os.path.relpath(target_file_path, root_dir)

            if not os.path.exists(target_file_path):
                print(f"ERROR: Broken reference in [{rel_file_path}]: {attr}='{url}' (Target not found: {rel_target})")
                errors += 1

    print("\nChecking in-page fragment anchors (#id)...")
    for file_path in html_files:
        file_dir = os.path.dirname(file_path)
        rel_file_path = os.path.relpath(file_path, root_dir)

        try:
            content = load_html(file_path)
        except Exception:
            continue

        for url, path_part, fragment in parse_fragment_hrefs(content):
            if path_part:
                target_file_path = os.path.abspath(os.path.join(file_dir, path_part))
                rel_target = os.path.relpath(target_file_path, root_dir)
                if not os.path.exists(target_file_path):
                    print(f"ERROR: Broken fragment link in [{rel_file_path}]: href='{url}' (Target not found: {rel_target})")
                    errors += 1
                    continue
            else:
                target_file_path = file_path

            if fragment not in ids_for(target_file_path):
                rel_target = os.path.relpath(target_file_path, root_dir)
                print(f"ERROR: Broken fragment link in [{rel_file_path}]: href='{url}' (No id='{fragment}' in {rel_target})")
                errors += 1

    print("\nRunning accessibility checks (image alt attributes)...")
    for file_path in html_files:
        rel_file_path = os.path.relpath(file_path, root_dir)
        try:
            content = load_html(file_path)
        except Exception:
            continue

        img_pattern = r'<img\s+[^>]*>'
        for match in re.finditer(img_pattern, content):
            img_tag = match.group(0)
            if 'alt=' not in img_tag:
                print(f"WARNING: Image missing alt attribute in [{rel_file_path}]: {img_tag}")
                warnings += 1

    print(f"\nScan complete: {errors} error(s), {warnings} warning(s).")
    sys.exit(1 if errors else 0)


if __name__ == '__main__':
    main()
