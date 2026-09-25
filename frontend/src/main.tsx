import { FormEvent, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'
import './admin.css'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000'
type User = { id: string; email: string; displayName: string; isAdmin?: boolean; is_admin?: boolean }
type Citation = { document_id: string; title: string; excerpt: string }
type Result = { answer: string; citations: Citation[]; authorized_document_count: number }
type AdminDocument = { id: string; title: string; user_emails: string[] }

async function api(path: string, options: RequestInit = {}, token?: string) {
  const response = await fetch(`${API_URL}${path}`, { ...options, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...options.headers } })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(body.detail || 'Request failed')
  return body
}

function parseMarkdownInline(text: string) {
  const regex = /(\*\*[^*]+\*\*|\*[^*]+\*|\[doc_[a-zA-Z0-9_-]+\]|\[Source:[^\]]+\])/g
  const parts: (string | JSX.Element)[] = []
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.substring(lastIndex, match.index))
    }
    const token = match[0]
    if (token.startsWith('**') && token.endsWith('**')) {
      parts.push(<strong key={match.index}>{token.slice(2, -2)}</strong>)
    } else if (token.startsWith('*') && token.endsWith('*')) {
      parts.push(<em key={match.index}>{token.slice(1, -1)}</em>)
    } else if (token.startsWith('[doc_') || token.startsWith('[Source:')) {
      parts.push(
        <span key={match.index} className="citation-tag">
          {token.slice(1, -1)}
        </span>
      )
    } else {
      parts.push(token)
    }
    lastIndex = regex.lastIndex
  }
  if (lastIndex < text.length) {
    parts.push(text.substring(lastIndex))
  }
  return parts
}

function FormattedAnswer({ text }: { text: string }) {
  if (!text) return null
  const blocks = text.split(/\n\s*\n/)

  return (
    <div className="formatted-answer">
      {blocks.map((block, bIdx) => {
        const lines = block.split('\n').map(l => l.trim()).filter(Boolean)
        if (lines.length === 0) return null

        const isList = lines.every(l => /^([\*\-\•]|\d+\.)\s+/.test(l))

        if (isList) {
          return (
            <ul key={bIdx} className="answer-list">
              {lines.map((line, lIdx) => {
                const cleanLine = line.replace(/^([\*\-\•]|\d+\.)\s+/, '')
                return <li key={lIdx}>{parseMarkdownInline(cleanLine)}</li>
              })}
            </ul>
          )
        }

        if (/^#{1,6}\s+/.test(lines[0])) {
          const headerText = lines[0].replace(/^#{1,6}\s+/, '')
          return (
            <h4 key={bIdx} className="answer-header">
              {parseMarkdownInline(headerText)}
            </h4>
          )
        }

        return (
          <p key={bIdx} className="answer-paragraph">
            {lines.map((line, lIdx) => (
              <span key={lIdx}>
                {parseMarkdownInline(line)}
                {lIdx < lines.length - 1 && <br />}
              </span>
            ))}
          </p>
        )
      })}
    </div>
  )
}

function App() {
  const [token, setToken] = useState(localStorage.getItem('rag_token') || '')
  const [user, setUser] = useState<User | null>(null)
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<Result | null>(null)
  const [uploadMessage, setUploadMessage] = useState('')
  const [adminUsers, setAdminUsers] = useState<User[]>([])
  const [documents, setDocuments] = useState<AdminDocument[]>([])
  const [selected, setSelected] = useState<AdminDocument | null>(null)
  const [assignedEmails, setAssignedEmails] = useState<string[]>([])
  const [newEmail, setNewEmail] = useState('')

  useEffect(() => {
    if (!token) return
    api('/auth/me', {}, token).then(account => {
      setUser(account)
      if (account.isAdmin) {
        api('/admin/users', {}, token).then(setAdminUsers).catch(() => {})
        api('/admin/documents', {}, token).then(setDocuments).catch(() => {})
      }
    }).catch(() => { localStorage.removeItem('rag_token'); setToken('') })
  }, [token])

  async function authenticate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(''); setLoading(true)
    const form = new FormData(event.currentTarget)
    try {
      const body = await api(`/auth/${mode}`, { method: 'POST', body: JSON.stringify({ email: form.get('email'), password: form.get('password'), ...(mode === 'register' ? { display_name: form.get('displayName') } : {}) }) })
      localStorage.setItem('rag_token', body.access_token); setToken(body.access_token); setUser(body.user)
    } catch (exception) { setError(exception instanceof Error ? exception.message : 'Could not authenticate') } finally { setLoading(false) }
  }

  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(''); setUploadMessage(''); setLoading(true)
    const form = event.currentTarget; const data = new FormData(form)
    try {
      const response = await fetch(`${API_URL}/admin/documents/upload`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: data })
      const body = await response.json(); if (!response.ok) throw new Error(body.detail || 'Upload failed')
      setUploadMessage(`${body.title} indexed securely (${body.chunk_count} chunks).`); setDocuments(await api('/admin/documents', {}, token)); form.reset()
    } catch (exception) { setError(exception instanceof Error ? exception.message : 'Upload failed') } finally { setLoading(false) }
  }

  async function ask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(''); setLoading(true); setResult(null)
    const query = String(new FormData(event.currentTarget).get('query') || '')
    try { setResult(await api('/search', { method: 'POST', body: JSON.stringify({ query }) }, token)) } catch (exception) { setError(exception instanceof Error ? exception.message : 'Search failed') } finally { setLoading(false) }
  }

  function addUser() {
    const email = newEmail.trim().toLowerCase()
    const valid = adminUsers.some(item => item.email === email && !item.isAdmin && !item.is_admin)
    if (!valid) { setError('Enter an existing normal user email'); return }
    if (!assignedEmails.includes(email)) setAssignedEmails([...assignedEmails, email])
    setNewEmail(''); setError('')
  }

  async function saveAccess() {
    if (!selected) return
    setLoading(true)
    try {
      const updated = await api(`/admin/documents/${selected.id}/users`, { method: 'POST', body: JSON.stringify({ user_emails: assignedEmails }) }, token)
      setSelected(updated); setDocuments(documents.map(item => item.id === updated.id ? updated : item)); setUploadMessage('User access saved.')
    } catch (exception) { setError(exception instanceof Error ? exception.message : 'Could not save user access') } finally { setLoading(false) }
  }

  async function deleteDocument(id: string) {
    if (!window.confirm('Delete this document and its indexed chunks?')) return
    await api(`/admin/documents/${id}`, { method: 'DELETE' }, token); setDocuments(documents.filter(item => item.id !== id)); setSelected(null)
  }

  function signOut() { localStorage.removeItem('rag_token'); setToken(''); setUser(null); setResult(null) }

  if (!user) return <main className="auth-shell"><section className="auth-card"><div className="mark">R</div><h1>RAG Application</h1><p className="muted">Sign in</p><form onSubmit={authenticate}>{mode === 'register' && <label>Full name<input name="displayName" required minLength={2} /></label>}<label>Email<input name="email" type="email" required /></label><label>Password<input name="password" type="password" minLength={10} required /></label>{error && <p className="error">{error}</p>}<button disabled={loading}>{loading ? 'Checking…' : mode === 'login' ? 'Sign in' : 'Create account'}</button></form><button className="link" onClick={() => setMode(mode === 'login' ? 'register' : 'login')}>{mode === 'login' ? 'New here? Create an account' : 'Already registered? Sign in'}</button></section></main>

  return <main><header><div className="brand"><div className="mark small">R</div><div><p className="eyebrow">RAG APPLICATION</p><h1>{user.isAdmin ? 'Admin console' : 'Knowledge Desk'}</h1></div></div><div className="user"><span>{user.displayName}</span><button className="link" onClick={signOut}>Sign out</button></div></header>
    {user.isAdmin ? (selected ? <section className="admin-panel document-detail"><button className="link" onClick={() => setSelected(null)}>← Back to documents</button><p className="eyebrow">DOCUMENT USERS</p><h2>{selected.title}</h2><p className="document-id">{selected.id}</p><p className="muted">Add a user by email. Delete removes that user’s access to this document.</p><div className="user-add-row"><input value={newEmail} onChange={event => setNewEmail(event.target.value)} placeholder="user@example.com" aria-label="User email to add" /><button type="button" onClick={addUser}>Add user</button></div><h3>Assigned users</h3><div className="user-list document-users">{assignedEmails.length ? assignedEmails.map(email => <div className="user-row" key={email}><span>{email}</span><button className="danger small-button" onClick={() => setAssignedEmails(assignedEmails.filter(item => item !== email))}>Delete</button></div>) : <p className="muted">No users assigned</p>}</div><button onClick={saveAccess} disabled={loading}>{loading ? 'Saving…' : 'Save user access'}</button>{uploadMessage && <p className="success">{uploadMessage}</p>}{error && <p className="error">{error}</p>}<button className="danger" onClick={() => deleteDocument(selected.id)}>Delete document</button></section> : <section className="admin-panel"><p className="eyebrow">ADMINISTRATOR CONTROLS</p><h2>Upload documents</h2><p className="muted">Upload first with no permissions. Click a document to manage its users.</p><form onSubmit={upload}><input name="document_name" placeholder="Document name" aria-label="Document name" required /><input name="file" type="file" accept="application/pdf,.pdf" aria-label="Choose a PDF" required /><button disabled={loading}>{loading ? 'Indexing…' : 'Upload PDF'}</button></form>{uploadMessage && <p className="success">{uploadMessage}</p>}{error && <p className="error">{error}</p>}<h3>Documents</h3><div className="document-list">{documents.map(item => <button className="document-row" key={item.id} onClick={() => { setSelected(item); setAssignedEmails(item.user_emails) }}><strong>{item.title}</strong><span>{item.user_emails.length} users assigned</span></button>)}</div></section>) : null}
    {!user.isAdmin && <section className="search-card"><p className="eyebrow">ASK YOUR LIBRARY</p><h3>What do you want to know?</h3><form onSubmit={ask}><input name="query" defaultValue="What are the deployment risks for Project Titan?" aria-label="Ask a question" required minLength={3} /><button disabled={loading}>{loading ? 'Searching…' : 'Ask'}</button></form>{error && <p className="error">{error}</p>}</section>}
    {!user.isAdmin && result && <section className="result"><div className="result-heading"><div><p className="eyebrow">ANSWER FROM YOUR SOURCES</p><h2>Here’s what I found</h2></div><span className="badge">{result.authorized_document_count} authorized documents</span></div><article><FormattedAnswer text={result.answer} /></article><h3>Sources used</h3><div className="citations">{result.citations.map(citation => <div className="citation" key={citation.document_id}><b>{citation.document_id}</b><strong>{citation.title}</strong><p>{citation.excerpt}</p></div>)}</div></section>}</main>
}

createRoot(document.getElementById('root')!).render(<App />)
