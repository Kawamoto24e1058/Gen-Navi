import { browser } from '$app/environment';

let currentAudio = null;
const audioCache = new Map();

/**
 * Pre-fetches voice data for a given text and stores it in cache as a Blob URL.
 */
export async function prefetchVoice(text) {
    if (!browser || !text || audioCache.has(text)) return;
    
    try {
        console.log('Zundamon: Pre-fetching...', text);
        const response = await fetch(`/api/voice?text=${encodeURIComponent(text)}&speed=1.3`);
        if (!response.ok) return;
        
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        audioCache.set(text, url);
    } catch (err) {
        console.warn('Zundamon Pre-fetch Error:', err);
    }
}

/**
 * Stops any currently playing audio.
 */
export function stopZundamon() {
    if (currentAudio) {
        currentAudio.pause();
        currentAudio = null;
    }
}

/**
 * Zundamon Voice Guidance using VOICEVOX.
 * Supports cached Blob URLs for instant playback.
 */
export async function playZundamon(text) {
    if (!browser || !text) return;
    
    // Interrupt previous speech
    stopZundamon();
    
    // Check cache
    const cachedUrl = audioCache.get(text);
    if (cachedUrl) {
        console.log('Zundamon: Playing from cache:', text);
        currentAudio = new Audio(cachedUrl);
        await currentAudio.play();
        return;
    }

    console.log('Zundamon Guidance (Live):', text);
    try {
        const response = await fetch(`/api/voice?text=${encodeURIComponent(text)}&speed=1.3`);
        if (!response.ok) throw new Error('Speech synthesis failed');
        
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        currentAudio = new Audio(url);
        
        currentAudio.onended = () => {
            if (currentAudio?.src === url) {
                URL.revokeObjectURL(url);
                currentAudio = null;
            }
        };
        await currentAudio.play();
    } catch (err) {
        console.error('VOICEVOX (Zundamon) Playback Error:', err);
    }
}
