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
                            { type: "text", text: "Beschreibe das Bild, indem du sagst, was darauf zu sehen ist, aber auf eine möglichst abwertende Art und Weise. Nutze maximal 20 Wörter." },
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