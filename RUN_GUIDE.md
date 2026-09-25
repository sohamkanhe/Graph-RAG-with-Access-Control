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

The default local administrator is `admin@example.com` with password `AdminTitan!2026`. The app also seeds two normal users: `user.one@example.com` / `TitanUserOne!2026` and `user.two@example.com` / `TitanUserTwo!2026`. Change these values in `.env` before sharing the app.

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

## Admin upload and permissions

Only the administrator uploads PDFs. Normal users cannot upload files. Enter a document name before selecting access.

1. Sign in as the administrator.
2. Choose a `.pdf` file in **Publish a protected document**.
3. Enter a document name and user emails, departments, and/or roles as comma-separated values.
4. Click **Publish PDF**.
5. Wait for the indexed chunk count confirmation.

The document is granted to the selected users, departments, and roles in Neo4j. Click a document in the admin list to view its permissions or delete it. Its chunks are stored in Qdrant with the document ID. Users appear in a list with a delete button; the administrator itself cannot be deleted.

## Ask questions

1. Enter a question in **Ask your library**.
2. Click **Ask**.
3. The API resolves allowed document IDs in Neo4j first.
4. Qdrant searches only chunks whose document IDs are authorized.
5. Gemini receives only those returned chunks.
6. The answer displays its authorized source documents.

## Verify two-user isolation

1. Register User One with `user.one@example.com` and `TitanUserOne!2026`.
2. Register User Two with `user.two@example.com` and `TitanUserTwo!2026`.
3. Sign in as the admin and publish `Docker, Kuberneetes.pdf` with only `user.one@example.com` in the user access field.
4. Ask the Docker question as User One and confirm an answer and citation appear.
5. Ask the same question as User Two and confirm `No authorized documents matched this request.`

Normal users cannot call the admin upload endpoint. Access is controlled by explicit user, department, and role grants.

For API-level group management, an admin can replace a user's memberships:

```http
POST /admin/users/{user_id}/groups
Authorization: Bearer <admin-token>
Content-Type: application/json

{"departments":["finance"],"roles":["reviewer"]}
```

Send empty arrays to revoke the user's department and role memberships.

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
