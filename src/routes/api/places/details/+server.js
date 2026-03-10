import { json } from '@sveltejs/kit';
import { Maps_API_KEY } from '$env/static/private';

export async function GET({ url }) {
    const place_id = url.searchParams.get('place_id');

    if (!place_id) {
        return json({ error: 'Missing place_id parameter' }, { status: 400 });
    }

    const googleUrl = new URL('https://maps.googleapis.com/maps/api/place/details/json');
    googleUrl.searchParams.set('place_id', place_id);
    googleUrl.searchParams.set('fields', 'geometry');
    googleUrl.searchParams.set('language', 'ja');
    googleUrl.searchParams.set('key', Maps_API_KEY);

    try {
        const response = await fetch(googleUrl.toString());
        const data = await response.json();
        return json(data);
    } catch (error) {
        console.error('Details Proxy Error:', error);
        return json({ error: 'Failed to fetch from Google' }, { status: 500 });
    }
}
