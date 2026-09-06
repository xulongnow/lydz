/**
 * 结果页渲染 + 事件绑定 v8
 */

let currentHandlers = null;

function renderRadar(container, radarData, dimLabels) {
  const size = 280;
  const cx = size / 2;
  const cy = size / 2;
  const radius = 90;
  const n = 6;
  const angleOffset = -Math.PI / 2;

  function point(i, r) {
    const angle = angleOffset + (i * 2 * Math.PI) / n;
    return [cx + r * Math.cos(angle), cy + r * Math.sin(angle)];
  }

  let svg = `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" style="display:block;margin:0 auto;">`;

  // 背景网格（3层）
  for (let layer = 1; layer <= 3; layer++) {
    const r = (radius / 3) * layer;
    let d = '';
    for (let i = 0; i <= n; i++) {
      const [x, y] = point(i % n, r);
      d += (i === 0 ? 'M' : 'L') + `${x.toFixed(1)},${y.toFixed(1)}`;
    }
    svg += `<path d="${d}Z" fill="none" stroke="#e0d8c8" stroke-width="1"/>`;
  }

  // 轴线和标签
  for (let i = 0; i < n; i++) {
    const [x, y] = point(i, radius);
    svg += `<line x1="${cx}" y1="${cy}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}" stroke="#e0d8c8" stroke-width="1"/>`;
    const [lx, ly] = point(i, radius + 22);
    const label = radarData[i]?.label || `D${i + 1}`;
    svg += `<text x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" text-anchor="middle" dominant-baseline="middle" font-size="11" fill="#5a6c7d">${label}</text>`;
  }

  // 数据多边形
  let dataD = '';
  for (let i = 0; i < n; i++) {
    const score = radarData[i]?.score || 0;
    const r = ((score + 1) / 2) * radius; // [-1,1] -> [0, radius]
    const [x, y] = point(i, r);
    dataD += (i === 0 ? 'M' : 'L') + `${x.toFixed(1)},${y.toFixed(1)}`;
  }
  svg += `<path d="${dataD}Z" fill="rgba(232,116,59,0.2)" stroke="#e8743b" stroke-width="2"/>`;

  // 数据点
  for (let i = 0; i < n; i++) {
    const score = radarData[i]?.score || 0;
    const r = ((score + 1) / 2) * radius;
    const [x, y] = point(i, r);
    svg += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3" fill="#e8743b"/>`;
  }

  svg += '</svg>';
  container.innerHTML = svg;
}

export function render(container, r, data) {
  const p = r.profile || {};
  const resultEmoji = container.querySelector('#resultEmoji');
  const resultType = container.querySelector('#resultType');
  const resultTagline = container.querySelector('#resultTagline');
  const resultDesc = container.querySelector('#resultDesc');
  const rateCircle = container.querySelector('#rateCircle');
  const rateNum = container.querySelector('#rateNum');
  const buddyList = container.querySelector('#buddyList');
  const top3List = container.querySelector('#top3List');
  const ambiguityHint = container.querySelector('#ambiguityHint');
  const radarChart = container.querySelector('#radarChart');
  const dimInterpretation = container.querySelector('#dimInterpretation');

  if (resultEmoji) resultEmoji.textContent = p.emoji || '🎯';
  if (resultType) resultType.textContent = r.winner;
  if (resultTagline) resultTagline.textContent = p.tagline || '';
  if (resultDesc) resultDesc.textContent = p.desc || '';

  const rate = Math.round(r.matchRate || 0);
  if (rateCircle) rateCircle.style.setProperty('--rate', rate);
  if (rateNum) rateNum.textContent = `${rate}%`;

  // 模糊度提示
  if (ambiguityHint) {
    const pres = r.presentation || {};
    if (r.ambiguity === 'high') {
      ambiguityHint.innerHTML = `<div class="ambiguity-box ambiguity-high">${pres.message || `你的旅行人格在 ${pres.primary} 和 ${pres.secondary} 之间摇摆`}</div>`;
    } else if (r.ambiguity === 'medium') {
      ambiguityHint.innerHTML = `<div class="ambiguity-box ambiguity-medium">${pres.hint || `你也带有 ${pres.secondary || r.top3[1]?.name} 的特质`}</div>`;
    } else {
      ambiguityHint.innerHTML = `<div class="ambiguity-box ambiguity-low">结果比较明确，你就是这个类型</div>`;
    }
  }

  // 雷达图
  if (radarChart && r.radarData) {
    renderRadar(radarChart, r.radarData, data.dimLabels);
  }

  // 维度解读
  if (dimInterpretation && r.dimInterpretation) {
    const ul = document.createElement('ul');
    ul.className = 'dim-list';
    for (const item of r.dimInterpretation) {
      const li = document.createElement('li');
      li.textContent = item;
      ul.appendChild(li);
    }
    dimInterpretation.innerHTML = '<h3 class="result-section-title">&#10022; 维度解读</h3>';
    dimInterpretation.appendChild(ul);
  }

  // 最佳搭子
  if (buddyList) {
    const frag = document.createDocumentFragment();
    const buddies = r.buddies || [];
    for (let i = 0; i < buddies.length; i++) {
      const b = buddies[i];
      const card = document.createElement('div');
      card.className = 'buddy-card';

      const emoji = document.createElement('div');
      emoji.className = 'buddy-emoji';
      emoji.textContent = b.emoji || '🧳';

      const name = document.createElement('div');
      name.className = 'buddy-name';
      name.textContent = b.name;

      const tag = document.createElement('div');
      tag.className = 'buddy-tag';
      tag.textContent = b.tagline || '';

      card.appendChild(emoji);
      card.appendChild(name);
      card.appendChild(tag);
      frag.appendChild(card);
    }
    while (buddyList.firstChild) buddyList.removeChild(buddyList.firstChild);
    buddyList.appendChild(frag);
  }

  // Top3
  if (top3List) {
    const frag = document.createDocumentFragment();
    const top3 = r.top3 || [];
    const mx = top3.length > 0 ? top3[0].similarity : 1;
    for (let i = 0; i < top3.length; i++) {
      const pct = mx > 0 ? Math.round((top3[i].similarity / mx) * 100) : 0;
      const item = document.createElement('div');
      item.className = 'top5-item';

      const rank = document.createElement('div');
      rank.className = 'top5-rank';
      rank.textContent = i + 1;

      const name = document.createElement('div');
      name.className = 'top5-name';
      name.textContent = top3[i].name;

      const barWrap = document.createElement('div');
      barWrap.className = 'top5-bar';
      const barFill = document.createElement('div');
      barFill.className = 'top5-fill';
      barFill.style.width = `${pct}%`;
      barWrap.appendChild(barFill);

      const score = document.createElement('div');
      score.className = 'top5-score';
      score.textContent = `${top3[i].similarity}%`;

      item.appendChild(rank);
      item.appendChild(name);
      item.appendChild(barWrap);
      item.appendChild(score);
      frag.appendChild(item);
    }
    while (top3List.firstChild) top3List.removeChild(top3List.firstChild);
    top3List.appendChild(frag);
  }
}

export function bindEvents(handlers) {
  currentHandlers = handlers;

  const shareBtn = document.getElementById('shareBtn');
  const retryBtn = document.getElementById('retryBtn');

  if (shareBtn) {
    shareBtn.addEventListener('click', () => {
      if (handlers.onShare) handlers.onShare();
    });
  }
  if (retryBtn) {
    retryBtn.addEventListener('click', () => {
      if (handlers.onRetry) handlers.onRetry();
    });
  }
}

export function destroy() {
  currentHandlers = null;
}
