const template = document.createElement('template');

template.innerHTML = `
  <div>
    <span class="info-label">Полигонов</span>
    <strong data-field="count">0</strong>
  </div>
  <div>
    <span class="info-label">Выбрано</span>
    <strong data-field="selected">Ничего не выбрано</strong>
  </div>
`;

class EditorInfoPanel extends HTMLElement {
  connectedCallback() {
    if (!this.hasChildNodes()) {
      this.append(template.content.cloneNode(true));
    }
  }

  update({ count, selectedName }) {
    this.querySelector('[data-field="count"]').textContent = count;
    this.querySelector('[data-field="selected"]').textContent = selectedName || 'Ничего не выбрано';
  }
}

customElements.define('editor-info-panel', EditorInfoPanel);
