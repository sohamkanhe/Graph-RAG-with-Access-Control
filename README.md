# Secure Enterprise RAG

A Dockerized reference implementation of the requested architecture:

1. **Neo4j authorization** resolves the signed-in user's permitted document IDs. New users start with no documents; each uploaded PDF is owned only by its uploader.
2. **Qdrant constrained search** queries chunks with a mandatory `document_id IN allowed_ids` filter.
3. **Gemini synthesis** receives only the returned, authorized chunks.

PostgreSQL stores individual user accounts; React is the user-facing application. The browser never connects to Neo4j, Qdrant, PostgreSQL, or Gemini.

## Run

1. Copy `.env.example` to `.env` and set a strong `JWT_SECRET`. `GOOGLE_API_KEY` is optional for local deterministic retrieval and extractive answers; add it for native Google Gemini embeddings and synthesis.
2. Run `docker compose up --build`.
3. Open http://localhost:5173, create an account, then sign in.

The API is at http://localhost:8000 and Swagger documentation is at `/docs`.

## Demo authorization graph

The graph seed creates demo documents, but new users are not granted those documents. Uploaded documents are connected to the uploader with `(:User)-[:OWNS]->(:Document)`:

- `doc_101` — Titan Deployment Risk Register
- `doc_205` — Titan Rollback Runbook

Access is modeled as `(:User)-[:MEMBER_OF]->(:Department)-[:CAN_READ]->(:Document)` and `(:User)-[:TEMPORARY_ACCESS {expires_at}]->(:Document)`. Edit the graph in Neo4j or extend the admin endpoints as the authorization model evolves.

## Security properties

- JWT identity is verified at the API boundary.
- The server, not the client, constructs the Qdrant access filter.
- Qdrant results are defense-in-depth checked against Neo4j's allowed IDs.
- Gemini gets only chunk text returned after authorization.
- No source context is stored in browser state beyond the returned citations.

For production, add refresh-token rotation, rate limiting, email verification, secret management, TLS, migrations, audit storage, and a connection pool/cache for authorization traversals.
