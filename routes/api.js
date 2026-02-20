const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { stmts } = require('../database');
const waClient = require('../services/waClient');
const autoReply = require('../services/autoReply');

const router = express.Router();

// Multer setup for media uploads
const uploadDir = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const upload = multer({
  dest: uploadDir,
  limits: { fileSize: 16 * 1024 * 1024 }, // 16MB
});

// --- Status ---
router.get('/status', (req, res) => {
  res.json(waClient.getStatus());
});

// --- Bulk Messaging ---
router.post('/bulk-send', upload.single('media'), async (req, res) => {
  const { phones, message, delay } = req.body;
  const mediaPath = req.file ? req.file.path : null;

  if (!phones || (!message && !mediaPath)) {
    return res.status(400).json({ error: 'Phones and message (or media) are required' });
  }

  const phoneList = phones
    .split('\n')
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  if (phoneList.length === 0) {
    return res.status(400).json({ error: 'No valid phone numbers provided' });
  }

  const delayMs = parseInt(delay) || 3000;
  const io = req.app.get('io');

  // Process in background
  res.json({ queued: phoneList.length, status: 'processing' });

  let sent = 0;
  let failed = 0;

  for (let i = 0; i < phoneList.length; i++) {
    const phone = phoneList[i];
    try {
      await waClient.sendMessage(phone, message, mediaPath);
      sent++;
    } catch (err) {
      failed++;
      stmts.insertLog.run(phone, message || '[media]', 'sent', mediaPath ? 'media' : 'text', 'failed');
    }

    io.emit('bulk_progress', {
      total: phoneList.length,
      sent,
      failed,
      remaining: phoneList.length - sent - failed,
      current: phone,
    });

    // Delay between messages (except after last)
    if (i < phoneList.length - 1) {
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }

  // Cleanup uploaded file
  if (mediaPath) {
    fs.unlink(mediaPath, () => {});
  }

  io.emit('bulk_complete', { sent, failed, total: phoneList.length });
});

// --- Single message ---
router.post('/send', async (req, res) => {
  const { phone, message } = req.body;
  if (!phone || !message) {
    return res.status(400).json({ error: 'Phone and message are required' });
  }
  try {
    await waClient.sendMessage(phone, message);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Auto-Reply Rules ---
router.get('/auto-replies', (req, res) => {
  const rules = stmts.getAllRules.all();
  const enabled = autoReply.isEnabled();
  res.json({ enabled, rules });
});

router.post('/auto-replies', (req, res) => {
  const { keyword, reply, match_mode } = req.body;
  if (!keyword || !reply) {
    return res.status(400).json({ error: 'Keyword and reply are required' });
  }
  const result = stmts.insertRule.run(keyword, reply, match_mode || 'contains', 1);
  autoReply.loadRules();
  res.json({ id: result.lastInsertRowid, success: true });
});

router.put('/auto-replies/:id', (req, res) => {
  const { keyword, reply, match_mode, enabled } = req.body;
  const existing = stmts.getRuleById.get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Rule not found' });

  stmts.updateRule.run(
    keyword ?? existing.keyword,
    reply ?? existing.reply,
    match_mode ?? existing.match_mode,
    enabled !== undefined ? (enabled ? 1 : 0) : existing.enabled,
    req.params.id
  );
  autoReply.loadRules();
  res.json({ success: true });
});

router.delete('/auto-replies/:id', (req, res) => {
  stmts.deleteRule.run(req.params.id);
  autoReply.loadRules();
  res.json({ success: true });
});

router.post('/auto-replies/toggle', (req, res) => {
  const { enabled } = req.body;
  autoReply.setEnabled(enabled);
  res.json({ enabled: autoReply.isEnabled() });
});

// --- Scheduled Messages ---
router.get('/scheduled', (req, res) => {
  const messages = stmts.getAllScheduled.all();
  res.json(messages);
});

router.post('/scheduled', (req, res) => {
  const { phone, message, scheduled_at } = req.body;
  if (!phone || !message || !scheduled_at) {
    return res.status(400).json({ error: 'Phone, message, and scheduled_at are required' });
  }
  const result = stmts.insertScheduled.run(phone, message, scheduled_at);
  res.json({ id: result.lastInsertRowid, success: true });
});

router.delete('/scheduled/:id', (req, res) => {
  stmts.deleteScheduled.run(req.params.id);
  res.json({ success: true });
});

// --- Message Logs ---
router.get('/logs', (req, res) => {
  const limit = parseInt(req.query.limit) || 100;
  const logs = stmts.getLogs.all(limit);
  res.json(logs);
});

router.get('/stats', (req, res) => {
  const stats = stmts.getLogStats.get();
  res.json(stats);
});

// --- Settings ---
router.get('/settings', (req, res) => {
  const bulkDelay = stmts.getSetting.get('bulk_delay_ms');
  const autoReplyEnabled = stmts.getSetting.get('auto_reply_enabled');
  res.json({
    bulk_delay_ms: bulkDelay ? parseInt(bulkDelay.value) : 3000,
    auto_reply_enabled: autoReplyEnabled ? autoReplyEnabled.value === '1' : true,
  });
});

router.put('/settings', (req, res) => {
  const { bulk_delay_ms, auto_reply_enabled } = req.body;
  if (bulk_delay_ms !== undefined) {
    stmts.setSetting.run('bulk_delay_ms', String(bulk_delay_ms));
  }
  if (auto_reply_enabled !== undefined) {
    autoReply.setEnabled(auto_reply_enabled);
  }
  res.json({ success: true });
});

// --- Logout ---
router.post('/logout', async (req, res) => {
  try {
    await waClient.logout();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
