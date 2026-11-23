---
name: agent-browser
description: Open a local or deployed web app with agent-browser. Use when a run drives a page, a session, or a headed window.
---

Read `agent-browser skills get core` before the first browser command. One `--session <name>` per cookie jar. Name the session with the first label of the host from `portless.urls`, so two checkouts do not share cookies.

Headless is the default. When a person is watching, use `--headed` and do not set a viewport. Do not guess a port or a hostname. Local origins come from `portless.urls`. A browser inside an agent-desktop guest uses the guest line. If that line says the guest is down, use the host URL.
