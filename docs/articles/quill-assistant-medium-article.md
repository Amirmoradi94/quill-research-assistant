# Introducing Quill Assistant

## A local-first research assistant for professor discovery, academic outreach, documents, replies, and interview prep.

Academic outreach looks simple from the outside: find professors, read their work, write thoughtful emails, track replies, and prepare for conversations.

In practice, it becomes a scattered process spread across browser tabs, PDFs, spreadsheets, Gmail threads, old drafts, calendar reminders, university pages, and half-finished notes. The hard part is not only writing the email. The hard part is keeping the whole search coherent while every professor, document, reply, and deadline carries its own context.

Today, I am sharing Quill Assistant, a local-first desktop app for graduate students, postdoctoral applicants, and early-career researchers who need one organized workspace for the academic research-position search.

Quill Assistant is available as a prerelease on GitHub:

https://github.com/Amirmoradi94/quill-research-assistant

## Academic outreach is a pipeline

When people talk about postdoc or graduate-school applications, they usually talk about the visible outputs: the CV, the research statement, the cover letter, and the email.

But the real workflow is larger than that.

Each professor has a research profile, recent papers, a possible fit angle, an institution, a lab, a funding context, an email address, a status, a draft, attachments, possible follow-up dates, and eventually a reply or interview. Multiply that by 30, 60, or 100 potential matches and the process starts to look less like a writing task and more like a lightweight CRM for academic opportunity.

Most applicants manage this with whatever is nearby: a spreadsheet, a folder of PDFs, a notes app, Gmail search, and memory. That works for a small number of targets. It becomes fragile when the search gets serious.

The first idea behind Quill is simple: academic outreach should be treated as a visible pipeline, not as a messy folder.

## Every researcher ends up building one

Almost every researcher I know has some version of this system.

Some keep a spreadsheet with names, links, email status, and comments. Some build elaborate Notion boards. Some use Zotero collections, Gmail labels, and calendar reminders. Some keep everything in a text file until it becomes too large to trust.

These systems usually grow reactively. First you need a list of professors. Then you need a way to remember who is relevant. Then you need email drafts. Then someone replies. Then you need to prepare for a meeting. Then you realize the original spreadsheet has no place for documents, interview notes, funding calls, or the actual reasoning behind each match.

That is the gap Quill Assistant is designed to fill.

It does not try to replace judgment. It does not try to mass-send generic emails. It gives the applicant a structured workspace for doing the work carefully.

## What Quill Assistant does

Quill Assistant brings the main pieces of a research-position search into one desktop app:

- Build a structured applicant profile from a CV, research interests, publications, skills, and target-position preferences.
- Upload CVs, research statements, transcripts, papers, and cover-letter templates into local storage.
- Discover professor candidates and score fit against the applicant's research profile.
- Review research angles, evidence, hiring signals, and match rationale before adding a professor to the pipeline.
- Track professors from draft to sent, replied, interview, offer, rejected, or skipped.
- Generate and redraft outreach emails using the user's own Codex or Claude Code account.
- Batch-review drafts before sending and optionally send through Gmail.
- Track replies, follow-ups, calendar items, grants, and interview preparation.

The point is not to make outreach faster at any cost. The point is to make the process more legible, so the applicant can spend more attention on fit, evidence, and tone.

## Candidate discovery that starts from fit

The discovery workflow starts with the applicant, not with a generic keyword search.

Quill uses the applicant profile, uploaded documents, and research interests to look for professor candidates. It can summarize why a candidate may be relevant, assign a match score, surface research angles, and preserve evidence so the applicant can decide whether the person belongs in the outreach pipeline.

That review step matters.

Academic outreach is easy to damage with volume. A professor should not enter the pipeline just because a search result matched a keyword. The applicant needs to know why the match makes sense, what paper or lab direction supports it, and what kind of email would be respectful.

Quill is built around that triage loop: discover, inspect, accept, skip, or save for later.

## A professor pipeline instead of a spreadsheet

Once a candidate becomes a target, they move into the professor pipeline.

This view is the operational center of the search. It shows who is active, who is high priority, what stage each person is in, whether contact information is ready, and what needs to happen next.

The pipeline model is deliberately simple. Academic applications already contain enough uncertainty. The interface should answer practical questions quickly:

- Who should I draft for next?
- Which emails are ready to review?
- Who replied?
- Who needs a follow-up?
- Which professor do I need to prepare for?
- Which documents should be attached?

By keeping that state explicit, Quill reduces the context switching that usually happens between spreadsheets, email, notes, and local files.

## Quill, the assistant inside the app

Quill is not just a blank chat box attached to a dashboard.

The assistant is connected to workflows: profile extraction, professor discovery, professor research, draft generation, reply drafting, interview preparation, and mock interview practice. That distinction matters because AI is most useful here when it knows which task it is performing and what structured output the app needs afterward.

For example, a drafting workflow is not just "write an email." It can use the applicant profile, professor context, selected documents, prior notes, and outreach status. An interview-prep workflow is not just "give me questions." It can work from the professor's research profile, the applicant's CV, and the existing outreach history.

The application layer gives the assistant memory, boundaries, and places to put the result.

## Local-first by design

Academic applications contain sensitive material: CVs, transcripts, draft emails, private replies, research plans, funding information, and sometimes personal constraints around location or immigration.

Quill keeps the database and uploaded documents on the user's computer by default. The desktop app stores its local data in the operating system's application-data folder. AI providers receive context only when the user explicitly runs a workflow.

This local-first architecture also changes how the app feels. The user is not asked to hand the whole search to a cloud workspace. The app behaves more like a personal research tool: local database, local documents, visible setup, and provider choice.

## Bring your own AI provider

Quill can use the user's installed Codex or Claude Code CLI account. It can also use API-key providers when configured.

This means Quill does not need to store a provider password. If Codex or Claude Code is installed and signed in on the machine, the setup screen can detect it and make it available for Quill workflows.

The current setup checks:

- local backend and database readiness
- local app data folder
- installed Claude Code and Codex CLI providers
- selected default Quill provider
- uploaded CV and basic profile fields

For non-technical users, that setup checklist is important. A local-first AI app should not assume the user wants to debug environment paths or backend logs. It should expose readiness clearly and make the next step obvious.

## Architecture

Quill Assistant is built as a desktop app with a local backend:

- Tauri provides the desktop shell.
- React and Vite power the frontend.
- FastAPI runs locally as the backend.
- SQLite stores the workflow data.
- Uploaded documents stay in local storage.
- A scraping sidecar supports professor-page research.
- Codex, Claude Code, Anthropic API, or OpenAI API can be selected as AI providers.

This architecture is intentionally pragmatic. The app needs to feel like a normal desktop tool, but it also needs a real workflow backend: document ingestion, professor records, drafts, replies, AI run history, and recoverable task state.

Every meaningful AI workflow leaves a trace in the run history. That makes failures easier to recover from and makes it possible to inspect what happened when an assistant run produced a draft, a candidate list, or interview material.

## What is available now

The current prerelease focuses on the core end-to-end workflow:

- local desktop packaging for macOS and Linux
- first-run setup checks
- provider detection for Codex and Claude Code
- local document upload
- applicant profile extraction
- candidate discovery and scoring
- professor pipeline tracking
- AI-assisted email drafting and redrafting
- Gmail sending support when configured
- reply tracking
- interview preparation
- mock interview practice

It is still a prerelease. The next layer is polish: broader platform packaging, stronger release signing and notarization, smoother onboarding, better non-technical setup, and deeper automation around replies, follow-ups, and preparation.

## Why I built it

I built Quill because I wanted the academic search process to feel less improvised.

Researchers are already doing difficult intellectual work: reading papers, understanding labs, positioning their experience, writing clearly, and preparing for serious conversations. The software around that process should reduce the administrative load, not add another place to lose context.

The goal is not to make outreach robotic. It is the opposite. By handling the repetitive structure around discovery, drafting, tracking, and preparation, Quill gives the applicant more room to be specific, careful, and human.

## Getting started

Quill Assistant is available as a prerelease on GitHub:

https://github.com/Amirmoradi94/quill-research-assistant

Download the desktop app, complete the setup checklist, connect Codex or Claude Code, upload a CV, and start turning academic outreach into a visible research pipeline.

If you try it, I would especially value feedback from graduate students, postdoctoral applicants, early-career researchers, and anyone who has managed a serious academic outreach process across spreadsheets, email, notes, and PDFs.

