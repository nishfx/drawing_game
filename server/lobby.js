// server/lobby.js
import ArtistPvpGame from './modes/artistPvpGame.js'; // Default mode for now
// import OtherGameMode from './modes/otherGameMode.js'; // Example for future
import { getRandomColor } from './utils.js';
import { interpretImage } from './aiService.js';

const MAX_PLAYERS_PER_LOBBY = 4;
const MIN_PLAYERS_TO_START = 1; // Keep low for testing

class Lobby {
    constructor(id, io, lobbyManager) {
        this.id = id;
        this.io = io;
        this.lobbyManager = lobbyManager;
        this.players = new Map();
        this.hostId = null;
        this.maxPlayers = MAX_PLAYERS_PER_LOBBY;

        // --- Game Settings ---
        this.settings = {
            gameMode: 'ArtistPvp', // Default mode
            totalRounds: 3,
            drawTime: 90,
            // Add other mode-specific settings here later
        };
        // ---

        // Game manager instance (will be replaced on game start)
        this.gameManager = null; // Start with no game manager

        this.lobbyChatHistory = [];
        this.lobbyCanvasCommands = [];
        this.maxLobbyCommands = 1000;

        this.lastAiRequestTime = 0;
        this.aiRequestCooldownMs = 10000;
    }

    // --- Player Management --- (addPlayer, removePlayer - slight changes)
     addPlayer(socket, username, isHost = false) {
        if (this.players.has(socket.id)) {
            console.warn(`[Lobby ${this.id}] addPlayer: socket already present: ${socket.id}`);
            return false;
        }

        const playerData = {
            id: socket.id,
            name: username,
            color: getRandomColor(),
            isHost: isHost,
            socket: socket,
            score: 0,
        };
        this.players.set(socket.id, playerData);
        socket.join(this.id);

        if (isHost || !this.hostId) {
            this.hostId = socket.id;
            playerData.isHost = true;
            this.players.forEach(p => {
                if (p.id !== this.hostId) p.isHost = false;
            });
        }

        console.log(`[Lobby ${this.id}] ${username} (${socket.id}) added. Host? ${playerData.isHost}. Players: ${this.players.size}`);

        this.broadcastSystemMessage(`${username} has joined the lobby.`);
        this.sendLobbyState(socket); // Send lobby state (includes settings)
        this.broadcastLobbyPlayerList();

        // If a game is *already* running, send the game state to the joining player
        if (this.gameManager && this.gameManager.gamePhase !== 'LOBBY') {
             this.gameManager.broadcastGameState(); // Send to all (including new player)
             // Send player their specific word if drawing phase (if applicable to mode)
             if(this.gameManager.gamePhase === 'DRAWING' && typeof this.gameManager.sendPlayerSpecificState === 'function') {
                 this.gameManager.sendPlayerSpecificState(socket.id);
             }
        }
        return true;
    }

     removePlayer(socket, opts = {}) {
        const socketId = socket.id;
        const playerData = this.players.get(socketId);
        if (!playerData) return;

        const username = playerData.name;
        const wasHost = playerData.isHost;
        console.log(`[Lobby ${this.id}] Removing player ${username} (${socketId}). Players before: ${this.players.size}`);
        this.players.delete(socketId);
        try { socket.leave(this.id); } catch (e) { console.warn(`[Lobby ${this.id}] Error leaving room for ${socketId}: ${e.message}`); }

        // Remove lobby commands
        this.lobbyCanvasCommands = this.lobbyCanvasCommands.filter(cmd => cmd.playerId !== socketId);

        // Notify game manager if game is running
        if (this.gameManager && this.gameManager.gamePhase !== 'LOBBY') {
            this.gameManager.handlePlayerDisconnect(socketId);
        }

        if (!opts.silent) { this.broadcastSystemMessage(`${username} has left the lobby.`); }

        // Promote new host
        if (wasHost && this.players.size > 0) {
            const nextHostEntry = this.players.entries().next().value;
            if (nextHostEntry) {
                const [nextHostId, nextHostData] = nextHostEntry;
                this.hostId = nextHostId;
                nextHostData.isHost = true;
                this.broadcastSystemMessage(`${nextHostData.name} is now the host.`);
                if (nextHostData.socket) nextHostData.socket.emit('promoted to host');
            } else { this.hostId = null; }
        } else if (this.players.size === 0) { this.hostId = null; }

        this.broadcastLobbyPlayerList();
        console.log(`[Lobby ${this.id}] Player removed. Players after: ${this.players.size}`);
    }

    // ... isFull, isEmpty, isUsernameTaken, isUsernameTakenByOther, getHostName ... (keep as is)
    isFull() { return this.players.size >= this.maxPlayers; }
    isEmpty() { return this.players.size === 0; }
    isUsernameTaken(username) { return Array.from(this.players.values()).some(p => p.name.toLowerCase() === username.toLowerCase()); }
    isUsernameTakenByOther(username, ownSocketId) { const lower = username.toLowerCase(); for (const [id, p] of this.players.entries()) { if (id !== ownSocketId && p.name.toLowerCase() === lower) return true; } return false; }
    getHostName() { const host = this.players.get(this.hostId); return host ? host.name : 'N/A'; }


    // --- State and Broadcasting ---
    sendLobbyState(socket) {
        // Sends LOBBY state (shared canvas, chat, settings)
        const state = {
            lobbyId: this.id,
            players: Array.from(this.players.values(), p => ({ id: p.id, name: p.name, color: p.color, isHost: p.isHost, score: p.score || 0 })),
            hostId: this.hostId,
            chatHistory: this.lobbyChatHistory,
            canvasCommands: this.lobbyCanvasCommands,
            settings: this.settings, // Send current settings
            // Game phase is determined by gameManager instance if it exists
            gamePhase: this.gameManager?.gamePhase || 'LOBBY',
            minPlayers: this.gameManager?.minPlayers || MIN_PLAYERS_TO_START // Use game's min players if set
        };
        socket.emit('lobby state', state);
    }

    broadcastLobbyPlayerList() {
        const playerList = Array.from(this.players.values(), p => ({ id: p.id, name: p.name, color: p.color, isHost: p.isHost, score: p.score || 0 }));
        this.io.to(this.id).emit('lobby player list update', playerList);
    }

    broadcastSystemMessage(msg) {
        const data = { text: msg, type: 'system' };
        // Send to both lobby and game chat contexts
        this.io.to(this.id).emit('lobby chat message', data);
        this.io.to(this.id).emit('chat message', data);
    }

    // --- Event Handlers ---

    // --- NEW: Handle Settings Update from Host ---
    handleUpdateSettings(socket, newSettings) {
        if (socket.id !== this.hostId) {
            this.sendToPlayer(socket.id, 'system message', 'Only the host can change settings.');
            return;
        }
        if (this.gameManager && this.gameManager.gamePhase !== 'LOBBY') {
             this.sendToPlayer(socket.id, 'system message', 'Cannot change settings while a game is running.');
             return;
        }

        // Validate and update settings
        let updated = false;
        if (newSettings.gameMode && typeof newSettings.gameMode === 'string') { // Add validation later
            this.settings.gameMode = newSettings.gameMode;
            updated = true;
        }
        const rounds = parseInt(newSettings.totalRounds, 10);
        if (!isNaN(rounds) && rounds >= 1 && rounds <= 10) {
            this.settings.totalRounds = rounds;
            updated = true;
        }
        const time = parseInt(newSettings.drawTime, 10);
        if (!isNaN(time) && time >= 30 && time <= 180) {
            this.settings.drawTime = time;
            updated = true;
        }

        if (updated) {
            console.log(`[Lobby ${this.id}] Settings updated by host:`, this.settings);
            // Broadcast new settings to all players in the lobby
            this.io.to(this.id).emit('lobby settings update', this.settings);
        }
    }


    handleLobbyChatMessage(socket, msg) {
        // Allow chat anytime, but maybe indicate if game is running?
        const sender = this.players.get(socket.id);
        if (!sender || typeof msg !== 'string' || msg.trim().length === 0) return;
        const cleanMsg = msg.substring(0, 150);
        const msgData = { senderName: sender.name, senderColor: sender.color, text: cleanMsg };

        // If in lobby phase, add to history and send to lobby chat
        if (!this.gameManager || this.gameManager.gamePhase === 'LOBBY') {
            this.lobbyChatHistory.push(msgData);
            if (this.lobbyChatHistory.length > 50) this.lobbyChatHistory.shift();
            this.io.to(this.id).emit('lobby chat message', msgData);
        } else {
            // If game is running, send to game chat via game manager
            this.gameManager.handleChatMessage(socket, msg);
        }
    }

    handleLobbyDraw(socket, drawCommand) {
        // Only allow drawing on lobby canvas if no game is running
         if (this.gameManager && this.gameManager.gamePhase !== 'LOBBY') {
             console.warn(`[Lobby ${this.id}] Lobby draw ignored, game phase is ${this.gameManager.gamePhase}.`);
             return;
         }
        // ... rest of lobby draw logic ...
        if (!this.players.has(socket.id) || !drawCommand || !drawCommand.type || !drawCommand.cmdId) return;
        const commandWithPlayer = { ...drawCommand, playerId: socket.id };
        // Basic validation (can be expanded)
        if (!['line', 'fill', 'rect', 'ellipse', 'text', 'clear'].includes(drawCommand.type)) return;

        if (commandWithPlayer.type === 'clear') {
            const removedCmdIds = [];
            this.lobbyCanvasCommands = this.lobbyCanvasCommands.filter(cmd => {
                if (cmd.playerId === socket.id) { removedCmdIds.push(cmd.cmdId); return false; } return true;
            });
            if (removedCmdIds.length > 0) {
                this.io.to(this.id).emit('lobby commands removed', { cmdIds: removedCmdIds, strokeId: null, playerId: socket.id });
            }
        } else {
            this.lobbyCanvasCommands.push(commandWithPlayer);
            if (this.lobbyCanvasCommands.length > this.maxLobbyCommands) this.lobbyCanvasCommands.shift();
            socket.to(this.id).emit('lobby draw update', commandWithPlayer);
        }
    }

    handleUndoLastDraw(socket, data) {
         if (this.gameManager && this.gameManager.gamePhase !== 'LOBBY') return; // Only for lobby canvas
         if (!this.players.has(socket.id)) return;
        // ... rest of undo logic ...
        const playerId = socket.id;
        const { cmdIds, strokeId } = data || {};
        if (!cmdIds && !strokeId) return;
        let removedCmdIds = []; let removedStrokeId = null;
        if (strokeId) {
            this.lobbyCanvasCommands = this.lobbyCanvasCommands.filter(cmd => {
                if (cmd.strokeId === strokeId && cmd.playerId === playerId) { removedCmdIds.push(cmd.cmdId); return false; } return true;
            });
            if (removedCmdIds.length > 0) removedStrokeId = strokeId;
        } else if (cmdIds && Array.isArray(cmdIds) && cmdIds.length > 0) {
            const idsToRemoveSet = new Set(cmdIds);
            this.lobbyCanvasCommands = this.lobbyCanvasCommands.filter(cmd => {
                if (idsToRemoveSet.has(cmd.cmdId) && cmd.playerId === playerId) { removedCmdIds.push(cmd.cmdId); return false; } return true;
            });
        }
        if (removedCmdIds.length > 0) {
            this.io.to(this.id).emit('lobby commands removed', { cmdIds: removedCmdIds, strokeId: removedStrokeId, playerId: playerId });
        }
    }

    handleStartGameRequest(socket) {
        if (socket.id !== this.hostId) {
            socket.emit('system message', 'Only the host can start.');
            return;
        }
        if (this.gameManager && this.gameManager.gamePhase !== 'LOBBY') {
            socket.emit('system message', 'Game is already running.');
            return;
        }

        // --- Instantiate Game Mode Based on Settings ---
        const options = {
             totalRounds: this.settings.totalRounds,
             drawTime: this.settings.drawTime,
             // Pass other relevant options
        };
        switch (this.settings.gameMode) {
            case 'ArtistPvp':
                this.gameManager = new ArtistPvpGame(this.io, this.id, this, options);
                break;
            // case 'StoryMode':
            //     this.gameManager = new StoryModeGame(this.io, this.id, this, options);
            //     break;
            default:
                console.error(`[Lobby ${this.id}] Unknown game mode selected: ${this.settings.gameMode}`);
                socket.emit('system message', `Error: Unknown game mode "${this.settings.gameMode}".`);
                return;
        }
        // ---

        console.log(`[Lobby ${this.id}] Host starting game (Mode: ${this.settings.gameMode}).`);
        this.io.to(this.id).emit('game starting', { lobbyId: this.id, gameMode: this.settings.gameMode });

        // Clear lobby canvas? Optional.
        // this.lobbyCanvasCommands = [];
        // this.io.to(this.id).emit('lobby commands removed', { clearAll: true }); // Need client handling for this

        setTimeout(() => {
            if (this.gameManager.startGame()) { // startGame now returns true/false
                // Game started successfully
            } else {
                // Game start failed (e.g., not enough players)
                 this.io.to(this.id).emit('game start failed');
                 this.gameManager = null; // Reset game manager if start failed
            }
        }, 500);
    }

    async handleRequestAiInterpretation(socket, imageDataUrl) {
         // Only allow lobby AI interpretation if no game is running
         if (this.gameManager && this.gameManager.gamePhase !== 'LOBBY') {
             socket.emit('ai interpretation result', { error: "Cannot ask AI while a game is running." });
             return;
         }
        // ... rest of lobby AI logic ...
        if (!this.players.has(socket.id)) return;
        if (socket.id !== this.hostId) { socket.emit('ai interpretation result', { error: "Only the host can ask." }); return; }
        const now = Date.now();
        if (now - this.lastAiRequestTime < this.aiRequestCooldownMs) { const remaining = Math.ceil((this.aiRequestCooldownMs - (now - this.lastAiRequestTime)) / 1000); socket.emit('ai interpretation result', { error: `Wait ${remaining}s.` }); return; }
        if (!imageDataUrl || typeof imageDataUrl !== 'string' || !imageDataUrl.startsWith('data:image/png;base64,') || imageDataUrl.length > 2 * 1024 * 1024) { socket.emit('ai interpretation result', { error: "Invalid image." }); return; }
        console.log(`[Lobby ${this.id}] Host requested AI interpretation for lobby canvas.`); this.lastAiRequestTime = now;
        try { const interpretation = await interpretImage(imageDataUrl); this.io.to(this.id).emit('ai interpretation result', { interpretation }); } catch (error) { console.error(`[Lobby ${this.id}] Lobby AI interpretation failed:`, error); const clientError = typeof error === 'string' ? error : "AI error."; this.io.to(this.id).emit('ai interpretation result', { error: clientError }); }
    }

    // --- Getters ---
    getPlayerCount() { return this.players.size; }

    // --- Game Event Forwarding ---
    // Forward events to the *current* gameManager instance if it exists
    handlePlayerReady(socket, data) {
        if (this.gameManager && typeof this.gameManager.handlePlayerReady === 'function') {
            this.gameManager.handlePlayerReady(socket, data);
        }
    }
    handleChatMessage(socket, data) { // Game chat messages
         if (this.gameManager && typeof this.gameManager.handleChatMessage === 'function') {
            this.gameManager.handleChatMessage(socket, data);
        }
    }
    handleRateDrawingRequest(socket, data) { // New event for PvP rating
         if (this.gameManager && typeof this.gameManager.handleRateDrawingRequest === 'function') {
            this.gameManager.handleRateDrawingRequest(socket, data);
        }
    }
}

export default Lobby;