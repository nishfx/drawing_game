// server/server.js
import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import path from 'path';
import { fileURLToPath } from 'url';
import LobbyManager from './lobbyManager.js';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    path: '/socket.io',
    maxHttpBufferSize: 2e7 // 20MB limit
});

const PORT = process.env.PORT || 3000;
const publicDirectoryPath = path.join(__dirname, '../public');

app.use(express.static(publicDirectoryPath));

// --- HTML Routes ---
app.get('/', (req, res) => res.sendFile(path.join(publicDirectoryPath, 'index.html')));
app.get('/lobby', (req, res) => res.sendFile(path.join(publicDirectoryPath, 'lobby.html')));
app.get('/game', (req, res) => res.sendFile(path.join(publicDirectoryPath, 'game.html')));
// ---

const lobbyManager = new LobbyManager(io);

io.on('connection', (socket) => {
    console.log(`Socket connected: ${socket.id}`);
    let currentLobby = null;

    // --- Lobby Management ---
    socket.on('request lobby list', () => lobbyManager.sendLobbyList(socket));
    socket.on('create lobby', (username) => {
        lobbyManager.createLobby(socket, username);
        currentLobby = lobbyManager.findLobbyBySocketId(socket.id);
    });
    socket.on('join lobby', ({ lobbyId, username }) => {
        lobbyManager.joinLobby(socket, lobbyId, username);
        currentLobby = lobbyManager.findLobbyBySocketId(socket.id);
    });
    socket.on('join game room', ({ lobbyId, username }) => {
        lobbyManager.rejoinGame(socket, lobbyId, username);
        currentLobby = lobbyManager.findLobbyBySocketId(socket.id);
    });

    // --- Lobby Events (Handled by Lobby Instance) ---
    const forwardToLobby = (eventName) => {
        socket.on(eventName, (data) => {
            // Find lobby fresh each time in case of rejoin/disconnect issues
            const lobby = lobbyManager.findLobbyBySocketId(socket.id);
            if (lobby) {
                const handlerName = `handle${eventName.split(' ').map(w => w[0].toUpperCase() + w.slice(1)).join('')}`;
                if (typeof lobby[handlerName] === 'function') {
                    lobby[handlerName](socket, data);
                } else {
                    console.warn(`[Server] No handler '${handlerName}' found in Lobby for event '${eventName}'`);
                }
            } else {
                console.warn(`[Server] Socket ${socket.id} sent '${eventName}' but not in a lobby.`);
            }
        });
    };

    forwardToLobby('update settings'); // NEW
    forwardToLobby('lobby chat message');
    forwardToLobby('lobby draw');
    forwardToLobby('undo last draw');
    forwardToLobby('request ai interpretation'); // Lobby mode AI
    forwardToLobby('start game');

    // --- Game Events (Forwarded to Lobby Instance -> Game Manager) ---
    const forwardToGame = (eventName) => {
         socket.on(eventName, (data) => {
            const lobby = lobbyManager.findLobbyBySocketId(socket.id);
            if (lobby) {
                 const handlerName = `handle${eventName.split(' ').map(w => w[0].toUpperCase() + w.slice(1)).join('')}`;
                 if (typeof lobby[handlerName] === 'function') {
                     lobby[handlerName](socket, data); // Lobby forwards to gameManager
                 } else {
                     console.warn(`[Server] No forwarding handler '${handlerName}' found in Lobby for game event '${eventName}'`);
                 }
            } else {
                 console.warn(`[Server] Socket ${socket.id} sent game event '${eventName}' but not in a lobby.`);
            }
        });
    };

    forwardToGame('player ready');
    forwardToGame('chat message'); // Game chat
    forwardToGame('rate drawing request'); // NEW

    // --- Disconnect ---
    socket.on('disconnect', (reason) => {
        console.log(`Socket disconnected: ${socket.id}. Reason: ${reason}`);
        // LobbyManager handles finding the lobby and removing the player
        lobbyManager.leaveLobby(socket);
        currentLobby = null; // Clear reference just in case
    });
});

// --- Start Server --- (Remains the same)
server.listen(PORT, () => {
    console.log(`Node App Server running on http://localhost:${PORT}`);
    if (!process.env.OPENAI_API_KEY) {
        console.warn('\x1b[33mWarning: OPENAI_API_KEY environment variable is not set. AI features will be disabled.\x1b[0m');
    } else {
        console.log('\x1b[32mOpenAI API Key found. AI features enabled.\x1b[0m');
    }
})
.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
        console.error(`\x1b[31mError: Port ${PORT} is already in use.\x1b[0m`);
    } else {
        console.error('\x1b[31mServer failed to start:\x1b[0m', err);
    }
    process.exit(1);
});