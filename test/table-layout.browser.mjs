import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

// Offline integration test. Uses synthetic content and the installed app's CSS;
// never opens an app profile, debugging port, chat, account or external page.
const { values } = parseArgs({ options: {
  'playwright-module': { type: 'string' }, 'browser-exe': { type: 'string' },
  'app-asar': { type: 'string' }, 'evidence-root': { type: 'string' },
  'css-module': { type: 'string' }, 'report-only': { type: 'boolean', default: false },
} });
for (const name of ['playwright-module', 'browser-exe', 'app-asar', 'evidence-root']) {
  assert.ok(values[name], 'Missing --' + name);
}
const evidenceRoot = path.resolve(values['evidence-root']);
assert.ok(!/BaiduSyncdisk|OneDrive/i.test(evidenceRoot), 'Evidence must stay outside sync');
await fs.mkdir(evidenceRoot, { recursive: true });
const require = createRequire(import.meta.url);
const { chromium } = require(path.resolve(values['playwright-module']));
const { WIDTH_CSS } = await import(values['css-module'] ?
  pathToFileURL(path.resolve(values['css-module'])).href : new URL('../width-style.mjs', import.meta.url).href);

async function installedStyles(archive) {
  const handle = await fs.open(archive, 'r');
  try {
    const lead = Buffer.alloc(16); await handle.read(lead, 0, 16, 0);
    const size = lead.readUInt32LE(12), dataStart = 8 + lead.readUInt32LE(4);
    assert.ok(size > 0 && size < 16 * 1024 * 1024, 'Invalid ASAR header');
    const bytes = Buffer.alloc(size); await handle.read(bytes, 0, size, 16);
    const tree = JSON.parse(bytes.toString('utf8'));
    const assets = tree.files.webview.files.assets.files;
    const names = Object.keys(assets).filter(name => /^(app-(initial|shared)|src)-.*\.css$/.test(name));
    // Match the app's cascade order: shared declares theme/base/components/
    // utilities before feature CSS. ASAR's alphabetical order is different.
    names.sort((a, b) => Number(!a.startsWith('app-shared-')) - Number(!b.startsWith('app-shared-')) || a.localeCompare(b));
    assert.ok(names.length >= 2, 'Installed CSS structure changed');
    const styles = [];
    for (const name of names) {
      const entry = assets[name];
      assert.ok(!entry.unpacked && entry.size < 8 * 1024 * 1024, 'Unsupported CSS asset');
      const content = Buffer.alloc(entry.size);
      await handle.read(content, 0, content.length, dataStart + Number(entry.offset));
      styles.push(content.toString('utf8'));
    }
    return { css: styles.join('\n'), names };
  } finally { await handle.close(); }
}
const native = await installedStyles(values['app-asar']);
const className = name => {
  const found = native.css.match(new RegExp('_' + name + '_[a-zA-Z0-9]+_[0-9]+'));
  assert.ok(found, 'Installed table markup changed: ' + name);
  return found[0];
};
const classes = Object.fromEntries(['MarkdownRoot', 'TableContainer', 'TableScroller', 'TableWrapper', 'Table'].map(name => [name, className(name)]));
const design = { frame: className('TableFrame'), viewport: className('TableViewport'), box: className('Box') };
design.table = design.frame.replace('_TableFrame_', '_Table_');

function fixture(sidebarWidth, columns, wide, structure) {
  const cells = row => Array.from({ length: columns }, (_, i) =>
    '<' + (row === 0 ? 'th' : 'td') + ' data-col-size="' + (i === 0 ? 'sm' : 'lg') + '">' +
    '<span data-marker="' + row + '-' + i + '">' + (i === 0 ? '首列完整' : wide ?
      'Column_' + i + '_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789' : '第' + i + '列 可换行测试内容') + '</span></' + (row === 0 ? 'th' : 'td') + '>'
  ).join('');
  const table = '<table data-d-column-sizing="auto" class="' + (structure === 'markdown' ? classes.Table : design.table) + '"><thead><tr>' + cells(0) + '</tr></thead><tbody><tr>' + cells(1) + '</tr></tbody></table>';
  const tableMarkup = structure === 'markdown' ?
    '<div id="table-root" data-markdown-table="true" data-wide-block class="' + classes.TableContainer + '"><div id="table-scroller" data-horizontal-scroll="true" class="' + classes.TableScroller + '"><div class="' + classes.TableWrapper + '">' + table + '</div></div></div>' :
    structure === 'design' ?
      '<div id="table-root" data-d-component="table" data-d-column-sizing="auto" class="' + design.frame + '"><div id="table-scroller" class="' + design.viewport + '">' + table + '</div></div>' :
      '<div id="table-root" data-d-scrollable="true" class="' + design.box + '"><div data-d-component="table" data-d-column-sizing="auto" class="' + design.frame + '"><div id="table-scroller" class="' + design.viewport + '">' + table + '</div></div></div>';
  return '<!doctype html><html data-codex-window-type="electron"><head><style>@layer properties,theme,base,components,utilities;' + native.css + '</style><style>' +
    ':root{--thread-content-max-width:48rem;--composer-adjacent-max-width:48rem;--thread-content-margin:24px;--thread-wide-block-inline-shift:0px;--padding-toolbar:0px;--markdown-space:4px;--markdown-small-font-size:14px;--markdown-line-height:1.5;--font-content:Arial,sans-serif;--spacing:4px;color-scheme:dark}' +
    'body{margin:0;font-size:16px;background:#181818;color:#fff}#sidebar{position:fixed;inset:0 auto 0 0;width:' + sidebarWidth + 'px;height:100vh;background:#242424}' +
    'main{margin-left:' + sidebarWidth + 'px;padding:32px 24px;min-width:0}#thread{container-type:inline-size;width:100%;min-width:0}#content{width:100%;max-width:var(--thread-content-max-width);margin-inline:auto;min-width:0}' +
    '#composer{width:100%;max-width:var(--composer-adjacent-max-width);margin:30px auto;min-height:40px}th,td{padding:10px;text-align:left;border-bottom:1px solid #444}' +
    (wide ? '#content th,#content td{white-space:nowrap}' : '') +
    '</style></head><body><aside id="sidebar">Synthetic sidebar</aside><main><div id="thread"><article id="content"><p>Offline table layout fixture</p><div class="' + classes.MarkdownRoot + '">' +
    tableMarkup + '</div></article><div id="composer">Synthetic composer</div></div></main></body></html>';
}
const browser = await chromium.launch({
  executablePath: path.resolve(values['browser-exe']), headless: true,
  ignoreDefaultArgs: ['--hide-scrollbars'],
  args: ['--no-first-run', '--disable-background-networking', '--disable-sync'],
});
const reports = [];
try {
  for (const setting of [
    { width: 1024, sidebar: 300, scale: 1 }, { width: 1536, sidebar: 300, scale: 1.5 },
    { width: 1920, sidebar: 300, scale: 2 },
  ]) {
    const context = await browser.newContext({ viewport: { width: setting.width, height: 960 },
      deviceScaleFactor: setting.scale, colorScheme: 'dark' });
    await context.route('**/*', route => route.abort());
    const page = await context.newPage();
    for (const structure of ['markdown', 'design', 'design-scrollable']) for (const wide of [false, true]) {
      await page.setContent(fixture(setting.sidebar, wide ? 12 : 3, wide, structure));
      await page.addStyleTag({ content: WIDTH_CSS });
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const start = await page.evaluate(() => {
        const box = e => { const r = e.getBoundingClientRect(); return { left: r.left, right: r.right, width: r.width }; };
        const container = document.querySelector('#table-root');
        const candidate = document.querySelector('#table-scroller');
        const scroll = getComputedStyle(candidate).overflowX === 'visible' ? container : candidate;
        scroll.scrollLeft = 0;
        return { content: box(document.querySelector('#content')), container: box(container), scroller: box(scroll),
          first: box(container.querySelector('[data-marker="0-0"]')), scrollWidth: scroll.scrollWidth,
          clientWidth: scroll.clientWidth, scrollLeft: scroll.scrollLeft, overflowX: getComputedStyle(scroll).overflowX,
          scrollbarWidth: getComputedStyle(scroll).scrollbarWidth,
          threadVariable: getComputedStyle(document.body).getPropertyValue('--thread-content-max-width').trim(),
          composerVariable: getComputedStyle(document.body).getPropertyValue('--composer-adjacent-max-width').trim(),
          sidebarWidth: document.querySelector('#sidebar').getBoundingClientRect().width,
          font: getComputedStyle(document.body).fontSize,
          containerDisplay: getComputedStyle(container).display,
          marginInlineStart: getComputedStyle(container).marginInlineStart,
          paddingInlineStart: getComputedStyle(scroll).paddingInlineStart,
          threadGutter: getComputedStyle(container).getPropertyValue('--table-thread-gutter') };
      });
      const end = await page.evaluate(() => {
        const container = document.querySelector('#table-root');
        const candidate = document.querySelector('#table-scroller');
        const scroll = getComputedStyle(candidate).overflowX === 'visible' ? container : candidate;
        scroll.scrollLeft = scroll.scrollWidth;
        const last = container.querySelector('thead tr').lastElementChild.querySelector('span').getBoundingClientRect();
        const viewport = scroll.getBoundingClientRect();
        return { scrollLeft: scroll.scrollLeft, lastRight: last.right, lastLeft: last.left, viewportRight: viewport.right, viewportLeft: viewport.left };
      });
      const checks = {
        bodyAndComposer90: start.threadVariable === '90%' && start.composerVariable === '90%',
        unchangedFontAndSidebar: start.font === '16px' && Math.abs(start.sidebarWidth - setting.sidebar) <= 1,
        containerWithinContent: start.container.left >= start.content.left - 1 && start.container.right <= start.content.right + 1,
        scrollportWithinContent: start.scroller.left >= start.content.left - 1 && start.scroller.right <= start.content.right + 1,
        firstColumnReachable: Math.abs(start.scrollLeft) <= 1 && start.first.left >= Math.max(start.scroller.left, setting.sidebar) - 1 && start.first.right <= start.scroller.right + 1,
        lastColumnReachable: end.lastRight <= end.viewportRight + 1 && end.lastRight > end.viewportLeft,
        overflowPermitted: ['auto', 'scroll'].includes(start.overflowX) && start.scrollbarWidth !== 'none',
        wideTableActuallyScrolls: !wide || (start.scrollWidth > start.clientWidth + 1 && end.scrollLeft > 1),
      };
      const name = structure + '-' + setting.width + '-dpr' + setting.scale + (wide ? '-wide' : '-normal');
      await page.evaluate(() => { document.querySelector('#table-scroller').scrollLeft = 0; document.querySelector('#table-root').scrollLeft = 0; });
      await page.screenshot({ path: path.join(evidenceRoot, name + '.png') });
      reports.push({ name, checks, start, end });
    }
    await context.close();
  }
} finally { await browser.close(); }
const failed = reports.flatMap(r => Object.entries(r.checks).filter(([,ok]) => !ok).map(([name]) => r.name + ':' + name));
await fs.writeFile(path.join(evidenceRoot, 'result.json'), JSON.stringify({ nativeAssets: native.names,
  browserVersion: browser.version(), cases: reports, passedChecks: reports.length * 8 - failed.length,
  totalChecks: reports.length * 8, failed }, null, 2));
console.log(JSON.stringify({ cases: reports.length, checks: reports.length * 8, failed, evidenceRoot }));
if (!values['report-only']) assert.deepEqual(failed, [], 'Table layout regression');
