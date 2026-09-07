/**
 * 结果页渲染 + 事件绑定 v8
 */

// P0-4 缓解方案 C：近距离配对提示文案
const CLOSE_PAIR_MESSAGES = {
  '出片者-行走的攻略': '出片者和行走的攻略这两种旅行风格非常相似，你可能同时具备两者的特质',
  '行走的攻略-出片者': '行走的攻略和出片者这两种旅行风格非常相似，你可能同时具备两者的特质',
  '美食雷达-购物狂魔': '美食雷达和购物狂魔对旅行中的"发现感"有强烈共鸣',
  '购物狂魔-美食雷达': '购物狂魔和美食雷达对旅行中的"发现感"有强烈共鸣',
  '中餐续命者-补水狂魔': '中餐续命者和补水狂魔在饮食偏好上非常接近',
  '补水狂魔-中餐续命者': '补水狂魔和中餐续命者在饮食偏好上非常接近',
  '出门困难户-婴幼儿': '出门困难户和婴幼儿都属于低行动力的旅行风格',
  '婴幼儿-出门困难户': '婴幼儿和出门困难户都属于低行动力的旅行风格',
  '打卡狂魔-行走的攻略': '打卡狂魔和行走的攻略在旅行目标感上很相似',
  '行走的攻略-打卡狂魔': '行走的攻略和打卡狂魔在旅行目标感上很相似',
  '纪录片导演-美食雷达': '纪录片导演和美食雷达都喜欢深挖目的地的细节',
  '美食雷达-纪录片导演': '美食雷达和纪录片导演都喜欢深挖目的地的细节',
  '外卖鉴赏家-Wi-Fi搜寻者': '外卖鉴赏家和 Wi-Fi 搜寻者都偏向舒适型旅行',
  'Wi-Fi搜寻者-外卖鉴赏家': 'Wi-Fi 搜寻者和外卖鉴赏家都偏向舒适型旅行',
  '特种兵王-购物狂魔': '特种兵王和购物狂魔在行动力和目标感上相近',
  '购物狂魔-特种兵王': '购物狂魔和特种兵王在行动力和目标感上相近',
};

let currentHandlers = null;

function renderRadar(container, radarData, dimLabels) {
  const size = 280;
  const cx = size / 2;
  const cy = size / 2;
  const radius = 90;
  const n = 6;
  const angleOffset = -Math.PI / 2;
  const SVG_NS = 'http://www.w3.org/2000/svg';

  function point(i, r) {
    const angle = angleOffset + (i * 2 * Math.PI) / n;
    return [cx + r * Math.cos(angle), cy + r * Math.sin(angle)];
  }

  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${size} ${size}`);
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.style.display = 'block';
  svg.style.margin = '0 auto';

  // 背景网格（3层）
  for (let layer = 1; layer <= 3; layer++) {
    const r = (radius / 3) * layer;
    let d = '';
    for (let i = 0; i <= n; i++) {
      const [x, y] = point(i % n, r);
      d += (i === 0 ? 'M' : 'L') + `${x.toFixed(1)},${y.toFixed(1)}`;
    }
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', d + 'Z');
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', '#e0d8c8');
    path.setAttribute('stroke-width', '1');
    svg.appendChild(path);
  }

  // 轴线和标签
  for (let i = 0; i < n; i++) {
    const [x, y] = point(i, radius);
    const line = document.createElementNS(SVG_NS, 'line');
    line.setAttribute('x1', String(cx));
    line.setAttribute('y1', String(cy));
    line.setAttribute('x2', String(x.toFixed(1)));
    line.setAttribute('y2', String(y.toFixed(1)));
    line.setAttribute('stroke', '#e0d8c8');
    line.setAttribute('stroke-width', '1');
    svg.appendChild(line);

    const [lx, ly] = point(i, radius + 22);
    const label = radarData[i]?.label || `D${i + 1}`;
    const text = document.createElementNS(SVG_NS, 'text');
    text.setAttribute('x', String(lx.toFixed(1)));
    text.setAttribute('y', String(ly.toFixed(1)));
    text.setAttribute('text-anchor', 'middle');
    text.setAttribute('dominant-baseline', 'middle');
    text.setAttribute('font-size', '11');
    text.setAttribute('fill', '#5a6c7d');
    text.textContent = label;
    svg.appendChild(text);
  }

  // 数据多边形
  let dataD = '';
  for (let i = 0; i < n; i++) {
    const score = radarData[i]?.score || 0;
    const r = ((score + 1) / 2) * radius; // [-1,1] -> [0, radius]
    const [x, y] = point(i, r);
    dataD += (i === 0 ? 'M' : 'L') + `${x.toFixed(1)},${y.toFixed(1)}`;
  }
  const dataPath = document.createElementNS(SVG_NS, 'path');
  dataPath.setAttribute('d', dataD + 'Z');
  dataPath.setAttribute('fill', 'rgba(232,116,59,0.2)');
  dataPath.setAttribute('stroke', '#e8743b');
  dataPath.setAttribute('stroke-width', '2');
  svg.appendChild(dataPath);

  // 数据点
  for (let i = 0; i < n; i++) {
    const score = radarData[i]?.score || 0;
    const r = ((score + 1) / 2) * radius;
    const [x, y] = point(i, r);
    const circle = document.createElementNS(SVG_NS, 'circle');
    circle.setAttribute('cx', String(x.toFixed(1)));
    circle.setAttribute('cy', String(y.toFixed(1)));
    circle.setAttribute('r', '3');
    circle.setAttribute('fill', '#e8743b');
    svg.appendChild(circle);
  }

  container.innerHTML = '';
  container.appendChild(svg);
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
    ambiguityHint.innerHTML = '';
    const box = document.createElement('div');
    box.className = 'ambiguity-box';
    if (r.ambiguity === 'high') {
      box.classList.add('ambiguity-high');
      box.textContent = pres.message || `你的旅行人格在 ${pres.primary} 和 ${pres.secondary} 之间摇摆`;
    } else if (r.ambiguity === 'medium') {
      box.classList.add('ambiguity-medium');
      box.textContent = pres.hint || `你也带有 ${pres.secondary || r.top3[1]?.name} 的特质`;
    } else {
      box.classList.add('ambiguity-low');
      box.textContent = '结果比较明确，你就是这个类型';
    }
    ambiguityHint.appendChild(box);

    // P0-4 缓解方案 C：近距离配对额外提示
    const pairKey = `${r.winner}-${r.top3[1]?.name || ''}`;
    const closeMsg = CLOSE_PAIR_MESSAGES[pairKey];
    if (closeMsg) {
      const closeBox = document.createElement('div');
      closeBox.className = 'ambiguity-box close-pair-hint';
      closeBox.style.marginTop = '8px';
      closeBox.style.background = '#fff8e1';
      closeBox.style.borderColor = '#ffcc80';
      closeBox.style.color = '#e65100';
      closeBox.textContent = closeMsg;
      ambiguityHint.appendChild(closeBox);
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
