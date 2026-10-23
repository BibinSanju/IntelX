# 🚀 IntelX: The Ultimate Code Learning Platform

Welcome to **IntelX**, an intelligent, self-updating coding platform built to provide developers with a comprehensive environment to practice algorithms, system design, and theory. 

This project was built for the hackathon and features a fully decoupled frontend and backend, a live code execution engine, and an automated scraping pipeline that continuously imports questions from top competitive programming platforms.

---

## 🌐 Live Demo

You don't need to run this locally to experience it! The project is fully deployed in the cloud:
- **Frontend App**: [https://intelxf.vercel.app](https://intelxf.vercel.app) (Deployed on Vercel)
- **Backend API**: Deployed on Render
- **Code Executor Engine**: Custom Dockerized Engine deployed on Render
- **Database**: Supabase PostgreSQL

---

## ⭐ Highlighted Features (As Requested by Judges)

### 1. 📥 Universal Exporter (XML, CSV, TXT)
The judges requested an **XML Downloader**, so we built a robust Export engine. From the Export page, administrators can seamlessly download the entire database of programming questions in three different formats:
- **XML Download**: Fully structured XML tree of questions.
- **CSV Download**: Spreadsheet-ready data for analytics.
- **TXT Download**: Clean, readable text format.

### 2. 🤖 Automated Web Scrapers (LeetCode & CSES)
We built a robust, Python-based scraping pipeline that pulls real problems directly into our platform. 
- **CSES Scraper**: Dynamically crawls `cses.fi`, converts problem pages to structured Markdown, and submits them to the staged AI pipeline.
- **Company Tags Automation**: We dynamically fetch company tags (Google, Meta, Apple, etc.) and tag them to questions in our database so users can filter by company.
- **GitHub Actions Integration**: `.github/workflows/nightly_scraper.yml` queues fresh problems through the deployed backend every night.

### 3. 🧠 AI Theory Grader
Instead of just running code, our platform features an AI evaluation engine powered by **Llama 3** (via Groq). When users submit answers to system design or theory questions, the AI grades the answer based on a hidden scoring rubric and provides a score out of 100 with detailed feedback!

---

## 🏗️ Architecture & How It Works

- **Frontend**: Built with React, Vite, and TypeScript. It uses Axios to communicate with the backend and features a dynamic split-pane code editor.
- **Backend**: Built with Hono (a blazing fast web framework) and Node.js. It manages authentication, routing, and AI evaluation.
- **Database Layer**: We use **Prisma ORM** connecting to a **Supabase (PostgreSQL)** database. We heavily utilize Supabase's direct connection for our Python data seeders and connection pooling for our high-traffic backend.
- **Execution Engine**: We built a custom code execution server (`executor/server.js`) that runs inside a secured Linux Docker container to compile and run C++, Python, Java, and JavaScript safely.

---

## 💻 Running it Locally (For Judges)

If you'd like to test the repository on your local machine, the process is seamless.

### Prerequisites
- Node.js (v18+)
- Python 3.10+ (For scrapers)

### 1. Setup the Backend
```bash
cd backend
npm install
# Create a .env file with DATABASE_URL, DIRECT_URL, GOOGLE_API_KEY (or GEMINI_API_KEY), and GROQ_API_KEY
# Optional model overrides: GEMINI_MODEL=gemini-3.8-flash and GROQ_MODEL=openai/gpt-oss-120b
npx prisma generate
npx prisma db push
npm run dev
```
*(Backend runs on `http://localhost:3000`)*

### 2. Setup the Frontend
```bash
cd frontend
npm install
# Create a .env file with VITE_API_BASE=http://localhost:3000
npm run dev
```
*(Frontend runs on `http://localhost:5173`)*

### 3. Running the Scrapers Manually (Optional)
The scrapers run automatically via GitHub Actions in the cloud, but you can test them locally:
```bash
cd scraper
pip install -r requirements.txt
python cses_scraper.py
python seed_companies.py
```

### Question ingestion and LeetCode enrichment

The feeder accepts a remembered problem statement plus optional topic tags and hints. These are retained as source evidence and used during reconstruction.

All coding-problem scrapers now use one provider-isolated pipeline:

```text
Source HTML
  -> BeautifulSoup (scripts/styles removed; headings, lists, code and examples become Markdown)
  -> POST /api/ingest (no provider keys leave the backend)
  -> Google AI Studio / Gemini (structured summary, requirements, inferred hints, tags, search query)
  -> Groq (formal problem reconstruction, LeetCode matching, solution/test generation and repair)
  -> sandbox verification
  -> faculty staging queue
```

`GOOGLE_API_KEY` takes precedence over `GEMINI_API_KEY`; `GOOGLE_AI_STUDIO_API_KEY` is also accepted as a project-specific alias. The Gemini model defaults to `gemini-3.8-flash` and can be changed with `GEMINI_MODEL`. Groq continues to use only `GROQ_API_KEY`, with `GROQ_MODEL` as its optional model override. Keys are read only by the backend and must not be exposed through Vite variables or scraper payloads.

If Gemini is unavailable, the question stops at `FAILED_PREPROCESSING`; it does not silently skip into Groq with unprepared input. A missing or failed Groq stage uses `FAILED_AI`. The Google brief and provider/model metadata are stored in `StagedQuestion.preprocessing` for auditability.

### Rate-limited API key pools

The backend supports multiple authorized credentials without exposing them to Python scrapers or the browser. Store the pools as deployment secrets or environment variables—not in `keys.json` and never in Git:

```env
GOOGLE_API_KEYS=["google-key-01","google-key-02"]
GROQ_API_KEYS=["groq-key-01","groq-key-02"]
```

The existing singular `GOOGLE_API_KEY`, `GEMINI_API_KEY`, and `GROQ_API_KEY` variables remain valid and are automatically merged into their corresponding pool. Duplicate keys are removed. Logs and `/health` expose only key counts and irreversible short hashes, never credential values.

This deployment assumes that every Google key belongs to a genuinely different Google project, so independent project ledgers are enabled by default:

```env
GOOGLE_QUOTA_SCOPE=per-project
```

One common Google free-tier limit profile is applied independently to every project key. Each project therefore has its own RPM/TPM/RPD/TPD counters and `429` cooldown, so a throttled project can rotate to another healthy project. Explicitly set `GOOGLE_QUOTA_SCOPE=shared` if keys ever come from the same project.

This deployment also expects one personal Groq key from each of 20 independent personal organizations:

```env
GROQ_QUOTA_SCOPE=per-organization
```

One common Groq free-tier profile is applied independently to every organization key. A `429` cools only that organization and rotates to the next healthy personal key. Set `GROQ_QUOTA_SCOPE=shared` if any keys belong to the same Groq account or organization, because Groq quotas are organization-level.

As of September 2026, the Gemini API rejects legacy standard keys; use current Google AI Studio authorization keys. See [Google's key migration guidance](https://ai.google.dev/gemini-api/docs/api-key). A complete non-secret template is available in `backend/.env.example`.

Keys from one Google project share its limits, and Groq limits apply at organization level. Therefore, adding keys from the same quota scope improves credential failover but does not multiply throughput. In shared mode the pool applies one aggregate safety budget and a `429` pauses the provider before retrying. In Google `per-project` and Groq `per-organization` modes, each independent quota owner has separate usage counters and cooldown. All modes round-robin healthy keys, disable credentials rejected with `401`/`403`, honor `Retry-After`, use exponential backoff with jitter, limit concurrency, and stop after bounded attempts instead of creating a retry storm.

Google's current limits vary by project, model, and tier, so periodically compare the active values from the [AI Studio rate-limit page](https://ai.google.dev/gemini-api/docs/rate-limits) with these settings. This deployment uses one common Gemini 3.8 Flash free-tier profile for all 20 projects, with roughly 10% safety headroom below the currently visible 5 RPM, 250,000 TPM, and 20 RPD values:

```env
GOOGLE_RPM=4
GOOGLE_TPM=225000
GOOGLE_RPD=18
GOOGLE_TPD=0
GOOGLE_CONCURRENCY=1
```

For the default Groq `openai/gpt-oss-120b` model, the [published free-plan limits](https://console.groq.com/docs/rate-limits) are currently 30 RPM, 1,000 RPD, 8,000 TPM, and 200,000 TPD. The application defaults to roughly 90% of those ceilings:

```env
GROQ_RPM=27
GROQ_RPD=900
GROQ_TPM=7200
GROQ_TPD=180000
GROQ_CONCURRENCY=1

# Whisper has a separate model quota and pool profile
GROQ_AUDIO_RPM=18
GROQ_AUDIO_RPD=1800
GROQ_AUDIO_CONCURRENCY=1

GOOGLE_MAX_ATTEMPTS=20
GROQ_MAX_ATTEMPTS=20
PROVIDER_MAX_QUEUE_WAIT_MS=120000
PROVIDER_BASE_COOLDOWN_MS=2000
```

A value of `0` disables only that local budget dimension; upstream limits and `429` cooldown handling still apply. In-memory counters are intentionally conservative rolling windows. If the backend is scaled to multiple replicas, replace the in-process limiter with a shared Redis-backed limiter so every replica uses the same quota ledger.

```http
POST /api/ingest
Content-Type: application/json
```

```json
{
  "raw_text": "Given an array, return the indices of two values that add to a target.",
  "source": "Student Interview",
  "tags": ["array", "hash table"],
  "hints": ["The interviewer asked for O(n)", "Use extra space"],
  "source_url": null,
  "external_id": null,
  "source_metadata": { "company": "Example Co", "round": "Technical" }
}
```

During Groq processing the backend searches LeetCode through `https://leetcode.com/graphql`, preferring the search query prepared by Gemini. A separate model check must identify a candidate with at least 72% confidence before LeetCode evidence is accepted. For an accepted match, the pipeline retrieves official topic tags and hints plus up to three highest-voted per-question solution/discussion posts. Discussion text is truncated, code and links are removed, and the result is treated as untrusted reference material. Failure to reach LeetCode does not block the normal curation pipeline.

The GraphQL URL and timeout can be overridden with `LEETCODE_GRAPHQL_URL` and `LEETCODE_TIMEOUT_MS`.

The nightly feeder scrapes a rotating, source-balanced theory batch from InterviewBit, JavaTPoint, and GeeksforGeeks. JavaTPoint's bounded registry covers DBMS, SQL, Oracle, MongoDB, operating systems, computer networks, cyber security, cloud computing, machine learning, artificial intelligence, data science, HTML, CSS, JavaScript, React, Angular, web development, Android/mobile development, software testing, manual and automation testing, Selenium, TestNG, DevOps, Git, Docker, Kubernetes, Jenkins, Ansible, and Terraform. Topic MCQ pages are included where a dedicated JavaTPoint quiz URL exists; explanations and examples attached to a question are retained, but ordinary tutorial paragraphs are not converted into fake questions.

The larger catalog is rotated by day and provider. A normal batch fetches no more than the number of source pages needed for the requested limit (capped at 12 successful pages), rather than crawling every registered page. If a provider host cannot be resolved or connected to, a per-run circuit breaker skips its remaining pages while the other providers continue. Each source failure is isolated, and historical alternative slugs are tried for topics such as networking, React, Angular, web development, mobile development, and QA.

All theory sources use the same BeautifulSoup-to-Markdown and `/api/ingest` path, marked with `source_metadata.content_type=theory`; JavaTPoint interview and quiz records additionally carry `source_metadata.content_kind`. Gemini prepares the evidence brief; Groq produces a reference answer, expected concepts and keywords, and a 100-point rubric. Theory items skip LeetCode matching and Python sandboxing, undergo duplicate detection, enter faculty staging, and export as Moodle essay questions.

Reddit is supported as an OAuth-only, explicitly approved source for student interview recollections. The default source set is `r/leetcode`, `r/cscareerquestions`, and `r/developersIndia`. The scraper searches the approved API at `https://oauth.reddit.com/r/{subreddit}/search`, retrieves up to three top-level discussion excerpts from `/r/{subreddit}/comments/{postId}`, omits author identity, filters NSFW/stickied/unrelated posts, and records the stable ID as `reddit:{postId}`. Gemini classifies each retained recollection as programming or theory before it enters the corresponding branch.

Reddit's [Responsible Builder Policy](https://support.reddithelp.com/hc/en-us/articles/42728983564564-Responsible-Builder-Policy) requires explicit approval. Reddit ingestion remains disabled unless `REDDIT_API_APPROVED=true` and approved `REDDIT_CLIENT_ID`, `REDDIT_CLIENT_SECRET`, and `REDDIT_USER_AGENT` values are configured. The system does not fall back to anonymous `.json` scraping.

Reddit content can also be imported without any automated Reddit request. Copy `scraper/reddit_manual.example.json`, paste the public post title/body and up to three useful comment excerpts, and keep the Reddit post ID and subreddit in the template. Validate the file first:

```bash
python scraper/manual_reddit_import.py path/to/reddit-post.json --dry-run
```

With the backend running, submit the validated record through the normal Gemini/Groq pipeline:

```bash
python scraper/manual_reddit_import.py path/to/reddit-post.json
```

The importer also accepts a locally saved standard Reddit thread JSON payload (`[post_listing, comment_listing]`). It never contacts Reddit, ignores author fields, retains no account identity, rejects deleted/NSFW/stickied/unrelated content, uses `reddit:{postId}` for idempotency, and sends accepted records to `POST /api/ingest`. Set `FEEDER_API_URL` or pass `--api-base` if the backend is not at `http://localhost:3000`.

Faculty screenshot ingestion is available at `POST /api/ingest/screenshots`; no frontend control is connected yet. The endpoint requires a faculty JWT in `Authorization: Bearer <token>` and multipart files under the `screenshots` field. A request may contain 1-6 genuine PNG, JPEG, or WebP images, with a 4 MB per-image and 12 MB combined limit. Optional text fields are `notes`, `tags`, `hints`, and `source_url`.

```bash
curl -X POST http://localhost:3000/api/ingest/screenshots \
  -H "Authorization: Bearer FACULTY_JWT" \
  -F "screenshots=@thread-1.png" \
  -F "screenshots=@thread-2.png" \
  -F "notes=Both screenshots belong to the same interview recollection" \
  -F "tags=graphs, shortest path"
```

Gemini Vision reads the screenshots in upload order, removes common account-identity and interface text, combines overlapping fragments, and returns an anonymous technical transcript with visible tags and hints. The server hashes the ordered image bytes for duplicate protection, discards the uploaded image bytes after extraction, stores only the transcript and non-identifying audit metadata, and queues the existing Gemini brief -> Groq curation -> programming/theory branch -> deduplication -> faculty staging process.

Faculty can also submit a free-form text recollection through `POST /api/ingest/text`; the frontend control is intentionally not connected yet. This JSON endpoint requires a faculty JWT and accepts `description` (required), plus optional `title`, `notes`, `tags`, `hints`, `content_type` (`auto`, `programming`, or `theory`), `source_url`, `external_id`, `company`, and `interview_round`.

```bash
curl -X POST http://localhost:3000/api/ingest/text \
  -H "Authorization: Bearer FACULTY_JWT" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Shortest path interview question",
    "description": "The student was asked to find the shortest path in a weighted graph.",
    "tags": ["Graphs", "Shortest Path"],
    "hints": ["All edge weights were non-negative"],
    "content_type": "programming",
    "company": "Example Company",
    "interview_round": "Technical round 2"
  }'
```

The server normalizes the description, creates a stable `faculty-text:` fingerprint for exact duplicate protection, records the submitting faculty ID and non-sensitive context, and queues the same Gemini brief -> Groq -> programming/theory -> semantic deduplication -> staging pipeline used by every other source.

Run coding, theory, and Reddit ingestion manually with `python scraper/nightly_feeder.py 10 8 4`, where the limits are LeetCode, total theory, and approved Reddit items respectively. Run only theory ingestion with `python scraper/theory_scraper.py 8`.
