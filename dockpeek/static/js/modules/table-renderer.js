import * as CellRenderer from './cell-renderer.js';
import { renderStatus } from './status-renderer.js';
import { updateColumnVisibility, updateFirstAndLastVisibleColumns } from './column-visibility.js';
import { updateTableOrder } from './column-order.js';
import { registerUsageCells, requestPendingUsage, registerTotalsRow, clearTotalsRow } from './container-usage.js';


export class TableRenderer {
  constructor(templateId, bodyId) {
    this.template = document.getElementById(templateId);
    this.body = document.getElementById(bodyId);
  }

  render(containers) {
    clearTotalsRow();
    this.body.innerHTML = '';

    if (!containers.length) {
      this.body.innerHTML = `<tr><td colspan="11" class="text-center py-8 text-gray-500">No containers found matching your criteria.</td></tr>`;
      return;
    }

    const hasAnyTraefikRoutes = window.traefikEnabled !== false &&
      containers.some(c => c.traefik_routes?.length);

    const fragment = document.createDocumentFragment();

    for (const container of containers) {
      const row = this._renderRow(container, hasAnyTraefikRoutes);
      fragment.appendChild(row);
    }

    const totalsRow = this._createTotalsRow();
    fragment.appendChild(totalsRow);

    this.body.appendChild(fragment);
    registerTotalsRow(totalsRow, () => containers);
    updateTableOrder();
    updateColumnVisibility();
    updateFirstAndLastVisibleColumns();
    requestPendingUsage();
  }

  _renderRow(container, hasAnyTraefikRoutes) {
    const clone = this.template.content.cloneNode(true);

    const rowElement = clone.querySelector('tr');

    const nameCell = clone.querySelector('[data-content="name"]');
    nameCell.classList.add('table-cell-name');
    CellRenderer.renderName(container, nameCell);

    CellRenderer.renderServer(container, clone);

    const stackCell = clone.querySelector('[data-content="stack"]');
    stackCell.classList.add('table-cell-stack');
    CellRenderer.renderStack(container, stackCell);

    const imageCell = clone.querySelector('[data-content="image"]');
    imageCell.classList.add('table-cell-image');
    CellRenderer.renderImage(container, imageCell, clone);

    CellRenderer.renderUpdateIndicator(container, clone);

    const tagsCell = clone.querySelector('[data-content="tags"]');
    tagsCell.classList.add('table-cell-tags');
    CellRenderer.renderTags(container, tagsCell);

    const statusCell = clone.querySelector('[data-content="status"]');
    statusCell.classList.add('table-cell-status');
    const { span, className } = renderStatus(container);
    statusCell.className = `py-3 px-4 border-b border-gray-200 table-cell-status ${className}`;
    statusCell.appendChild(span);

    const logsCell = clone.querySelector('[data-content="logs"]');
    logsCell.classList.add('table-cell-logs');
    CellRenderer.renderLogs(container, logsCell);

    if (rowElement) {
      const ramCell = rowElement.querySelector('[data-content="ram"]');
      if (ramCell) {
        ramCell.classList.add('table-cell-ram');
      }

      const diskCell = rowElement.querySelector('[data-content="disk"]');
      if (diskCell) {
        diskCell.classList.add('table-cell-disk');
      }

      registerUsageCells(rowElement, container);
    }

    const portsCell = clone.querySelector('[data-content="ports"]');
    portsCell.classList.add('table-cell-ports');
    CellRenderer.renderPorts(container, portsCell);

    const traefikCell = clone.querySelector('[data-content="traefik-routes"]');
    traefikCell.classList.add('table-cell-traefik');
    CellRenderer.renderTraefik(container, traefikCell, hasAnyTraefikRoutes);

    return clone;
  }

  _createTotalsRow() {
    const row = document.createElement('tr');
    row.classList.add('table-total-row');
    row.setAttribute('data-row-type', 'total');

    const cells = [
      this._buildTotalsCell('name', {
        text: 'TOTAL',
        classes: ['px-4', 'table-total-label']
      }),
      this._buildTotalsCell('stack', { classes: ['px-4'] }),
      this._buildTotalsCell('server', { classes: ['px-4'], extraClasses: ['server-column'] }),
      this._buildTotalsCell('ports', { classes: ['px-4'] }),
      this._buildTotalsCell('traefik', { classes: ['px-4'], extraClasses: ['traefik-column', 'hidden'] }),
      this._buildTotalsCell('image', { classes: ['px-4'] }),
      this._buildTotalsCell('tags', { classes: ['px-4'] }),
      this._buildTotalsCell('ram', { classes: ['px-4', 'text-right'], dataset: { total: 'ram' } }),
      this._buildTotalsCell('disk', { classes: ['px-4', 'text-right'], dataset: { total: 'disk' } }),
      this._buildTotalsCell('status', { classes: ['px-4'] }),
      this._buildTotalsCell('logs', { classes: ['px-2'] })
    ];

    cells.forEach(cell => row.appendChild(cell));
    return row;
  }

  _buildTotalsCell(columnName, { text = '', classes = [], dataset = {}, extraClasses = [] } = {}) {
    const cell = document.createElement('td');
    cell.dataset.content = columnName;
    cell.classList.add('py-3', 'table-total-cell', `table-cell-${columnName}`);

    if (classes.length) {
      cell.classList.add(...classes);
    }

    if (extraClasses.length) {
      cell.classList.add(...extraClasses);
    }

    if (!classes.includes('px-2') && !classes.includes('px-4')) {
      cell.classList.add('px-4');
    }

    Object.entries(dataset).forEach(([key, value]) => {
      cell.dataset[key] = value;
    });

    if (text) {
      cell.textContent = text;
    }

    return cell;
  }
}
