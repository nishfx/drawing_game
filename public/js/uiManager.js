// public/js/uiManager.js
import * as TimerUI from './ui/timerUI.js';
import * as PlayerListUI from './ui/playerListUI.js';
import * as ChatUI from './ui/chatUI.js';
import * as VotingUI from './ui/votingUI.js';
import * as ResultsUI from './ui/resultsUI.js';

// --- DOM Elements (Only those needed for general phase control) ---
const statusElement = document.getElementById('status');
const gameStatusElement = document.getElementById('game-status');
const wordHintElement = document.getElementById('word-hint');
const readyButton = document.getElementById('ready-button');
const drawingControls = document.getElementById('drawing-controls');

// --- Export Functions that delegate ---
export const updatePlayerList = PlayerListUI.updatePlayerList;
export const addChatMessage = ChatUI.addChatMessage;
export const startTimer = TimerUI.startTimer;
export const stopTimer = TimerUI.stopTimer;

export function updateStatus(isConnected) {
    if (!statusElement) { console.error("UIManager: statusElement is null!"); return; }
    if (isConnected) { statusElement.textContent = 'Connected'; statusElement.style.color = 'green'; }
    else { statusElement.textContent = 'Disconnected'; statusElement.style.color = 'red'; }
}

export function showGamePhaseUI(phase, data = {}) {
    console.log("UIManager: Updating UI for phase:", phase, data);

    // --- Hide all phase-specific sections ---
    if (readyButton) readyButton.style.display = 'none';
    VotingUI.hideVotingArea();
    ResultsUI.hideResultsArea();
    TimerUI.hideTimer(); // Hide timer by default, specific phases will show it

    // --- Reset general elements ---
    if (drawingControls) drawingControls.style.opacity = '0.5'; // Dim by default
    if (wordHintElement) { wordHintElement.textContent = ''; wordHintElement.classList.remove('is-word'); }
    if (gameStatusElement) gameStatusElement.textContent = '';

    // --- Show elements for the current phase ---
    switch (phase) {
        case 'LOBBY':
            if (gameStatusElement) {
                const playerCount = data.playerCount !== undefined ? data.playerCount : (document.getElementById('player-list')?.children?.length || 0);
                const minPlayers = data.minPlayers || 2; // Use data from server or default
                if (playerCount < minPlayers) {
                    gameStatusElement.textContent = `Waiting for more players... (${playerCount}/${minPlayers})`;
                } else {
                    gameStatusElement.textContent = `Ready to start! Waiting...`; // Or "Game will start soon..."
                }
            }
            // Ensure game elements are hidden/dimmed
            if (drawingControls) drawingControls.style.opacity = '0.5';
            if (wordHintElement) wordHintElement.textContent = '--- LOBBY ---'; // Placeholder
            break;

        case 'WAITING': // Fallback case, should ideally be LOBBY
            if (gameStatusElement) gameStatusElement.textContent = 'Waiting for players...';
            break;

        case 'DRAWING':
            if (gameStatusElement) gameStatusElement.textContent = 'Draw the word!';
            if (wordHintElement && data.word) { wordHintElement.textContent = data.word; wordHintElement.classList.add('is-word'); }
            if (drawingControls) drawingControls.style.opacity = '1';
            if (readyButton) { readyButton.style.display = 'block'; readyButton.disabled = false; readyButton.textContent = "Ready"; }
            TimerUI.showTimer(); // Timer started via client event
            break;

        case 'VOTING':
            if (gameStatusElement) gameStatusElement.textContent = 'Vote for your favorite drawing!';
            if (drawingControls) drawingControls.style.opacity = '0.5'; // Keep canvas dimmed
            if (data.drawings && Object.keys(data.drawings).length > 0 && data.myPlayerId) {
                VotingUI.displayVotingOptions(data.drawings, data.myPlayerId);
                VotingUI.showVotingArea();
                VotingUI.enableVotingButtons(); // Ensure buttons are enabled at start
            } else {
                console.warn("Voting phase UI: No drawings or missing myPlayerId.");
                VotingUI.showVotingArea(); // Show area but maybe with a message
                document.getElementById('voting-area').innerHTML = '<p>Waiting for drawings to vote on...</p>';
            }
            TimerUI.showTimer(); // Timer started via client event
            break;

        case 'RESULTS':
            if (gameStatusElement) gameStatusElement.textContent = 'Round Over!';
            if (wordHintElement && data.word) { wordHintElement.textContent = `Word was: ${data.word}`; }
            if (data.scores) {
                ResultsUI.displayResults(data.scores, data.drawings || {});
                ResultsUI.showResultsArea();
            } else {
                console.warn("Results phase UI: Missing scores.");
                ResultsUI.showResultsArea();
                document.getElementById('results-area').innerHTML = '<p>Calculating results...</p>';
            }
            break; // Timer remains hidden

        default:
            if (gameStatusElement) gameStatusElement.textContent = 'Unknown game state';
    }
}