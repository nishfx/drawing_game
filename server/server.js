// server/server.js
import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import path from 'path';
import { fileURLToPath } from 'url';
import LobbyManager from './lobbyManager.js';

// --- ES Module __dirname setup ---
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// ---

const app = express();
const server = http.createServer(app);
// --- Correct Socket.IO path (Assuming Nginx removes /game prefix for this path) ---
const io = new Server(server, {
    path: '/socket.io', // Nginx forwards /game/socket.io -> /socket.io
    maxHttpBufferSize: 1e7 // Increase limit for potentially larger canvas data (10MB)
});
// --- End Correct ---

const PORT = process.env.PORT || 3000; // Node listens on 3000

const publicDirectoryPath = path.join(__dirname, '../public');

// --- Serve Static Files (CSS, JS, Images etc.) ---
// Serve static files directly from public. Nginx requests for /game/style.css
// will likely be proxied to Node as /style.css (if Nginx strips prefix for static too)
// or Nginx might serve static files directly itself. This covers the proxy case.
app.use(express.static(publicDirectoryPath));

// --- Specific HTML Routes ---
// Node handles routes WITHOUT the /game/ prefix, as Nginx strips it.

// Root path '/' (coming from Nginx proxying /game/) serves the start page index.html
app.get('/', (req, res) => {
    console.log(`Serving index.html for request path: ${req.path}`);
    res.sendFile(path.join(publicDirectoryPath, 'index.html'));
});

// Serve lobby.html for /lobby path (coming from Nginx proxying /game/lobby)
app.get('/lobby', (req, res) => {
     console.log(`Serving lobby.html for request path: ${req.path}`);
    res.sendFile(path.join(publicDirectoryPath, 'lobby.html'));
});

// Serve game.html for /game path (coming from Nginx proxying /game/game)
app.get('/game', (req, res) => {
     console.log(`Serving game.html for request path: ${req.path}`);
    res.sendFile(path.join(publicDirectoryPath, 'game.html'));
});


const lobbyManager = new LobbyManager(io);

io.on('connection', (socket) => {
    console.log(`Socket connected: ${socket.id}`);

    // --- Lobby Management Events ---
    socket.on('request lobby list', () => lobbyManager.sendLobbyList(socket));
    socket.on('create lobby', (username) => lobbyManager.createLobby(socket, username));
    socket.on('join lobby', ({ lobbyId, username }) => lobbyManager.joinLobby(socket, lobbyId, username));
    // Game client connects to the same socket.io endpoint
    socket.on('join game room', ({ lobbyId, username }) => lobbyManager.rejoinGame(socket, lobbyId, username));

    // --- Lobby & Game Events (Forwarding Logic - Unchanged) ---
    const forwardEvent = (eventName) => {
        socket.on(eventName, (data) => {
            const lobby = lobbyManager.findLobbyBySocketId(socket.id);
            if (lobby) {
                // Construct CamelCase handler names from event names
                const handlerBaseName = eventName
                    .split(' ')
                    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
                    .join('');
                const lobbyHandlerName = `handle${handlerBaseName}`;
                const gameHandlerName = `handle${handlerBaseName}`;

                // Prioritize Game Manager if game is active
                if (lobby.gameManager && lobby.gameManager.gamePhase !== 'LOBBY' && typeof lobby.gameManager[gameHandlerName] === 'function') {
                    lobby.gameManager[gameHandlerName](socket, data);
                }
                // Otherwise, check Lobby instance
                else if (typeof lobby[lobbyHandlerName] === 'function') {
                    lobby[lobbyHandlerName](socket, data);
                }
                 else if (lobby.gameManager && typeof lobby.gameManager[eventName] === 'function') {
                     console.warn(`Using direct event name fallback for game ${eventName}`);
                     lobby.gameManager[eventName](socket, data);
                 }
                 else if (typeof lobby[eventName] === 'function') {
                     console.warn(`Using direct event name fallback for lobby ${eventName}`);
                     lobby[eventName](socket, data);
                 }
                else {
                     console.warn(`No handler found for event '${eventName}' (tried ${lobbyHandlerName} / ${gameHandlerName}) in lobby ${lobby.id}.`);
                }
            } else {
                console.warn(`Socket ${socket.id} sent event '${eventName}' but is not in a lobby.`);
            }
        });
    };

    // Register events to be forwarded (including new undo event)
    forwardEvent('lobby chat message');
    forwardEvent('lobby draw'); // Handles line, fill, shape, clear
    forwardEvent('undo last draw'); // New event for undo
    forwardEvent('start game');
    forwardEvent('player ready');
    forwardEvent('submit vote');
    forwardEvent('chat message'); // Game chat

    // --- Disconnect ---
    socket.on('disconnect', () => {
        console.log(`Socket disconnected: ${socket.id}`);
        lobbyManager.leaveLobby(socket);
    });
});

// --- Start the Server ---
server.listen(PORT, () => {
    console.log(`Node App Server running on http://localhost:${PORT}`); // Log internal port
})
.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
        console.error(`\x1b[31mError: Port ${PORT} is already in use.\x1b[0m`);
        console.error(`Please close the other application using port ${PORT}.`);
    } else {
        console.error('\x1b[31mServer failed to start:\x1b[0m', err);
    }
    process.exit(1);
});