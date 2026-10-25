export const STYLE_ID = 'shc-windows-width-preview-v1';
export const OWNER = 'shc-width-preview';

// Width declarations follow Akrabut/codex-full-width (MIT), pinned in README.
// Intentionally contains no font, zoom, sidebar, header or account changes.
export const WIDTH_CSS = `
:root[data-codex-window-type="electron"] body {
  --thread-content-max-width: 90% !important;
  --composer-adjacent-max-width: 90% !important;
}
:root[data-codex-window-type="electron"] [data-markdown-table="true"] {
  /* The app also uses this variable for column sizes and wide-block math.
     Keep its native length here rather than reuse the outer percentage. */
  --thread-content-max-width: 48rem !important;
  width: 100% !important;
  max-width: 100% !important;
  min-width: 0 !important;
  margin-inline: 0 !important;
  transform: none !important;
}
:root[data-codex-window-type="electron"] [data-markdown-table="true"] > [data-horizontal-scroll] {
  /* Constrain the scrollport, not the intrinsic table or its wrapper. */
  display: block !important;
  width: 100% !important;
  max-width: 100% !important;
  min-width: 0 !important;
  overflow-x: auto !important;
  scrollbar-width: thin !important;
}
:root[data-codex-window-type="electron"] :is([data-d-component="table"], [class*="_TableFrame_"])[data-d-column-sizing="auto"] {
  /* ChatGPT's newer table uses negative gutters calculated from the thread
     variable. With 90% that percentage resolves against different boxes. */
  --table-thread-content-width: 100% !important;
  --table-thread-gutter: 0px !important;
  --table-inline-gutter-start: 0px !important;
  --table-inline-gutter-end: 0px !important;
  --table-inline-content-end: 0px !important;
  width: 100% !important;
  max-width: 100% !important;
  min-width: 0 !important;
  margin-inline: 0 !important;
}
:root[data-codex-window-type="electron"] :is([data-d-component="table"], [class*="_TableFrame_"])[data-d-column-sizing="auto"] > [class*="_TableViewport_"] {
  box-sizing: border-box !important;
  width: 100% !important;
  max-width: 100% !important;
  min-width: 0 !important;
  padding-inline: 0 !important;
  scroll-padding-inline: 0 !important;
  overflow-x: auto !important;
  scrollbar-width: thin !important;
}
:root[data-codex-window-type="electron"] [data-d-scrollable="true"]:has(> [data-d-component="table"][data-d-column-sizing="auto"]) {
  box-sizing: border-box !important;
  width: 100% !important;
  max-width: 100% !important;
  min-width: 0 !important;
  margin-inline: 0 !important;
  padding-inline: 0 !important;
  scroll-padding-inline: 0 !important;
  overflow-x: auto !important;
  scrollbar-width: thin !important;
}`;

// This function is serialized into the renderer. It returns geometry only,
// never conversation text, cookies, tokens, screenshots or account information.
export async function rendererOperation(action, styleId, owner, cssText) {
  if (document.documentElement.dataset.codexWindowType !== 'electron') throw new Error('UNEXPECTED_WINDOW');
  const existing = document.getElementById(styleId);
  if (existing && existing.dataset.owner !== owner) throw new Error('STYLE_ID_CONFLICT');
  const visible = element => element && element.getBoundingClientRect().width > 0;
  const rectangle = element => {
    if (!element) return null;
    const { x, y, width, height } = element.getBoundingClientRect();
    return { x, y, width, height };
  };
  const largest = elements => [...elements].filter(visible).sort((a, b) => {
    const ar = a.getBoundingClientRect(), br = b.getBoundingClientRect();
    return br.width * br.height - ar.width * ar.height;
  })[0];
  const composer = largest(document.querySelectorAll('[data-composer-input]'));
  const content = largest(document.querySelectorAll('[class*="--thread-body-max-width"]'));
  const sidebar = largest([...document.querySelectorAll('aside,nav,[data-app-shell-focus-area="sidebar"],[data-app-shell-left-panel]')].filter(element => {
    const r = element.getBoundingClientRect();
    return r.x < innerWidth * .2 && r.width > 100 && r.width < innerWidth * .4 && r.height > innerHeight * .4;
  }));
  const snapshot = () => {
    const bodyStyle = getComputedStyle(document.body);
    return {
      threadVariable: bodyStyle.getPropertyValue('--thread-content-max-width').trim(),
      composerVariable: bodyStyle.getPropertyValue('--composer-adjacent-max-width').trim(),
      bodyFont: bodyStyle.fontSize,
      composerFont: composer ? getComputedStyle(composer).fontSize : null,
      sidebarVariable: bodyStyle.getPropertyValue('--app-shell-left-panel-width').trim(),
      content: rectangle(content), composer: rectangle(composer), sidebar: rectangle(sidebar),
      tables: [...document.querySelectorAll('table')]
        .filter(visible).slice(0, 20).map(table => {
          const container = table.closest('[data-markdown-table="true"], [data-d-component="table"], [class*="_TableFrame_"], [class*="_TableContainer_"]') ?? table.parentElement;
          const scroller = table.closest('[data-horizontal-scroll], [class*="_TableViewport_"], [data-d-scrollable="true"]') ?? container;
          const ancestors = [];
          for (let element = table.parentElement; element && ancestors.length < 6; element = element.parentElement) {
            const style = getComputedStyle(element);
            ancestors.push({ tag: element.tagName, classes: String(element.className).slice(0, 300),
              box: rectangle(element), marginInlineStart: style.marginInlineStart,
              marginInlineEnd: style.marginInlineEnd, paddingInlineStart: style.paddingInlineStart,
              overflowX: style.overflowX, scrollLeft: element.scrollLeft,
              scrollWidth: element.scrollWidth, clientWidth: element.clientWidth });
          }
          return {
            container: rectangle(container), scroller: rectangle(scroller),
            table: rectangle(table), firstCell: rectangle(table.querySelector('th,td')), ancestors,
            scrollLeft: scroller?.scrollLeft ?? null,
            scrollWidth: scroller?.scrollWidth ?? null,
            clientWidth: scroller?.clientWidth ?? null,
            overflowX: scroller ? getComputedStyle(scroller).overflowX : null,
          };
        }),
    };
  };
  const before = snapshot();
  // Background windows may suspend animation frames. Computed styles still
  // resolve there, so bound the wait instead of blocking all window updates.
  const settleLayout = () => new Promise(resolve => {
    const timer = setTimeout(resolve, 120);
    requestAnimationFrame(() => requestAnimationFrame(() => { clearTimeout(timer); resolve(); }));
  });
  if (action === 'status') return { present: Boolean(existing), metrics: before };
  if (action === 'restore') {
    existing?.remove();
    await settleLayout();
    return { restored: !document.getElementById(styleId), metrics: snapshot() };
  }
  if (action !== 'apply') throw new Error('UNKNOWN_ACTION');
  if (existing) return { applied: true, alreadyApplied: true, before, after: before };
  const element = document.createElement('style');
  element.id = styleId;
  element.dataset.owner = owner;
  element.textContent = cssText;
  document.head.appendChild(element);
  try {
    await settleLayout();
    const after = snapshot();
    if (after.threadVariable !== '90%' || after.composerVariable !== '90%') throw new Error('WIDTH_RULE_NOT_APPLIED');
    if (before.bodyFont !== after.bodyFont || before.composerFont !== after.composerFont) throw new Error('FONT_CHANGED');
    if (before.sidebarVariable !== after.sidebarVariable) throw new Error('SIDEBAR_VARIABLE_CHANGED');
    if (before.sidebar && after.sidebar && Math.abs(before.sidebar.width - after.sidebar.width) > 1) throw new Error('SIDEBAR_WIDTH_CHANGED');
    return {
      applied: true, before, after,
      contentMeasured: Boolean(content), composerMeasured: Boolean(composer), sidebarMeasured: Boolean(sidebar),
      visualReviewRequired: true,
    };
  } catch (error) {
    element.remove();
    throw error;
  }
}

export function expressionFor(action) {
  if (!['apply', 'restore', 'status'].includes(action)) throw new Error('UNKNOWN_ACTION');
  return `(${rendererOperation.toString()})(${JSON.stringify(action)},${JSON.stringify(STYLE_ID)},${JSON.stringify(OWNER)},${JSON.stringify(WIDTH_CSS)})`;
}
