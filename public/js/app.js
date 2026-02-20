/* global io */
const socket = io();

// ---- Toast notifications ----
const toastContainer = document.createElement('div');
toastContainer.className = 'toast-container';
document.body.appendChild(toastContainer);

function toast(message, type = 'info') {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = message;
  toastContainer.appendChild(el);
  setTimeout(() => el.remove(), 4000);
}

// ---- Tab navigation ----
document.querySelectorAll('.nav-link').forEach((link) => {
  link.addEventListener('click', (e) => {
    e.preventDefault();
    const tab = link.dataset.tab;
    document.querySelectorAll('.nav-link').forEach((l) => l.classList.remove('active'));
    document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
    link.classList.add('active');
    document.getElementById(`tab-${tab}`).classList.add('active');

    // Load data for the tab
    if (tab === 'autoreply') loadRules();
    if (tab === 'scheduler') loadScheduled();
    if (tab === 'logs') loadLogs();
    if (tab === 'dashboard') loadStats();
  });
});

// ---- Socket.IO events ----
socket.on('status', (data) => {
  updateConnectionStatus(data.status, data.info, data.error);
});

socket.on('qr', (qrDataUrl) => {
  document.getElementById('qr-image').src = qrDataUrl;
  document.getElementById('qr-container').style.display = 'block';
  document.getElementById('connected-info').style.display = 'none';
  document.getElementById('disconnected-info').style.display = 'none';
});

socket.on('ready', (info) => {
  updateConnectionStatus('connected', info);
  toast('WhatsApp connected!', 'success');
});

socket.on('auth_failure', () => {
  toast('Authentication failed. Please restart.', 'error');
});

socket.on('bulk_progress', (data) => {
  const pct = ((data.sent + data.failed) / data.total) * 100;
  document.getElementById('bulk-progress-fill').style.width = `${pct}%`;
  document.getElementById('bp-sent').textContent = data.sent;
  document.getElementById('bp-failed').textContent = data.failed;
  document.getElementById('bp-remaining').textContent = data.remaining;
  document.getElementById('bp-current').textContent = `Current: ${data.current}`;
});

socket.on('bulk_complete', (data) => {
  toast(`Bulk send complete: ${data.sent} sent, ${data.failed} failed`, data.failed > 0 ? 'error' : 'success');
  document.getElementById('bp-current').textContent = 'Complete!';
});

socket.on('scheduled_sent', (data) => {
  toast(`Scheduled message to ${data.phone}: ${data.status}`, data.status === 'sent' ? 'success' : 'error');
  loadScheduled();
});

socket.on('message_received', () => {
  // Update stats if on dashboard
  if (document.getElementById('tab-dashboard').classList.contains('active')) {
    loadStats();
  }
});

// ---- Connection status ----
function updateConnectionStatus(status, info, error) {
  const badge = document.getElementById('connection-badge');
  badge.className = `badge ${status === 'qr' ? 'scanning' : status}`;
  badge.textContent = status === 'qr' ? 'Scanning...' : status === 'connected' ? 'Connected' : 'Disconnected';

  if (status === 'connected' && info) {
    document.getElementById('qr-container').style.display = 'none';
    document.getElementById('disconnected-info').style.display = 'none';
    document.getElementById('connected-info').style.display = 'block';
    document.getElementById('info-name').textContent = info.pushname || '-';
    document.getElementById('info-phone').textContent = info.phone || '-';
    document.getElementById('info-platform').textContent = info.platform || '-';
  } else if (status === 'disconnected') {
    document.getElementById('qr-container').style.display = 'none';
    document.getElementById('connected-info').style.display = 'none';
    document.getElementById('disconnected-info').style.display = 'block';
    const errEl = document.getElementById('init-error');
    if (error) {
      errEl.textContent = error;
      errEl.style.display = 'block';
    } else {
      errEl.style.display = 'none';
    }
  }
}

// ---- Stats ----
async function loadStats() {
  try {
    const res = await fetch('/api/stats');
    const stats = await res.json();
    document.getElementById('stat-total').textContent = stats.total || 0;
    document.getElementById('stat-sent').textContent = stats.sent || 0;
    document.getElementById('stat-received').textContent = stats.received || 0;
    document.getElementById('stat-failed').textContent = stats.failed || 0;
  } catch (err) {
    console.error('Failed to load stats:', err);
  }
}

// ---- Bulk messaging ----
document.getElementById('bulk-form').addEventListener('submit', async (e) => {
  e.preventDefault();

  const phones = document.getElementById('bulk-phones').value.trim();
  const message = document.getElementById('bulk-message').value.trim();
  const mediaInput = document.getElementById('bulk-media');
  const delay = document.getElementById('bulk-delay').value;

  if (!phones || (!message && !mediaInput.files.length)) {
    toast('Please provide phone numbers and a message or media', 'error');
    return;
  }

  const formData = new FormData();
  formData.append('phones', phones);
  formData.append('message', message);
  formData.append('delay', delay);
  if (mediaInput.files.length) {
    formData.append('media', mediaInput.files[0]);
  }

  document.getElementById('bulk-progress-area').style.display = 'block';
  document.getElementById('bulk-progress-fill').style.width = '0%';

  try {
    await fetch('/api/bulk-send', { method: 'POST', body: formData });
  } catch (err) {
    toast('Failed to start bulk send: ' + err.message, 'error');
  }
});

// ---- Auto-reply rules ----
async function loadRules() {
  try {
    const res = await fetch('/api/auto-replies');
    const data = await res.json();

    document.getElementById('autoreply-toggle').checked = data.enabled;

    const tbody = document.getElementById('rules-table-body');
    if (!data.rules.length) {
      tbody.innerHTML = '<tr><td colspan="5" class="empty-row">No rules configured</td></tr>';
      return;
    }

    tbody.innerHTML = data.rules
      .map(
        (r) => `
      <tr>
        <td>${esc(r.keyword)}</td>
        <td>${esc(r.reply)}</td>
        <td>${r.match_mode}</td>
        <td>
          <span class="status-badge ${r.enabled ? 'sent' : 'failed'}">${r.enabled ? 'On' : 'Off'}</span>
        </td>
        <td>
          <button class="btn-icon" onclick="toggleRule(${r.id}, ${r.enabled ? 0 : 1})">${r.enabled ? 'Disable' : 'Enable'}</button>
          <button class="btn-icon danger" onclick="deleteRule(${r.id})">Delete</button>
        </td>
      </tr>`
      )
      .join('');
  } catch (err) {
    console.error('Failed to load rules:', err);
  }
}

document.getElementById('rule-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const keyword = document.getElementById('rule-keyword').value.trim();
  const reply = document.getElementById('rule-reply').value.trim();
  const match_mode = document.getElementById('rule-mode').value;

  if (!keyword || !reply) return;

  try {
    await fetch('/api/auto-replies', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ keyword, reply, match_mode }),
    });
    document.getElementById('rule-keyword').value = '';
    document.getElementById('rule-reply').value = '';
    toast('Rule added', 'success');
    loadRules();
  } catch (err) {
    toast('Failed to add rule', 'error');
  }
});

document.getElementById('autoreply-toggle').addEventListener('change', async (e) => {
  try {
    await fetch('/api/auto-replies/toggle', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: e.target.checked }),
    });
    toast(`Auto-reply ${e.target.checked ? 'enabled' : 'disabled'}`, 'info');
  } catch (err) {
    toast('Failed to toggle auto-reply', 'error');
  }
});

// Global functions for inline onclick handlers
window.toggleRule = async function (id, enabled) {
  try {
    await fetch(`/api/auto-replies/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: !!enabled }),
    });
    loadRules();
  } catch (err) {
    toast('Failed to update rule', 'error');
  }
};

window.deleteRule = async function (id) {
  if (!confirm('Delete this rule?')) return;
  try {
    await fetch(`/api/auto-replies/${id}`, { method: 'DELETE' });
    toast('Rule deleted', 'success');
    loadRules();
  } catch (err) {
    toast('Failed to delete rule', 'error');
  }
};

// ---- Scheduled messages ----
async function loadScheduled() {
  try {
    const res = await fetch('/api/scheduled');
    const messages = await res.json();

    const tbody = document.getElementById('scheduled-table-body');
    if (!messages.length) {
      tbody.innerHTML = '<tr><td colspan="5" class="empty-row">No scheduled messages</td></tr>';
      return;
    }

    tbody.innerHTML = messages
      .map(
        (m) => `
      <tr>
        <td>${esc(m.phone)}</td>
        <td>${esc(m.message)}</td>
        <td>${formatDate(m.scheduled_at)}</td>
        <td><span class="status-badge ${m.status}">${m.status}</span></td>
        <td>
          ${m.status === 'pending' ? `<button class="btn-icon danger" onclick="deleteScheduled(${m.id})">Cancel</button>` : '-'}
        </td>
      </tr>`
      )
      .join('');
  } catch (err) {
    console.error('Failed to load scheduled:', err);
  }
}

document.getElementById('schedule-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const phone = document.getElementById('sched-phone').value.trim();
  const message = document.getElementById('sched-message').value.trim();
  const datetime = document.getElementById('sched-datetime').value;

  if (!phone || !message || !datetime) return;

  const scheduled_at = new Date(datetime).toISOString();

  try {
    await fetch('/api/scheduled', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone, message, scheduled_at }),
    });
    document.getElementById('sched-phone').value = '';
    document.getElementById('sched-message').value = '';
    document.getElementById('sched-datetime').value = '';
    toast('Message scheduled', 'success');
    loadScheduled();
  } catch (err) {
    toast('Failed to schedule message', 'error');
  }
});

window.deleteScheduled = async function (id) {
  if (!confirm('Cancel this scheduled message?')) return;
  try {
    await fetch(`/api/scheduled/${id}`, { method: 'DELETE' });
    toast('Scheduled message cancelled', 'success');
    loadScheduled();
  } catch (err) {
    toast('Failed to cancel', 'error');
  }
};

// ---- Message logs ----
async function loadLogs() {
  try {
    const res = await fetch('/api/logs?limit=100');
    const logs = await res.json();

    const tbody = document.getElementById('logs-table-body');
    if (!logs.length) {
      tbody.innerHTML = '<tr><td colspan="6" class="empty-row">No logs yet</td></tr>';
      return;
    }

    tbody.innerHTML = logs
      .map(
        (l) => `
      <tr>
        <td>${esc(l.phone)}</td>
        <td>${esc(l.message || '')}</td>
        <td><span class="status-badge ${l.direction}">${l.direction}</span></td>
        <td>${l.type}</td>
        <td><span class="status-badge ${l.status}">${l.status}</span></td>
        <td>${formatDate(l.created_at)}</td>
      </tr>`
      )
      .join('');
  } catch (err) {
    console.error('Failed to load logs:', err);
  }
}

document.getElementById('btn-refresh-logs').addEventListener('click', loadLogs);

// ---- Logout ----
document.getElementById('btn-logout').addEventListener('click', async () => {
  if (!confirm('Logout from WhatsApp?')) return;
  try {
    await fetch('/api/logout', { method: 'POST' });
    toast('Logged out', 'info');
  } catch (err) {
    toast('Logout failed', 'error');
  }
});

// ---- Helpers ----
function esc(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function formatDate(dateStr) {
  if (!dateStr) return '-';
  const d = new Date(dateStr);
  return d.toLocaleString();
}

// ---- Initial load ----
loadStats();
