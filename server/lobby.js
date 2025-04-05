// server/lobby.js
import GameManager from './gameManager.js';
import { getRandomColor } from './utils.js';

const MAX_PLAYERS_PER_LOBBY = 4;
// --- TESTING: Allow starting with 1 player ---
const MIN_PLAYERS_TO_START = 1; // Original value was 2
// --- END TESTING ---

class Lobby {
    constructor(id, io, lobbyManager) {
        this.id = id;
        this.io = io;
        this.lobbyManager = lobbyManager;
        this.players = new Map();
        this.hostId = null;
        this.maxPlayers = MAX_PLAYERS_PER_LOBBY;
        this.gameManager = new GameManager(this.io, this.id);
        this.gameManager.setLobbyReference(this);
        this.lobbyChatHistory = [];
        this.lobbyCanvasCommands = [];
        this.maxLobbyCommands = 500;
    }

    // --- Player Management ---
    addPlayer(socket, username, isHost = false) {
        if (this.isFull()) { socket.emit('join failed', 'Lobby is full.'); return false; }
        if (this.isUsernameTakenByOther(username, socket.id)) { socket.emit('join failed', 'Username taken.'); return false; }

        const playerData = {
            id: socket.id, name: username, color: getRandomColor(),
            isHost: isHost, socket: socket, score: 0,
            hasVoted: false, receivedVotes: 0
        };
        this.players.set(socket.id, playerData);
        socket.join(this.id);

        if (isHost || this.players.size === 1) {
             this.hostId = socket.id;
             playerData.isHost = true;
        }

        console.log(`${username} (${socket.id}) added to lobby ${this.id}. Host: ${playerData.isHost}`);
        this.sendLobbyState(socket); // Send full state to new player
        this.broadcastLobbyPlayerList(); // Update list for others
        // Join message broadcast handled by LobbyManager
        return true;
    }

    removePlayer(socket) {
        const playerData = this.players.get(socket.id);
        if (!playerData) return;
        const username = playerData.name;
        const wasHost = playerData.isHost;
        const leavingSocketId = socket.id;
        const wasOnlyPlayer = this.players.size === 1;
        this.players.delete(leavingSocketId);
        socket.leave(this.id);
        console.log(`${username} (${leavingSocketId}) left lobby ${this.id}.`);

        const isGracePeriod = this.lobbyManager.recentlyCreated.has(this.id);
        if (!(wasOnlyPlayer && isGracePeriod)) {
            console.log(`Broadcasting leave message for ${username}.`);
            this.broadcastSystemMessage(`${username} has left the lobby.`);
        } else {
            console.log(`Suppressing leave message for ${username} (only player leaving during grace period).`);
        }

        this.broadcastLobbyPlayerList(); // Update list immediately

        if (wasHost && this.players.size > 0) {
            const nextHostEntry = this.players.entries().next().value;
            if (nextHostEntry) {
                const [nextHostId, nextHostData] = nextHostEntry;
                this.hostId = nextHostId;
                nextHostData.isHost = true;
                console.log(`Host left. New host: ${nextHostData.name} (${nextHostId})`);
                this.broadcastSystemMessage(`${nextHostData.name} is now the host.`);
                this.broadcastLobbyPlayerList();
                nextHostData.socket.emit('promoted to host');
            }
        } else if (this.players.size === 0) {
            this.hostId = null;
            console.log(`Lobby ${this.id} became empty.`);
        }

        // --- TESTING: Check against the modified MIN_PLAYERS_TO_START ---
        if (this.gameManager.gamePhase !== 'LOBBY' && this.players.size < MIN_PLAYERS_TO_START && this.players.size > 0) {
             console.log(`Lobby ${this.id}: Not enough players (${this.players.size}/${MIN_PLAYERS_TO_START}), stopping game.`);
             this.gameManager.goToLobby();
        }
        // --- END TESTING ---
    }

    isFull() { return this.players.size >= this.maxPlayers; }
    isEmpty() { return this.players.size === 0; }
    isUsernameTaken(username) { return Array.from(this.players.values()).some(p => p.name.toLowerCase() === username.toLowerCase()); }
    isUsernameTakenByOther(username, ownSocketId) { return Array.from(this.players.values()).some(p => p.id !== ownSocketId && p.name.toLowerCase() === username.toLowerCase()); }
    getHostName() { const host = this.players.get(this.hostId); return host ? host.name : 'N/A'; }

    // --- Broadcasting & State ---
    sendLobbyState(socket) {
        const state = {
            lobbyId: this.id,
            players: Array.from(this.players.values(), p => ({ id: p.id, name: p.name, color: p.color, isHost: p.isHost, score: p.score || 0 })),
            hostId: this.hostId,
            chatHistory: this.lobbyChatHistory,
            canvasCommands: this.lobbyCanvasCommands,
            gamePhase: this.gameManager.gamePhase,
            // Send min players needed so UI can reflect the testing change if desired
            minPlayers: MIN_PLAYERS_TO_START
        };
        socket.emit('lobby state', state);
    }

    broadcastLobbyPlayerList() {
        const playerList = Array.from(this.players.values(), p => ({ id: p.id, name: p.name, color: p.color, isHost: p.isHost, score: p.score || 0 }));
        this.io.to(this.id).emit('lobby player list update', playerList);
    }

     broadcastSystemMessage(message) {
        const msgData = { text: message };
        // Add system messages to chat history as well? Optional.
        // this.lobbyChatHistory.push(msgData);
        // if (this.lobbyChatHistory.length > 50) { this.lobbyChatHistory.shift(); }
        this.io.to(this.id).emit('lobby chat message', msgData); // Use lobby chat message for system messages too
    }

    // --- Event Handling ---

    // NEW Method to re-register events (called by LobbyManager on rejoin)
    registerSocketEvents(socket) {
         console.log(`Registering lobby/game events for ${socket.id} in lobby ${this.id}`);
         // Clear potential old listeners first to prevent duplicates
         socket.removeAllListeners('lobby chat message');
         socket.removeAllListeners('lobby draw');
         socket.removeAllListeners('start game');
         socket.removeAllListeners('player ready');
         socket.removeAllListeners('submit vote');
         socket.removeAllListeners('chat message');

         // Add listeners again (forwarding handled by server.js)
         // No actual handlers needed here, just ensures the socket object
         // used by the forwarder has the listeners attached.
         // The forwarder in server.js will call the methods below.
    }

    handleLobbyChatMessage(socket, msg) {
        const senderData = this.players.get(socket.id);
        if (!senderData || typeof msg !== 'string' || msg.trim().length === 0) return;
        const cleanMsg = msg.substring(0, 150);
        const msgData = { senderName: senderData.name, senderColor: senderData.color, text: cleanMsg };
        this.lobbyChatHistory.push(msgData);
        if (this.lobbyChatHistory.length > 50) { this.lobbyChatHistory.shift(); }
        this.io.to(this.id).emit('lobby chat message', msgData);
    }

    handleLobbyDraw(socket, drawData) {
        if (!this.players.has(socket.id) || !drawData) return;
        // Basic validation for draw data type
        if (drawData.type === 'line' && typeof drawData.x0 === 'number') {
            this.lobbyCanvasCommands.push(drawData);
            if (this.lobbyCanvasCommands.length > this.maxLobbyCommands) { this.lobbyCanvasCommands.shift(); }
            // Broadcast to others in the lobby
            socket.to(this.id).emit('lobby draw update', drawData);
        } else if (drawData.type === 'clear') {
            console.log(`Lobby ${this.id}: Clearing canvas commands.`);
            this.lobbyCanvasCommands = []; // Clear history on clear command
            socket.to(this.id).emit('lobby draw update', drawData); // Broadcast clear
        } else {
            console.warn(`Lobby ${this.id}: Invalid lobby draw data from ${socket.id}:`, drawData);
        }
    }


    handleStartGameRequest(socket) {
        if (socket.id !== this.hostId) { socket.emit('system message', 'Only host can start.'); return; }
        // --- TESTING: Check against the modified MIN_PLAYERS_TO_START ---
        if (this.players.size < MIN_PLAYERS_TO_START) {
            socket.emit('system message', `Need ${MIN_PLAYERS_TO_START} player(s) to start (currently ${this.players.size}).`);
            return;
        }
        // --- END TESTING ---
        if (this.gameManager.gamePhase !== 'LOBBY') { socket.emit('system message', `Game already running.`); return; }
        console.log(`Host ${this.players.get(socket.id)?.name} starting game in lobby ${this.id}`);
        this.gameManager.startGame();
    }

    getPlayerCount() { return this.players.size; }
    attemptAutoStartGame() {
        // --- TESTING: Check against the modified MIN_PLAYERS_TO_START ---
        if (this.gameManager.gamePhase === 'LOBBY' && this.players.size >= MIN_PLAYERS_TO_START) {
            console.log(`Lobby ${this.id}: Auto-starting game.`);
            this.gameManager.startGame();
        }
        // --- END TESTING ---
    }
}

export default Lobby;