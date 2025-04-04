// server/game/wordlist.js
export const wordList = [
    "apple", "banana", "car", "house", "tree", "computer", "book", "chair",
    "sun", "moon", "star", "cloud", "rain", "flower", "river", "mountain",
    "bird", "fish", "dog", "cat", "mouse", "elephant", "guitar", "piano",
    "bridge", "train", "boat", "bicycle", "lamp", "clock", "key", "door",
    "hat", "shoe", "sock", "shirt", "pants", "glasses", "watch", "ring"
];

export function getRandomWord() {
    if (wordList.length === 0) return "DEFAULT"; // Fallback
    return wordList[Math.floor(Math.random() * wordList.length)];
}