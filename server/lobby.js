// server/lobby.js
import GameManager from './gameManager.js';
import { getRandomColor } from './utils.js';
import { interpretImage } from './aiService.js'; // --- NEW AI Import ---

const MAX_PLAYERS_PER_LOBBY = 4;
const MIN_PLAYERS_TO_START = 1; // For easier testing

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
        this.maxLobbyCommands = 10000000;

        // Default lobby settings (synced to/from clients)
        this.currentSettings = {
            gameMode: 'artist-pvp',
            drawTime: 120,
            voteTime: 45,
            pointsToWin: 15
        };

        // NEW: AI Request Cooldown
        this.lastAiRequestTime = 0;
        this.aiRequestCooldownMs = 10000; // 10s
    }

    // ---------- LOBBY CORE METHODS ----------

    addPlayer(socket, username, isHost = false) {
        // If already in the lobby map, ignore
        if (this.players.has(socket.id)) {
            console.warn(`[Lobby ${this.id}] addPlayer: socket already present: ${socket.id}`);
        }

        const playerData = {
            id: socket.id,
            name: username,
            color: getRandomColor(),
            isHost: isHost,
            socket: socket,
            score: 0,
            hasVoted: false,
            receivedVotes: 0
        };
        this.players.set(socket.id, playerData);
        socket.join(this.id);

        // Determine host
        if (isHost || !this.hostId) {
            this.hostId = socket.id;
            playerData.isHost = true;
            this.players.forEach(p => {
                if (p.id !== this.hostId) p.isHost = false;
            });
        }

        console.log(`[Lobby ${this.id}] ${username} (${socket.id}) added. Host? ${playerData.isHost}`);
        this.broadcastSystemMessage(`${username} has joined the lobby.`);

        this.sendLobbyState(socket);
        this.broadcastLobbyPlayerList();
        return true;
    }

    removePlayer(socket, opts = {}) {
        // opts.silent => skip “XYZ has left the lobby.”
        const playerData = this.players.get(socket.id);
        if (!playerData) {
            console.log(`[Lobby ${this.id}] removePlayer: not found: ${socket.id}`);
            return;
        }
        const username = playerData.name;
        const wasHost = playerData.isHost;

        console.log(`[Lobby ${this.id}] Removing player ${username} (${socket.id}).`);
        this.players.delete(socket.id);
        socket.leave(this.id);

        // Remove player's commands from lobbyCanvasCommands
        const initialCount = this.lobbyCanvasCommands.length;
        this.lobbyCanvasCommands = this.lobbyCanvasCommands.filter(cmd => cmd.playerId !== socket.id);
        console.log(`[Lobby ${this.id}] Removed ${initialCount - this.lobbyCanvasCommands.length} commands for ${username}.`);

        // Only broadcast “left” if not silent
        if (!opts.silent) {
            this.broadcastSystemMessage(`${username} has left the lobby.`);
        }

        // If host left, pick a new one (the next entry in Map)
        if (wasHost && this.players.size > 0) {
            const nextHostEntry = this.players.entries().next().value;
            if (nextHostEntry) {
                const [nextHostId, nextHostData] = nextHostEntry;
                this.hostId = nextHostId;
                nextHostData.isHost = true;
                console.log(`[Lobby ${this.id}] Host left. New host: ${nextHostData.name}`);
                this.broadcastSystemMessage(`${nextHostData.name} is now the host.`);
                if (nextHostData.socket) {
                    nextHostData.socket.emit('promoted to host');
                }
            } else {
                this.hostId = null;
                console.error(`[Lobby ${this.id}] Host left but no next host?`);
            }
        } else if (this.players.size === 0) {
            this.hostId = null;
            console.log(`[Lobby ${this.id}] Became empty.`);
        }

        this.broadcastLobbyPlayerList();

        // If a game was ongoing, but now not enough players remain, or no players remain
        if (this.gameManager.gamePhase !== 'LOBBY') {
            if (this.players.size < MIN_PLAYERS_TO_START && this.players.size > 0) {
                console.log(`[Lobby ${this.id}] Not enough players, stopping game.`);
                this.gameManager.goToLobby();
            } else if (this.players.size === 0) {
                console.log(`[Lobby ${this.id}] Last player left, stopping game.`);
                this.gameManager.goToLobby();
            }
        }
    }

    isFull() {
        return this.players.size >= this.maxPlayers;
    }
    isEmpty() {
        return this.players.size === 0;
    }

    isUsernameTaken(username) {
        return Array.from(this.players.values()).some(p => p.name.toLowerCase() === username.toLowerCase());
    }

    isUsernameTakenByOther(username, ownSocketId) {
        const lower = username.toLowerCase();
        for (const [id, p] of this.players.entries()) {
            if (id !== ownSocketId && p.name.toLowerCase() === lower) {
                return true;
            }
        }
        return false;
    }

    getHostName() {
        const host = this.players.get(this.hostId);
        return host ? host.name : 'N/A';
    }

    sendLobbyState(socket) {
        const state = {
            lobbyId: this.id,
            players: Array.from(this.players.values()).map(p => ({
                id: p.id,
                name: p.name,
                color: p.color,
                isHost: p.isHost,
                score: p.score || 0
            })),
            hostId: this.hostId,
            chatHistory: this.lobbyChatHistory,
            canvasCommands: this.lobbyCanvasCommands,
            gamePhase: this.gameManager.gamePhase,
            minPlayers: MIN_PLAYERS_TO_START
        };
        socket.emit('lobby state', state);
    }

    broadcastLobbyPlayerList() {
        const playerList = Array.from(this.players.values(), p => ({
            id: p.id,
            name: p.name,
            color: p.color,
            isHost: p.isHost,
            score: p.score || 0
        }));
        this.io.to(this.id).emit('lobby player list update', playerList);
    }

    broadcastSystemMessage(msg) {
        const data = { text: msg, type: 'system' };
        this.io.to(this.id).emit('lobby chat message', data);
    }

    registerSocketEvents(socket) {
        console.log(`Registering update-lobby-settings for ${socket.id} in lobby ${this.id}`);

        // ---- Only remove & re-add 'update-lobby-settings'. Leave chat/draw events alone. ----
        socket.removeAllListeners('update-lobby-settings');
        socket.on('update-lobby-settings', (newSettings) => {
            // 1) Confirm the sender is host:
            if (socket.id !== this.hostId) {
                socket.emit('system message', 'Only the host can change settings.');
                return;
            }
            // 2) Validate or just store newSettings:
            this.currentSettings = { ...newSettings };
            console.log(`[Lobby ${this.id}] Host updated settings =>`, this.currentSettings);
            // 3) Broadcast to all players
            this.io.to(this.id).emit('lobby-settings-updated', this.currentSettings);
        });
    }

    // ---------- CHAT & DRAWING HANDLERS ----------

    handleLobbyChatMessage(socket, msg) {
        const sender = this.players.get(socket.id);
        if (!sender || typeof msg !== 'string' || msg.trim().length === 0) return;
        const cleanMsg = msg.substring(0, 150);
        const msgData = {
            senderName: sender.name,
            senderColor: sender.color,
            text: cleanMsg
        };
        this.lobbyChatHistory.push(msgData);
        if (this.lobbyChatHistory.length > 50) {
            this.lobbyChatHistory.shift();
        }
        this.io.to(this.id).emit('lobby chat message', msgData);
    }

    handleLobbyDraw(socket, drawCommand) {
        if (!this.players.has(socket.id) || !drawCommand || !drawCommand.type || !drawCommand.cmdId) {
            console.warn(`Lobby ${this.id}: invalid draw data from ${socket.id}`, drawCommand);
            return;
        }
        const commandWithPlayer = { ...drawCommand, playerId: socket.id };

        let isValid = false;
        switch (drawCommand.type) {
            case 'line':
                isValid =
                    typeof drawCommand.x0 === 'number' &&
                    typeof drawCommand.y0 === 'number' &&
                    typeof drawCommand.x1 === 'number' &&
                    typeof drawCommand.y1 === 'number' &&
                    typeof drawCommand.size === 'number' &&
                    typeof drawCommand.strokeId === 'string';
                break;

            case 'fill':
                isValid =
                    typeof drawCommand.x === 'number' &&
                    typeof drawCommand.y === 'number' &&
                    typeof drawCommand.color === 'string';
                break;

            case 'rect':
            case 'ellipse':
                isValid =
                    typeof drawCommand.x0 === 'number' &&
                    typeof drawCommand.y0 === 'number' &&
                    typeof drawCommand.x1 === 'number' &&
                    typeof drawCommand.y1 === 'number' &&
                    typeof drawCommand.color === 'string' &&
                    typeof drawCommand.size === 'number';
                break;

            case 'text':
                isValid =
                    typeof drawCommand.x === 'number' &&
                    typeof drawCommand.y === 'number' &&
                    typeof drawCommand.text === 'string' &&
                    typeof drawCommand.color === 'string' &&
                    typeof drawCommand.size === 'number';
                break;

            case 'clear':
                isValid = true;
                break;

            default:
                console.warn(`Lobby ${this.id}: unknown draw type: ${drawCommand.type}`);
                isValid = false;
                break;
        }
        if (!isValid) {
            console.warn(`Lobby ${this.id}: invalid data for type=${drawCommand.type} from ${socket.id}`, drawCommand);
            return;
        }

        // Special case: clear
        if (commandWithPlayer.type === 'clear') {
            const removedCmdIds = [];
            const initialLen = this.lobbyCanvasCommands.length;
            this.lobbyCanvasCommands = this.lobbyCanvasCommands.filter(cmd => {
                if (cmd.playerId === socket.id) {
                    removedCmdIds.push(cmd.cmdId);
                    return false;
                }
                return true;
            });
            console.log(`[Lobby ${this.id}] Player ${socket.id} cleared their lines. Removed ${removedCmdIds.length} commands.`);

            if (removedCmdIds.length > 0) {
                this.io.to(this.id).emit('lobby commands removed', {
                    cmdIds: removedCmdIds,
                    strokeId: null,
                    playerId: socket.id
                });
            }
        } else {
            // Normal command
            this.lobbyCanvasCommands.push(commandWithPlayer);
            if (this.lobbyCanvasCommands.length > this.maxLobbyCommands) {
                this.lobbyCanvasCommands.shift();
            }
            socket.to(this.id).emit('lobby draw update', commandWithPlayer);
        }
    }

    handleUndoLastDraw(socket, data) {
        if (!this.players.has(socket.id)) return;
        const playerId = socket.id;
        const { cmdIds, strokeId } = data || {};

        if (!cmdIds && !strokeId) {
            console.warn(`[Lobby ${this.id}] Undo request missing cmdIds/strokeId from ${playerId}`);
            return;
        }

        let removedCmdIds = [];
        let removedStrokeId = null;

        if (strokeId) {
            // Remove all commands matching strokeId for that player
            this.lobbyCanvasCommands = this.lobbyCanvasCommands.filter(cmd => {
                if (cmd.strokeId === strokeId && cmd.playerId === playerId) {
                    removedCmdIds.push(cmd.cmdId);
                    return false;
                }
                return true;
            });
            if (removedCmdIds.length > 0) {
                removedStrokeId = strokeId;
                console.log(`[Lobby ${this.id}] Undo stroke=${strokeId}, removed ${removedCmdIds.length} commands from ${playerId}.`);
            }
        } else if (cmdIds && Array.isArray(cmdIds) && cmdIds.length > 0) {
            // Remove specific command IDs
            const idsToRemoveSet = new Set(cmdIds);
            this.lobbyCanvasCommands = this.lobbyCanvasCommands.filter(cmd => {
                if (idsToRemoveSet.has(cmd.cmdId) && cmd.playerId === playerId) {
                    removedCmdIds.push(cmd.cmdId);
                    return false;
                }
                return true;
            });
            if (removedCmdIds.length > 0) {
                console.log(`[Lobby ${this.id}] Undo single command(s)=${removedCmdIds.join(',')} by ${playerId}`);
            }
        }

        if (removedCmdIds.length > 0) {
            this.io.to(this.id).emit('lobby commands removed', {
                cmdIds: removedCmdIds,
                strokeId: removedStrokeId,
                playerId: playerId
            });
        } else {
            console.warn(`[Lobby ${this.id}] Undo request from ${playerId} did not remove any commands for data:`, data);
        }
    }

    handleStartGameRequest(socket) {
        if (socket.id !== this.hostId) {
            socket.emit('system message', 'Only the host can start.');
            return;
        }
        if (this.players.size < MIN_PLAYERS_TO_START) {
            socket.emit('system message', `Need ${MIN_PLAYERS_TO_START} players to start.`);
            return;
        }
        if (this.gameManager.gamePhase !== 'LOBBY') {
            socket.emit('system message', 'Game is already running.');
            return;
        }
        console.log(`[Lobby ${this.id}] Host starting game.`);
        this.io.to(this.id).emit('game starting', { lobbyId: this.id });
        setTimeout(() => this.gameManager.startGame(), 500);
    }

    // ---------- AI INTERPRETATION ----------
    async handleRequestAiInterpretation(socket, imageDataUrl) {
        if (!this.players.has(socket.id)) return; // must be in lobby
        // 1) Must be host
        if (socket.id !== this.hostId) {
            console.warn(`[Lobby ${this.id}] Non-host (${socket.id}) tried to request AI interpretation.`);
            socket.emit('ai interpretation result', { error: "Only the host can ask the AI." });
            return;
        }

        // 2) Throttle checks
        const now = Date.now();
        if (now - this.lastAiRequestTime < this.aiRequestCooldownMs) {
            const remaining = Math.ceil((this.aiRequestCooldownMs - (now - this.lastAiRequestTime)) / 1000);
            console.log(`[Lobby ${this.id}] AI request throttled. Wait ${remaining}s.`);
            socket.emit('ai interpretation result', { error: `Please wait ${remaining} seconds before asking again.` });
            return;
        }

        // 3) Data validation
        if (!imageDataUrl ||
            typeof imageDataUrl !== 'string' ||
            !imageDataUrl.startsWith('data:image/png;base64,') ||
            imageDataUrl.length > 2 * 1024 * 1024) {
            console.warn(`[Lobby ${this.id}] Invalid image data from ${socket.id}, length=${imageDataUrl?.length}`);
            socket.emit('ai interpretation result', { error: "Invalid or too large image data." });
            return;
        }

        console.log(`[Lobby ${this.id}] Host (${socket.id}) requested AI interpretation.`);
        this.lastAiRequestTime = now;

        try {
            const interpretation = await interpretImage(imageDataUrl);
            this.io.to(this.id).emit('ai interpretation result', { interpretation });
            console.log(`[Lobby ${this.id}] Broadcasted AI interpretation: "${interpretation}"`);
        } catch (error) {
            console.error(`[Lobby ${this.id}] AI interpretation failed:`, error);
            const clientError = typeof error === 'string'
                ? error
                : "The AI could not process the image.";
            this.io.to(this.id).emit('ai interpretation result', { error: clientError });
        }
    }

    // Unused, but available if you want to track total players
    getPlayerCount() {
        return this.players.size;
    }

    // Called if you want auto-start logic
    attemptAutoStartGame() {
        // no-op
    }
}

export default Lobby;
