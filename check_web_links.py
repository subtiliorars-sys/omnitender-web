#!/usr/bin/env python3
import os
import re
import sys
from urllib.parse import urlparse

def parse_html_references(content):
    # Find all href="..." and src="..." attributes
    refs = []
    # Match href="..." and src="..."
    href_pattern = r'href=["\']([^"\']+)["\']'
    src_pattern = r'src=["\']([^"\']+)["\']'
    
    # Non-file URI schemes to ignore
    ignored_schemes = ('http://', 'https://', 'mailto:', 'tel:', 'sms:', 'data:', 'javascript:', '#')
    
    for match in re.finditer(href_pattern, content):
        url = match.group(1).strip()
        if url and not url.startswith(ignored_schemes):
            refs.append(('href', url))
            
    for match in re.finditer(src_pattern, content):
        url = match.group(1).strip()
        if url and not url.startswith(ignored_schemes):
            refs.append(('src', url))
            
    return refs

def main():
    root_dir = os.path.abspath(os.path.dirname(__file__))
    html_files = []
    for dirpath, _, filenames in os.walk(root_dir):
        if any(p in dirpath for p in ['.git', '.github', '.githooks']):
            continue
        for f in filenames:
            if f.endswith('.html'):
                html_files.append(os.path.join(dirpath, f))

    errors = 0
    warnings = 0

    print("Checking HTML references (href, src)...")
    for file_path in html_files:
        file_dir = os.path.dirname(file_path)
        rel_file_path = os.path.relpath(file_path, root_dir)
        
        try:
            with open(file_path, 'r', encoding='utf-8') as f:
                content = f.read()
        except Exception as e:
            print(f"Error reading {rel_file_path}: {e}")
            continue
            
        refs = parse_html_references(content)
        for attr, url in refs:
            # Parse URL and strip query params and fragment identifiers
            parsed = urlparse(url)
            target_path = parsed.path
            
            if not target_path:
                # If there's no path (e.g. just a query or fragment), skip
                continue
                
            target_file_path = os.path.abspath(os.path.join(file_dir, target_path))
            rel_target = os.path.relpath(target_file_path, root_dir)
            
            if not os.path.exists(target_file_path):
                print(f"ERROR: Broken reference in [{rel_file_path}]: {attr}='{url}' (Target not found: {rel_target})")
                errors += 1
                
    # Check for image tags missing alt attributes (accessibility check)
    print("\nRunning accessibility checks (image alt attributes)...")
    for file_path in html_files:
        rel_file_path = os.path.relpath(file_path, root_dir)
        try:
            with open(file_path, 'r', encoding='utf-8') as f:
                content = f.read()
        except:
            continue
            
        # Find all <img> tags
        img_pattern = r'<img\s+[^>]*>'
        for match in re.finditer(img_pattern, content):
            img_tag = match.group(0)
            if 'alt=' not in img_tag:
                print(f"WARNING: Image missing alt attribute in [{rel_file_path}]: {img_tag}")
                warnings += 1

    print(f"\nScan complete: {errors} error(s), {warnings} warning(s).")
    if errors > 0:
        sys.exit(1)
    else:
        sys.exit(0)

if __name__ == '__main__':
    main()
