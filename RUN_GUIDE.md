# Secure Document Studio

A two-user PDF question-answering app with per-user document authorization.

## Requirements

- Docker Desktop running
- A Gemini API key in `.env`
- A PDF with selectable text

## First-time setup

1. Copy `.env.example` to `.env`.
2. Open `.env` and set:

```env
JWT_SECRET=use-a-long-random-secret
GOOGLE_API_KEY=your-gemini-api-key
GEMINI_CHAT_MODEL=gemini-3.6-flash
GEMINI_EMBEDDING_MODEL=models/gemini-embedding-001
GEMINI_TEMPERATURE=0.7
```

3. Start the complete application:

```powershell
docker compose up --build -d
```

4. Open the web app at http://localhost:5173.

Useful endpoints:

- Web app: http://localhost:5173
- API: http://localhost:8000
- API documentation: http://localhost:8000/docs
- Health check: http://localhost:8000/health

## Create an account and log in

The app does not use a shared default password. Each user creates their own account.

Example test accounts:

| User | Email | Password |
|---|---|---|
| User One | `user.one@example.com` | `TitanUserOne!2026` |
| User Two | `user.two@example.com` | `TitanUserTwo!2026` |

Passwords must be at least 10 characters. These accounts do not exist until you register them from the login screen.

To switch users:

1. Click **Sign out**.
2. Sign in with the other email and password.

## Upload a PDF

1. Sign in.
2. In **Add to your library**, choose a `.pdf` file.
3. Click **Upload PDF**.
4. Wait for the indexed chunk count confirmation.

Every uploaded document is connected to the uploading user in Neo4j with an ownership relationship. Its chunks are stored in Qdrant with the document ID.

## Ask questions

1. Enter a question in **Ask your library**.
2. Click **Ask**.
3. The API resolves allowed document IDs in Neo4j first.
4. Qdrant searches only chunks whose document IDs are authorized.
5. Gemini receives only those returned chunks.
6. The answer displays its authorized source documents.

## Verify two-user isolation

1. Register User One with `user.one@example.com` and `TitanUserOne!2026`.
2. Upload `Docker, Kuberneetes.pdf` while signed in as User One.
3. Ask a question and confirm the answer lists User One's document source.
4. Sign out.
5. Register User Two with `user.two@example.com` and `TitanUserTwo!2026`.
6. Upload the same PDF while signed in as User Two.
7. Ask the same question and confirm User Two sees their own document ID.
8. User Two must not see User One's document ID, and User One must not see User Two's document ID.

The same PDF uploaded by two accounts becomes two different owned documents with separate document IDs.

## Stop the application

```powershell
docker compose down
```

To remove all local database, graph, and vector data as well:

```powershell
docker compose down -v
```

The `-v` command deletes all registered users, uploaded document metadata, Neo4j authorization data, and Qdrant chunks.

## Troubleshooting

View service status:

```powershell
docker compose ps
```

View API logs:

```powershell
docker compose logs -f api
```

Rebuild after code or environment changes:

```powershell
docker compose up --build -d
```

If Gemini returns a model error, check that the embedding model is `models/gemini-embedding-001`, the chat model is `gemini-3.6-flash`, and `GOOGLE_API_KEY` has access to Gemini embedding and generation models.
