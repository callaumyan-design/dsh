// 解析 RSS 2.0 / Atom / RSS 1.0 (RDF)，统一成同一种条目格式。
import { XMLParser } from 'fast-xml-parser';
import { createHash } from 'node:crypto';

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@',
  textNodeName: '#text',
  cdataPropName: false,
  processEntities: true,
  htmlEntities: true,
  trimValues: true,
});

const arr = (x) => (x == null ? [] : Array.isArray(x) ? x : [x]);
const text = (x) => {
  if (x == null) return '';
  if (typeof x === 'string' || typeof x === 'number') return String(x);
  if (Array.isArray(x)) return text(x[0]);
  return text(x['#text'] ?? '');
};

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };

/** 去掉 HTML，得到一段纯文本。 */
export function stripHtml(html) {
  return String(html ?? '')
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>|<\/p>|<\/li>|<\/h\d>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(#\d+|#x[0-9a-f]+|[a-z]+\d*);/gi, (m, e) => {
      if (e[0] === '#') {
        const code = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return Number.isFinite(code) ? String.fromCodePoint(code) : m;
      }
      return ENTITIES[e.toLowerCase()] ?? m;
    })
    .replace(/[ \t ]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim();
}

const firstImg = (html) => String(html ?? '').match(/<img[^>]+src=["']([^"']+)["']/i)?.[1] ?? null;

/** 去掉追踪参数和锚点，用来判断两条链接是不是同一篇。 */
export function canonicalUrl(url) {
  try {
    const u = new URL(url);
    u.hash = '';
    for (const k of [...u.searchParams.keys()]) {
      if (/^(utm_|ref$|ref_|spm$|from$|source$|fbclid$|gclid$)/i.test(k)) u.searchParams.delete(k);
    }
    u.hostname = u.hostname.replace(/^www\./, '');
    u.protocol = 'https:';
    return u.toString().replace(/\/$/, '');
  } catch {
    return String(url ?? '').trim();
  }
}

export const itemId = (url) => createHash('sha1').update(canonicalUrl(url)).digest('base64url').slice(0, 12);

const toIso = (s) => {
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

// 喂给 AI 的简介只需要开头一段。有些来源在 description 里放整篇文章。
const SUMMARY_CHARS = 600;
const clip = (s) => (s.length > SUMMARY_CHARS ? `${s.slice(0, SUMMARY_CHARS)}…` : s);

function atomLink(links) {
  const list = arr(links);
  const alt = list.find((l) => !l['@rel'] || l['@rel'] === 'alternate') ?? list[0];
  return typeof alt === 'string' ? alt : alt?.['@href'] ?? '';
}

function mediaImage(node) {
  const media = arr(node['media:content']).find((m) => !m['@medium'] || m['@medium'] === 'image') ?? arr(node['media:group']?.['media:content'])[0];
  if (media?.['@url']) return media['@url'];
  const thumb = arr(node['media:thumbnail'])[0];
  if (thumb?.['@url']) return thumb['@url'];
  const enc = arr(node.enclosure).find((e) => String(e['@type'] ?? '').startsWith('image/'));
  return enc?.['@url'] ?? null;
}

/**
 * 解析一份订阅源，返回条目列表。
 * @param {string} xml
 * @param {{id: string, name: string, lang: string, section: string}} source
 */
export function parseFeed(xml, source) {
  const doc = parser.parse(xml);
  let nodes;
  let kind;
  if (doc.rss?.channel) {
    nodes = arr(doc.rss.channel.item);
    kind = 'rss';
  } else if (doc.feed) {
    nodes = arr(doc.feed.entry);
    kind = 'atom';
  } else if (doc['rdf:RDF']) {
    nodes = arr(doc['rdf:RDF'].item);
    kind = 'rss';
  } else {
    throw new Error('不是 RSS 或 Atom 格式');
  }

  return nodes
    .map((n) => {
      const url = kind === 'atom' ? atomLink(n.link) : text(n.link) || text(n.guid);
      const html = kind === 'atom' ? text(n.content) || text(n.summary) : text(n['content:encoded']) || text(n.description);
      const shortHtml = kind === 'atom' ? text(n.summary) || text(n.content) : text(n.description) || text(n['content:encoded']);
      const title = stripHtml(text(n.title));
      if (!url || !title) return null;
      return {
        id: itemId(url),
        sourceId: source.id,
        sourceName: source.name,
        lang: source.lang,
        section: source.section,
        title,
        url: url.trim(),
        summary: clip(stripHtml(shortHtml)),
        publishedAt: toIso(text(n.pubDate) || text(n.published) || text(n.updated) || text(n['dc:date'])),
        image: mediaImage(n) ?? firstImg(html),
      };
    })
    .filter(Boolean);
}
