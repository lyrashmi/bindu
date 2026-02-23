from flask import Flask, request, render_template, abort, url_for, send_from_directory, redirect, session, flash, jsonify
from markupsafe import Markup
from urllib.parse import quote as url_quote
import markdown
import os
import re
import json
import threading
import time
import unicodedata
import subprocess
import shlex
app = Flask(__name__)
app.secret_key = 'changeme'  # TODO: set a secure secret in production

VAULT_DIR = os.path.join(os.path.dirname(__file__), 'vault')
DB_PATH = os.path.join(os.path.dirname(__file__), 'vault_index.json')
USERS_DB_PATH = os.path.join(os.path.dirname(__file__), 'users.json')
SETTINGS_PATH = os.path.join(os.path.dirname(__file__), 'settings.json')
NOTES_DIR = os.path.join(os.path.dirname(__file__), 'notes')
NOTES_ENTRIES_DIR = os.path.join(os.path.dirname(__file__), 'notes_entries')
INDEX_UPDATE_INTERVAL = 60  # seconds

# Default settings
DEFAULT_SETTINGS = {
    "accepting_registrations": False,
    "private_tag_enabled": True,
    "all_private": False
}

def get_settings():
    """Load settings from settings.json, creating with defaults if not exists."""
    if not os.path.exists(SETTINGS_PATH):
        with open(SETTINGS_PATH, 'w', encoding='utf-8') as f:
            json.dump(DEFAULT_SETTINGS, f, indent=2)
        return DEFAULT_SETTINGS.copy()
    try:
        with open(SETTINGS_PATH, encoding='utf-8') as f:
            settings = json.load(f)
        # Ensure all keys exist
        for key, val in DEFAULT_SETTINGS.items():
            if key not in settings:
                settings[key] = val
        return settings
    except Exception:
        return DEFAULT_SETTINGS.copy()

def save_settings(settings):
    """Save settings to settings.json."""
    with open(SETTINGS_PATH, 'w', encoding='utf-8') as f:
        json.dump(settings, f, indent=2)

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
            # URL-encode the target to handle special characters
            encoded_target = url_quote(norm_target, safe='')
            return f'<a href="/bindu/{encoded_target}">{display}</a>'

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

    settings = get_settings()
    
    # Check all_private mode - if enabled and user not logged in, show private page
    if settings.get('all_private', False) and 'username' not in session:
        private_file = os.path.join(os.path.dirname(__file__), 'text', 'private.md')
        try:
            with open(private_file, encoding='utf-8') as f:
                md_content = f.read()
            html = render_markdown(md_content)
            return html, [], []
        except FileNotFoundError:
            abort(404)

    # Check for #private tag; if enabled, present, and user not logged in, return private page content
    if settings.get('private_tag_enabled', True):
        if re.search(r'(?<!\w)#private(?!\w)', md_content) and 'username' not in session:
            private_file = os.path.join(os.path.dirname(__file__), 'text', 'private.md')
            try:
                with open(private_file, encoding='utf-8') as f:
                    md_content = f.read()
                html = render_markdown(md_content)
                return html, [], []
            except FileNotFoundError:
                abort(404)

    md_content = parse_links(md_content)
    md_content = parse_tags_links(md_content)

    html = render_markdown(md_content)
    backlinks = backlinks_map.get(norm_name, [])
    forwardlinks = link_graph.get(norm_name, [])
    return html, backlinks, forwardlinks


def _repo_rel(path):
    return os.path.relpath(path, os.path.dirname(__file__)).replace(os.path.sep, '/')


def git_commit(paths, message, author=None):
    """Stage the given file paths (absolute) and commit with message. Returns (ok, output)."""
    repo_dir = os.path.dirname(__file__)
    try:
        rels = [_repo_rel(p) for p in paths]
        # git add
        subprocess.run(['git', 'add'] + rels, cwd=repo_dir, check=True)
        cmd = ['git', 'commit', '-m', message]
        if author:
            cmd += ['--author', f"{author} <{author}@local>"]
        # run commit and capture output
        res = subprocess.run(cmd, cwd=repo_dir, check=False, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
        return (res.returncode == 0, res.stdout)
    except Exception as e:
        return (False, str(e))

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
                    # Deduplicate: same target linked multiple times with different display text
                    temp_link_graph[identifier] = list(set(
                        normalize_unicode(link.split('|')[0].strip())
                        for link in links
                        if not re.search(r'\.(png|jpe?g|gif|webp|svg)$', link.split('|')[0], re.IGNORECASE)
                    ))

        temp_backlinks_map = {k: [] for k in temp_note_map}
        for src, targets in temp_link_graph.items():
            for tgt in targets:
                if tgt in temp_backlinks_map and src not in temp_backlinks_map[tgt]:
                    temp_backlinks_map[tgt].append(src)

        note_map = temp_note_map
        link_graph = temp_link_graph
        backlinks_map = temp_backlinks_map

        # Ensure notes directories exist and an index file for each note
        try:
            os.makedirs(NOTES_DIR, exist_ok=True)
            os.makedirs(NOTES_ENTRIES_DIR, exist_ok=True)
            for identifier in note_map.keys():
                notes_index_file = os.path.join(NOTES_DIR, f"{identifier}.md")
                if not os.path.exists(notes_index_file):
                    # create empty index file
                    with open(notes_index_file, 'w', encoding='utf-8') as nf:
                        nf.write(f"# Notes for {identifier}\n\n")
        except Exception:
            pass

        # Convert absolute paths to relative paths for the JSON file
        base_dir = os.path.dirname(__file__)
        relative_note_map = {k: os.path.relpath(v, base_dir).replace(os.path.sep, '/') for k, v in note_map.items()}

        with open(DB_PATH, "w", encoding="utf-8") as f:
            json.dump({
                "notes": relative_note_map,
                "forwardlinks": link_graph,
                "backlinks": backlinks_map
            }, f, indent=2)

        time.sleep(INDEX_UPDATE_INTERVAL)

@app.route('/')
def index():
    settings = get_settings()
    # If all_private is enabled and user not logged in, redirect to login
    if settings.get('all_private', False) and 'username' not in session:
        return redirect(url_for('login', next=request.path))
    
    notes = sorted(note_map.keys())
    notes_json = json.dumps(notes)
    
    # Compute orphan bindus (no backlinks AND no forward links) for admin view
    orphan_bindus = []
    if session.get('role') == 'admin':
        for note in notes:
            has_backlinks = len(backlinks_map.get(note, [])) > 0
            has_forwardlinks = len(link_graph.get(note, [])) > 0
            if not has_backlinks and not has_forwardlinks:
                orphan_bindus.append(note)
    orphan_bindus_json = json.dumps(orphan_bindus)
    
    return render_template('index.html', notes=notes, notes_json=notes_json, orphan_bindus_json=orphan_bindus_json)

def extract_tags_from_content(content):
    return re.findall(r'(?<!\w)#([\w/-]+)', content)



@app.route('/bindu/<bindu_name>/save', methods=['POST'])
def save_bindu(bindu_name):
    norm_name = normalize_unicode(bindu_name)
    note_file = note_map.get(norm_name)
    if not note_file:
        abort(404)

    new_content = request.form.get("markdown")
    if not new_content:
        abort(400, "No content received")

    with open(note_file, "w", encoding="utf-8") as f:
        f.write(new_content)

    return redirect(url_for('bindu', bindu_name=bindu_name))

@app.route('/bindu/<bindu_name>')
def bindu(bindu_name):
    norm_name = normalize_unicode(bindu_name)
    note_file = note_map.get(norm_name)
    if not note_file:
        abort(404)
    with open(note_file, encoding='utf-8') as f:
        raw_md = f.read()

    settings = get_settings()
    
    # Check all_private mode first
    all_private_block = settings.get('all_private', False) and 'username' not in session
    
    # Check if private tag applies
    is_private = bool(re.search(r'(?<!\w)#private(?!\w)', raw_md))
    private_tag_block = settings.get('private_tag_enabled', True) and is_private and 'username' not in session

    # If blocked by all_private or private tag, show the special private page
    if all_private_block or private_tag_block:
        private_file = os.path.join(os.path.dirname(__file__), 'text', 'private.md')
        try:
            with open(private_file, encoding='utf-8') as pf:
                private_md = pf.read()
            content = render_markdown(private_md)
            backlinks = []
            forwardlinks = []
            tags = []
        except FileNotFoundError:
            abort(404)
    else:
        tags = extract_tags_from_content(raw_md)
        content, backlinks, forwardlinks = get_note_content(bindu_name)

    graph_nodes = set(backlinks + forwardlinks + [norm_name])
    edges = []

    for src in backlinks:
        edges.append({"from": src, "to": norm_name})

    for tgt in forwardlinks:
        edges.append({"from": norm_name, "to": tgt})

    # Build GitHub edit URL for admin edit button
    try:
        rel_repo_path = os.path.relpath(note_file, os.path.dirname(__file__)).replace(os.path.sep, '/')
        github_url = f"https://github.com/dgrmunch/bindu/blob/main/{rel_repo_path}"
    except Exception:
        github_url = None

    # Load the notes index file and render
    notes_index_html = ''
    notes_index_file = os.path.join(NOTES_DIR, f"{norm_name}.md")
    try:
        with open(notes_index_file, encoding='utf-8') as nf:
            notes_index_md = nf.read()
            notes_index_html = render_markdown(notes_index_md)
    except Exception:
        notes_index_html = ''

    # Collect git history for this bindu and its entries
    history = []
    try:
        repo_dir = os.path.dirname(__file__)
        files = [note_file]
        for fname in os.listdir(NOTES_ENTRIES_DIR):
            if fname.startswith(norm_name + '_'):
                files.append(os.path.join(NOTES_ENTRIES_DIR, fname))
        for f in files:
            cmd = ['git', 'log', '--pretty=format:%H||%an||%ai||%s', '--', _repo_rel(f)]
            res = subprocess.run(cmd, cwd=repo_dir, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
            if res.returncode == 0:
                for line in res.stdout.splitlines():
                    parts = line.split('||', 3)
                    if len(parts) == 4:
                        sha, author, date, subj = parts
                        history.append({'sha': sha, 'author': author, 'date': date, 'message': subj})
    except Exception:
        history = []
    # Prepare notes list for link autocompletion
    all_notes_json = json.dumps(sorted(note_map.keys()))
    return render_template('note.html',
                           note_name=bindu_name,
                           content=content,
                           backlinks=backlinks,
                           forwardlinks=forwardlinks,
                           tags=tags,
                           graph_nodes=list(graph_nodes),
                           raw_md=raw_md,
                           graph_edges=edges,
                           github_url=github_url,
                           notes_index_html=notes_index_html,
                           history=history,
                           all_notes_json=all_notes_json)


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


def ensure_users_db():
    # Initialize users.json if it does not exist
    if not os.path.exists(USERS_DB_PATH):
        users = {
            "users": [
                {"username": "diego", "password": "mahakala", "role": "admin"},
                {"username": "vivien", "password": "mahakala", "role": "admin"},
                {"username": "ravi", "password": "mahakala", "role": "admin"},
                {"username": "joe", "password": "mahakala", "role": "student"}
            ]
        }
        with open(USERS_DB_PATH, 'w', encoding='utf-8') as f:
            json.dump(users, f, indent=2)


ensure_users_db()


@app.route('/login', methods=['GET', 'POST'])
def login():
    if request.method == 'POST':
        username = request.form.get('username')
        password = request.form.get('password')
        try:
            with open(USERS_DB_PATH, encoding='utf-8') as f:
                users_db = json.load(f)
        except Exception:
            users_db = {"users": []}

        user = next((u for u in users_db.get('users', []) if u.get('username') == username and u.get('password') == password), None)
        if user:
            session['username'] = user['username']
            session['role'] = user.get('role', 'student')
            flash('Logged in successfully.', 'success')
            next_url = request.args.get('next') or url_for('index')
            return redirect(next_url)
        else:
            flash('Invalid credentials', 'danger')
            return render_template('login.html')
    else:
        return render_template('login.html')


@app.route('/logout')
def logout():
    session.pop('username', None)
    session.pop('role', None)
    flash('Logged out', 'info')
    return redirect(url_for('index'))


@app.route('/register', methods=['GET', 'POST'])
def register():
    settings = get_settings()
    # Only allow registration if accepting_registrations is enabled
    if not settings.get('accepting_registrations', False):
        flash('Registration is currently closed.', 'warning')
        return redirect(url_for('login'))
    
    if request.method == 'POST':
        username = request.form.get('username', '').strip()
        password = request.form.get('password', '').strip()
        email = request.form.get('email', '').strip()
        
        # Basic validation
        if not username or not password or not email:
            flash('All fields are required.', 'danger')
            return render_template('register.html')
        
        if len(username) < 3:
            flash('Username must be at least 3 characters.', 'danger')
            return render_template('register.html')
        
        if len(password) < 6:
            flash('Password must be at least 6 characters.', 'danger')
            return render_template('register.html')
        
        # Check if username already exists
        try:
            with open(USERS_DB_PATH, encoding='utf-8') as f:
                users_db = json.load(f)
        except Exception:
            users_db = {"users": []}
        
        if any(u.get('username') == username for u in users_db.get('users', [])):
            flash('Username already exists.', 'danger')
            return render_template('register.html')
        
        # Add new user with student role
        new_user = {
            "username": username,
            "password": password,
            "email": email,
            "role": "student"
        }
        users_db['users'].append(new_user)
        
        with open(USERS_DB_PATH, 'w', encoding='utf-8') as f:
            json.dump(users_db, f, indent=2)
        
        flash('Registration successful! You can now log in.', 'success')
        return redirect(url_for('login'))
    
    return render_template('register.html')


@app.route('/admin/settings', methods=['GET', 'POST'])
def admin_settings():
    # Only admins can access
    if session.get('role') != 'admin':
        flash('Access denied.', 'danger')
        return redirect(url_for('index'))
    
    settings = get_settings()
    
    if request.method == 'POST':
        # Update settings from form
        settings['accepting_registrations'] = 'accepting_registrations' in request.form
        settings['private_tag_enabled'] = 'private_tag_enabled' in request.form
        settings['all_private'] = 'all_private' in request.form
        save_settings(settings)
        flash('Settings saved successfully.', 'success')
        return redirect(url_for('admin_settings'))
    
    # Generate registration URL for copying
    registration_url = url_for('register', _external=True)
    
    return render_template('admin_settings.html', settings=settings, registration_url=registration_url)


@app.route('/notes_entries/<path:filename>')
def notes_entries_files(filename):
    return send_from_directory(NOTES_ENTRIES_DIR, filename)


@app.route('/bindu/<bindu_name>/commit/<sha>')
def bindu_commit(bindu_name, sha):
    """Return JSON with commit metadata and diff for the given sha."""
    repo_dir = os.path.dirname(__file__)
    try:
        # Get commit metadata
        meta_cmd = ['git', 'show', '--no-patch', '--pretty=format:%H||%an||%ai||%s', sha]
        meta_res = subprocess.run(meta_cmd, cwd=repo_dir, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        if meta_res.returncode != 0:
            return jsonify({'status': 'error', 'message': 'Commit not found'}), 404
        parts = meta_res.stdout.strip().split('||', 3)
        if len(parts) != 4:
            return jsonify({'status': 'error', 'message': 'Invalid commit format'}), 500
        commit_sha, author, date, message = parts
        meta = {'sha': commit_sha, 'author': author, 'date': date, 'message': message}

        # Get diff
        diff_cmd = ['git', 'show', '--format=', sha]
        diff_res = subprocess.run(diff_cmd, cwd=repo_dir, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        diff_text = diff_res.stdout if diff_res.returncode == 0 else ''

        return jsonify({'status': 'ok', 'meta': meta, 'diff': diff_text})
    except Exception as e:
        return jsonify({'status': 'error', 'message': str(e)}), 500


@app.route('/notes_entries/render/<path:filename>')
def render_notes_entry(filename):
    # safety: prevent path traversal
    safe_path = os.path.normpath(os.path.join(NOTES_ENTRIES_DIR, filename))
    if not safe_path.startswith(os.path.normpath(NOTES_ENTRIES_DIR)):
        abort(403)
    try:
        with open(safe_path, encoding='utf-8') as f:
            md = f.read()
        # Parse obsidian-style links and tags
        md = parse_links(md)
        md = parse_tags_links(md)
        return render_markdown(md)
    except Exception:
        abort(404)


@app.route('/bindu/<bindu_name>/notes/add', methods=['GET', 'POST'])
def add_note_entry(bindu_name):
    if 'username' not in session:
        return redirect(url_for('login', next=url_for('bindu', bindu_name=bindu_name)))

    norm_name = normalize_unicode(bindu_name)
    if request.method == 'POST':
        body = request.form.get('markdown')
        title = request.form.get('title') or f'Note by {session.get("username")}'
        if not body:
            flash('Note cannot be empty', 'danger')
            # For AJAX calls, return JSON error
            if request.headers.get('X-Requested-With') == 'XMLHttpRequest':
                return jsonify({'status': 'error', 'message': 'Note cannot be empty'}), 400
            return render_template('add_note.html', bindu_name=bindu_name)

        # create entry file
        timestamp = int(time.time())
        safe_title = re.sub(r'[^A-Za-z0-9_-]', '_', title)[:80]
        filename = f"{norm_name}_{session['username']}_{timestamp}_{safe_title}.md"
        entry_path = os.path.join(NOTES_ENTRIES_DIR, filename)
        with open(entry_path, 'w', encoding='utf-8') as ef:
            ef.write(f"# {title}\n\n")
            ef.write(f"_by {session['username']} on {time.ctime(timestamp)}_\n\n")
            ef.write(body)
            ef.write(f"\n\n[Original bindu](/bindu/{bindu_name})\n")

        # add link to index file for this note
        index_file = os.path.join(NOTES_DIR, f"{norm_name}.md")
        rel_link = f"/notes_entries/{filename}"
        with open(index_file, 'a', encoding='utf-8') as nf:
            nf.write(f"- [{title}]({rel_link}) by {session['username']} on {time.ctime(timestamp)}\n")

        # Commit the new files (entry + index) to git with a descriptive message
        try:
            commit_message = f"Add bindu entry for {bindu_name} by {session.get('username')} at {time.ctime(timestamp)}"
            ok, out = git_commit([entry_path, index_file], commit_message, author=session.get('username'))
        except Exception as e:
            ok, out = (False, str(e))

        # If this is an AJAX request, return JSON so the page can update dynamically
        if request.headers.get('X-Requested-With') == 'XMLHttpRequest':
            return jsonify({'status': 'ok' if ok else 'error', 'title': title, 'link': rel_link, 'git': out})

        if ok:
            flash('Note saved and committed', 'success')
        else:
            flash('Note saved but git commit failed: ' + str(out), 'warning')
        return redirect(url_for('bindu', bindu_name=bindu_name))

    return render_template('add_note.html', bindu_name=bindu_name)


@app.route('/bindu/create', methods=['POST'])
def create_bindu():
    """Create a new bindu (admin only)."""
    if session.get('role') != 'admin':
        return jsonify({'status': 'error', 'message': 'Forbidden'}), 403

    bindu_name = request.form.get('name', '').strip()
    markdown_content = request.form.get('markdown', '').strip()

    if not bindu_name:
        return jsonify({'status': 'error', 'message': 'Bindu name is required'}), 400

    # Normalize and check if already exists
    norm_name = normalize_unicode(bindu_name)
    if norm_name in note_map:
        return jsonify({'status': 'error', 'message': f'Bindu "{bindu_name}" already exists'}), 409

    # Create file in Sanskrit Archive
    archive_dir = os.path.join(VAULT_DIR, 'Sanskrit Archive')
    os.makedirs(archive_dir, exist_ok=True)
    
    filename = f"{bindu_name}.md"
    filepath = os.path.join(archive_dir, filename)
    rel_path = os.path.join('vault', 'Sanskrit Archive', filename)

    # Write the file
    try:
        with open(filepath, 'w', encoding='utf-8') as f:
            f.write(markdown_content if markdown_content else f"# {bindu_name}\n\n")
    except Exception as e:
        return jsonify({'status': 'error', 'message': str(e)}), 500

    # Update note_map
    note_map[norm_name] = filepath

    # Update vault_index.json
    try:
        with open(DB_PATH, 'r', encoding='utf-8') as db:
            index_data = json.load(db)
        if 'notes' not in index_data:
            index_data['notes'] = {}
        index_data['notes'][bindu_name] = rel_path
        with open(DB_PATH, 'w', encoding='utf-8') as db:
            json.dump(index_data, db, indent=2)
    except Exception as e:
        return jsonify({'status': 'error', 'message': f'Index update failed: {e}'}), 500

    # Git commit
    timestamp = int(time.time())
    commit_message = f"Create bindu {bindu_name} by {session.get('username')} at {time.ctime(timestamp)}"
    try:
        ok, out = git_commit([filepath, DB_PATH], commit_message, author=session.get('username'))
    except Exception as e:
        ok, out = (False, str(e))

    return jsonify({
        'status': 'ok' if ok else 'warning',
        'message': 'Bindu created' + ('' if ok else f' (git: {out})'),
        'url': url_for('bindu', bindu_name=bindu_name)
    })


@app.route('/bindu/<bindu_name>/edit', methods=['POST'])
def edit_bindu(bindu_name):
    # Only admins may edit
    if session.get('role') != 'admin':
        return jsonify({'status': 'error', 'message': 'Forbidden'}), 403

    norm_name = normalize_unicode(bindu_name)
    note_file = note_map.get(norm_name)
    if not note_file:
        return jsonify({'status': 'error', 'message': 'Bindu not found'}), 404

    new_md = request.form.get('markdown')
    if new_md is None:
        return jsonify({'status': 'error', 'message': 'No content provided'}), 400

    try:
        with open(note_file, 'w', encoding='utf-8') as nf:
            nf.write(new_md)
        timestamp = int(time.time())
        commit_message = f"Edit bindu {bindu_name} by {session.get('username')} at {time.ctime(timestamp)}"
        ok, out = git_commit([note_file], commit_message, author=session.get('username'))
    except Exception as e:
        return jsonify({'status': 'error', 'message': str(e)}), 500

    # Return rendered HTML for the updated content
    rendered_html, _, _ = get_note_content(bindu_name)
    return jsonify({'status': 'ok' if ok else 'error', 'git': out, 'html': rendered_html})

if __name__ == '__main__':
    app.run(debug=True)
