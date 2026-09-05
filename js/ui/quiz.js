/**
 * 答题页渲染 + 事件绑定
 * 使用 <button> 元素保证键盘 Tab/Enter 可达
 */

let currentHandlers = null;

export function render(container, props) {
  const progressFill = container.querySelector('#progressFill');
  const progressText = container.querySelector('#progressText');
  const backBtn = container.querySelector('#backBtn');
  const quizDim = container.querySelector('#quizDim');
  const quizStem = container.querySelector('#quizStem');
  const optList = container.querySelector('#optList');
  const quizContainer = container.querySelector('#quizContainer');

  if (progressFill) progressFill.style.width = `${(props.step / props.total) * 100}%`;
  if (progressText) progressText.textContent = `${props.step} / ${props.total}`;

  if (backBtn) {
    if (props.canGoBack) {
      backBtn.classList.remove('disabled');
      backBtn.removeAttribute('disabled');
    } else {
      backBtn.classList.add('disabled');
      backBtn.setAttribute('disabled', 'true');
    }
  }

  if (quizDim) quizDim.textContent = props.dim;
  if (quizStem) quizStem.textContent = props.stem;

  if (optList) {
    const frag = document.createDocumentFragment();
    for (let i = 0; i < props.options.length; i++) {
      const btn = document.createElement('button');
      btn.className = 'opt-btn slide-in';
      if (props.prevSelectedIdx === i) {
        btn.classList.add('prev-selected');
      }
      btn.style.animationDelay = `${i * 0.05}s`;
      btn.setAttribute('type', 'button');
      btn.setAttribute('aria-label', `选项 ${i + 1}: ${props.options[i]}`);

      const num = document.createElement('span');
      num.className = 'opt-num';
      num.textContent = i + 1;

      const text = document.createElement('span');
      text.textContent = props.options[i];

      btn.appendChild(num);
      btn.appendChild(text);

      btn.addEventListener('click', () => {
        if (currentHandlers && currentHandlers.onSelect) {
          currentHandlers.onSelect(i);
        }
      });

      frag.appendChild(btn);
    }
    while (optList.firstChild) optList.removeChild(optList.firstChild);
    optList.appendChild(frag);
  }

  // 触发动画重排
  if (quizContainer) {
    quizContainer.classList.remove('fade-in');
    void quizContainer.offsetWidth;
    quizContainer.classList.add('fade-in');
  }
}

export function bindEvents(handlers) {
  currentHandlers = handlers;

  const backBtn = document.getElementById('backBtn');
  const restartBtn = document.getElementById('restartBtn');

  if (backBtn) {
    backBtn.addEventListener('click', () => {
      if (handlers.onBack) handlers.onBack();
    });
  }
  if (restartBtn) {
    restartBtn.addEventListener('click', () => {
      if (handlers.onRestart) handlers.onRestart();
    });
  }
}

export function destroy() {
  currentHandlers = null;
}
