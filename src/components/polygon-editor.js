const CANVAS_PADDING = 18;
const MAX_GENERATION_ATTEMPTS = 180;
const COLORS = [
  '#0f766e',
  '#2563eb',
  '#db2777',
  '#ea580c',
  '#16a34a',
  '#7c3aed',
  '#0891b2',
  '#dc2626'
];

const template = document.createElement('template');

template.innerHTML = `
  <main class="app-shell">
    <header class="app-header">
      <div>
        <h1>Редактор полигонов</h1>
      </div>
      <editor-info-panel></editor-info-panel>
    </header>
    <editor-toolbar></editor-toolbar>
    <section class="canvas-area" aria-label="Область редактирования полигонов">
      <canvas aria-label="Холст редактора полигонов"></canvas>
      <div class="empty-state">Нажмите «Сгенерировать», чтобы добавить первый полигон</div>
    </section>
    <app-toast></app-toast>
  </main>
`;

class PolygonEditor extends HTMLElement {
  connectedCallback() {
    this.append(template.content.cloneNode(true));

    this.canvas = this.querySelector('canvas');
    this.context = this.canvas.getContext('2d');
    this.toolbar = this.querySelector('editor-toolbar');
    this.infoPanel = this.querySelector('editor-info-panel');
    this.toast = this.querySelector('app-toast');
    this.emptyState = this.querySelector('.empty-state');

    this.polygons = [];
    this.undoStack = [];
    this.redoStack = [];
    this.selectedId = null;
    this.sequence = 1;
    this.dragState = null;

    this.resizeObserver = new ResizeObserver(this.scheduleCanvasResize);
    this.resizeObserver.observe(this.canvas.parentElement);

    this.addEventListener('toolbar-action', this.handleToolbarAction);
    this.canvas.addEventListener('pointerdown', this.handlePointerDown);
    this.canvas.addEventListener('pointermove', this.handlePointerMove);
    this.canvas.addEventListener('pointerup', this.handlePointerUp);
    this.canvas.addEventListener('pointercancel', this.handlePointerUp);
    this.canvas.addEventListener('pointerleave', this.handlePointerLeave);
    window.addEventListener('keydown', this.handleKeyDown);

    this.syncUi();
  }

  disconnectedCallback() {
    this.resizeObserver.disconnect();
    cancelAnimationFrame(this.resizeFrame);
    this.removeEventListener('toolbar-action', this.handleToolbarAction);
    this.canvas.removeEventListener('pointerdown', this.handlePointerDown);
    this.canvas.removeEventListener('pointermove', this.handlePointerMove);
    this.canvas.removeEventListener('pointerup', this.handlePointerUp);
    this.canvas.removeEventListener('pointercancel', this.handlePointerUp);
    this.canvas.removeEventListener('pointerleave', this.handlePointerLeave);
    window.removeEventListener('keydown', this.handleKeyDown);
  }

  scheduleCanvasResize = () => {
    cancelAnimationFrame(this.resizeFrame);
    this.resizeFrame = requestAnimationFrame(this.resizeCanvas);
  };

  resizeCanvas = () => {
    const rect = this.canvas.parentElement.getBoundingClientRect();
    const width = Math.max(320, Math.floor(rect.width));
    const height = Math.max(280, Math.floor(rect.height));
    const ratio = window.devicePixelRatio || 1;
    const targetWidth = Math.floor(width * ratio);
    const targetHeight = Math.floor(height * ratio);

    if (this.canvas.width !== targetWidth) {
      this.canvas.width = targetWidth;
    }

    if (this.canvas.height !== targetHeight) {
      this.canvas.height = targetHeight;
    }

    this.context.setTransform(ratio, 0, 0, ratio, 0, 0);

    this.keepPolygonsInsideCanvas();
    this.draw();
  };

  handleToolbarAction = async (event) => {
    const { action } = event.detail;

    switch (action) {
      case 'generate':
        this.generatePolygon();
        break;
      case 'delete':
        this.deleteSelected();
        break;
      case 'clear':
        this.clearAll();
        break;
      case 'undo':
        this.undo();
        break;
      case 'redo':
        this.redo();
        break;
      case 'color':
        this.changeSelectedColor(event.detail.color);
        break;
      case 'export':
        this.exportScene();
        break;
      case 'import':
        await this.importScene(event.detail.file);
        break;
      default:
        break;
    }
  };

  handleKeyDown = (event) => {
    const key = event.key.toLowerCase();

    if ((event.ctrlKey || event.metaKey) && key === 'z' && !event.shiftKey) {
      event.preventDefault();
      this.undo();
    }

    if ((event.ctrlKey || event.metaKey) && (key === 'y' || (key === 'z' && event.shiftKey))) {
      event.preventDefault();
      this.redo();
    }

    if (event.key === 'Delete' || event.key === 'Backspace') {
      const isTyping = ['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName);

      if (!isTyping) {
        event.preventDefault();
        this.deleteSelected();
      }
    }
  };

  handlePointerDown = (event) => {
    const point = this.getCanvasPoint(event);
    const polygon = this.getPolygonAt(point);
    this.selectedId = polygon?.id || null;

    if (polygon) {
      this.canvas.setPointerCapture(event.pointerId);
      this.canvas.style.cursor = 'grab';
      this.dragState = {
        pointerId: event.pointerId,
        previousPoint: point,
        polygonId: polygon.id,
        beforePoints: clonePoints(polygon.points),
        moved: false
      };
    }

    this.syncUi();
    this.draw();
  };

  handlePointerMove = (event) => {
    if (!this.dragState) {
      const point = this.getCanvasPoint(event);
      this.canvas.style.cursor = this.getPolygonAt(point) ? 'pointer' : 'default';
      return;
    }

    if (event.pointerId !== this.dragState.pointerId) {
      return;
    }

    const point = this.getCanvasPoint(event);
    const polygon = this.getPolygonById(this.dragState.polygonId);

    if (!polygon) {
      return;
    }

    const dx = point.x - this.dragState.previousPoint.x;
    const dy = point.y - this.dragState.previousPoint.y;
    const proposed = this.constrainPoints(translatePoints(polygon.points, dx, dy));

    if (!this.hasCollision(proposed, polygon.id)) {
      polygon.points = proposed;
      this.dragState.previousPoint = point;
      this.dragState.moved = true;
      this.draw();
    }
  };

  handlePointerUp = (event) => {
    if (!this.dragState || event.pointerId !== this.dragState.pointerId) {
      return;
    }

    const polygon = this.getPolygonById(this.dragState.polygonId);
    const moved = polygon && this.dragState.moved && !samePoints(this.dragState.beforePoints, polygon.points);

    if (this.canvas.hasPointerCapture(event.pointerId)) {
      this.canvas.releasePointerCapture(event.pointerId);
    }

    if (moved) {
      this.commit({
        type: 'move',
        polygonId: polygon.id,
        before: this.dragState.beforePoints,
        after: clonePoints(polygon.points)
      });
    }

    this.dragState = null;
    this.updateCursor(event);
    this.syncUi();
  };

  handlePointerLeave = () => {
    if (!this.dragState) {
      this.canvas.style.cursor = 'default';
    }
  };

  generatePolygon() {
    const polygon = this.createRandomPolygon();

    if (!polygon) {
      this.showToast('Не удалось найти свободное место для нового полигона');
      return;
    }

    this.polygons.push(polygon);
    this.selectedId = polygon.id;
    this.commit({ type: 'add', polygon: clonePolygon(polygon) });
    this.syncUi();
    this.draw();
  }

  createRandomPolygon() {
    const { width, height } = this.getCanvasSize();

    for (let attempt = 0; attempt < MAX_GENERATION_ATTEMPTS; attempt += 1) {
      const vertexCount = randomInteger(3, 7);
      const radius = randomInteger(34, Math.min(86, Math.max(36, Math.min(width, height) / 5)));
      const shape = createRandomShape(vertexCount, radius);
      const bounds = getBounds(shape);
      const xMin = CANVAS_PADDING - bounds.minX;
      const xMax = width - CANVAS_PADDING - bounds.maxX;
      const yMin = CANVAS_PADDING - bounds.minY;
      const yMax = height - CANVAS_PADDING - bounds.maxY;

      if (xMin > xMax || yMin > yMax) {
        continue;
      }

      const dx = randomInteger(xMin, xMax);
      const dy = randomInteger(yMin, yMax);
      const points = translatePoints(shape, dx, dy);

      if (!this.hasCollision(points)) {
        const id = crypto.randomUUID ? crypto.randomUUID() : `polygon-${Date.now()}-${attempt}`;

        return {
          id,
          name: `Полигон ${this.sequence++}`,
          points,
          color: randomColor(),
          createdAt: performance.now()
        };
      }
    }

    return null;
  }

  deleteSelected() {
    const polygon = this.getSelectedPolygon();

    if (!polygon) {
      this.showToast('Полигон не выбран');
      return;
    }

    this.polygons = this.polygons.filter((item) => item.id !== polygon.id);
    this.selectedId = null;
    this.commit({ type: 'delete', polygon: clonePolygon(polygon) });
    this.syncUi();
    this.draw();
  }

  clearAll() {
    if (this.polygons.length === 0) {
      return;
    }

    const removed = this.polygons.map(clonePolygon);
    this.polygons = [];
    this.selectedId = null;
    this.commit({ type: 'clear', polygons: removed });
    this.syncUi();
    this.draw();
  }

  changeSelectedColor(color) {
    const polygon = this.getSelectedPolygon();

    if (!polygon) {
      this.showToast('Полигон не выбран');
      return;
    }

    const before = polygon.color;

    if (before === color) {
      return;
    }

    polygon.color = color;
    this.commit({ type: 'color', polygonId: polygon.id, before, after: color });
    this.syncUi();
    this.draw();
  }

  undo() {
    const action = this.undoStack.pop();

    if (!action) {
      return;
    }

    this.applyAction(action, true);
    this.redoStack.push(action);
    this.syncUi();
    this.draw();
  }

  redo() {
    const action = this.redoStack.pop();

    if (!action) {
      return;
    }

    this.applyAction(action, false);
    this.undoStack.push(action);
    this.syncUi();
    this.draw();
  }

  commit(action) {
    this.undoStack.push(action);
    this.redoStack = [];
  }

  applyAction(action, isUndo) {
    switch (action.type) {
      case 'add':
        if (isUndo) {
          this.polygons = this.polygons.filter((polygon) => polygon.id !== action.polygon.id);
          this.selectedId = null;
        } else {
          this.polygons.push(clonePolygon(action.polygon));
          this.selectedId = action.polygon.id;
        }
        break;
      case 'delete':
        if (isUndo) {
          this.polygons.push(clonePolygon(action.polygon));
          this.selectedId = action.polygon.id;
        } else {
          this.polygons = this.polygons.filter((polygon) => polygon.id !== action.polygon.id);
          this.selectedId = null;
        }
        break;
      case 'clear':
        this.polygons = isUndo ? action.polygons.map(clonePolygon) : [];
        this.selectedId = null;
        break;
      case 'move':
        this.applyMoveAction(action, isUndo);
        break;
      case 'color':
        this.applyColorAction(action, isUndo);
        break;
      default:
        break;
    }
  }

  applyMoveAction(action, isUndo) {
    const polygon = this.getPolygonById(action.polygonId);

    if (!polygon) {
      return;
    }

    polygon.points = clonePoints(isUndo ? action.before : action.after);
    this.selectedId = polygon.id;
  }

  applyColorAction(action, isUndo) {
    const polygon = this.getPolygonById(action.polygonId);

    if (!polygon) {
      return;
    }

    polygon.color = isUndo ? action.before : action.after;
    this.selectedId = polygon.id;
  }

  draw() {
    const { width, height } = this.getCanvasSize();
    this.context.clearRect(0, 0, width, height);
    this.drawGrid(width, height);

    for (const polygon of this.polygons) {
      this.drawPolygon(polygon);
    }

    this.emptyState.classList.toggle('is-hidden', this.polygons.length > 0);
  }

  drawGrid(width, height) {
    this.context.save();
    this.context.strokeStyle = 'rgba(24, 39, 58, 0.08)';
    this.context.lineWidth = 1;

    for (let x = 24; x < width; x += 24) {
      this.context.beginPath();
      this.context.moveTo(x, 0);
      this.context.lineTo(x, height);
      this.context.stroke();
    }

    for (let y = 24; y < height; y += 24) {
      this.context.beginPath();
      this.context.moveTo(0, y);
      this.context.lineTo(width, y);
      this.context.stroke();
    }

    this.context.restore();
  }

  drawPolygon(polygon) {
    const isSelected = polygon.id === this.selectedId;
    const age = performance.now() - polygon.createdAt;
    const progress = polygon.createdAt ? Math.min(1, age / 320) : 1;
    const scale = 0.55 + progress * 0.45;
    const center = getCenter(polygon.points);
    const points = polygon.points.map((point) => ({
      x: center.x + (point.x - center.x) * scale,
      y: center.y + (point.y - center.y) * scale
    }));

    if (progress < 1) {
      requestAnimationFrame(() => this.draw());
    }

    this.context.save();
    this.context.globalAlpha = progress;
    this.context.beginPath();
    points.forEach((point, index) => {
      if (index === 0) {
        this.context.moveTo(point.x, point.y);
      } else {
        this.context.lineTo(point.x, point.y);
      }
    });
    this.context.closePath();
    this.context.fillStyle = polygon.color;
    this.context.shadowColor = 'rgba(15, 23, 42, 0.18)';
    this.context.shadowBlur = isSelected ? 18 : 8;
    this.context.shadowOffsetY = isSelected ? 8 : 4;
    this.context.fill();
    this.context.shadowColor = 'transparent';
    this.context.lineWidth = isSelected ? 4 : 2;
    this.context.strokeStyle = isSelected ? '#ffffff' : getContrastColor(polygon.color);
    this.context.stroke();

    if (isSelected) {
      this.context.setLineDash([7, 5]);
      this.context.lineWidth = 2;
      this.context.strokeStyle = '#111827';
      this.context.stroke();
    }

    this.context.restore();
  }

  syncUi() {
    const selected = this.getSelectedPolygon();
    this.infoPanel.update({ count: this.polygons.length, selectedName: selected?.name });
    this.toolbar.setUndoRedoState({ canUndo: this.undoStack.length > 0, canRedo: this.redoStack.length > 0 });
    this.toolbar.setSelectedColor(selected?.color);
  }

  exportScene() {
    const scene = { version: 1, polygons: this.polygons.map(clonePolygon) };
    const blob = new Blob([JSON.stringify(scene, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');

    link.href = url;
    link.download = 'polygon-scene.json';
    link.click();
    URL.revokeObjectURL(url);
  }

  async importScene(file) {
    try {
      const scene = JSON.parse(await file.text());
      const polygons = Array.isArray(scene.polygons) ? scene.polygons : [];
      const imported = polygons
        .filter(isValidPolygon)
        .map((polygon, index) => ({
          ...clonePolygon(polygon),
          id: polygon.id || `imported-${Date.now()}-${index}`,
          name: polygon.name || `Полигон ${index + 1}`,
          createdAt: 0
        }));

      this.polygons = [];

      for (const polygon of imported) {
        const constrained = this.constrainPoints(polygon.points);

        if (!this.hasCollision(constrained)) {
          this.polygons.push({ ...polygon, points: constrained });
        }
      }

      this.selectedId = null;
      this.undoStack = [];
      this.redoStack = [];
      this.sequence = this.polygons.length + 1;
      this.syncUi();
      this.draw();
      this.showToast('Сцена импортирована');
    } catch (error) {
      this.showToast('Не удалось импортировать JSON');
    }
  }

  getPolygonAt(point) {
    for (let index = this.polygons.length - 1; index >= 0; index -= 1) {
      const polygon = this.polygons[index];

      if (pointInPolygon(point, polygon.points)) {
        return polygon;
      }
    }

    return null;
  }

  getSelectedPolygon() {
    return this.getPolygonById(this.selectedId);
  }

  getPolygonById(id) {
    return this.polygons.find((polygon) => polygon.id === id);
  }

  getCanvasPoint(event) {
    const rect = this.canvas.getBoundingClientRect();

    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top
    };
  }

  updateCursor(event) {
    if (this.dragState) {
      this.canvas.style.cursor = 'grab';
      return;
    }

    const point = this.getCanvasPoint(event);
    this.canvas.style.cursor = this.getPolygonAt(point) ? 'pointer' : 'default';
  }

  getCanvasSize() {
    return {
      width: this.canvas.clientWidth || 900,
      height: this.canvas.clientHeight || 520
    };
  }

  constrainPoints(points) {
    const { width, height } = this.getCanvasSize();
    const bounds = getBounds(points);
    let dx = 0;
    let dy = 0;

    if (bounds.minX < CANVAS_PADDING) {
      dx = CANVAS_PADDING - bounds.minX;
    }

    if (bounds.maxX + dx > width - CANVAS_PADDING) {
      dx = width - CANVAS_PADDING - bounds.maxX;
    }

    if (bounds.minY < CANVAS_PADDING) {
      dy = CANVAS_PADDING - bounds.minY;
    }

    if (bounds.maxY + dy > height - CANVAS_PADDING) {
      dy = height - CANVAS_PADDING - bounds.maxY;
    }

    return translatePoints(points, dx, dy);
  }

  keepPolygonsInsideCanvas() {
    for (const polygon of this.polygons) {
      polygon.points = this.constrainPoints(polygon.points);
    }
  }

  hasCollision(points, ignoredId = null) {
    for (const polygon of this.polygons) {
      if (polygon.id === ignoredId) {
        continue;
      }

      if (polygonsOverlap(points, polygon.points)) {
        return true;
      }
    }

    return false;
  }

  showToast(message) {
    this.toast.show(message);
  }
}

function createRandomShape(vertexCount, radius) {
  const points = [];
  let angle = Math.random() * Math.PI * 2;

  for (let index = 0; index < vertexCount; index += 1) {
    angle += (Math.PI * 2) / vertexCount + randomFloat(-0.45, 0.45);
    const currentRadius = radius * randomFloat(0.48, 1);
    points.push({ x: Math.cos(angle) * currentRadius, y: Math.sin(angle) * currentRadius });
  }

  if (vertexCount >= 5 && Math.random() > 0.35) {
    const dentIndex = randomInteger(0, vertexCount - 1);
    points[dentIndex] = {
      x: points[dentIndex].x * randomFloat(0.28, 0.55),
      y: points[dentIndex].y * randomFloat(0.28, 0.55)
    };
  }

  return points;
}

function pointInPolygon(point, polygon) {
  let inside = false;

  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const xi = polygon[i].x;
    const yi = polygon[i].y;
    const xj = polygon[j].x;
    const yj = polygon[j].y;
    const intersects = yi > point.y !== yj > point.y && point.x < ((xj - xi) * (point.y - yi)) / (yj - yi) + xi;

    if (intersects) {
      inside = !inside;
    }
  }

  return inside;
}

function polygonsOverlap(first, second) {
  if (!boundsOverlap(getBounds(first), getBounds(second))) {
    return false;
  }

  for (let i = 0; i < first.length; i += 1) {
    for (let j = 0; j < second.length; j += 1) {
      if (segmentsIntersect(first[i], first[(i + 1) % first.length], second[j], second[(j + 1) % second.length])) {
        return true;
      }
    }
  }

  return pointInPolygon(first[0], second) || pointInPolygon(second[0], first);
}

function segmentsIntersect(a, b, c, d) {
  const directionA = orientation(a, b, c);
  const directionB = orientation(a, b, d);
  const directionC = orientation(c, d, a);
  const directionD = orientation(c, d, b);

  if (directionA !== directionB && directionC !== directionD) {
    return true;
  }

  return (
    (directionA === 0 && pointOnSegment(a, c, b)) ||
    (directionB === 0 && pointOnSegment(a, d, b)) ||
    (directionC === 0 && pointOnSegment(c, a, d)) ||
    (directionD === 0 && pointOnSegment(c, b, d))
  );
}

function orientation(a, b, c) {
  const value = (b.y - a.y) * (c.x - b.x) - (b.x - a.x) * (c.y - b.y);

  if (Math.abs(value) < 0.0001) {
    return 0;
  }

  return value > 0 ? 1 : 2;
}

function pointOnSegment(a, b, c) {
  return b.x <= Math.max(a.x, c.x) && b.x >= Math.min(a.x, c.x) && b.y <= Math.max(a.y, c.y) && b.y >= Math.min(a.y, c.y);
}

function boundsOverlap(first, second) {
  return first.minX <= second.maxX && first.maxX >= second.minX && first.minY <= second.maxY && first.maxY >= second.minY;
}

function getBounds(points) {
  const bounds = {
    minX: points[0].x,
    minY: points[0].y,
    maxX: points[0].x,
    maxY: points[0].y
  };

  for (const point of points) {
    bounds.minX = Math.min(bounds.minX, point.x);
    bounds.minY = Math.min(bounds.minY, point.y);
    bounds.maxX = Math.max(bounds.maxX, point.x);
    bounds.maxY = Math.max(bounds.maxY, point.y);
  }

  return bounds;
}

function getCenter(points) {
  const bounds = getBounds(points);

  return {
    x: (bounds.minX + bounds.maxX) / 2,
    y: (bounds.minY + bounds.maxY) / 2
  };
}

function translatePoints(points, dx, dy) {
  return points.map((point) => ({ x: point.x + dx, y: point.y + dy }));
}

function clonePoints(points) {
  return points.map((point) => ({ x: point.x, y: point.y }));
}

function clonePolygon(polygon) {
  return { ...polygon, points: clonePoints(polygon.points) };
}

function samePoints(first, second) {
  return first.length === second.length && first.every((point, index) => point.x === second[index].x && point.y === second[index].y);
}

function isValidPolygon(polygon) {
  return (
    polygon &&
    Array.isArray(polygon.points) &&
    polygon.points.length >= 3 &&
    polygon.points.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y))
  );
}

function randomInteger(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + Math.ceil(min);
}

function randomFloat(min, max) {
  return Math.random() * (max - min) + min;
}

function randomColor() {
  return COLORS[randomInteger(0, COLORS.length - 1)];
}

function getContrastColor(hex) {
  const red = parseInt(hex.slice(1, 3), 16);
  const green = parseInt(hex.slice(3, 5), 16);
  const blue = parseInt(hex.slice(5, 7), 16);
  const luminance = (0.299 * red + 0.587 * green + 0.114 * blue) / 255;

  return luminance > 0.55 ? '#172033' : '#f8fafc';
}

customElements.define('polygon-editor', PolygonEditor);
