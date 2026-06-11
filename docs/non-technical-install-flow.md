# Non-Technical Install Flow

This is the target user journey for a public GitHub release.

## Step 1: Download

User opens the GitHub repository and clicks **Releases**.

Expected release assets:

- macOS Apple Silicon: `Postdoc-Dashboard_aarch64.dmg`
- macOS Intel: `Postdoc-Dashboard_x64.dmg`
- Windows: `Postdoc-Dashboard_x64-setup.exe`
- Linux: `Postdoc-Dashboard.AppImage`

User should not need to clone the repository.

## Step 2: Open The App

User opens the installer or app bundle.

Expected behavior:

- App starts the local backend automatically.
- App shows a setup checklist, not a blank dashboard.
- If the backend fails, the app shows a readable recovery screen.

## Step 3: Confirm Local Storage

The app explains:

- Data is stored on this computer.
- Uploaded files stay local.
- The user can open the storage folder from Settings.

No path editing is required.

## Step 4: Connect Quill

The app detects:

- Claude CLI
- Codex CLI
- Anthropic API key
- OpenAI API key

User chooses one:

- **Use Claude**
- **Use Codex**
- **Use API key**

The app runs a test prompt and shows success or a clear fix.

## Step 5: Add Profile Material

User uploads:

- CV
- optional transcript
- optional sample paper

The app indexes the files and offers profile autofill.

## Step 6: Start Dashboard

The user lands on Home with:

- profile status
- next recommended action
- Quill ready in the right rail

## Current Simulation Result

Today, the app passes the local developer desktop-shell test, but fails the
non-technical release test because public installers and bundled backend
sidecars are not yet implemented.
