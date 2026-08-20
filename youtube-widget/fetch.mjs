#!/usr/bin/env node
/**
 * YouTube Data API v3 로 카테고리별 한국어 영상을 수집해 data.json 으로 저장한다.
 *
 *   YOUTUBE_API_KEY=... node fetch.mjs [--days 120] [--limit 14] [--out data.json]
 *
 * 검색(search.list) 1회 = 쿼터 100유닛, 상세조회(videos.list) 1회 = 1유닛.
 * 기본 설정(카테고리 4 × 쿼리 6)이면 하루 약 2,430유닛 — 무료 한도 10,000유닛 안쪽이다.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const API = 'https://www.googleapis.com/youtube/v3';
const HANGUL = /[가-힣]/;

const API_KEY = process.env.YOUTUBE_API_KEY;
// --from-cache 는 저장해 둔 후보만 다시 추리므로 키가 필요 없다
if (!API_KEY && !process.argv.includes('--from-cache')) {
  console.error('YOUTUBE_API_KEY 환경변수가 없습니다.  예) YOUTUBE_API_KEY=AIza... node fetch.mjs');
  process.exit(1);
}

/* ---------- 인자 ---------- */

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const config = JSON.parse(readFileSync(resolve(HERE, 'config.json'), 'utf8'));
const windowDays = Number(arg('days', config.windowDays));
const perCategoryLimit = Number(arg('limit', config.perCategoryLimit));
const outPath = resolve(HERE, arg('out', 'data.json'));

let quotaUsed = 0;

/* ---------- API ---------- */

async function api(path, params, cost) {
  const url = new URL(`${API}/${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  url.searchParams.set('key', API_KEY);

  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(url);
    if (res.ok) {
      quotaUsed += cost;
      return res.json();
    }
    const body = await res.text();
    const reason = body.match(/"reason":\s*"([^"]+)"/)?.[1] ?? '';

    if (reason === 'quotaExceeded') {
      throw new Error('YouTube API 일일 쿼터를 모두 썼습니다. 내일 다시 시도하거나 config.json 의 쿼리 수를 줄이세요.');
    }
    if (res.status === 400 || res.status === 403) {
      throw new Error(`YouTube API 거부 (HTTP ${res.status}${reason ? `, ${reason}` : ''}). API 키와 "YouTube Data API v3" 사용 설정을 확인하세요.\n${body.slice(0, 400)}`);
    }
    // 5xx / 네트워크 계열은 지수 백오프로 재시도
    if (attempt === 3) throw new Error(`YouTube API 요청 실패 (HTTP ${res.status}): ${body.slice(0, 200)}`);
    await new Promise((r) => setTimeout(r, 2000 * 2 ** attempt));
  }
}

/* ---------- 파싱 유틸 ---------- */

function parseDuration(iso) {
  const m = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso ?? '');
  if (!m) return 0;
  const [, d, h, min, s] = m.map((v) => (v ? Number(v) : 0));
  return d * 86400 + h * 3600 + min * 60 + s;
}

const daysSince = (iso) => (Date.now() - new Date(iso).getTime()) / 86400000;

function isKorean(v) {
  const lang = v.snippet.defaultAudioLanguage || v.snippet.defaultLanguage || '';
  if (lang.startsWith('ko')) return true;
  if (lang && !lang.startsWith('ko')) return false;
  return HANGUL.test(v.snippet.title);
}

/**
 * 트렌드 점수. "요즘 많이 보는 영상"을 뽑는 게 목적이라 누적 조회수보다
 * 하루 평균 조회수(급상승 속도)에 가장 큰 가중치를 둔다.
 */
function score(v) {
  const views = Number(v.statistics.viewCount ?? 0);
  const likes = Number(v.statistics.likeCount ?? 0);
  const days = Math.max(daysSince(v.snippet.publishedAt), 1);

  const velocity = Math.log10(views / days + 1) * 1.0; // 급상승 속도
  const authority = Math.log10(views + 1) * 0.35;      // 누적 신뢰도
  const freshness = Math.exp(-days / 45) * 1.2;        // 최신성
  const engagement = views > 0 ? Math.min(likes / views, 0.1) * 4 : 0; // 반응률

  return velocity + authority + freshness + engagement;
}

/* ---------- 수집 ---------- */

async function searchIds(query, publishedAfter) {
  const res = await api('search', {
    part: 'snippet',
    type: 'video',
    q: query,
    maxResults: 50,
    order: 'relevance',
    regionCode: config.regionCode,
    relevanceLanguage: config.relevanceLanguage,
    publishedAfter,
  }, 100);
  return (res.items ?? []).map((i) => i.id.videoId).filter(Boolean);
}

async function hydrate(ids) {
  const out = [];
  for (let i = 0; i < ids.length; i += 50) {
    const res = await api('videos', {
      part: 'snippet,statistics,contentDetails',
      id: ids.slice(i, i + 50).join(','),
    }, 1);
    out.push(...(res.items ?? []));
  }
  return out;
}

function toRecord(v) {
  const thumbs = v.snippet.thumbnails ?? {};
  return {
    id: v.id,
    title: v.snippet.title,
    channel: v.snippet.channelTitle,
    channelId: v.snippet.channelId,
    publishedAt: v.snippet.publishedAt,
    views: Number(v.statistics.viewCount ?? 0),
    likes: Number(v.statistics.likeCount ?? 0),
    duration: parseDuration(v.contentDetails?.duration),
    thumb: (thumbs.medium ?? thumbs.high ?? thumbs.default ?? {}).url ?? '',
    score: score(v),
  };
}

/* ---------- 후보 수집 (API) ---------- */

async function gather(cat, publishedAfter) {
  const ids = new Set();
  for (const q of cat.queries) {
    for (const id of await searchIds(q, publishedAfter)) ids.add(id);
  }
  return hydrate([...ids]);
}

/* ---------- 선별 (API 없이 재실행 가능) ---------- */

/**
 * 검색 결과는 주제에서 곧잘 벗어난다("AI 디자인 툴"에 게임 영상이 섞이는 식).
 * config 의 mustMatch 키워드가 제목에 하나도 없으면 후보에서 뺀다.
 */
function onTopic(cat, v) {
  if (!cat.mustMatch?.length) return true;
  const title = v.snippet.title.toLowerCase();
  return cat.mustMatch.some((k) => title.includes(k.toLowerCase()));
}

function rank(cat, raw, taken) {
  const videos = raw
    .filter((v) => !config.koreanOnly || isKorean(v))
    .filter((v) => onTopic(cat, v))
    .map(toRecord)
    // 쇼츠는 하루 평균 조회수가 압도적이라 목록을 독식한다. 공부용이 아니므로 제외.
    .filter((v) => v.duration >= config.minDuration && v.views >= config.minViews)
    .filter((v) => !taken.has(v.id))
    .sort((a, b) => b.score - a.score);

  // 한 채널이 목록을 독점하지 않도록 채널당 상한을 둔다
  const perChannel = new Map();
  const picked = [];
  for (const v of videos) {
    const n = perChannel.get(v.channelId) ?? 0;
    if (n >= config.maxPerChannelPerCategory) continue;
    perChannel.set(v.channelId, n + 1);
    picked.push(v);
    taken.add(v.id);
    if (picked.length >= perCategoryLimit) break;
  }

  const top = picked[0]?.score ?? 1;
  for (const v of picked) v.heat = Math.max(0.08, Math.min(1, v.score / top));

  console.log(`  ${cat.label.padEnd(18)} 후보 ${raw.length}개 → 채택 ${picked.length}개`);
  return { id: cat.id, label: cat.label, blurb: cat.blurb, videos: picked };
}


const cachePath = resolve(HERE, '.cache.json');
const fromCache = process.argv.includes('--from-cache');

let raw;
if (fromCache) {
  try {
    const cached = JSON.parse(readFileSync(cachePath, 'utf8'));
    raw = cached.raw;
    console.log(`캐시된 후보로 다시 선별합니다 (${cached.fetchedAt} 수집).`);
  } catch {
    console.error('.cache.json 이 없습니다. --from-cache 없이 한 번 실행해 후보를 받아 두세요.');
    process.exit(1);
  }
} else {
  const publishedAfter = new Date(Date.now() - windowDays * 86400000).toISOString();
  console.log(`최근 ${windowDays}일 이내 한국어 영상을 수집합니다…`);
  raw = {};
  for (const cat of config.categories) {
    raw[cat.id] = await gather(cat, publishedAfter);
  }
  // 원본 후보를 남겨 두면 필터를 손볼 때 할당량을 다시 쓰지 않아도 된다
  writeFileSync(cachePath, JSON.stringify({ fetchedAt: new Date().toISOString(), windowDays, raw }));
}

// 같은 영상이 여러 주제에 겹쳐 나오면 점수가 가장 높은 주제 한 곳에만 남긴다
const taken = new Set();
const categories = config.categories.map((cat) => rank(cat, raw[cat.id] ?? [], taken));


/**
 * --thumbs 를 주면 썸네일을 내려받아 data: URI 로 심는다.
 * 아티팩트 CSP 가 외부 이미지를 막기 때문에, 썸네일을 쓰려면 인라인이 유일한 방법이다.
 * i.ytimg.com 에 나갈 수 없는 환경이면 조용히 건너뛰고 러닝타임 타일로 대체된다.
 */
async function inlineThumbs(cats) {
  let ok = 0;
  let failed = 0;

  for (const cat of cats) {
    for (const v of cat.videos) {
      if (!v.thumb) continue;
      try {
        const res = await fetch(v.thumb);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const buf = Buffer.from(await res.arrayBuffer());
        const type = res.headers.get('content-type') || 'image/jpeg';
        v.thumb = `data:${type};base64,${buf.toString('base64')}`;
        ok++;
      } catch {
        failed++;
        if (failed === 1) {
          console.warn('  썸네일을 받을 수 없습니다(네트워크 정책일 수 있음). 러닝타임 타일로 대체합니다.');
        }
      }
    }
  }
  if (ok) console.log(`  썸네일 ${ok}개 인라인 완료${failed ? `, ${failed}개 실패` : ''}`);
}

if (process.argv.includes('--thumbs')) {
  console.log('\n썸네일을 내려받는 중…');
  await inlineThumbs(categories);
}

const total = categories.reduce((n, c) => n + c.videos.length, 0);
if (total === 0) {
  console.error('수집된 영상이 0개입니다. --days 값을 늘리거나 config.json 의 쿼리를 확인하세요.');
  process.exit(1);
}

writeFileSync(outPath, JSON.stringify({
  generatedAt: new Date().toISOString(),
  windowDays,
  categories,
}, null, 2));

console.log(`\n총 ${total}개 영상 저장 → ${outPath}`);
console.log(`사용한 쿼터 약 ${quotaUsed} 유닛 (무료 한도 10,000/일)`);
