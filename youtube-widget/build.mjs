#!/usr/bin/env node
/**
 * data.json + template.html → dist/widget.html (외부 의존성 없는 단일 파일)
 *
 *   node build.mjs [--data data.json] [--out dist/widget.html]
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const dataPath = resolve(HERE, arg('data', 'data.json'));
const outPath = resolve(HERE, arg('out', 'dist/widget.html'));

let data;
try {
  data = JSON.parse(readFileSync(dataPath, 'utf8'));
} catch {
  console.error(`${dataPath} 를 읽을 수 없습니다. 먼저 fetch.mjs 를 실행해 데이터를 받으세요.`);
  process.exit(1);
}

const template = readFileSync(resolve(HERE, 'template.html'), 'utf8');

/* ---------- 표시 형식 ---------- */

const esc = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

function views(n) {
  if (n >= 1e8) return `${(n / 1e8).toFixed(1).replace(/\.0$/, '')}억회`;
  if (n >= 1e4) return `${(n / 1e4).toFixed(1).replace(/\.0$/, '')}만회`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1).replace(/\.0$/, '')}천회`;
  return `${n}회`;
}

function clock(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const mm = h ? String(m).padStart(2, '0') : String(m);
  return `${h ? `${h}:` : ''}${mm}:${String(s).padStart(2, '0')}`;
}

function ago(iso) {
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  if (d <= 0) return '오늘';
  if (d === 1) return '어제';
  if (d < 7) return `${d}일 전`;
  if (d < 31) return `${Math.floor(d / 7)}주 전`;
  if (d < 365) return `${Math.floor(d / 30)}개월 전`;
  return `${Math.floor(d / 365)}년 전`;
}

const seoulStamp = (iso) => new Intl.DateTimeFormat('ko-KR', {
  timeZone: 'Asia/Seoul',
  month: 'long', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
}).format(new Date(iso)) + ' 갱신';

/* ---------- 렌더링 ---------- */

function card(v, catId) {
  const days = (Date.now() - new Date(v.publishedAt).getTime()) / 86400000;
  const badges = [];
  if (v.heat >= 0.75) badges.push('<span class="badge badge-hot">급상승</span>');
  if (days <= 7) badges.push('<span class="badge badge-new">NEW</span>');
  if (v.duration <= 600) badges.push('<span class="badge badge-short">10분 컷</span>');

  const url = `https://www.youtube.com/watch?v=${v.id}`;
  const haystack = `${v.title} ${v.channel}`.toLowerCase();

  // v.thumb 가 data: URI 로 인라인된 경우에만 이미지를 쓴다.
  // 아티팩트 CSP 는 외부 호스트 이미지를 차단하므로 원격 URL 은 러닝타임 타일로 대체한다.
  const inlined = typeof v.thumb === 'string' && v.thumb.startsWith('data:');
  const tile = inlined
    ? `<a class="thumb" href="${url}" target="_blank" rel="noopener" tabindex="-1" aria-hidden="true">
            <img src="${v.thumb}" alt="" loading="lazy" width="320" height="180">
            <span class="len">${clock(v.duration)}</span>
          </a>`
    : `<a class="thumb thumb--solo" href="${url}" target="_blank" rel="noopener" tabindex="-1" aria-hidden="true">
            <span class="len">${clock(v.duration)}</span>
          </a>`;

  return `      <article class="card"
        data-id="${esc(v.id)}"
        data-cat="${esc(catId)}"
        data-title="${esc(v.title)}"
        data-search="${esc(haystack)}"
        data-published="${esc(v.publishedAt)}"
        data-duration="${v.duration}"
        data-views="${v.views}"
        data-score="${v.score.toFixed(4)}">
        ${tile}
        <div class="body">
          <div class="badges">${badges.join('')}</div>
          <h3><a href="${url}" target="_blank" rel="noopener">${esc(v.title)}</a></h3>
          <p class="channel">${esc(v.channel)}</p>
          <ul class="stats">
            <li>${views(v.views)}</li>
            <li class="age">${ago(v.publishedAt)}</li>
            <li class="vh">길이 ${clock(v.duration)}</li>
          </ul>
          <div class="card-foot">
            <div class="meter" role="img" aria-label="주제 내 트렌드 점수 ${Math.round(v.heat * 100)}퍼센트">
              <span style="width:${(v.heat * 100).toFixed(0)}%"></span>
            </div>
            <button type="button" class="seen" aria-pressed="false">봤어요</button>
          </div>
        </div>
      </article>`;
}

const total = data.categories.reduce((n, c) => n + c.videos.length, 0);

const tabs = [
  `      <button type="button" class="tab" role="tab" data-cat="all" aria-selected="true" data-blurb="네 가지 주제를 트렌드 점수 순으로 한 줄에 모았습니다.">전체<span class="count">${total}</span></button>`,
  ...data.categories.map((c) =>
    `      <button type="button" class="tab" role="tab" data-cat="${esc(c.id)}" aria-selected="false" data-blurb="${esc(c.blurb)}">${esc(c.label)}<span class="count">${c.videos.length}</span></button>`),
].join('\n');

const cards = data.categories
  .flatMap((c) => c.videos.map((v) => card(v, c.id)))
  .join('\n');

const html = template
  .replace('{{TABS}}', tabs)
  .replace('{{CARDS}}', cards)
  .replace('{{UPDATED}}', esc(seoulStamp(data.generatedAt)))
  .replace('{{WINDOW}}', String(data.windowDays))
  .replace('{{TOTAL}}', String(total));

if (html.includes('{{')) {
  console.error('템플릿에 채우지 못한 자리표시자가 남아 있습니다.');
  process.exit(1);
}

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, html);
console.log(`${outPath} 생성 완료 · 영상 ${total}편 · ${(html.length / 1024).toFixed(0)}KB`);
