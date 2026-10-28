import { fetch as undiciFetch, ProxyAgent, type Dispatcher } from 'undici';

const USER_AGENT = 'Index/0.2 (+local)';

export interface TextResponse {
  text: string;
  url: string;
}

export class HttpClient {
  private readonly dispatcher: Dispatcher | undefined;

  constructor(proxyUrl?: string) {
    const clean = proxyUrl?.trim();
    if (clean) {
      this.dispatcher = new ProxyAgent(clean);
    }
  }

  async getText(url: string, headers: Record<string, string> = {}, timeoutMs = 30_000): Promise<TextResponse> {
    const response = await undiciFetch(url, {
      headers: { 'User-Agent': USER_AGENT, ...headers },
      dispatcher: this.dispatcher,
      redirect: 'follow',
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText} for ${url}`);
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    const contentType = response.headers.get('content-type') ?? '';
    const charset = /charset\s*=\s*"?([^";\s]+)/i.exec(contentType)?.[1] ?? 'utf-8';
    let text: string;
    try {
      text = new TextDecoder(charset).decode(buffer);
    } catch {
      text = new TextDecoder('utf-8').decode(buffer);
    }
    return { text, url: response.url || url };
  }
}
