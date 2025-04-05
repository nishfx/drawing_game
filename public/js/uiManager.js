// public/js/uiManager.js
import * as TimerUI from './ui/timerUI.js';
import * as PlayerListUI from './ui/playerListUI.js';
import * as ChatUI from './ui/chatUI.js';
import * as VotingUI from './ui/votingUI.js';
import * as ResultsUI from './ui/resultsUI.js';

// --- DOM Elements (Only those needed for general phase control) ---
// const statusElement = document.getElementById('status'); // Removed
const gameStatusElement = document.getElementById('game-status');
const wordHintElement = document.getElementById('word-hint');
const readyButton = document.getElementById('ready-button');
const drawingControls = document.getElementById('drawing-controls');

// --- Export Functions that delegate ---
export const updatePlayerList = PlayerListUI.updatePlayerList;
export const addChatMessage = ChatUI.addChatMessage;
export const startTimer = TimerUI.startTimer;
export const stopTimer = TimerUI.stopTimer;

// Removed updateStatus function as the element is gone
// export function updateStatus(isConnected) { ... }

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
        case 'LOBBY': // This case might not be hit if game starts immediately from lobby
            if (gameStatusElement) {
                const playerCount = data.playerCount !== undefined ? data.playerCount : (document.getElementById('player-list')?.children?.length || 0);
                const minPlayers = data.minPlayers || 2;
                if (playerCount < minPlayers) {
                    gameStatusElement.textContent = `Waiting for more players... (${playerCount}/${minPlayers})`;
                } else {
                    gameStatusElement.textContent = `Ready to start! Waiting...`;
                }
            }
            if (drawingControls) drawingControls.style.opacity = '0.5';
            if (wordHintElement) wordHintElement.textContent = '--- LOBBY ---';
            break;

        case 'WAITING': // Fallback case
            if (gameStatusElement) gameStatusElement.textContent = 'Waiting for players...';
            break;

        case 'DRAWING':
            if (gameStatusElement) gameStatusElement.textContent = 'Draw the word!';
            if (wordHintElement && data.word) { wordHintElement.textContent = data.word; wordHintElement.classList.add('is-word'); }
            if (drawingControls) drawingControls.style.opacity = '1';
            if (readyButton) { readyButton.style.display = 'block'; readyButton.disabled = false; readyButton.textContent = "Ready"; }
            TimerUI.showTimer();
            break;

        case 'VOTING':
            if (gameStatusElement) gameStatusElement.textContent = 'Vote for your favorite drawing!';
            if (drawingControls) drawingControls.style.opacity = '0.5';
            if (data.drawings && Object.keys(data.drawings).length > 0 && data.myPlayerId) {
                VotingUI.displayVotingOptions(data.drawings, data.myPlayerId);
                VotingUI.showVotingArea();
                VotingUI.enableVotingButtons();
            } else {
                console.warn("Voting phase UI: No drawings or missing myPlayerId.");
                VotingUI.showVotingArea();
                document.getElementById('voting-area').innerHTML = '<p>Waiting for drawings to vote on...</p>';
            }
            TimerUI.showTimer();
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
            break;

        default:
            if (gameStatusElement) gameStatusElement.textContent = 'Unknown game state';
    }
}