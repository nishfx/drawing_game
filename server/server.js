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
// --- Correct Socket.IO path ---
const io = new Server(server, { path: '/game/socket.io' }); // Tell server where client expects Socket.IO
// --- End Correct ---

const PORT = process.env.PORT || 3000; // Node listens on 3000

const publicDirectoryPath = path.join(__dirname, '../public');

// --- Serve Static Files (CSS, JS, etc.) ---
// Mount static files under /game/ path as well
app.use('/game', express.static(publicDirectoryPath));

// --- Specific HTML Routes ---
// Root serves the start page (index.html is served by express.static under /game/)
app.get('/game', (req, res) => {
    res.sendFile(path.join(publicDirectoryPath, 'index.html'));
});

// Serve lobby.html for /game/lobby path
app.get('/game/lobby', (req, res) => {
    res.sendFile(path.join(publicDirectoryPath, 'lobby.html'));
});

// Serve game.html for /game/game path
app.get('/game/game', (req, res) => {
    res.sendFile(path.join(publicDirectoryPath, 'game.html'));
});

// Optional: Redirect base path to /game/
app.get('/', (req, res) => {
    res.redirect('/game/');
});


const lobbyManager = new LobbyManager(io);

io.on('connection', (socket) => {
    console.log(`Socket connected: ${socket.id}`);

    // --- Lobby Management Events ---
    socket.on('request lobby list', () => lobbyManager.sendLobbyList(socket));
    socket.on('create lobby', (username) => lobbyManager.createLobby(socket, username));
    socket.on('join lobby', ({ lobbyId, username }) => lobbyManager.joinLobby(socket, lobbyId, username));
    socket.on('join game room', ({ lobbyId, username }) => lobbyManager.rejoinGame(socket, lobbyId, username)); // Handle game rejoin

    // --- Lobby & Game Events (Forwarding Logic) ---
    const forwardEvent = (eventName) => {
        socket.on(eventName, (data) => {
            const lobby = lobbyManager.findLobbyBySocketId(socket.id);
            if (lobby) {
                const handlerBaseName = eventName.split(' ').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join('');
                const lobbyHandlerName = `handle${handlerBaseName}`;
                const gameHandlerName = `handle${handlerBaseName}`;

                if (lobby.gameManager && lobby.gameManager.gamePhase !== 'LOBBY' && typeof lobby.gameManager[gameHandlerName] === 'function') {
                    lobby.gameManager[gameHandlerName](socket, data);
                }
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

    forwardEvent('lobby chat message');
    forwardEvent('lobby draw');
    forwardEvent('start game');
    forwardEvent('player ready');
    forwardEvent('submit vote');
    forwardEvent('chat message'); // Game chat

    socket.on('disconnect', () => {
        console.log(`Socket disconnected: ${socket.id}`);
        lobbyManager.leaveLobby(socket);
    });
});

server.listen(PORT, () => { console.log(`Node App Server running on http://localhost:${PORT}`); });
server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') { console.error(`\x1b[31mError: Port ${PORT} is already in use.\x1b[0m`); }
    else { console.error('\x1b[31mServer failed to start:\x1b[0m', err); }
    process.exit(1);
});