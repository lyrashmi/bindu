from flask import Flask, request, render_template, abort, url_for, send_from_directory, redirect
from markupsafe import Markup
import markdown
import os
import re
import json
import threading
import time
import unicodedata
app = Flask(__name__)

VAULT_DIR = os.path.join(os.path.dirname(__file__), 'vault')
DB_PATH = os.path.join(os.path.dirname(__file__), 'vault_index.json')
INDEX_UPDATE_INTERVAL = 60  # seconds

# Global variables to hold vault data
note_map = {}       # note identifier (normalized lowercase) -> full path to .md file
backlinks_map = {}  # note identifier -> list of notes that link here
link_graph = {}     # note identifier -> list of notes this note links to

file_index = {}     # normalized filename -> relative path inside vault (for images, etc.)

def normalize_unicode(text):
    return unicodedata.normalize('NFC', text).lower()

def update_file_index():
    global file_index
    file_index = {}
    for root, dirs, files in os.walk(VAULT_DIR):
        for file in files:
            norm_file = normalize_unicode(file)
            rel_dir = os.path.relpath(root, VAULT_DIR)
            rel_path = os.path.join(rel_dir, file) if rel_dir != '.' else file
            file_index[norm_file] = rel_path.replace(os.path.sep, '/')

def parse_links(content):
    def replacer(match):
        is_embed = match.group(1)  # '!' or None
        raw_target = match.group(2)
        if not raw_target:
            return ''

        # Handle display text: [[target|display]]
        if '|' in raw_target:
            target, display = raw_target.split('|', 1)
        else:
            target = raw_target
            display = raw_target

        norm_target = normalize_unicode(target.strip())

        if is_embed:
            # Render image
            norm_file = normalize_unicode(target.strip())
            rel_path = file_index.get(norm_file, target.strip())
            img_url = '/vault/' + rel_path
            return f'<img src="{img_url}" alt="{display}" style="max-width: 100%; height: auto;" />'
        else:
            return f'<a href="/note/{norm_target}">{display}</a>'

    return re.sub(r'(!)?\[\[([^\]]+)\]\]', replacer, content)

def parse_tags_links(content):
    # Replace #tag with markdown-style link [#tag](/tag/tag)
    pattern = re.compile(r'(?<!\w)#(\w[\w/-]*)')

    def replacer(match):
        tag = match.group(1)
        return f'[#{tag}](/tag/{tag})'

    return pattern.sub(replacer, content)

def render_markdown(content):
    # Render Markdown to HTML (includes image tags)
    return Markup(markdown.markdown(content, extensions=['fenced_code', 'tables', 'toc']))

def get_note_content(note_name):
    norm_name = normalize_unicode(note_name)
    note_file = note_map.get(norm_name)
    if not note_file:
        abort(404)
    with open(note_file, encoding='utf-8') as f:
        md_content = f.read()

    md_content = parse_links(md_content)
    md_content = parse_tags_links(md_content)

    html = render_markdown(md_content)
    backlinks = backlinks_map.get(norm_name, [])
    forwardlinks = link_graph.get(norm_name, [])
    return html, backlinks, forwardlinks

def update_vault_index():
    global note_map, backlinks_map, link_graph
    while True:
        # Update file index first (all files including images)
        update_file_index()

        temp_note_map = {}
        temp_link_graph = {}

        for root, dirs, files in os.walk(VAULT_DIR):
            for file in files:
                if file.endswith(".md"):
                    full_path = os.path.join(root, file)
                    identifier = normalize_unicode(file[:-3])  # normalize and lowercase
                    temp_note_map[identifier] = full_path

                    with open(full_path, encoding="utf-8") as f:
                        content = f.read()

                    # Find [[links]] excluding image markdown: ![alt](file)
                    links = re.findall(r'\[\[([^\]]+)\]\]', content)
                    temp_link_graph[identifier] = [
                        normalize_unicode(link.strip())
                        for link in links
                        if not re.search(r'\.(png|jpe?g|gif|webp|svg)$', link, re.IGNORECASE)
                    ]

        temp_backlinks_map = {k: [] for k in temp_note_map}
        for src, targets in temp_link_graph.items():
            for tgt in targets:
                if tgt in temp_backlinks_map:
                    temp_backlinks_map[tgt].append(src)

        note_map = temp_note_map
        link_graph = temp_link_graph
        backlinks_map = temp_backlinks_map

        with open(DB_PATH, "w", encoding="utf-8") as f:
            json.dump({
                "notes": note_map,
                "forwardlinks": link_graph,
                "backlinks": backlinks_map
            }, f, indent=2)

        time.sleep(INDEX_UPDATE_INTERVAL)

@app.route('/')
def index():
    notes = sorted(note_map.keys())
    return render_template('index.html', notes=notes)

def extract_tags_from_content(content):
    return re.findall(r'(?<!\w)#([\w/-]+)', content)



@app.route('/note/<note_name>/save', methods=['POST'])
def save_note(note_name):
    norm_name = normalize_unicode(note_name)
    note_file = note_map.get(norm_name)
    if not note_file:
        abort(404)

    new_content = request.form.get("markdown")
    if not new_content:
        abort(400, "No content received")

    with open(note_file, "w", encoding="utf-8") as f:
        f.write(new_content)

    return redirect(url_for('note', note_name=note_name))

@app.route('/note/<note_name>')
def note(note_name):
    norm_name = normalize_unicode(note_name)
    note_file = note_map.get(norm_name)
    if not note_file:
        abort(404)
    with open(note_file, encoding='utf-8') as f:
        raw_md = f.read()

    tags = extract_tags_from_content(raw_md)
    content, backlinks, forwardlinks = get_note_content(note_name)

    graph_nodes = set(backlinks + forwardlinks + [norm_name])
    edges = []

    for src in backlinks:
        edges.append({"from": src, "to": norm_name})

    for tgt in forwardlinks:
        edges.append({"from": norm_name, "to": tgt})

    return render_template('note.html',
                           note_name=note_name,
                           content=content,
                           backlinks=backlinks,
                           forwardlinks=forwardlinks,
                           tags=tags,
                           graph_nodes=list(graph_nodes),
                           raw_md=raw_md,
                           graph_edges=edges)

@app.route('/tag/<path:tag>')
def tag_view(tag):
    try:
        with open(DB_PATH, encoding='utf-8') as f:
            db = json.load(f)
    except Exception:
        db = {"notes": {}, "backlinks": {}, "forwardlinks": {}}

    notes_with_tag = []
    for note_id, path in db.get("notes", {}).items():
        try:
            with open(path, encoding='utf-8') as nf:
                content = nf.read()
                if re.search(r'(?<!\w)#' + re.escape(tag) + r'(?!\w)', content):
                    notes_with_tag.append(note_id)
        except Exception:
            continue

    return render_template('tag_view.html', tag=tag, notes=notes_with_tag)

@app.route('/vault/<path:filename>')
def vault_files(filename):
    # Serve vault files (including images, etc.)
    return send_from_directory(VAULT_DIR, filename)

# Start background indexing
threading.Thread(target=update_vault_index, daemon=True).start()

if __name__ == '__main__':
    app.run(debug=True)
