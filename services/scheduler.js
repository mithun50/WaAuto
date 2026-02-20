const cron = require('node-cron');
const { stmts } = require('../database');
const waClient = require('./waClient');

let cronJob = null;
let io = null;

function start(socketIo) {
  io = socketIo;

  // Check every 30 seconds for due messages
  cronJob = cron.schedule('*/30 * * * * *', async () => {
    const pending = stmts.getPendingScheduled.all();

    for (const msg of pending) {
      try {
        await waClient.sendMessage(msg.phone, msg.message);
        stmts.updateScheduledStatus.run('sent', new Date().toISOString(), null, msg.id);
        if (io) {
          io.emit('scheduled_sent', { id: msg.id, phone: msg.phone, status: 'sent' });
        }
        console.log(`Scheduled message sent to ${msg.phone}`);
      } catch (err) {
        stmts.updateScheduledStatus.run('failed', null, err.message, msg.id);
        if (io) {
          io.emit('scheduled_sent', { id: msg.id, phone: msg.phone, status: 'failed', error: err.message });
        }
        console.error(`Scheduled message failed for ${msg.phone}:`, err.message);
      }
    }
  });

  console.log('Message scheduler started');
}

function stop() {
  if (cronJob) {
    cronJob.stop();
    cronJob = null;
  }
}

module.exports = { start, stop };
