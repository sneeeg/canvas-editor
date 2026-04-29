class AppToast extends HTMLElement {
  connectedCallback() {
    this.setAttribute('role', 'status');
    this.setAttribute('aria-live', 'polite');
  }

  show(message) {
    window.clearTimeout(this.timeoutId);
    this.textContent = message;
    this.classList.add('is-visible');
    this.timeoutId = window.setTimeout(() => {
      this.classList.remove('is-visible');
    }, 2400);
  }
}

customElements.define('app-toast', AppToast);
