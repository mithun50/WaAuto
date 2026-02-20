const express = require('express');
const waClient = require('../services/waClient');

const router = express.Router();

// Get all contacts
router.get('/', async (req, res) => {
  try {
    const client = waClient.getClient();
    if (!client) return res.status(503).json({ error: 'Client not connected' });

    const contacts = await client.getContacts();
    const filtered = contacts
      .filter((c) => c.id.server === 'c.us' && c.isMyContact)
      .map((c) => ({
        id: c.id._serialized,
        name: c.name || c.pushname || c.number,
        number: c.number,
        pushname: c.pushname,
      }));

    res.json(filtered);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get all groups
router.get('/groups', async (req, res) => {
  try {
    const client = waClient.getClient();
    if (!client) return res.status(503).json({ error: 'Client not connected' });

    const chats = await client.getChats();
    const groups = chats
      .filter((c) => c.isGroup)
      .map((c) => ({
        id: c.id._serialized,
        name: c.name,
        participantCount: c.participants ? c.participants.length : 0,
      }));

    res.json(groups);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Check if a number is registered on WhatsApp
router.get('/check/:phone', async (req, res) => {
  try {
    const client = waClient.getClient();
    if (!client) return res.status(503).json({ error: 'Client not connected' });

    const numberId = await client.getNumberId(req.params.phone);
    res.json({ registered: !!numberId, numberId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
