// Reads a TikTok post's metadata from the public web page.
// yt-dlp handles videos well but has no support for photo carousels,
// so we read the page's embedded JSON ourselves to tell the two apart
// and to get the slide image URLs.

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';

export const HEADERS = { 'User-Agent': UA, Referer: 'https://www.tiktok.com/' };

const TIKTOK_HOST = /(^|\.)tiktok\.com$/i;

export function isTikTokUrl(raw) {
  try {
    const u = new URL(raw);
    return /^https?:$/.test(u.protocol) && TIKTOK_HOST.test(u.hostname);
  } catch {
    return false;
  }
}

// Short links (vm.tiktok.com, tiktok.com/t/...) redirect to the canonical URL.
async function resolveUrl(raw) {
  const res = await fetch(raw, { headers: HEADERS, redirect: 'follow' });
  await res.body?.cancel();
  return res.url || raw;
}

function parsePostUrl(url) {
  const m = new URL(url).pathname.match(/\/@([^/]+)\/(video|photo)\/(\d+)/);
  if (!m) return null;
  return { author: m[1], kind: m[2], id: m[3] };
}

function pickImageUrl(urlList = []) {
  return urlList.find((u) => /\.jpe?g/i.test(u)) || urlList[0];
}

export async function getPostInfo(rawUrl) {
  const url = await resolveUrl(rawUrl);
  const parsed = parsePostUrl(url);
  if (!parsed) throw new Error("Ce lien ne ressemble pas à une publication TikTok (vidéo ou photo).");

  // Photo pages don't embed the post data, but the same id under /video/ does.
  const pageUrl = `https://www.tiktok.com/@${parsed.author}/video/${parsed.id}`;
  let item = null;
  try {
    const html = await (await fetch(pageUrl, { headers: HEADERS })).text();
    const m = html.match(/<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>([\s\S]*?)<\/script>/);
    const scope = m && JSON.parse(m[1]).__DEFAULT_SCOPE__;
    item = scope?.['webapp.video-detail']?.itemInfo?.itemStruct ?? null;
  } catch {
    // Fall through: we can still try yt-dlp for videos.
  }

  const images = item?.imagePost?.images?.map((img) => pickImageUrl(img.imageURL?.urlList)).filter(Boolean) ?? [];
  const type = images.length ? 'carousel' : 'video';

  return {
    id: parsed.id,
    url: pageUrl,
    type,
    author: item?.author?.uniqueId || parsed.author,
    description: item?.desc || '',
    cover: item?.video?.cover || item?.imagePost?.cover?.imageURL?.urlList?.[0] || null,
    duration: item?.video?.duration || null,
    images,
    musicUrl: item?.music?.playUrl || null,
  };
}
