import { json } from '@sveltejs/kit';
import { YAHOO_CLIENT_ID } from '$env/static/private';

export async function GET({ url }) {
    const query = url.searchParams.get('q');
    
    if (!query) {
        return json({ error: 'Query is required' }, { status: 400 });
    }

    const yahooUrl = new URL('https://map.yahooapis.jp/search/local/V1/localSearch');
    yahooUrl.searchParams.set('appid', YAHOO_CLIENT_ID);
    yahooUrl.searchParams.set('query', query);
    yahooUrl.searchParams.set('output', 'json');
    yahooUrl.searchParams.set('results', '5');

    try {
        const response = await fetch(yahooUrl.toString());
        if (!response.ok) {
            throw new Error(`Yahoo API error: ${response.status}`);
        }
        const data = await response.json();
        return json(data);
    } catch (error) {
        console.error('Yahoo Search Proxy Error:', error);
        return json({ error: 'Failed to fetch from Yahoo API' }, { status: 500 });
    }
}
