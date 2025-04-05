// server/aiService.js
import OpenAI from 'openai';
import dotenv from 'dotenv';

// Load environment variables from .env file
dotenv.config();

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

const AI_MODEL = "gpt-4o-mini"; // Use the specified model
const MAX_RETRIES = 2;
const INITIAL_RETRY_DELAY_MS = 1000;

/**
 * Asks the OpenAI API to interpret an image provided as a base64 data URL.
 * @param {string} base64ImageData - The base64 encoded image data (e.g., "data:image/png;base64,...").
 * @returns {Promise<string>} A promise that resolves with the AI's one-sentence interpretation or rejects with an error message.
 */
export async function interpretImage(base64ImageData) {
    if (!process.env.OPENAI_API_KEY) {
        console.error("AI Service Error: OPENAI_API_KEY is not set.");
        return Promise.reject("AI Service is not configured on the server.");
    }
    if (!base64ImageData || !base64ImageData.startsWith('data:image')) {
        return Promise.reject("Invalid image data provided.");
    }

    console.log(`[AI Service] Requesting interpretation for image (length: ${base64ImageData.length})...`);

    let retries = 0;
    while (retries <= MAX_RETRIES) {
        try {
            const response = await openai.chat.completions.create({
                model: AI_MODEL,
                messages: [
                    {
                        role: "user",
                        content: [
                            { type: "text", text: "Make fun of this drawing in German in one simple sentence. You can be really harsh as this is part of a game. Use irony and sarcasm and dark humour when possible. The sentence should be at max 20 words long." },
                            {
                                type: "image_url",
                                image_url: {
                                    "url": base64ImageData,
                                },
                            },
                        ],
                    },
                ],
                max_tokens: 40, // Limit response length
            });

            console.log("[AI Service] Received response from OpenAI.");

            if (response.choices && response.choices.length > 0 && response.choices[0].message?.content) {
                const interpretation = response.choices[0].message.content.trim();
                console.log(`[AI Service] Interpretation: "${interpretation}"`);
                return interpretation; // Resolve with the interpretation text
            } else {
                console.error("[AI Service] Error: Unexpected response format from OpenAI:", response);
                throw new Error("Received an unexpected response format from the AI.");
            }
        } catch (error) {
            console.error(`[AI Service] Error calling OpenAI API (Attempt ${retries + 1}/${MAX_RETRIES + 1}):`, error.message);
            retries++;
            if (retries > MAX_RETRIES) {
                // If max retries reached, reject the promise
                return Promise.reject(`AI failed to interpret the image after several attempts. (${error.status || 'Network Error'})`);
            }
            // Wait before retrying (exponential backoff could be added here)
            await new Promise(resolve => setTimeout(resolve, INITIAL_RETRY_DELAY_MS * retries));
        }
    }
    // Should not be reached if loop logic is correct, but acts as a fallback
    return Promise.reject("AI failed to interpret the image after maximum retries.");
}

/**
 * Asks the OpenAI API to evaluate how well a drawing represents a given word.
 * @param {string} base64ImageData - The base64 encoded image data.
 * @param {string} word - The word the drawing is supposed to represent.
 * @returns {Promise<{score: number, explanation: string}>} A promise resolving with score (0-10) and explanation. Rejects on error.
 */
export async function evaluateDrawing(base64ImageData, word) {
    if (!process.env.OPENAI_API_KEY) {
        console.error("AI Service Error: OPENAI_API_KEY is not set.");
        return Promise.reject("AI Service is not configured on the server.");
    }
     if (!base64ImageData || !base64ImageData.startsWith('data:image')) {
        return Promise.reject("Invalid image data provided for evaluation.");
    }
    if (!word || typeof word !== 'string' || word.trim().length === 0) {
         return Promise.reject("Invalid word provided for evaluation.");
    }

    const prompt = `Rate how well this image depicts the word "${word}" on a scale of 0 to 10 (0 = not at all, 10 = perfectly). Provide a one-sentence explanation in German for your rating. Format your response EXACTLY like this:\nScore: [score]/10\nExplanation: [sentence]`;

    console.log(`[AI Service] Requesting evaluation for word "${word}" (image length: ${base64ImageData.length})...`);

    let retries = 0;
    while (retries <= MAX_RETRIES) {
        try {
            const response = await openai.chat.completions.create({
                model: AI_MODEL,
                messages: [
                    {
                        role: "user",
                        content: [
                            { type: "text", text: prompt },
                            {
                                type: "image_url",
                                image_url: { "url": base64ImageData },
                            },
                        ],
                    },
                ],
                max_tokens: 80, // Slightly more tokens for score + explanation
            });

            console.log("[AI Service] Received evaluation response from OpenAI.");

            if (response.choices && response.choices.length > 0 && response.choices[0].message?.content) {
                const rawResponse = response.choices[0].message.content.trim();
                console.log(`[AI Service] Raw evaluation: "${rawResponse}"`);

                // --- Parse the response ---
                const scoreMatch = rawResponse.match(/Score:\s*(\d{1,2})\s*\/\s*10/i);
                const explanationMatch = rawResponse.match(/Explanation:\s*(.*)/i);

                const score = scoreMatch ? parseInt(scoreMatch[1], 10) : 0;
                // Clamp score between 0 and 10
                const clampedScore = Math.max(0, Math.min(10, score));
                const explanation = explanationMatch ? explanationMatch[1].trim() : "AI did not provide a valid explanation.";

                if (!scoreMatch) {
                    console.warn(`[AI Service] Could not parse score from response: "${rawResponse}"`);
                    // Return 0 score but keep potentially useful explanation text
                     return { score: 0, explanation: explanation || rawResponse };
                }

                return { score: clampedScore, explanation };
                // --- End Parsing ---

            } else {
                console.error("[AI Service] Error: Unexpected evaluation response format:", response);
                throw new Error("Received an unexpected response format from the AI.");
            }
        } catch (error) {
            console.error(`[AI Service] Error calling OpenAI API for evaluation (Attempt ${retries + 1}/${MAX_RETRIES + 1}):`, error.message);
            retries++;
            if (retries > MAX_RETRIES) {
                return Promise.reject(`AI failed to evaluate the image after several attempts. (${error.status || 'Network Error'})`);
            }
            await new Promise(resolve => setTimeout(resolve, INITIAL_RETRY_DELAY_MS * retries));
        }
    }
     return Promise.reject("AI failed to evaluate the image after maximum retries.");
}