const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

// Initialize database (creates tables on first run)
require('./database');

const apiRoutes = require('./routes/api');
const contactRoutes = require('./routes/contacts');
const waClient = require('./services/waClient');
const autoReply = require('./services/autoReply');
const scheduler = require('./services/scheduler');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Make io accessible in routes
app.set('io', io);

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// API routes
app.use('/api', apiRoutes);
app.use('/api/contacts', contactRoutes);

// Socket.IO connection
io.on('connection', (socket) => {
  console.log('Dashboard client connected');
  // Send current status to newly connected client
  socket.emit('status', waClient.getStatus());
});

// Initialize WhatsApp client
const client = waClient.initialize(io);

// Setup auto-reply listener
autoReply.setupListener(client);

// Start message scheduler
scheduler.start(io);

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`WA Auto dashboard running at http://localhost:${PORT}`);
});
