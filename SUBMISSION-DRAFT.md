# BountyDesk — Devpost submission description (DRAFT, do not submit yet)

Submission needs the author's under-2-minute video (recorded on camera by the author) and final go-ahead. Deadline: 11 Jan 2027, 23:00 WIB.

## Title

BountyDesk — an open agentic website for security research

## Description (draft)

BountyDesk is a public research desk for independent bug-bounty hunters, built from real triage work. The human-facing site is a living desk: a program-triage table (which bounty programs are live, free, and open to a new researcher, and what gates they carry), a checklist library (program triage, PoC verification, safe-testing rules, contract audit), and a log of closed findings with the lesson each one taught.

Agentified on top of it, the site publishes a network of three security agents that any visitor — human or agent — can discover from the manifest at agent-manifest.json (also at .well-known/awww.json) and talk to in the browser: a coordinator that routes questions, a triage specialist that walks a program against the checklist and returns PASS / CAUTION / FAIL with the exact gates, and a PoC specialist that checks whether a finding's evidence proves it or lists what is missing. The agents answer only from the site's own data and read-only public sources through registered site actions; they never invent findings, never touch keys, and never run payloads. The one write action saves the visitor's own triage note to their browser's localStorage — nothing leaves the browser.

Because the agentic web is about trust as much as discovery, BountyDesk demonstrates peer interaction honestly: before it asks another agent site anything, it asks Agent Atlas — an independent directory and trust checker — to check that site, with the visitor's consent on a card first. The peer runs in the visitor's browser on the visitor's key and never receives the key. The whole site is static (HTML + CSS + vanilla JavaScript) on GitHub Pages, the network and its instructions are public and auditable, and inference is visitor-funded bring-your-own-key, so the entry costs the author nothing.

## What to attach at submission time

- Public site URL: https://feriandi02.github.io/bountydesk/ (after the repo is created and Pages is enabled)
- Repo: https://github.com/feriandi02/bountydesk (public, MIT)
- Video: under 2 minutes on YouTube (public) — footage of the project running in a browser + the author explaining it on camera (not AI-generated). Record 23–29 Dec.
- Screenshots of the website (at least 1).
- Optional: Otari account email + one–two sentences on an Otari problem/improvement (Otari is the default router).

## Notes for the author

- GitHub Pages cannot send Access-Control-Allow-Origin headers, so other sites cannot fetch this network's files cross-origin; the site still fully works for visitors and can still call Agent Atlas. If the judges' interop check needs inbound CORS, the site would need a host with header control (Cloudflare Pages / Netlify) — a decision for the author before submitting.
- The contract-audit agent (live BSC read-only lookup) is deferred to a later milestone; the launch roster is coordinator + triage + PoC.
- Re-pull the spec repo and re-run the 7 interop checks before submitting; re-verify the Agent Atlas peer.
