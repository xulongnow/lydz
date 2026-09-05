/**
 * 欢迎页渲染 + 事件绑定
 */

export function render(container, data) {
  const types = data.types.slice();
  // Fisher-Yates 洗牌
  for (let i = types.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const t = types[i];
    types[i] = types[j];
    types[j] = t;
  }

  const wrap = container.querySelector('.welcome-types');
  if (!wrap) return;

  const frag = document.createDocumentFragment();
  for (let i = 0; i < Math.min(12, types.length); i++) {
    const p = data.profiles[types[i]] || {};
    const chip = document.createElement('span');
    chip.className = 'type-chip';
    chip.textContent = `${p.emoji || '🎯'} ${types[i]}`;
    frag.appendChild(chip);
  }
  const more = document.createElement('span');
  more.className = 'type-chip';
  more.textContent = '...共48种';
  frag.appendChild(more);

  while (wrap.firstChild) wrap.removeChild(wrap.firstChild);
  wrap.appendChild(frag);
}

export function bindEvents(handlers) {
  const btn = document.querySelector('.start-btn');
  if (btn) {
    btn.addEventListener('click', handlers.onStart);
  }
}
