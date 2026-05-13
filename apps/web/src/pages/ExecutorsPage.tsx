import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Check, Eye, EyeOff, Pencil, Trash2, UserCheck, UserX, Users, X } from 'lucide-react';
import { Card } from '../components/Card';
import { api } from '../lib/api';

type CrmUser = {
  id: string;
  name: string;
  email: string;
  role: 'ADMIN' | 'EMPLOYEE';
  isActive: boolean;
  createdAt: string;
};

type CreateForm = {
  name: string;
  email: string;
  role: 'ADMIN' | 'EMPLOYEE';
  password: string;
};

type EditForm = {
  name: string;
  email: string;
  role: 'ADMIN' | 'EMPLOYEE';
  password: string;
};

function initials(name: string) {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map(w => w[0].toUpperCase())
    .join('');
}

export function ExecutorsPage({ currentUserId }: { currentUserId: string }) {
  const queryClient = useQueryClient();

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<EditForm>({ name: '', email: '', role: 'EMPLOYEE', password: '' });
  const [showEditPw, setShowEditPw] = useState(false);

  const [createForm, setCreateForm] = useState<CreateForm>({ name: '', email: '', role: 'EMPLOYEE', password: '' });
  const [showCreatePw, setShowCreatePw] = useState(false);
  const [createError, setCreateError] = useState('');

  const usersQuery = useQuery({
    queryKey: ['crm-users'],
    queryFn: () => api.get<CrmUser[]>('/users')
  });

  const createMutation = useMutation({
    mutationFn: (data: CreateForm) => api.post<CrmUser>('/users', data),
    onSuccess: () => {
      setCreateForm({ name: '', email: '', role: 'EMPLOYEE', password: '' });
      setCreateError('');
      queryClient.invalidateQueries({ queryKey: ['crm-users'] });
      queryClient.invalidateQueries({ queryKey: ['employees-options'] });
    },
    onError: (err: Error) => setCreateError(err.message)
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<EditForm> }) =>
      api.patch<CrmUser>(`/users/${id}`, data),
    onSuccess: () => {
      setEditingId(null);
      queryClient.invalidateQueries({ queryKey: ['crm-users'] });
      queryClient.invalidateQueries({ queryKey: ['employees-options'] });
    }
  });

  const toggleActiveMutation = useMutation({
    mutationFn: (id: string) => api.patch<CrmUser>(`/users/${id}/toggle-active`, {}),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: ['crm-users'] });
      const prev = queryClient.getQueryData<CrmUser[]>(['crm-users']);
      queryClient.setQueryData<CrmUser[]>(['crm-users'], old =>
        old?.map(u => u.id === id ? { ...u, isActive: !u.isActive } : u) ?? []
      );
      return { prev };
    },
    onError: (_err, _id, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(['crm-users'], ctx.prev);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['crm-users'] })
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/users/${id}`),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: ['crm-users'] });
      const prev = queryClient.getQueryData<CrmUser[]>(['crm-users']);
      queryClient.setQueryData<CrmUser[]>(['crm-users'], old => old?.filter(u => u.id !== id) ?? []);
      if (editingId === id) setEditingId(null);
      return { prev };
    },
    onError: (_err, _id, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(['crm-users'], ctx.prev);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['crm-users'] });
      queryClient.invalidateQueries({ queryKey: ['employees-options'] });
    }
  });

  const startEdit = (user: CrmUser) => {
    setEditingId(user.id);
    setEditForm({ name: user.name, email: user.email, role: user.role, password: '' });
    setShowEditPw(false);
  };

  const saveEdit = () => {
    if (!editingId) return;
    const data: Partial<EditForm> = {
      name: editForm.name,
      email: editForm.email,
      role: editForm.role
    };
    if (editForm.password) data.password = editForm.password;
    updateMutation.mutate({ id: editingId, data });
  };

  const users = usersQuery.data ?? [];
  const canCreate = Boolean(createForm.name && createForm.email && createForm.password);

  return (
    <div className="exec-page-wrap">
      <div className="exec-header">
        <div>
          <h2 className="exec-header-title">Team</h2>
          <p className="exec-header-sub">Manage CRM accounts and access</p>
        </div>
      </div>

      <div className="exec-two-col">
        <Card className="exec-list-card">
          <div className="exec-list-top">
            <span className="exec-list-label">Accounts</span>
            <span className="exec-list-count">{users.length}</span>
          </div>

          {users.length === 0 && !usersQuery.isLoading ? (
            <div className="exec-empty-state">
              <Users size={28} strokeWidth={1.5} />
              <span>No accounts yet — create one on the right</span>
            </div>
          ) : null}

          {users.map(user => {
            const isEditing = editingId === user.id;
            const isSelf = user.id === currentUserId;

            return (
              <div className="exec-user-row" key={user.id}>
                <div className="exec-row-inner">
                  <div className={[
                    'exec-avatar',
                    user.role === 'ADMIN' ? 'is-admin' : '',
                    !user.isActive ? 'is-inactive' : ''
                  ].filter(Boolean).join(' ')}>
                    {initials(user.name)}
                  </div>

                  <div className="exec-user-body">
                    <p className={`exec-user-name${!user.isActive ? ' is-inactive' : ''}`}>{user.name}</p>
                    <p className="exec-user-email">{user.email}</p>
                  </div>

                  <div className="exec-user-side">
                    <span className={`exec-role-tag${user.role === 'ADMIN' ? ' is-admin' : ''}`}>
                      {user.role === 'ADMIN' ? 'Admin' : 'Employee'}
                    </span>
                    <span className={`exec-status-pill${user.isActive ? ' is-active' : ''}`}>
                      <span className="exec-status-dot" />
                      {user.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </div>

                  <div className="exec-row-actions">
                    {isEditing ? (
                      <>
                        <button className="exec-icon-btn" type="button" title="Save changes" onClick={saveEdit} disabled={updateMutation.isPending}>
                          <Check size={14} />
                        </button>
                        <button className="exec-icon-btn" type="button" title="Cancel" onClick={() => setEditingId(null)}>
                          <X size={14} />
                        </button>
                      </>
                    ) : (
                      <>
                        <button className="exec-icon-btn" type="button" title="Edit" onClick={() => startEdit(user)}>
                          <Pencil size={13} />
                        </button>
                        {!isSelf ? (
                          <button
                            className={`exec-icon-btn ${user.isActive ? 'deactivate' : 'activate'}`}
                            type="button"
                            title={user.isActive ? 'Deactivate account' : 'Activate account'}
                            onClick={() => toggleActiveMutation.mutate(user.id)}
                            disabled={toggleActiveMutation.isPending}
                          >
                            {user.isActive ? <UserX size={13} /> : <UserCheck size={13} />}
                          </button>
                        ) : null}
                        {!isSelf ? (
                          <button
                            className="exec-icon-btn delete"
                            type="button"
                            title="Delete account"
                            onClick={() => { if (window.confirm(`Delete account for ${user.name}? This cannot be undone.`)) deleteMutation.mutate(user.id); }}
                            disabled={deleteMutation.isPending}
                          >
                            <Trash2 size={13} />
                          </button>
                        ) : null}
                      </>
                    )}
                  </div>
                </div>

                {isEditing ? (
                  <div className="exec-edit-area">
                    <div className="exec-edit-grid">
                      <input
                        className="input"
                        placeholder="Full name"
                        value={editForm.name}
                        onChange={e => setEditForm(p => ({ ...p, name: e.target.value }))}
                      />
                      <input
                        className="input"
                        placeholder="Email"
                        type="email"
                        value={editForm.email}
                        onChange={e => setEditForm(p => ({ ...p, email: e.target.value }))}
                      />
                      <select
                        className="input"
                        value={editForm.role}
                        onChange={e => setEditForm(p => ({ ...p, role: e.target.value as 'ADMIN' | 'EMPLOYEE' }))}
                      >
                        <option value="EMPLOYEE">Employee</option>
                        <option value="ADMIN">Admin</option>
                      </select>
                      <div className="exec-pw-wrap">
                        <input
                          className="input"
                          placeholder="New password (leave blank to keep)"
                          type={showEditPw ? 'text' : 'password'}
                          value={editForm.password}
                          onChange={e => setEditForm(p => ({ ...p, password: e.target.value }))}
                        />
                        <button type="button" className="exec-pw-toggle" onClick={() => setShowEditPw(v => !v)} tabIndex={-1}>
                          {showEditPw ? <EyeOff size={14} /> : <Eye size={14} />}
                        </button>
                      </div>
                    </div>
                    <div className="exec-edit-actions">
                      <button className="primary-btn" type="button" onClick={saveEdit} disabled={updateMutation.isPending}>
                        {updateMutation.isPending ? 'Saving…' : 'Save Changes'}
                      </button>
                      <button className="ghost-btn" type="button" onClick={() => setEditingId(null)}>Cancel</button>
                    </div>
                  </div>
                ) : null}
              </div>
            );
          })}
        </Card>

        <Card className="exec-create-card">
          <p className="exec-section-label">New Account</p>
          <div className="exec-form-stack">
            <input
              className="input"
              placeholder="Full name"
              value={createForm.name}
              onChange={e => setCreateForm(p => ({ ...p, name: e.target.value }))}
            />
            <input
              className="input"
              placeholder="Email address"
              type="email"
              value={createForm.email}
              onChange={e => setCreateForm(p => ({ ...p, email: e.target.value }))}
            />

            <div className="exec-divider" />
            <p className="exec-field-label">Role</p>
            <div className="exec-role-group">
              <button
                type="button"
                className={`exec-role-btn${createForm.role === 'EMPLOYEE' ? ' selected' : ''}`}
                onClick={() => setCreateForm(p => ({ ...p, role: 'EMPLOYEE' }))}
              >
                Employee
              </button>
              <button
                type="button"
                className={`exec-role-btn${createForm.role === 'ADMIN' ? ' selected' : ''}`}
                onClick={() => setCreateForm(p => ({ ...p, role: 'ADMIN' }))}
              >
                Admin
              </button>
            </div>

            <div className="exec-divider" />
            <p className="exec-field-label">Password</p>
            <div className="exec-pw-wrap">
              <input
                className="input"
                placeholder="Min 6 characters"
                type={showCreatePw ? 'text' : 'password'}
                value={createForm.password}
                onChange={e => setCreateForm(p => ({ ...p, password: e.target.value }))}
              />
              <button type="button" className="exec-pw-toggle" onClick={() => setShowCreatePw(v => !v)} tabIndex={-1}>
                {showCreatePw ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>

            {createError ? (
              <p className="exec-error">{createError}</p>
            ) : null}

            <button
              className="primary-btn"
              type="button"
              disabled={createMutation.isPending || !canCreate}
              onClick={() => {
                setCreateError('');
                createMutation.mutate(createForm);
              }}
            >
              {createMutation.isPending ? 'Creating…' : 'Create Account'}
            </button>
          </div>
        </Card>
      </div>
    </div>
  );
}
