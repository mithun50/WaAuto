const { stmts } = require('../database');

let rules = [];
let enabled = true;

function loadRules() {
  rules = stmts.getEnabledRules.all();
  const setting = stmts.getSetting.get('auto_reply_enabled');
  enabled = setting ? setting.value === '1' : true;
}

function isEnabled() {
  return enabled;
}

function setEnabled(val) {
  enabled = !!val;
  stmts.setSetting.run('auto_reply_enabled', enabled ? '1' : '0');
}

function findMatch(messageBody) {
  if (!enabled || !messageBody) return null;

  const body = messageBody.toLowerCase().trim();

  for (const rule of rules) {
    const keyword = rule.keyword.toLowerCase().trim();

    if (rule.match_mode === 'exact') {
      if (body === keyword) return rule;
    } else {
      // contains mode
      if (body.includes(keyword)) return rule;
    }
  }

  return null;
}

function setupListener(waClient) {
  waClient.on('message', async (msg) => {
    if (msg.fromMe || msg.isStatus) return;

    const match = findMatch(msg.body);
    if (match) {
      try {
        await msg.reply(match.reply);
        stmts.insertLog.run(
          msg.from.replace('@c.us', ''),
          match.reply,
          'sent',
          'text',
          'sent'
        );
      } catch (err) {
        console.error('Auto-reply send error:', err.message);
      }
    }
  });
}

// Load rules on startup
loadRules();

module.exports = { loadRules, findMatch, setupListener, isEnabled, setEnabled };
