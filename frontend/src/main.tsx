import { FormEvent, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'
import './admin.css'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000'
type User = { id: string; email: string; displayName: string; isAdmin?: boolean; is_admin?: boolean }
type Citation = { document_id: string; title: string; excerpt: string }
type Result = { answer: string; citations: Citation[]; authorized_document_count: number }

type AdminDocument = { id: string; title: string; user_emails: string[]; departments: string[]; roles: string[] }
type UserDetail = { id: string; email: string; display_name: string; is_admin: boolean; departments: string[]; roles: string[]; direct_document_ids: string[]; all_allowed_documents: { id: string; title: string }[] }
type DepartmentSummary = { id: string; name: string; user_emails: string[]; document_ids: string[] }
type RoleSummary = { id: string; name: string; user_emails: string[]; document_ids: string[] }

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
  const [statusMessage, setStatusMessage] = useState('')

  // Admin section states
  const [adminTab, setAdminTab] = useState<'documents' | 'users' | 'departments' | 'roles'>('documents')
  const [documents, setDocuments] = useState<AdminDocument[]>([])
  const [adminUsers, setAdminUsers] = useState<User[]>([])
  const [departments, setDepartments] = useState<DepartmentSummary[]>([])
  const [roles, setRoles] = useState<RoleSummary[]>([])

  // Selected Item details for Admin
  const [selectedDoc, setSelectedDoc] = useState<AdminDocument | null>(null)
  const [docUsers, setDocUsers] = useState<string[]>([])
  const [docDepts, setDocDepts] = useState<string[]>([])
  const [docRoles, setDocRoles] = useState<string[]>([])

  const [selectedUser, setSelectedUser] = useState<UserDetail | null>(null)
  const [userDepts, setUserDepts] = useState<string[]>([])
  const [userRoles, setUserRoles] = useState<string[]>([])
  const [userDirectDocs, setUserDirectDocs] = useState<string[]>([])

  const [selectedDept, setSelectedDept] = useState<DepartmentSummary | null>(null)
  const [deptUsers, setDeptUsers] = useState<string[]>([])
  const [deptDocs, setDeptDocs] = useState<string[]>([])

  const [selectedRole, setSelectedRole] = useState<RoleSummary | null>(null)
  const [roleUsers, setRoleUsers] = useState<string[]>([])
  const [roleDocs, setRoleDocs] = useState<string[]>([])

  // Form Inputs
  const [newInputEmail, setNewInputEmail] = useState('')
  const [newDeptName, setNewDeptName] = useState('')
  const [newRoleName, setNewRoleName] = useState('')

  const loadAdminData = async (tok: string) => {
    try {
      const [docsData, usersData, deptsData, rolesData] = await Promise.all([
        api('/admin/documents', {}, tok),
        api('/admin/users', {}, tok),
        api('/admin/departments', {}, tok),
        api('/admin/roles', {}, tok),
      ])
      setDocuments(docsData)
      setAdminUsers(usersData)
      setDepartments(deptsData)
      setRoles(rolesData)
    } catch (e) {
      console.error(e)
    }
  }

  useEffect(() => {
    if (!token) return
    api('/auth/me', {}, token).then(account => {
      setUser(account)
      if (account.isAdmin) {
        loadAdminData(token)
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

  async function uploadDocument(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(''); setStatusMessage(''); setLoading(true)
    const form = event.currentTarget; const data = new FormData(form)
    try {
      const response = await fetch(`${API_URL}/admin/documents/upload`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: data })
      const body = await response.json(); if (!response.ok) throw new Error(body.detail || 'Upload failed')
      setStatusMessage(`"${body.title}" uploaded & indexed securely (${body.chunk_count} chunks).`)
      loadAdminData(token); form.reset()
    } catch (exception) { setError(exception instanceof Error ? exception.message : 'Upload failed') } finally { setLoading(false) }
  }

  async function ask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(''); setLoading(true); setResult(null)
    const query = String(new FormData(event.currentTarget).get('query') || '')
    try { setResult(await api('/search', { method: 'POST', body: JSON.stringify({ query }) }, token)) } catch (exception) { setError(exception instanceof Error ? exception.message : 'Search failed') } finally { setLoading(false) }
  }

  // --- Document Access Handlers ---
  const saveDocPermissions = async () => {
    if (!selectedDoc) return
    setLoading(true); setError(''); setStatusMessage('')
    try {
      const updated = await api(`/admin/documents/${selectedDoc.id}/permissions`, {
        method: 'POST',
        body: JSON.stringify({ user_emails: docUsers, departments: docDepts, roles: docRoles })
      }, token)
      setSelectedDoc(updated)
      setStatusMessage('Document permissions saved.')
      loadAdminData(token)
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed to save document permissions') } finally { setLoading(false) }
  }

  const deleteDocument = async (id: string) => {
    if (!window.confirm('Delete this document and its indexed vectors?')) return
    await api(`/admin/documents/${id}`, { method: 'DELETE' }, token)
    setSelectedDoc(null)
    loadAdminData(token)
  }

  // --- User Detail Handlers ---
  const selectUserForEdit = async (u: User) => {
    setLoading(true); setError(''); setStatusMessage('')
    try {
      const detail: UserDetail = await api(`/admin/users/${u.id}`, {}, token)
      setSelectedUser(detail)
      setUserDepts(detail.departments)
      setUserRoles(detail.roles)
      setUserDirectDocs(detail.direct_document_ids)
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed to load user details') } finally { setLoading(false) }
  }

  const saveUserPermissions = async () => {
    if (!selectedUser) return
    setLoading(true); setError(''); setStatusMessage('')
    try {
      const updated: UserDetail = await api(`/admin/users/${selectedUser.id}/permissions`, {
        method: 'POST',
        body: JSON.stringify({ departments: userDepts, roles: userRoles, direct_document_ids: userDirectDocs })
      }, token)
      setSelectedUser(updated)
      setStatusMessage('User departments, roles, and direct access permissions updated.')
      loadAdminData(token)
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed to update user permissions') } finally { setLoading(false) }
  }

  const deleteUser = async (id: string) => {
    if (!window.confirm('Delete this user account?')) return
    await api(`/admin/users/${id}`, { method: 'DELETE' }, token)
    setSelectedUser(null)
    loadAdminData(token)
  }

  // --- Department Handlers ---
  const createDepartment = async (e: FormEvent) => {
    e.preventDefault()
    if (!newDeptName.trim()) return
    setLoading(true); setError(''); setStatusMessage('')
    try {
      await api('/admin/departments', { method: 'POST', body: JSON.stringify({ name: newDeptName.trim() }) }, token)
      setNewDeptName('')
      setStatusMessage('Department created.')
      loadAdminData(token)
    } catch (err) { setError(err instanceof Error ? err.message : 'Failed to create department') } finally { setLoading(false) }
  }

  const saveDeptMembers = async () => {
    if (!selectedDept) return
    setLoading(true); setError(''); setStatusMessage('')
    try {
      const updated = await api(`/admin/departments/${selectedDept.id}`, {
        method: 'POST',
        body: JSON.stringify({ user_emails: deptUsers, document_ids: deptDocs })
      }, token)
      setSelectedDept(updated)
      setStatusMessage('Department members and documents updated.')
      loadAdminData(token)
    } catch (err) { setError(err instanceof Error ? err.message : 'Failed to update department') } finally { setLoading(false) }
  }

  const deleteDept = async (id: string) => {
    if (!window.confirm('Delete this department?')) return
    await api(`/admin/departments/${id}`, { method: 'DELETE' }, token)
    setSelectedDept(null)
    loadAdminData(token)
  }

  // --- Role Handlers ---
  const createRole = async (e: FormEvent) => {
    e.preventDefault()
    if (!newRoleName.trim()) return
    setLoading(true); setError(''); setStatusMessage('')
    try {
      await api('/admin/roles', { method: 'POST', body: JSON.stringify({ name: newRoleName.trim() }) }, token)
      setNewRoleName('')
      setStatusMessage('Role created.')
      loadAdminData(token)
    } catch (err) { setError(err instanceof Error ? err.message : 'Failed to create role') } finally { setLoading(false) }
  }

  const saveRoleMembers = async () => {
    if (!selectedRole) return
    setLoading(true); setError(''); setStatusMessage('')
    try {
      const updated = await api(`/admin/roles/${selectedRole.id}`, {
        method: 'POST',
        body: JSON.stringify({ user_emails: roleUsers, document_ids: roleDocs })
      }, token)
      setSelectedRole(updated)
      setStatusMessage('Role members and documents updated.')
      loadAdminData(token)
    } catch (err) { setError(err instanceof Error ? err.message : 'Failed to update role') } finally { setLoading(false) }
  }

  const deleteRole = async (id: string) => {
    if (!window.confirm('Delete this role?')) return
    await api(`/admin/roles/${id}`, { method: 'DELETE' }, token)
    setSelectedRole(null)
    loadAdminData(token)
  }

  function signOut() { localStorage.removeItem('rag_token'); setToken(''); setUser(null); setResult(null) }

  const [apiKey, setApiKey] = useState('')
  const reloadApiKey = async () => {
    if (!apiKey.trim()) return
    setLoading(true); setError(''); setStatusMessage('')
    try {
      await api('/admin/reload-api-key', { method: 'POST', body: JSON.stringify({ api_key: apiKey.trim() }) }, token)
      setStatusMessage('✅ Gemini API key reloaded. No container restart needed!')
      setApiKey('')
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed to reload API key') } finally { setLoading(false) }
  }

  if (!user) return (
    <main className="auth-shell">
      <section className="auth-card">
        <div className="mark">R</div>
        <h1>RAG Application</h1>
        <p className="muted">Sign in</p>
        <form onSubmit={authenticate}>
          {mode === 'register' && <label>Full name<input name="displayName" required minLength={2} /></label>}
          <label>Email<input name="email" type="email" required /></label>
          <label>Password<input name="password" type="password" minLength={10} required /></label>
          {error && <p className="error">{error}</p>}
          <button disabled={loading}>{loading ? 'Checking…' : mode === 'login' ? 'Sign in' : 'Create account'}</button>
        </form>
        <button className="link" onClick={() => setMode(mode === 'login' ? 'register' : 'login')}>
          {mode === 'login' ? 'New here? Create an account' : 'Already registered? Sign in'}
        </button>
      </section>
    </main>
  )

  return (
    <main>
      <header>
        <div className="brand">
          <div className="mark small">R</div>
          <div>
            <p className="eyebrow">RAG APPLICATION</p>
            <h1>{user.isAdmin ? 'Admin Console' : 'Knowledge Desk'}</h1>
          </div>
        </div>
        <div className="user">
          <span>{user.displayName}</span>
          <button className="link" onClick={signOut}>Sign out</button>
        </div>
      </header>

      {user.isAdmin ? (
        <section className="admin-container">
          {/* API Key Hot-Reload Banner */}
          <div className="api-key-banner">
            <span>🔑 Gemini API Key</span>
            <input
              type="password"
              value={apiKey}
              onChange={e => setApiKey(e.target.value)}
              placeholder="Paste new API key to hot-reload (no restart needed)"
              onKeyDown={e => e.key === 'Enter' && reloadApiKey()}
            />
            <button onClick={reloadApiKey} disabled={loading || !apiKey.trim()}>Reload Key</button>
          </div>

          <nav className="admin-tabs">
            <button className={adminTab === 'documents' ? 'active' : ''} onClick={() => { setAdminTab('documents'); setSelectedDoc(null) }}>📄 Documents</button>
            <button className={adminTab === 'users' ? 'active' : ''} onClick={() => { setAdminTab('users'); setSelectedUser(null) }}>👥 Users</button>
            <button className={adminTab === 'departments' ? 'active' : ''} onClick={() => { setAdminTab('departments'); setSelectedDept(null) }}>🏢 Departments</button>
            <button className={adminTab === 'roles' ? 'active' : ''} onClick={() => { setAdminTab('roles'); setSelectedRole(null) }}>🛡️ Roles</button>
          </nav>

          {statusMessage && <p className="success">{statusMessage}</p>}
          {error && <p className="error">{error}</p>}

          {/* TAB 1: DOCUMENTS */}
          {adminTab === 'documents' && (
            selectedDoc ? (
              <div className="admin-panel document-detail">
                <button className="link" onClick={() => setSelectedDoc(null)}>← Back to Documents</button>
                <p className="eyebrow">DOCUMENT PERMISSIONS</p>
                <h2>{selectedDoc.title}</h2>
                <p className="document-id">{selectedDoc.id}</p>
                
                <h3>Direct Assigned Users</h3>
                <div className="user-add-row">
                  <input value={newInputEmail} onChange={e => setNewInputEmail(e.target.value)} placeholder="user@example.com" />
                  <button type="button" onClick={() => {
                    const email = newInputEmail.trim().toLowerCase()
                    if (email && !docUsers.includes(email)) setDocUsers([...docUsers, email])
                    setNewInputEmail('')
                  }}>Add Direct User</button>
                </div>
                <div className="permission-chip-list">
                  {docUsers.map(email => (
                    <span className="chip" key={email}>
                      {email}
                      <button onClick={() => setDocUsers(docUsers.filter(e => e !== email))}>×</button>
                    </span>
                  ))}
                  {!docUsers.length && <span className="muted">No direct users assigned</span>}
                </div>

                <h3>Allowed Departments</h3>
                <div className="checkbox-grid">
                  {departments.map(dept => (
                    <label key={dept.id} className="checkbox-label">
                      <input
                        type="checkbox"
                        checked={docDepts.includes(dept.name)}
                        onChange={e => {
                          if (e.target.checked) setDocDepts([...docDepts, dept.name])
                          else setDocDepts(docDepts.filter(d => d !== dept.name))
                        }}
                      />
                      {dept.name}
                    </label>
                  ))}
                  {!departments.length && <p className="muted">No departments created yet</p>}
                </div>

                <h3>Allowed Roles</h3>
                <div className="checkbox-grid">
                  {roles.map(role => (
                    <label key={role.id} className="checkbox-label">
                      <input
                        type="checkbox"
                        checked={docRoles.includes(role.name)}
                        onChange={e => {
                          if (e.target.checked) setDocRoles([...docRoles, role.name])
                          else setDocRoles(docRoles.filter(r => r !== role.name))
                        }}
                      />
                      {role.name}
                    </label>
                  ))}
                  {!roles.length && <p className="muted">No roles created yet</p>}
                </div>

                <div className="button-row">
                  <button onClick={saveDocPermissions} disabled={loading}>{loading ? 'Saving…' : 'Save Document Access'}</button>
                  <button className="danger" onClick={() => deleteDocument(selectedDoc.id)}>Delete Document</button>
                </div>
              </div>
            ) : (
              <div className="admin-panel">
                <p className="eyebrow">DOCUMENT MANAGEMENT</p>
                <h2>Upload New Document</h2>
                <form onSubmit={uploadDocument} className="upload-form">
                  <input name="document_name" placeholder="Document Title (e.g. Security Runbook)" required />
                  <input name="file" type="file" accept="application/pdf,.pdf" required />
                  <input name="user_emails_str" placeholder="Optional direct user emails (comma separated)" />
                  <input name="departments_str" placeholder="Optional departments (comma separated)" />
                  <input name="roles_str" placeholder="Optional roles (comma separated)" />
                  <button disabled={loading}>{loading ? 'Indexing…' : 'Upload & Index PDF'}</button>
                </form>

                <h3>All Documents ({documents.length})</h3>
                <div className="document-list">
                  {documents.map(item => (
                    <button className="document-row" key={item.id} onClick={() => {
                      setSelectedDoc(item)
                      setDocUsers(item.user_emails)
                      setDocDepts(item.departments)
                      setDocRoles(item.roles)
                    }}>
                      <div>
                        <strong>{item.title}</strong>
                        <div className="row-tags">
                          {item.user_emails.length > 0 && <span className="tag-user">{item.user_emails.length} Users</span>}
                          {item.departments.length > 0 && <span className="tag-dept">{item.departments.join(', ')}</span>}
                          {item.roles.length > 0 && <span className="tag-role">{item.roles.join(', ')}</span>}
                          {!item.user_emails.length && !item.departments.length && !item.roles.length && <span className="tag-none">No Access</span>}
                        </div>
                      </div>
                      <span>Manage →</span>
                    </button>
                  ))}
                </div>
              </div>
            )
          )}

          {/* TAB 2: USERS */}
          {adminTab === 'users' && (
            selectedUser ? (
              <div className="admin-panel user-detail">
                <button className="link" onClick={() => setSelectedUser(null)}>← Back to Users</button>
                <p className="eyebrow">USER PROFILE & PERMISSIONS</p>
                <h2>{selectedUser.display_name}</h2>
                <p className="document-id">{selectedUser.email} (ID: {selectedUser.id})</p>

                <h3>Assigned Departments</h3>
                <div className="checkbox-grid">
                  {departments.map(dept => (
                    <label key={dept.id} className="checkbox-label">
                      <input
                        type="checkbox"
                        checked={userDepts.includes(dept.name)}
                        onChange={e => {
                          if (e.target.checked) setUserDepts([...userDepts, dept.name])
                          else setUserDepts(userDepts.filter(d => d !== dept.name))
                        }}
                      />
                      {dept.name}
                    </label>
                  ))}
                  {!departments.length && <p className="muted">No departments available</p>}
                </div>

                <h3>Assigned Roles</h3>
                <div className="checkbox-grid">
                  {roles.map(role => (
                    <label key={role.id} className="checkbox-label">
                      <input
                        type="checkbox"
                        checked={userRoles.includes(role.name)}
                        onChange={e => {
                          if (e.target.checked) setUserRoles([...userRoles, role.name])
                          else setUserRoles(userRoles.filter(r => r !== role.name))
                        }}
                      />
                      {role.name}
                    </label>
                  ))}
                  {!roles.length && <p className="muted">No roles available</p>}
                </div>

                <h3>Direct Document Access</h3>
                <div className="checkbox-grid">
                  {documents.map(doc => (
                    <label key={doc.id} className="checkbox-label">
                      <input
                        type="checkbox"
                        checked={userDirectDocs.includes(doc.id)}
                        onChange={e => {
                          if (e.target.checked) setUserDirectDocs([...userDirectDocs, doc.id])
                          else setUserDirectDocs(userDirectDocs.filter(id => id !== doc.id))
                        }}
                      />
                      {doc.title}
                    </label>
                  ))}
                  {!documents.length && <p className="muted">No documents uploaded yet</p>}
                </div>

                <h3>All Allowed Documents for this User ({selectedUser.all_allowed_documents.length})</h3>
                <div className="allowed-docs-list">
                  {selectedUser.all_allowed_documents.map(doc => (
                    <div key={doc.id} className="allowed-doc-item">
                      ✓ {doc.title} <small>({doc.id})</small>
                    </div>
                  ))}
                  {!selectedUser.all_allowed_documents.length && <p className="muted">User currently has NO document access.</p>}
                </div>

                <div className="button-row">
                  <button onClick={saveUserPermissions} disabled={loading}>{loading ? 'Saving…' : 'Save User Access'}</button>
                  {!selectedUser.is_admin && <button className="danger" onClick={() => deleteUser(selectedUser.id)}>Delete User</button>}
                </div>
              </div>
            ) : (
              <div className="admin-panel">
                <p className="eyebrow">USER MANAGEMENT</p>
                <h2>All Registered Users ({adminUsers.length})</h2>
                <p className="muted">New users start by default with no document access and no assigned department/role.</p>
                <div className="user-grid-list">
                  {adminUsers.map(u => (
                    <button className="user-card-button" key={u.id} onClick={() => selectUserForEdit(u)}>
                      <div>
                        <strong>{u.email}</strong>
                        <p>{u.displayName} {(u.isAdmin || u.is_admin) && <span className="badge">Admin</span>}</p>
                      </div>
                      <span>Manage Permissions →</span>
                    </button>
                  ))}
                </div>
              </div>
            )
          )}

          {/* TAB 3: DEPARTMENTS */}
          {adminTab === 'departments' && (
            selectedDept ? (
              <div className="admin-panel department-detail">
                <button className="link" onClick={() => setSelectedDept(null)}>← Back to Departments</button>
                <p className="eyebrow">DEPARTMENT MANAGEMENT</p>
                <h2>{selectedDept.name} Department</h2>

                <h3>Member User Emails</h3>
                <div className="user-add-row">
                  <input value={newInputEmail} onChange={e => setNewInputEmail(e.target.value)} placeholder="user@example.com" />
                  <button type="button" onClick={() => {
                    const email = newInputEmail.trim().toLowerCase()
                    if (email && !deptUsers.includes(email)) setDeptUsers([...deptUsers, email])
                    setNewInputEmail('')
                  }}>Add User to Department</button>
                </div>
                <div className="permission-chip-list">
                  {deptUsers.map(email => (
                    <span className="chip" key={email}>
                      {email}
                      <button onClick={() => setDeptUsers(deptUsers.filter(e => e !== email))}>×</button>
                    </span>
                  ))}
                  {!deptUsers.length && <span className="muted">No member users</span>}
                </div>

                <h3>Accessible Documents for this Department</h3>
                <div className="checkbox-grid">
                  {documents.map(doc => (
                    <label key={doc.id} className="checkbox-label">
                      <input
                        type="checkbox"
                        checked={deptDocs.includes(doc.id)}
                        onChange={e => {
                          if (e.target.checked) setDeptDocs([...deptDocs, doc.id])
                          else setDeptDocs(deptDocs.filter(id => id !== doc.id))
                        }}
                      />
                      {doc.title}
                    </label>
                  ))}
                </div>

                <div className="button-row">
                  <button onClick={saveDeptMembers} disabled={loading}>{loading ? 'Saving…' : 'Save Department Settings'}</button>
                  <button className="danger" onClick={() => deleteDept(selectedDept.id)}>Delete Department</button>
                </div>
              </div>
            ) : (
              <div className="admin-panel">
                <p className="eyebrow">DEPARTMENT MANAGEMENT</p>
                <h2>Create New Department</h2>
                <form onSubmit={createDepartment} className="single-form">
                  <input value={newDeptName} onChange={e => setNewDeptName(e.target.value)} placeholder="Department Name (e.g. Engineering, Finance, HR)" required />
                  <button disabled={loading}>Create Department</button>
                </form>

                <h3>Existing Departments ({departments.length})</h3>
                <div className="item-grid-list">
                  {departments.map(dept => (
                    <button className="item-card-button" key={dept.id} onClick={() => {
                      setSelectedDept(dept)
                      setDeptUsers(dept.user_emails)
                      setDeptDocs(dept.document_ids)
                    }}>
                      <div>
                        <strong>{dept.name}</strong>
                        <p>{dept.user_emails.length} Users · {dept.document_ids.length} Documents</p>
                      </div>
                      <span>Manage →</span>
                    </button>
                  ))}
                  {!departments.length && <p className="muted">No departments created yet.</p>}
                </div>
              </div>
            )
          )}

          {/* TAB 4: ROLES */}
          {adminTab === 'roles' && (
            selectedRole ? (
              <div className="admin-panel role-detail">
                <button className="link" onClick={() => setSelectedRole(null)}>← Back to Roles</button>
                <p className="eyebrow">ROLE MANAGEMENT</p>
                <h2>{selectedRole.name} Role</h2>

                <h3>Member User Emails</h3>
                <div className="user-add-row">
                  <input value={newInputEmail} onChange={e => setNewInputEmail(e.target.value)} placeholder="user@example.com" />
                  <button type="button" onClick={() => {
                    const email = newInputEmail.trim().toLowerCase()
                    if (email && !roleUsers.includes(email)) setRoleUsers([...roleUsers, email])
                    setNewInputEmail('')
                  }}>Add User to Role</button>
                </div>
                <div className="permission-chip-list">
                  {roleUsers.map(email => (
                    <span className="chip" key={email}>
                      {email}
                      <button onClick={() => setRoleUsers(roleUsers.filter(e => e !== email))}>×</button>
                    </span>
                  ))}
                  {!roleUsers.length && <span className="muted">No member users</span>}
                </div>

                <h3>Accessible Documents for this Role</h3>
                <div className="checkbox-grid">
                  {documents.map(doc => (
                    <label key={doc.id} className="checkbox-label">
                      <input
                        type="checkbox"
                        checked={roleDocs.includes(doc.id)}
                        onChange={e => {
                          if (e.target.checked) setRoleDocs([...roleDocs, doc.id])
                          else setRoleDocs(roleDocs.filter(id => id !== doc.id))
                        }}
                      />
                      {doc.title}
                    </label>
                  ))}
                </div>

                <div className="button-row">
                  <button onClick={saveRoleMembers} disabled={loading}>{loading ? 'Saving…' : 'Save Role Settings'}</button>
                  <button className="danger" onClick={() => deleteRole(selectedRole.id)}>Delete Role</button>
                </div>
              </div>
            ) : (
              <div className="admin-panel">
                <p className="eyebrow">ROLE MANAGEMENT</p>
                <h2>Create New Role</h2>
                <form onSubmit={createRole} className="single-form">
                  <input value={newRoleName} onChange={e => setNewRoleName(e.target.value)} placeholder="Role Name (e.g. Auditor, Manager, Developer)" required />
                  <button disabled={loading}>Create Role</button>
                </form>

                <h3>Existing Roles ({roles.length})</h3>
                <div className="item-grid-list">
                  {roles.map(role => (
                    <button className="item-card-button" key={role.id} onClick={() => {
                      setSelectedRole(role)
                      setRoleUsers(role.user_emails)
                      setRoleDocs(role.document_ids)
                    }}>
                      <div>
                        <strong>{role.name}</strong>
                        <p>{role.user_emails.length} Users · {role.document_ids.length} Documents</p>
                      </div>
                      <span>Manage →</span>
                    </button>
                  ))}
                  {!roles.length && <p className="muted">No roles created yet.</p>}
                </div>
              </div>
            )
          )}
        </section>
      ) : null}

      {!user.isAdmin && (
        <section className="search-card">
          <p className="eyebrow">ASK YOUR LIBRARY</p>
          <h3>What do you want to know?</h3>
          <form onSubmit={ask}>
            <input name="query" defaultValue="What are the deployment risks for Project Titan?" aria-label="Ask a question" required minLength={3} />
            <button disabled={loading}>{loading ? 'Searching…' : 'Ask'}</button>
          </form>
          {error && <p className="error">{error}</p>}
        </section>
      )}

      {!user.isAdmin && result && (
        <section className="result">
          <div className="result-heading">
            <div>
              <p className="eyebrow">ANSWER FROM YOUR SOURCES</p>
              <h2>Here’s what I found</h2>
            </div>
            <span className="badge">{result.authorized_document_count} authorized documents</span>
          </div>
          <article><FormattedAnswer text={result.answer} /></article>
          <h3>Sources used</h3>
          <div className="citations">
            {result.citations.map(citation => (
              <div className="citation" key={citation.document_id}>
                <b>{citation.document_id}</b>
                <strong>{citation.title}</strong>
                <p>{citation.excerpt}</p>
              </div>
            ))}
          </div>
        </section>
      )}
    </main>
  )
}

createRoot(document.getElementById('root')!).render(<App />)
