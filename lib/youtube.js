// YouTube URL helpers — a port of apps/web/src/lib/youtube.ts.

export function extractYouTubeVideoId(url) {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, '');
    let id = null;
    if (host === 'youtu.be') {
      id = u.pathname.replace(/^\//, '').split('/')[0] ?? null;
    } else if (host === 'youtube.com' || host === 'm.youtube.com') {
      if (u.pathname === '/watch') id = u.searchParams.get('v');
      else if (u.pathname.startsWith('/shorts/')) id = u.pathname.replace('/shorts/', '').split('/')[0] ?? null;
      else if (u.pathname.startsWith('/embed/')) id = u.pathname.replace('/embed/', '').split('/')[0] ?? null;
      else if (u.pathname.startsWith('/live/')) id = u.pathname.replace('/live/', '').split('/')[0] ?? null;
    }
    if (!id || !/^[\w-]{6,}$/.test(id)) return null;
    return id;
  } catch { return null; }
}

export function youtubeEmbedUrl(url) {
  const id = extractYouTubeVideoId(url);
  return id ? `https://www.youtube.com/embed/${id}` : null;
}

export function youtubeThumbnailUrl(url, quality = 'mq') {
  const id = extractYouTubeVideoId(url);
  if (!id) return null;
  const file = quality === 'maxres' ? 'maxresdefault.jpg' : quality === 'sd' ? 'sddefault.jpg' : quality === 'hq' ? 'hqdefault.jpg' : 'mqdefault.jpg';
  return `https://img.youtube.com/vi/${id}/${file}`;
}
