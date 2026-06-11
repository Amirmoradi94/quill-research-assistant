# Quill Research Assistant

Quill Research Assistant is a local-first desktop app for graduate students and
early-career researchers managing professor discovery, research-position
outreach drafts, documents, grants, interviews, and follow-ups.

It is designed to run on your own computer. Your database and uploaded documents
stay local unless you choose to connect an AI provider.

## For Non-Technical Users

The intended install path is:

1. Open the project **Releases** page on GitHub.
2. Download the installer for your operating system.
3. Open **Quill Research Assistant**.
4. Follow the in-app setup checklist.
5. Choose Claude or Codex for Quill, the built-in research assistant.

Current status: the desktop app foundation is implemented, but public installers
are not ready yet. Until the first release is published, this repository still
requires developer setup.

## What The App Helps With

- Build and maintain your applicant profile.
- Upload CVs, transcripts, papers, and cover letter templates.
- Discover professor candidates for Master's, PhD, and postdoctoral research positions.
- Track professor pipeline status from discovery to sent emails and replies.
- Generate and review outreach drafts.
- Track grants, calendar events, and interview prep.
- Use Quill with either Claude CLI or Codex CLI.

## First-Run Setup Checklist

When the desktop installer is ready, the app should guide you through:

- Confirming where local data will be stored.
- Detecting Claude CLI and Codex CLI.
- Choosing the default Quill provider.
- Testing the provider connection.
- Uploading your CV.
- Optionally connecting Gmail for sending drafts and checking replies.

## Developer Setup

Use this only if you are building or contributing to the app.

Backend:

```bash
scripts/start_backend_local.sh
```

Frontend:

```bash
npm --prefix web run dev -- --host 0.0.0.0 --port 5173
```

Open:

```text
http://localhost:5173
```

Desktop dev shell:

```bash
cd web
npm run desktop:dev
```

The desktop dev shell requires Rust/Cargo and Node 20-24. Node 25 is not
recommended for this project.

## Local Data

Browser/developer mode stores data in:

```text
dashboard/data
```

Desktop mode stores data in the operating system app-data folder:

- macOS: `~/Library/Application Support/QuillResearchAssistant`
- Windows: `%APPDATA%/QuillResearchAssistant`
- Linux: `$XDG_DATA_HOME/QuillResearchAssistant` or `~/.local/share/QuillResearchAssistant`

Existing desktop installs that already have a `PostdocDashboard` data folder
continue to use it for compatibility.

## Desktop Packaging Status

Implemented:

- Tauri desktop shell scaffold.
- Desktop-safe data paths.
- Local FastAPI backend mode.
- Claude/Codex provider detection.
- Quill provider selector.
- AI run recovery and retry support.

Remaining before non-technical release:

- Bundle the Python backend as a sidecar binary.
- Add first-run setup wizard.
- Build GitHub Release installers.
- Add code signing/notarization for macOS and signing for Windows.
