// server/modes/baseGame.js
import { getRandomWord } from '../wordlist.js'; // Assuming wordlist is in parent dir

export const GamePhase = {
    LOBBY: 'LOBBY',
    DRAWING: 'DRAWING',
    MANUAL_RATING: 'MANUAL_RATING', // Renamed from EVALUATION
    RESULTS: 'RESULTS', // Shows round results
    FINAL_SCOREBOARD: 'FINAL_SCOREBOARD', // Shows final winner
    WAITING: 'WAITING'
};

const DEFAULT_MIN_PLAYERS = 2;
const DEFAULT_TOTAL_ROUNDS = 3; // Default number of rounds

class BaseGame {
    constructor(io, lobbyId, lobbyRef, options = {}) { // Accept options
        if (!io || !lobbyId || !lobbyRef) {
            throw new Error("BaseGame requires io, lobbyId, and lobbyRef");
        }
        this.io = io;
        this.lobbyId = lobbyId;
        this.lobby = lobbyRef; // Reference to the parent Lobby instance
        this.gamePhase = GamePhase.LOBBY;
        this.roundTimer = null;
        this.currentTimerDuration = 0;
        this.currentTimerStart = 0;
        this.minPlayers = DEFAULT_MIN_PLAYERS; // Can be overridden by specific modes

        // --- Round Tracking ---
        this.currentRound = 0;
        this.totalRounds = options.totalRounds || DEFAULT_TOTAL_ROUNDS;
        this.drawTime = options.drawTime || 90; // Default draw time, allow override
        // --- End Round Tracking ---
    }

    // --- Helpers --- (getPlayers, getPlayerById, getPlayerName, broadcastToLobby, sendToPlayer - remain the same)
    getPlayers() {
        return this.lobby.players; // Get players from the lobby reference
    }

    getPlayerById(socketId) {
        return this.getPlayers().get(socketId);
    }

    getPlayerName(socketId) {
        return this.getPlayerById(socketId)?.name || 'Unknown';
    }

    broadcastToLobby(event, data) {
        this.io.to(this.lobbyId).emit(event, data);
    }

    sendToPlayer(socketId, event, data) {
        const player = this.getPlayerById(socketId);
        if (player && player.socket) {
            player.socket.emit(event, data);
        }
    }


    // Broadcast the current game state
    // Needs to be implemented or overridden by subclasses to include mode-specific data
    broadcastGameState() {
        console.warn(`[${this.lobbyId}] broadcastGameState() called on BaseGame - should be overridden.`);
        const state = {
            phase: this.gamePhase,
            currentRound: this.currentRound, // Add round info
            totalRounds: this.totalRounds,   // Add round info
            timerDuration: this.currentTimerDuration > 0 ? this.currentTimerDuration : null,
            timerStart: this.currentTimerStart > 0 ? this.currentTimerStart : null,
            minPlayers: this.minPlayers,
            playerCount: this.getPlayers().size,
            lobbyId: this.lobbyId,
            hostId: this.lobby.hostId,
        };
        this.broadcastToLobby('game state update', state);
    }

    // --- Timer Management --- (startTimer, clearTimer - remain the same)
    startTimer(durationSeconds, nextPhaseCallback) {
        if (this.roundTimer) clearTimeout(this.roundTimer);
        if (durationSeconds <= 0) {
            console.warn(`[${this.lobbyId}] Invalid timer duration: ${durationSeconds}s`);
            this.currentTimerDuration = 0;
            this.currentTimerStart = 0;
            if (typeof nextPhaseCallback === 'function') {
                nextPhaseCallback.call(this);
            }
            return;
        }

        this.currentTimerDuration = durationSeconds;
        this.currentTimerStart = Date.now();
        console.log(`[${this.lobbyId}] Starting timer: ${durationSeconds}s for phase ${this.gamePhase} (Round ${this.currentRound})`);

        this.roundTimer = setTimeout(() => {
            if (typeof nextPhaseCallback === 'function') {
                nextPhaseCallback.call(this);
            } else {
                console.error(`[${this.lobbyId}] Timer finished but no valid callback provided for phase ${this.gamePhase}`);
            }
        }, durationSeconds * 1000);

        this.broadcastGameState(); // Send timer updates
    }

    clearTimer() {
        if (this.roundTimer) {
            clearTimeout(this.roundTimer);
            this.roundTimer = null;
        }
        this.currentTimerDuration = 0;
        this.currentTimerStart = 0;
    }


    // --- Phase Transitions (Basic Structure) ---
    startGame() {
        if (this.gamePhase !== GamePhase.LOBBY) {
            console.warn(`[${this.lobbyId}] startGame called but phase is ${this.gamePhase}`);
            return false;
        }
        if (this.getPlayers().size < this.minPlayers) {
             console.warn(`[${this.lobbyId}] Cannot start game, not enough players.`);
             this.sendToPlayer(this.lobby.hostId, 'system message', `Need ${this.minPlayers} players to start.`);
             return false;
        }
        console.log(`[${this.lobbyId}] Starting game sequence. Rounds: ${this.totalRounds}, Draw Time: ${this.drawTime}s`);
        this.currentRound = 0; // Reset round counter
        this.getPlayers().forEach(p => {
            p.score = 0; // Reset scores
        });
        // Subclass should implement the actual round start logic (e.g., startNextRound)
        return true;
    }

    // --- NEW: Start Next Round ---
    startNextRound() {
        this.currentRound++;
        console.log(`[${this.lobbyId}] Starting Round ${this.currentRound}/${this.totalRounds}`);
        // Subclass implements specific phase transition (e.g., startDrawingPhase)
    }

    // Called when game ends or needs reset
    goToLobby() {
        console.log(`[${this.lobbyId}] Game returning to Lobby state.`);
        this.clearTimer();
        this.gamePhase = GamePhase.LOBBY;
        this.currentRound = 0; // Reset round
        // Reset game-specific state in subclass goToLobby
        this.broadcastGameState(); // Broadcast the LOBBY state
    }

    // --- Player Event Handlers (To be implemented by subclasses) ---
    handlePlayerReady(socket, data) {
        console.warn(`[${this.lobbyId}] handlePlayerReady not implemented for phase ${this.gamePhase}`);
    }

    handleChatMessage(socket, msg) {
         console.warn(`[${this.lobbyId}] handleChatMessage not implemented for phase ${this.gamePhase}`);
    }

    // --- NEW: Handler for Rating Request ---
    handleRateDrawingRequest(socket, data) {
        console.warn(`[${this.lobbyId}] handleRateDrawingRequest not implemented for phase ${this.gamePhase}`);
    }


    handlePlayerDisconnect(socketId) {
        console.log(`[${this.lobbyId}] Player ${socketId} disconnected during game phase ${this.gamePhase}.`);
        if (this.getPlayers().size < this.minPlayers && this.gamePhase !== GamePhase.LOBBY) {
             console.log(`[${this.lobbyId}] Not enough players remaining, returning to lobby.`);
             this.broadcastToLobby('system message', 'Not enough players to continue the game.');
             this.goToLobby();
        }
    }
}

export default BaseGame;