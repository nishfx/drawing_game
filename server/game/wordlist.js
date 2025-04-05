export const wordList = [
    "apple", "banana", "car", "house", "tree", "computer", "book", "chair",
    "sun", "moon", "star", "cloud", "rain", "flower", "river", "mountain",
    "bird", "fish", "dog", "cat", "mouse", "elephant", "guitar", "piano",
    "bridge", "train", "boat", "bicycle", "lamp", "clock", "key", "door",
    "hat", "shoe", "sock", "shirt", "pants", "glasses", "watch", "ring",
    "table", "window", "pencil", "paper", "phone", "camera", "television",
    "radio", "airplane", "rocket", "robot", "ghost", "monster", "dragon",
    "castle", "knight", "king", "queen", "prince", "princess", "wizard",
    "witch", "fairy", "elf", "dwarf", "goblin", "orc", "troll", "unicorn",
    "rainbow", "treasure", "map", "compass", "island", "beach", "ocean",
    "desert", "forest", "jungle", "cave", "volcano", "waterfall", "fire",
    "ice", "snow", "storm", "tornado", "earthquake", "lightning", "thunder"
];

export function getRandomWord() {
    if (wordList.length === 0) return "DEFAULT"; // Fallback
    return wordList[Math.floor(Math.random() * wordList.length)];
}