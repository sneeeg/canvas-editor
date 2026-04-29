const template = document.createElement('template');

template.innerHTML = `
  <button type="button" data-action="generate" title="Сгенерировать полигон">
    <span aria-hidden="true">✦</span>
    <span>Сгенерировать</span>
  </button>
  <button type="button" data-action="delete" title="Удалить выбранный полигон">
    <span aria-hidden="true">⌫</span>
    <span>Удалить выбранный</span>
  </button>
  <button type="button" data-action="clear" title="Удалить все полигоны">
    <span aria-hidden="true">×</span>
    <span>Удалить все</span>
  </button>
  <button type="button" data-action="undo" title="Отменить: Ctrl+Z">
    <span aria-hidden="true">↶</span>
    <span>Отменить</span>
  </button>
  <button type="button" data-action="redo" title="Повторить: Ctrl+Y или Ctrl+Shift+Z">
    <span aria-hidden="true">↷</span>
    <span>Повторить</span>
  </button>
  <label class="color-control" title="Цвет выбранного полигона">
    <span aria-hidden="true">●</span>
    <span>Цвет</span>
    <input type="color" data-action="color" value="#42b883" aria-label="Изменить цвет выбранного полигона" />
  </label>
  <button type="button" data-action="export" title="Экспорт сцены в JSON">
    <span aria-hidden="true">⇩</span>
    <span>Экспорт</span>
  </button>
  <label class="import-button" title="Импорт сцены из JSON">
    <span aria-hidden="true">⇧</span>
    <span>Импорт</span>
    <input type="file" data-action="import" accept="application/json,.json" aria-label="Импортировать JSON" />
  </label>
`;

class EditorToolbar extends HTMLElement {
  connectedCallback() {
    if (this.hasChildNodes()) {
      return;
    }

    this.append(template.content.cloneNode(true));
    this.addEventListener('click', this.handleClick);
    this.addEventListener('input', this.handleInput);
    this.addEventListener('change', this.handleChange);
  }

  disconnectedCallback() {
    this.removeEventListener('click', this.handleClick);
    this.removeEventListener('input', this.handleInput);
    this.removeEventListener('change', this.handleChange);
  }

  handleClick = (event) => {
    const control = event.target.closest('[data-action]');

    if (!control || control.matches('input')) {
      return;
    }

    this.emit(control.dataset.action);
  };

  handleInput = (event) => {
    if (event.target.dataset.action === 'color') {
      this.emit('color', { color: event.target.value });
    }
  };

  handleChange = (event) => {
    if (event.target.dataset.action === 'import') {
      const [file] = event.target.files;

      if (file) {
        this.emit('import', { file });
        event.target.value = '';
      }
    }
  };

  emit(action, detail = {}) {
    this.dispatchEvent(
      new CustomEvent('toolbar-action', {
        bubbles: true,
        detail: { action, ...detail }
      })
    );
  }

  setUndoRedoState({ canUndo, canRedo }) {
    this.querySelector('[data-action="undo"]').disabled = !canUndo;
    this.querySelector('[data-action="redo"]').disabled = !canRedo;
  }

  setSelectedColor(color) {
    const input = this.querySelector('[data-action="color"]');
    input.value = color || '#42b883';
    input.disabled = !color;
  }
}

customElements.define('editor-toolbar', EditorToolbar);
