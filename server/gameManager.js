// server/gameManager.js
import { getRandomWord } from './game/wordlist.js';
// Removed Lobby import, as GameManager operates within a Lobby now

// Constants remain the same
const MAX_PLAYERS = 4; // Keep for reference, but Lobby enforces
const MIN_PLAYERS_TO_START = 2;
const DRAW_TIME_SECONDS = 120;
const VOTE_TIME_SECONDS = 60;
const RESULTS_TIME_SECONDS = 15;

class GameManager {
    // Modified Constructor: Takes io and lobbyId
    constructor(io, lobbyId) {
        this.io = io;
        this.lobbyId = lobbyId; // ID of the lobby this game belongs to
        this.lobby = null; // Reference to the parent Lobby instance (set externally)

        // Game-specific state
        this.gamePhase = 'LOBBY'; // Initial state is Lobby (controlled by Lobby class)
        this.currentWord = "";
        this.roundTimer = null;
        this.readyPlayers = new Set();
        this.playerDrawings = {};
        this.playerVotes = {};
        this.currentTimerDuration = 0;
        this.currentTimerStart = 0;
    }

    // Method to link back to the parent lobby (called after instantiation)
    setLobbyReference(lobbyInstance) {
        this.lobby = lobbyInstance;
    }

    // --- Helpers ---
    // Use lobby's player map
    getPlayers() {
        return this.lobby ? this.lobby.players : new Map();
    }
    getPlayerName(socketId) {
        return this.lobby?.players?.get(socketId)?.name || 'Unknown';
    }

    // Broadcast specifically to this lobby's room
    broadcastToLobby(event, data) {
        this.io.to(this.lobbyId).emit(event, data);
    }

    broadcastGameState() {
        if (!this.lobby) return; // Need lobby reference

        let drawingsToSend = null;
        if (this.gamePhase === 'VOTING' || this.gamePhase === 'RESULTS') {
            drawingsToSend = this.playerDrawings;
        }

        const state = {
            phase: this.gamePhase,
            word: (this.gamePhase === 'DRAWING' || this.gamePhase === 'RESULTS') ? this.currentWord : null,
            drawings: drawingsToSend,
            scores: Array.from(this.getPlayers().values(), p => ({ id: p.id, name: p.name, score: p.score || 0 })),
            timerDuration: (this.gamePhase === 'DRAWING' || this.gamePhase === 'VOTING') ? this.currentTimerDuration : null,
            timerStart: (this.gamePhase === 'DRAWING' || this.gamePhase === 'VOTING') ? this.currentTimerStart : null,
            minPlayers: MIN_PLAYERS_TO_START,
            playerCount: this.getPlayers().size,
            // Add lobby specific info if needed by game UI?
            lobbyId: this.lobbyId,
            hostId: this.lobby.hostId
        };
        this.broadcastToLobby('game state update', state); // Use specific broadcast
        console.log(`Lobby ${this.lobbyId}: Broadcasting state: ${this.gamePhase} (${state.playerCount} players)`);
    }

    // --- Phase Transitions ---
    // startGame is now called by the Lobby when host clicks Start
    startGame() {
        if (this.gamePhase !== 'LOBBY') {
             console.warn(`Lobby ${this.lobbyId}: startGame called but phase is ${this.gamePhase}`);
             return; // Should only start from Lobby
        }
        console.log(`Lobby ${this.lobbyId}: Starting game sequence.`);
        this.startDrawingPhase();
    }

    startDrawingPhase() {
        this.gamePhase = 'DRAWING';
        this.currentWord = getRandomWord();
        this.readyPlayers.clear(); this.playerDrawings = {}; this.playerVotes = {};
        // Reset round-specific player state (votes) - scores persist
        this.getPlayers().forEach(p => { p.hasVoted = false; p.receivedVotes = 0; });
        console.log(`Lobby ${this.lobbyId}: Drawing phase started. Word: ${this.currentWord}`);
        this.currentTimerDuration = DRAW_TIME_SECONDS; this.currentTimerStart = Date.now();
        this.broadcastGameState();
        this.broadcastToLobby('round start', { word: this.currentWord, duration: this.currentTimerDuration });
        if (this.roundTimer) clearTimeout(this.roundTimer);
        this.roundTimer = setTimeout(this.startVotingPhase.bind(this), this.currentTimerDuration * 1000);
    }

    checkEndDrawingPhase() {
        if (this.gamePhase === 'DRAWING' && this.readyPlayers.size === this.getPlayers().size && this.getPlayers().size > 0) {
            console.log(`Lobby ${this.lobbyId}: All players ready, ending drawing phase early.`);
            if (this.roundTimer) clearTimeout(this.roundTimer);
            this.startVotingPhase();
        }
    }

    startVotingPhase() {
        this.gamePhase = 'VOTING';
        console.log(`Lobby ${this.lobbyId}: Voting phase started.`);
        this.getPlayers().forEach(p => { p.hasVoted = false; }); this.playerVotes = {};
        this.currentTimerDuration = VOTE_TIME_SECONDS; this.currentTimerStart = Date.now();
        this.broadcastGameState(); // State includes drawings
        this.broadcastToLobby('voting start', { duration: this.currentTimerDuration });
        if (this.roundTimer) clearTimeout(this.roundTimer);
        this.roundTimer = setTimeout(this.startResultsPhase.bind(this), this.currentTimerDuration * 1000);
    }

    startResultsPhase() {
        this.gamePhase = 'RESULTS';
        this.currentTimerDuration = 0; this.currentTimerStart = 0;
        console.log(`Lobby ${this.lobbyId}: Results phase started.`);
        // Calculate scores
        this.getPlayers().forEach(p => { p.receivedVotes = 0; });
        Object.values(this.playerVotes).forEach(votedForId => {
            const votedPlayer = this.getPlayers().get(votedForId);
            if (votedPlayer) { votedPlayer.receivedVotes++; }
        });
        this.getPlayers().forEach(p => { p.score = (p.score || 0) + p.receivedVotes; });
        this.broadcastGameState(); // State includes scores/results
        if (this.roundTimer) clearTimeout(this.roundTimer);
        this.roundTimer = setTimeout(this.goToLobby.bind(this), RESULTS_TIME_SECONDS * 1000);
    }

    // Renamed from original goToLobby - this resets the *game* state back to lobby mode
    goToLobby() {
        console.log(`Lobby ${this.lobbyId}: Game returning to Lobby state.`);
        this.gamePhase = 'LOBBY'; // Set game manager's phase
        this.currentWord = "";
        if (this.roundTimer) clearTimeout(this.roundTimer); this.roundTimer = null;
        this.currentTimerDuration = 0; this.currentTimerStart = 0;
        this.readyPlayers.clear(); this.playerDrawings = {}; this.playerVotes = {};
        // Scores persist on the player objects in the Lobby instance
        this.broadcastGameState(); // Broadcast the LOBBY state for this game instance
        // The Lobby instance itself doesn't change phase here, only the game within it
        // The Lobby might decide to auto-start again if conditions met
        if (this.lobby) {
            this.lobby.attemptAutoStartGame(); // Check if lobby should restart game
        }
    }

    // --- Event Handlers (Called by Lobby instance) ---
    // Note: handleConnection and handleDisconnect are removed

    handleChatMessage(socket, msg) {
        // Game chat could be different from lobby chat if needed, but currently same
        if (!this.lobby?.players?.has(socket.id) || typeof msg !== 'string' || msg.trim().length === 0) return;
        const senderName = this.getPlayerName(socket.id);
        const cleanMsg = msg.substring(0, 100);
        console.log(`Lobby ${this.lobbyId} (Game Chat): ${senderName}: ${cleanMsg}`);
        this.broadcastToLobby('chat message', { senderName: senderName, text: cleanMsg });
    }

    handlePlayerReady(socket, drawingDataUrl) {
        if (this.gamePhase === 'DRAWING' && this.lobby?.players?.has(socket.id) && !this.readyPlayers.has(socket.id)) {
            if (drawingDataUrl && typeof drawingDataUrl === 'string' && drawingDataUrl.startsWith('data:image/png;base64,') && drawingDataUrl.length < 500000) {
                 this.playerDrawings[socket.id] = drawingDataUrl;
                 this.readyPlayers.add(socket.id);
                 console.log(`Lobby ${this.lobbyId}: ${this.getPlayerName(socket.id)} is ready.`);
                 this.checkEndDrawingPhase();
            } else {
                 console.warn(`Lobby ${this.lobbyId}: Invalid drawing data from ${socket.id}. Size: ${drawingDataUrl?.length}`);
                 socket.emit('system message', 'Error submitting drawing. Please try again.');
            }
        }
    }

    handleSubmitVote(socket, votedForId) {
         if (this.gamePhase === 'VOTING' && this.lobby?.players?.has(socket.id)) {
             const voter = this.lobby.players.get(socket.id);
             if (voter.hasVoted) return; // Prevent double voting

             if (votedForId === socket.id) {
                 socket.emit('vote error', "You cannot vote for yourself."); return;
             }
             // Check if the player being voted for exists and submitted a drawing
             if (!this.lobby.players.has(votedForId) || !this.playerDrawings[votedForId]) {
                  socket.emit('vote error', "Invalid player/drawing voted for."); return;
             }
             console.log(`Lobby ${this.lobbyId}: ${this.getPlayerName(socket.id)} voted for ${this.getPlayerName(votedForId)}`);
             voter.hasVoted = true; // Mark voter
             this.playerVotes[socket.id] = votedForId;
             socket.emit('vote accepted');
             // Optional: Check if all players have voted to end phase early
             // const totalPlayers = this.getPlayers().size;
             // const totalVotes = Object.keys(this.playerVotes).length;
             // if (totalVotes === totalPlayers && totalPlayers > 0) { ... end voting early ... }
         }
    }
}

export default GameManager;