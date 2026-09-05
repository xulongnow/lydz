/**
 * 结果页渲染 + 事件绑定
 */

let currentHandlers = null;

export function render(container, r, data) {
  const p = r.profile || {};
  const resultEmoji = container.querySelector('#resultEmoji');
  const resultType = container.querySelector('#resultType');
  const resultTagline = container.querySelector('#resultTagline');
  const resultDesc = container.querySelector('#resultDesc');
  const rateCircle = container.querySelector('#rateCircle');
  const rateNum = container.querySelector('#rateNum');
  const buddyList = container.querySelector('#buddyList');
  const top5List = container.querySelector('#top5List');

  if (resultEmoji) resultEmoji.textContent = p.emoji || '🎯';
  if (resultType) resultType.textContent = r.winner;
  if (resultTagline) resultTagline.textContent = p.tagline || '';
  if (resultDesc) resultDesc.textContent = p.desc || '';

  const rate = Math.round(r.matchRate || 0);
  if (rateCircle) rateCircle.style.setProperty('--rate', rate);
  if (rateNum) rateNum.textContent = `${rate}%`;

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

  if (top5List) {
    const frag = document.createDocumentFragment();
    const top5 = r.top5 || [];
    const mx = top5.length > 0 ? top5[0].score : 1;
    for (let i = 0; i < top5.length; i++) {
      const pct = Math.round((top5[i].score / mx) * 100);
      const item = document.createElement('div');
      item.className = 'top5-item';

      const rank = document.createElement('div');
      rank.className = 'top5-rank';
      rank.textContent = i + 1;

      const name = document.createElement('div');
      name.className = 'top5-name';
      name.textContent = top5[i].type;

      const barWrap = document.createElement('div');
      barWrap.className = 'top5-bar';
      const barFill = document.createElement('div');
      barFill.className = 'top5-fill';
      barFill.style.width = `${pct}%`;
      barWrap.appendChild(barFill);

      const score = document.createElement('div');
      score.className = 'top5-score';
      score.textContent = top5[i].score;

      item.appendChild(rank);
      item.appendChild(name);
      item.appendChild(barWrap);
      item.appendChild(score);
      frag.appendChild(item);
    }
    while (top5List.firstChild) top5List.removeChild(top5List.firstChild);
    top5List.appendChild(frag);
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
