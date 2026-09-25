# Graph-RAG with Access Control (Secure Enterprise Document Studio)

A production-grade, multi-tenant Retrieval-Augmented Generation (RAG) platform with **Graph-based Access Control (Graph-RAG)**. It enforces fine-grained document security permissions using Neo4j before querying vector embeddings in Qdrant, ensuring users can only retrieve and synthesize answers from documents they are explicitly authorized to access.

---

## 🌟 Key Features

- **Fine-Grained Graph Authorization**: Uses Neo4j to resolve user, role, department, and direct document permissions before vector search.
- **Strict Vector Filtering**: Injects authorized document IDs directly into Qdrant search filters (`document_id IN allowed_ids`), preventing data leakage at the vector layer.
- **Google Gemini & LangChain Integration**:
  - **Chat Model**: `gemini-3.6-flash` (temperature `0.7`) for concise, source-grounded LLM synthesis.
  - **Embeddings**: `models/gemini-embedding-001` (768 dimensions) for semantic document and query vectorization.
- **Multi-Tenant Administration**:
  - Admin console for indexing PDFs, managing documents, and assigning/revoking access by user email.
  - Individual user knowledge desks restricted strictly to authorized documents.
- **Rich Markdown Formatting & Citations**: Frontend parses markdown output into bold titles, bullet lists, and inline document citation badges (`[doc_id]`).
- **Fully Containerized Architecture**: Multi-container setup with Docker & Docker Compose.

---

## 🛠️ Technologies Used

| Layer | Technologies & Tools |
| :--- | :--- |
| **Frontend** | React 18, TypeScript, Vite, Nginx, Custom Markdown Formatter, Dark Theme CSS3 |
| **Backend API** | Python 3.12, FastAPI, Uvicorn, PyPDF, Pydantic v2, PyJWT |
| **Graph Database** | Neo4j 5 (Cypher Queries for ABAC / RBAC Graph Authorization) |
| **Vector Database** | Qdrant v1.13 (HNSW Vector Indexing with Cosine Distance & Payload Filters) |
| **Relational Database** | PostgreSQL 16 (SQLAlchemy ORM for User Accounts & Passlib bcrypt hashing) |
| **AI / LLM Framework** | LangChain (`langchain-google-genai`), Google Gemini API |
| **Orchestration** | Docker & Docker Compose |

---

## 🏗️ Architecture & How It Works

```
┌─────────────────┐       1. Authenticate (JWT)       ┌─────────────────┐
│   React Client  │ ─────────────────────────────────> │   FastAPI API   │
└─────────────────┘                                    └────────┬────────┘
        │                                                       │
        │ 2. Ask Question                                       │ 3. Resolve Authorized Doc IDs
        ▼                                                       ▼
┌─────────────────┐                                    ┌─────────────────┐
│  Search Endpoint│                                    │   Neo4j Graph   │
└────────┬────────┘                                    └────────┬────────┘
         │                                                      │
         │ 4. Search Vector DB (document_id IN allowed_ids)     │ Returns allowed_ids
         ▼                                                      │
┌─────────────────┐ <───────────────────────────────────────────┘
│  Qdrant Vector  │
└────────┬────────┘
         │
         │ 5. Returns authorized text chunks
         ▼
┌─────────────────┐ 6. Synthesize Answer
│  Google Gemini  │ ───────────────────────> Formatted Markdown Answer + Citations
└─────────────────┘
```

1. **Authentication**: The user logs in and receives a JWT token containing their user ID and tenant ID.
2. **Graph Resolution**: When a question is submitted, FastAPI queries Neo4j to find all document IDs the user is authorized to read via direct access, role, department, or non-expired temporary access.
3. **Constrained Retrieval**: FastAPI performs similarity search in Qdrant with a mandatory filter: `tenant_id == tenant` AND `document_id IN allowed_ids`. Un-authorized chunks are never fetched or exposed to the model.
4. **Grounded Synthesis**: Retrieved chunks are passed to `gemini-3.6-flash` through LangChain. Gemini is prompted to generate concise answers and cite source document IDs.

---

## 🚀 Getting Started

### Prerequisites

- **Docker Desktop** installed and running.
- A **Google Gemini API Key** (obtained from [Google AI Studio](https://aistudio.google.com/)).

### Configuration Setup

1. Copy `.env.example` to `.env`:
   ```bash
   cp .env.example .env
   ```

2. Open `.env` and set your credentials:
   ```env
   POSTGRES_DB=rag_auth
   POSTGRES_USER=rag_user
   POSTGRES_PASSWORD=change-me-in-production
   JWT_SECRET=use-a-long-random-secret-key-2026

   ADMIN_EMAIL=admin@example.com
   ADMIN_PASSWORD=AdminTitan!2026
   ADMIN_DISPLAY_NAME=System Admin

   SEED_USER_ONE_EMAIL=user.one@example.com
   SEED_USER_ONE_PASSWORD=TitanUserOne!2026

   SEED_USER_TWO_EMAIL=user.two@example.com
   SEED_USER_TWO_PASSWORD=TitanUserTwo!2026

   GOOGLE_API_KEY=your_google_gemini_api_key_here
   GEMINI_CHAT_MODEL=gemini-3.6-flash
   GEMINI_EMBEDDING_MODEL=models/gemini-embedding-001
   GEMINI_TEMPERATURE=0.7
   CORS_ORIGINS=http://localhost:5173
   ```

---

## 🏃 How to Run

### Start All Services

Run the following command to build and launch the containers in background mode:

```bash
docker compose up --build -d
```

### Access Ports & Services

- **Web Application**: http://localhost:5173
- **FastAPI Backend**: http://localhost:8000
- **Interactive API Docs (Swagger UI)**: http://localhost:8000/docs
- **Neo4j Browser**: http://localhost:7474 (Username: `neo4j`, Password: `neo4j-local-password`)

### Stop Services

To stop all running containers:

```bash
docker compose down
```

To stop containers **and clear all database/graph/vector volumes**:

```bash
docker compose down -v
```

---

## 👥 Default Accounts

| Role | Email | Password |
| :--- | :--- | :--- |
| **System Administrator** | `admin@example.com` | `AdminTitan!2026` |
| **User One** | `user.one@example.com` | `TitanUserOne!2026` |
| **User Two** | `user.two@example.com` | `TitanUserTwo!2026` |

---

## 🧪 Step-by-Step Testing & Verification

1. **Sign in as Admin**:
   - Go to http://localhost:5173 and log in with `admin@example.com` / `AdminTitan!2026`.
2. **Upload PDF 1 (Docker PDF)**:
   - Enter `Docker, Kuberneetes` as the document name.
   - Choose your Docker PDF and click **Upload PDF**.
   - Click the uploaded document row, enter `user.one@example.com`, click **Add user**, and save access.
3. **Upload PDF 2 (RAG & Embedding PDF)**:
   - Enter `Rag , embedding` as the document name.
   - Choose your RAG/Embedding PDF and click **Upload PDF**.
   - Click the uploaded document row, enter `user.two@example.com`, click **Add user**, and save access.
4. **Test User One Isolation**:
   - Sign out of Admin and sign in as `user.one@example.com` / `TitanUserOne!2026`.
   - Ask *"What is docker?"* $\rightarrow$ Returns detailed answer from Docker PDF with citations.
   - Ask *"What is embedding?"* $\rightarrow$ Returns *"No authorized documents matched this request."*
5. **Test User Two Isolation**:
   - Sign out and sign in as `user.two@example.com` / `TitanUserTwo!2026`.
   - Ask *"What is docker?"* $\rightarrow$ Returns *"I am sorry, but the provided authorized sources do not contain information about Docker."*
   - Ask *"What is embedding?"* $\rightarrow$ Returns detailed answer from RAG Embedding PDF with citations.

---

## 🛡️ Security Features

- **No Client Data Leakage**: The client browser never communicates directly with databases or LLM APIs; all interactions pass through the API gateway.
- **Server-Side Access Filtering**: Allowed document ID resolution is strictly enforced in Neo4j and injected into Qdrant by the backend.
- **Zero Hallucination Grounding**: Prompt engineering instructs Gemini to answer only using authorized context and to cite document IDs.
- **Strict Role Boundaries**: Only administrative accounts can access PDF upload and user permission management endpoints.
