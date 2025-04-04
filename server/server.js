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
const io = new Server(server);

const PORT = process.env.PORT || 3000;

const publicDirectoryPath = path.join(__dirname, '../public');

// --- HTML Routes ---
app.get('/', (req, res) => { res.sendFile(path.join(publicDirectoryPath, 'index.html')); });
app.get('/lobby', (req, res) => { res.sendFile(path.join(publicDirectoryPath, 'lobby.html')); });
app.get('/game', (req, res) => { res.sendFile(path.join(publicDirectoryPath, 'game.html')); });

// --- Serve Static Files (CSS, JS) ---
app.use(express.static(publicDirectoryPath));

// --- Initialize Lobby Manager ---
const lobbyManager = new LobbyManager(io);

// --- Socket.IO Connection Logic ---
io.on('connection', (socket) => {
    console.log(`Socket connected: ${socket.id}`);

    // --- Lobby Management Events ---
    socket.on('request lobby list', () => lobbyManager.sendLobbyList(socket));
    socket.on('create lobby', (username) => lobbyManager.createLobby(socket, username));
    socket.on('join lobby', ({ lobbyId, username }) => lobbyManager.joinLobby(socket, lobbyId, username));

    // --- Lobby & Game Events (Forwarding Logic) ---
    const forwardEvent = (eventName) => {
        socket.on(eventName, (data) => {
            const lobby = lobbyManager.findLobbyBySocketId(socket.id);
            if (lobby) {
                // Construct CamelCase handler names from event names
                const handlerBaseName = eventName
                    .split(' ') // Split by space
                    .map(word => word.charAt(0).toUpperCase() + word.slice(1)) // Capitalize each word
                    .join(''); // Join back together
                const lobbyHandlerName = `handle${handlerBaseName}`; // e.g., handleLobbyChatMessage
                const gameHandlerName = `handle${handlerBaseName}`;  // e.g., handleChatMessage

                // Prioritize Game Manager if game is active
                if (lobby.gameManager && lobby.gameManager.gamePhase !== 'LOBBY' && typeof lobby.gameManager[gameHandlerName] === 'function') {
                    // console.log(`Forwarding '${eventName}' to GameManager as ${gameHandlerName}`);
                    lobby.gameManager[gameHandlerName](socket, data);
                }
                // Otherwise, check Lobby instance
                else if (typeof lobby[lobbyHandlerName] === 'function') {
                    // console.log(`Forwarding '${eventName}' to Lobby as ${lobbyHandlerName}`);
                    lobby[lobbyHandlerName](socket, data);
                }
                // Fallback checks (less ideal)
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

    // Register events to be forwarded
    forwardEvent('lobby chat message');
    forwardEvent('lobby draw');
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
    console.log(`Server running on http://localhost:${PORT}`);
})
.on('error', (err) => {
    if (err.code === 'EADDRINUSE') { console.error(`\x1b[31mError: Port ${PORT} is already in use.\x1b[0m`); }
    else { console.error('\x1b[31mServer failed to start:\x1b[0m', err); }
    process.exit(1);
});