import { FormEvent, useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'
import './admin.css'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000'
type User = { id: string; email: string; displayName: string; isAdmin?: boolean; is_admin?: boolean }
type Citation = { document_id: string; title: string; excerpt: string }

type AdminDocument = { id: string; title: string; user_emails: string[]; departments: string[]; roles: string[] }
type UserDetail = { id: string; email: string; display_name: string; is_admin: boolean; departments: string[]; roles: string[]; direct_document_ids: string[]; all_allowed_documents: { id: string; title: string }[] }
type DepartmentSummary = { id: string; name: string; user_emails: string[]; document_ids: string[] }
type RoleSummary = { id: string; name: string; user_emails: string[]; document_ids: string[] }

type ChatSession = { id: string; title: string; created_at?: string; updated_at?: string }
type ChatMessage = {
  id: string
  session_id: string
  role: 'user' | 'assistant'
  content: string
  citations?: Citation[]
  authorized_document_count?: number
  created_at?: string
}

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
  const [statusMessage, setStatusMessage] = useState('')

  // View mode for Admin (Admin Console vs Chat Knowledge Desk)
  const [viewMode, setViewMode] = useState<'chat' | 'admin'>('chat')

  // Sidebar collapsed state
  const [isSidebarOpen, setIsSidebarOpen] = useState(true)

  // Chat state
  const [chatSessions, setChatSessions] = useState<ChatSession[]>([])
  const [activeChatId, setActiveChatId] = useState<string | null>(null)
  const [activeMessages, setActiveMessages] = useState<ChatMessage[]>([])
  const [chatInput, setChatInput] = useState('')
  const [chatLoading, setChatLoading] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)

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
  const [apiKey, setApiKey] = useState('')

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  useEffect(() => {
    scrollToBottom()
  }, [activeMessages, chatLoading])

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

  const loadChatSessions = async (tok: string, targetId?: string) => {
    try {
      const sessions: ChatSession[] = await api('/chats', {}, tok)
      setChatSessions(sessions)
      if (sessions.length > 0) {
        const idToLoad = targetId || (activeChatId && sessions.some(s => s.id === activeChatId) ? activeChatId : sessions[0].id)
        setActiveChatId(idToLoad)
        const detail = await api(`/chats/${idToLoad}`, {}, tok)
        setActiveMessages(detail.messages || [])
      } else {
        const newSession: ChatSession = await api('/chats', { method: 'POST', body: JSON.stringify({ title: 'New Chat' }) }, tok)
        setChatSessions([newSession])
        setActiveChatId(newSession.id)
        setActiveMessages([])
      }
    } catch (e) {
      console.error('Failed to load chat sessions', e)
    }
  }

  useEffect(() => {
    if (!token) return
    api('/auth/me', {}, token)
      .then(account => {
        setUser(account)
        if (account.isAdmin) {
          loadAdminData(token)
        }
        loadChatSessions(token)
      })
      .catch(() => {
        localStorage.removeItem('rag_token')
        setToken('')
      })
  }, [token])

  async function authenticate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setLoading(true)
    const form = new FormData(event.currentTarget)
    try {
      const body = await api(`/auth/${mode}`, {
        method: 'POST',
        body: JSON.stringify({
          email: form.get('email'),
          password: form.get('password'),
          ...(mode === 'register' ? { display_name: form.get('displayName') } : {}),
        }),
      })
      localStorage.setItem('rag_token', body.access_token)
      setToken(body.access_token)
      setUser(body.user)
      if (body.user.isAdmin) {
        loadAdminData(body.access_token)
      }
      loadChatSessions(body.access_token)
    } catch (exception) {
      setError(exception instanceof Error ? exception.message : 'Could not authenticate')
    } finally {
      setLoading(false)
    }
  }

  // --- Chat Actions ---
  const createNewChat = async () => {
    setViewMode('chat')
    try {
      const newSession: ChatSession = await api('/chats', { method: 'POST', body: JSON.stringify({ title: 'New Chat' }) }, token)
      setChatSessions([newSession, ...chatSessions])
      setActiveChatId(newSession.id)
      setActiveMessages([])
    } catch (e) {
      console.error('Failed to create new chat', e)
    }
  }

  const selectChat = async (id: string) => {
    setViewMode('chat')
    if (id === activeChatId && activeMessages.length > 0) return
    setActiveChatId(id)
    try {
      const detail = await api(`/chats/${id}`, {}, token)
      setActiveMessages(detail.messages || [])
    } catch (e) {
      console.error('Failed to load chat history', e)
    }
  }

  const deleteChat = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation()
    if (!window.confirm('Delete this chat history?')) return
    try {
      await api(`/chats/${id}`, { method: 'DELETE' }, token)
      const updated = chatSessions.filter(s => s.id !== id)
      setChatSessions(updated)
      if (activeChatId === id) {
        if (updated.length > 0) {
          selectChat(updated[0].id)
        } else {
          createNewChat()
        }
      }
    } catch (e) {
      console.error('Failed to delete chat', e)
    }
  }

  const sendChatMessage = async (textToSend?: string) => {
    const text = (textToSend !== undefined ? textToSend : chatInput).trim()
    if (!text || chatLoading) return

    let currentChatId = activeChatId
    if (!currentChatId) {
      try {
        const newSession: ChatSession = await api('/chats', { method: 'POST', body: JSON.stringify({ title: 'New Chat' }) }, token)
        setChatSessions([newSession, ...chatSessions])
        currentChatId = newSession.id
        setActiveChatId(newSession.id)
      } catch (err) {
        console.error(err)
        return
      }
    }

    const tempUserMsg: ChatMessage = {
      id: 'temp-' + Date.now(),
      session_id: currentChatId,
      role: 'user',
      content: text,
      created_at: new Date().toISOString(),
    }

    setActiveMessages(prev => [...prev, tempUserMsg])
    setChatInput('')
    setChatLoading(true)
    setError('')

    try {
      const res = await api(`/chats/${currentChatId}/messages`, {
        method: 'POST',
        body: JSON.stringify({ message: text }),
      }, token)

      setActiveMessages(prev => [...prev.filter(m => m.id !== tempUserMsg.id), res.user_message, res.assistant_message])

      if (res.chat_title) {
        setChatSessions(prev =>
          prev.map(s => (s.id === currentChatId ? { ...s, title: res.chat_title, updated_at: new Date().toISOString() } : s))
        )
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send message')
    } finally {
      setChatLoading(false)
    }
  }

  // --- Document Access Handlers ---
  async function uploadDocument(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setStatusMessage('')
    setLoading(true)
    const form = event.currentTarget
    const data = new FormData(form)
    try {
      const response = await fetch(`${API_URL}/admin/documents/upload`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: data,
      })
      const body = await response.json()
      if (!response.ok) throw new Error(body.detail || 'Upload failed')
      setStatusMessage(`"${body.title}" uploaded & indexed securely (${body.chunk_count} chunks).`)
      loadAdminData(token)
      form.reset()
    } catch (exception) {
      setError(exception instanceof Error ? exception.message : 'Upload failed')
    } finally {
      setLoading(false)
    }
  }

  const saveDocPermissions = async () => {
    if (!selectedDoc) return
    setLoading(true)
    setError('')
    setStatusMessage('')
    try {
      const updated = await api(`/admin/documents/${selectedDoc.id}/permissions`, {
        method: 'POST',
        body: JSON.stringify({ user_emails: docUsers, departments: docDepts, roles: docRoles }),
      }, token)
      setSelectedDoc(updated)
      setStatusMessage('Document permissions saved.')
      loadAdminData(token)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save document permissions')
    } finally {
      setLoading(false)
    }
  }

  const deleteDocument = async (id: string) => {
    if (!window.confirm('Delete this document and its indexed vectors?')) return
    await api(`/admin/documents/${id}`, { method: 'DELETE' }, token)
    setSelectedDoc(null)
    loadAdminData(token)
  }

  // --- User Detail Handlers ---
  const selectUserForEdit = async (u: User) => {
    setLoading(true)
    setError('')
    setStatusMessage('')
    try {
      const detail: UserDetail = await api(`/admin/users/${u.id}`, {}, token)
      setSelectedUser(detail)
      setUserDepts(detail.departments)
      setUserRoles(detail.roles)
      setUserDirectDocs(detail.direct_document_ids)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load user details')
    } finally {
      setLoading(false)
    }
  }

  const saveUserPermissions = async () => {
    if (!selectedUser) return
    setLoading(true)
    setError('')
    setStatusMessage('')
    try {
      const updated: UserDetail = await api(`/admin/users/${selectedUser.id}/permissions`, {
        method: 'POST',
        body: JSON.stringify({ departments: userDepts, roles: userRoles, direct_document_ids: userDirectDocs }),
      }, token)
      setSelectedUser(updated)
      setStatusMessage('User departments, roles, and direct access permissions updated.')
      loadAdminData(token)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update user permissions')
    } finally {
      setLoading(false)
    }
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
    setLoading(true)
    setError('')
    setStatusMessage('')
    try {
      await api('/admin/departments', { method: 'POST', body: JSON.stringify({ name: newDeptName.trim() }) }, token)
      setNewDeptName('')
      setStatusMessage('Department created.')
      loadAdminData(token)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create department')
    } finally {
      setLoading(false)
    }
  }

  const saveDeptMembers = async () => {
    if (!selectedDept) return
    setLoading(true)
    setError('')
    setStatusMessage('')
    try {
      const updated = await api(`/admin/departments/${selectedDept.id}`, {
        method: 'POST',
        body: JSON.stringify({ user_emails: deptUsers, document_ids: deptDocs }),
      }, token)
      setSelectedDept(updated)
      setStatusMessage('Department members and documents updated.')
      loadAdminData(token)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update department')
    } finally {
      setLoading(false)
    }
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
    setLoading(true)
    setError('')
    setStatusMessage('')
    try {
      await api('/admin/roles', { method: 'POST', body: JSON.stringify({ name: newRoleName.trim() }) }, token)
      setNewRoleName('')
      setStatusMessage('Role created.')
      loadAdminData(token)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create role')
    } finally {
      setLoading(false)
    }
  }

  const saveRoleMembers = async () => {
    if (!selectedRole) return
    setLoading(true)
    setError('')
    setStatusMessage('')
    try {
      const updated = await api(`/admin/roles/${selectedRole.id}`, {
        method: 'POST',
        body: JSON.stringify({ user_emails: roleUsers, document_ids: roleDocs }),
      }, token)
      setSelectedRole(updated)
      setStatusMessage('Role members and documents updated.')
      loadAdminData(token)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update role')
    } finally {
      setLoading(false)
    }
  }

  const deleteRole = async (id: string) => {
    if (!window.confirm('Delete this role?')) return
    await api(`/admin/roles/${id}`, { method: 'DELETE' }, token)
    setSelectedRole(null)
    loadAdminData(token)
  }

  const reloadApiKey = async () => {
    if (!apiKey.trim()) return
    setLoading(true)
    setError('')
    setStatusMessage('')
    try {
      await api('/admin/reload-api-key', { method: 'POST', body: JSON.stringify({ api_key: apiKey.trim() }) }, token)
      setStatusMessage('✅ Gemini API key reloaded. No container restart needed!')
      setApiKey('')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to reload API key')
    } finally {
      setLoading(false)
    }
  }

  function signOut() {
    localStorage.removeItem('rag_token')
    setToken('')
    setUser(null)
    setChatSessions([])
    setActiveMessages([])
    setActiveChatId(null)
  }

  if (!user) {
    return (
      <main className="auth-shell">
        <section className="auth-card">
          <div className="mark">✦</div>
          <h1>RAG Studio</h1>
          <p className="muted">Sign in to search your authorized documents</p>
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
  }

  return (
    <div className="gemini-app-shell">
      {/* =========================================================
          LEFT SIDEBAR (Full Height - App Name, Chats, User Profile)
          ========================================================= */}
      <aside className={`gemini-sidebar ${isSidebarOpen ? '' : 'collapsed'}`}>
        {/* Top: Logo + App Name + Collapse Button */}
        <div className="gemini-sidebar-top">
          <div className="gemini-brand">
            <div className="gemini-brand-icon">✦</div>
            <span className="gemini-brand-title">RAG Studio</span>
          </div>
          <button
            className="gemini-icon-btn"
            onClick={() => setIsSidebarOpen(false)}
            title="Collapse sidebar"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <line x1="9" y1="3" x2="9" y2="21" />
            </svg>
          </button>
        </div>

        {/* New Chat Button */}
        <div className="gemini-new-chat-box">
          <button className="gemini-new-chat-pill" onClick={createNewChat}>
            <span className="new-chat-plus">+</span>
            <span>New chat</span>
          </button>
        </div>

        {/* Admin Switcher (Only if Admin) */}
        {user.isAdmin && (
          <div className="sidebar-admin-switcher">
            <button
              className={viewMode === 'chat' ? 'active' : ''}
              onClick={() => setViewMode('chat')}
            >
              💬 Chat
            </button>
            <button
              className={viewMode === 'admin' ? 'active' : ''}
              onClick={() => setViewMode('admin')}
            >
              🛠️ Admin
            </button>
          </div>
        )}

        {/* Recents Section */}
        <div className="gemini-recents-container">
          <div className="gemini-recents-heading">Recent</div>
          <div className="gemini-recents-list">
            {chatSessions.map(session => (
              <button
                key={session.id}
                className={`gemini-chat-item ${activeChatId === session.id && viewMode === 'chat' ? 'active' : ''}`}
                onClick={() => selectChat(session.id)}
              >
                <span className="gemini-chat-item-title">{session.title}</span>
                <span
                  className="gemini-chat-item-del"
                  title="Delete chat"
                  onClick={e => deleteChat(e, session.id)}
                >
                  ✕
                </span>
              </button>
            ))}
            {!chatSessions.length && (
              <div className="gemini-no-chats-msg">No recent conversations</div>
            )}
          </div>
        </div>

        {/* Bottom Pinned: User Profile + Sign Out */}
        <div className="gemini-sidebar-bottom">
          <div className="gemini-user-profile">
            <div className="gemini-user-avatar">
              {user.displayName.slice(0, 2).toUpperCase() || 'U1'}
            </div>
            <div className="gemini-user-details">
              <div className="gemini-user-name">{user.displayName}</div>
              <div className="gemini-user-badge">{user.isAdmin ? 'Admin' : 'Member'}</div>
            </div>
          </div>
          <button className="gemini-signout-btn" onClick={signOut} title="Sign out">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
              <polyline points="16 17 21 12 16 7" />
              <line x1="21" y1="12" x2="9" y2="12" />
            </svg>
            <span>Exit</span>
          </button>
        </div>
      </aside>

      {/* =========================================================
          MAIN WORKSPACE (Full Width & Height like Gemini)
          ========================================================= */}
      <main className="gemini-main">
        {/* Expand button when sidebar is collapsed */}
        {!isSidebarOpen && (
          <div className="gemini-top-header">
            <button
              className="gemini-open-sidebar-btn"
              onClick={() => setIsSidebarOpen(true)}
              title="Expand menu"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="3" y1="12" x2="21" y2="12" />
                <line x1="3" y1="6" x2="21" y2="6" />
                <line x1="3" y1="18" x2="21" y2="18" />
              </svg>
              <span>Menu</span>
            </button>
          </div>
        )}

        {/* If Admin view is active */}
        {user.isAdmin && viewMode === 'admin' ? (
          <div className="gemini-admin-scroll">
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
          </div>
        ) : (
          /* =========================================================
             GEMINI CHAT WORKSPACE (Spacious, Full Screen)
             ========================================================= */
          <div style={{ display: 'flex', flexDirection: 'column', height: '100%', width: '100%', position: 'relative' }}>
            {activeMessages.length === 0 ? (
              /* Hero Empty State: "Where should we start?" + 2 Questions */
              <div className="gemini-hero-container">
                <h1 className="gemini-hero-title">Where should we start?</h1>
                <div className="gemini-suggestions-row">
                  <button
                    className="gemini-suggestion-chip"
                    onClick={() => sendChatMessage('what is docker?')}
                  >
                    <span className="gemini-chip-sparkle">✦</span>
                    <span>what is docker?</span>
                  </button>
                  <button
                    className="gemini-suggestion-chip"
                    onClick={() => sendChatMessage('what is anti bribery policy')}
                  >
                    <span className="gemini-chip-sparkle">✦</span>
                    <span>what is anti bribery policy</span>
                  </button>
                </div>
              </div>
            ) : (
              /* Active Conversation Stream */
              <div className="gemini-stream-scroll">
                {activeMessages.map(msg => (
                  <div key={msg.id} className={`gemini-msg-row ${msg.role}`}>
                    {msg.role === 'assistant' && (
                      <div className="gemini-avatar-mark bot">✦</div>
                    )}

                    <div className="gemini-msg-bubble">
                      <div className="gemini-msg-header">
                        <span className="gemini-msg-author">
                          {msg.role === 'user' ? 'You' : 'RAG Assistant'}
                        </span>
                      </div>

                      {msg.role === 'user' ? (
                        <div style={{ whiteSpace: 'pre-wrap' }}>{msg.content}</div>
                      ) : (
                        <FormattedAnswer text={msg.content} />
                      )}

                      {msg.role === 'assistant' && msg.citations && msg.citations.length > 0 && (
                        <div className="message-citations">
                          <span className="message-citations-title">
                            Sources Used ({msg.citations.length})
                          </span>
                          <div className="message-citation-cards">
                            {msg.citations.map(cit => (
                              <div key={cit.document_id} className="message-citation-card">
                                <strong>{cit.title}</strong>
                                <p>{cit.excerpt}</p>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>

                    {msg.role === 'user' && (
                      <div className="gemini-avatar-mark user">
                        {user.displayName.slice(0, 1).toUpperCase() || 'U'}
                      </div>
                    )}
                  </div>
                ))}

                {chatLoading && (
                  <div className="chat-thinking-row">
                    <div className="gemini-avatar-mark bot">✦</div>
                    <div className="chat-thinking-bubble">
                      <div className="thinking-dots">
                        <div className="thinking-dot" />
                        <div className="thinking-dot" />
                        <div className="thinking-dot" />
                      </div>
                      <span>Querying authorized library & generating response...</span>
                    </div>
                  </div>
                )}

                <div ref={messagesEndRef} />
              </div>
            )}

            {error && <p className="error" style={{ textAlign: 'center', margin: '0 0 8px' }}>{error}</p>}

            {/* Floating Bottom Input Bar */}
            <div className="gemini-bottom-bar">
              <form
                className="gemini-input-pill"
                onSubmit={e => {
                  e.preventDefault()
                  sendChatMessage()
                }}
              >
                <input
                  value={chatInput}
                  onChange={e => setChatInput(e.target.value)}
                  placeholder="Ask anything about your authorized documents... (Enter to send)"
                  disabled={chatLoading}
                />
                <button
                  type="submit"
                  className="gemini-submit-btn"
                  disabled={chatLoading || !chatInput.trim()}
                  title="Send message"
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
                  </svg>
                </button>
              </form>
              <div className="gemini-disclaimer-text">
                Answers are grounded strictly in your authorized enterprise documents via Graph-RAG.
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  )
}

createRoot(document.getElementById('root')!).render(<App />)
