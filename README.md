# Bindu — A Browser for the Mandalic Hypertext

![Bindu Logo](static/logo.png)

**Bindu** is a Flask-based web application that serves as a *mandalic hypertext browser* — a knowledge-base system for exploring interconnected concepts as discrete nodes (bindus). It was originally developed by [Vimarsha Foundation](https://vimarshafoundation.org/) to facilitate the study of Sanskrit philosophical concepts within the [Sarvāmnāya](https://www.vimarshafoundation.org/tradition) tradition.

Each note in the vault is a Markdown file. Notes are linked together using `[[wiki-style]]` links, and the application automatically builds backlink and forward-link graphs, tag indexes, and a search interface. Authenticated users can add annotations to any concept node, and administrators can edit the vault content directly through the browser.

---

## Features

- **Mandalic graph navigation** — explore forward links and backlinks between concepts
- **Full-text search** with autocomplete
- **Tag-based browsing** — tag any note with `#tag` and browse by topic
- **Note annotations** — logged-in users can add personal notes to any concept
- **Admin editing** — administrators can edit vault content in-browser
- **Git-backed versioning** — every save is committed to the local git repository, with a full diff viewer
- **Private notes** — notes tagged `#private` are hidden from unauthenticated visitors

---

## Requirements

- Python 3.8 or newer
- `git` available on `PATH` (used for version control of vault content)

---

## Installation

### Linux

```bash
# 1. Clone the repository
git clone https://github.com/lyrashmi/bindu.git
cd bindu

# 2. Create and activate a virtual environment (recommended)
python3 -m venv .venv
source .venv/bin/activate

# 3. Install Python dependencies
pip install -r requirements.txt
```

### macOS

```bash
# 1. Clone the repository
git clone https://github.com/lyrashmi/bindu.git
cd bindu

# 2. Create and activate a virtual environment (recommended)
python3 -m venv .venv
source .venv/bin/activate

# 3. Install Python dependencies
pip install -r requirements.txt
```

> **Note for macOS users:** if `python3` is not found, install it via [Homebrew](https://brew.sh/):
> ```bash
> brew install python
> ```

---

## Running the Application

```bash
# Make sure the virtual environment is active first
source .venv/bin/activate   # Linux / macOS

# Start the development server
python app.py
```

By default Flask runs on **http://127.0.0.1:5000**. Open that URL in your browser.

For a production deployment, use a WSGI server such as [Gunicorn](https://gunicorn.org/):

```bash
pip install gunicorn
gunicorn app:app
```

---

## Vault Structure

The knowledge base lives in the `vault/` directory. Each Markdown file becomes a browsable concept node. You can organise files in subdirectories — the application discovers them automatically.

```
vault/
└── Sanskrit Archive/
    ├── Abhyāsa (अभ्यास).md
    [...]
    ├── Pañcapretāḥ (पञ्चप्रेताः).md
    └── Vairāgya (वैराग्य).md
```

### Linking between notes

Use `[[Note Title]]` inside any Markdown file to create a hyperlink to another note. Aliases are supported with `[[Note Title|Display Text]]`. Embed images with `![[image.png]]`.

### Tags

Add `#tag` anywhere in a note to make it discoverable under `/tag/<tag>`.

### Private notes

Add `#private` to a note to restrict it to logged-in users.

---

## Authentication

A `users.json` file is created automatically on first run with a set of default accounts. Edit that file to manage users, passwords, and roles (`admin` or `student`).

> ⚠️ **Security notice:** Before deploying to a public server you **must**:
> - Change `app.secret_key` in `app.py` to a long, randomly generated value.
> - Update or remove the default credentials in `users.json`.
>
> Leaving the defaults in place allows anyone who knows them to gain admin access to your instance.

---

## Project Structure

```
bindu/
├── app.py              # Flask application
├── requirements.txt    # Python dependencies
├── vault/              # Markdown knowledge-base files
├── notes/              # Per-concept notes index files (auto-generated)
├── notes_entries/      # User annotation entries (auto-generated)
├── static/             # CSS, logos and other static assets
├── templates/          # Jinja2 HTML templates
└── users.json          # User accounts (auto-generated on first run)
```

---

## License

© [Vimarsha Foundation](https://vimarshafoundation.org/). All rights reserved.

# trigger
