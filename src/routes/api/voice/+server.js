import { error } from '@sveltejs/kit';

/** @type {import('./$types').RequestHandler} */
export async function GET({ url }) {
    const text = url.searchParams.get('text');
    if (!text) throw error(400, 'Text is required');

    // speaker 3 (Zundamon Normal)
    const speaker = 3;
    
    const speed = url.searchParams.get('speed') || '1.25';
    
    // 1. Try Local VOICEVOX Engine (localhost:50021)
    try {
        const queryRes = await fetch(`http://localhost:50021/audio_query?text=${encodeURIComponent(text)}&speaker=${speaker}`, { 
            method: 'POST' 
        });
        
        if (queryRes.ok) {
            const query = await queryRes.json();
            
            // Adjust speed
            query.speedScale = parseFloat(speed);
            
            const synthRes = await fetch(`http://localhost:50021/synthesis?speaker=${speaker}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(query)
            });
            
            if (synthRes.ok) {
                console.log('Voice Synthesis: Using local engine');
                const audioData = await synthRes.arrayBuffer();
                return new Response(audioData, { headers: { 'Content-Type': 'audio/wav' } });
            }
        }
    } catch (err) {
        console.warn('Local VOICEVOX engine not available, trying fallback...');
    }

    // 2. Try Public API Fallback (Unofficial tts.quest)
    try {
        const fallbackUrl = `https://api.tts.quest/v3/voicevox/synthesis?text=${encodeURIComponent(text)}&speaker=${speaker}`;
        
        console.log('VOICEVOX Fallback: Requesting synthesis...', fallbackUrl);
        const fallbackRes = await fetch(fallbackUrl);
        
        if (fallbackRes.ok) {
            const result = await fallbackRes.json();
            if (result.success && result.wavDownloadUrl) {
                // Polling loop: Upstream might 404 for a few seconds while file is being written
                // Increased to 30 attempts (15 seconds total) for long sentences
                let audioData = null;
                for (let i = 0; i < 30; i++) {
                    console.log(`VOICEVOX Fallback: Fetching audio (Attempt ${i+1}/30)...`);
                    try {
                        const audioRes = await fetch(result.wavDownloadUrl);
                        if (audioRes.ok) {
                            audioData = await audioRes.arrayBuffer();
                            break;
                        }
                        if (audioRes.status === 404) {
                            await new Promise(r => setTimeout(r, 500));
                            continue;
                        }
                    } catch (e) {
                        console.warn(`Attempt ${i+1} failed:`, e.message);
                    }
                    break; // Other error, stop
                }

                if (audioData) {
                    console.log('VOICEVOX Fallback: Successfully fetched audio, size:', audioData.byteLength);
                    return new Response(audioData, { headers: { 'Content-Type': 'audio/wav' } });
                } else {
                    console.error('VOICEVOX Fallback: Polling timed out after 30 attempts.');
                }
            } else if (result.retry) {
                console.warn('VOICEVOX Fallback: API busy, retry in', result.retry, 's');
                return new Response(JSON.stringify({ error: 'API busy', retry: result.retry }), { status: 503 });
            }
        }
    } catch (err) {
        console.error('VOICEVOX Fallback Error:', err);
    }

    return new Response(JSON.stringify({ error: 'Failed to synthesize voice after all attempts' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
    });
}
