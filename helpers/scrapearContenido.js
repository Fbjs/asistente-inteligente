// helpers/scrapearContenido.js
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const HEADLESS = process.env.SCRAPER_HEADLESS ?? 'new';
const NAV_TIMEOUT = parseInt(process.env.SCRAPER_NAV_TIMEOUT_MS || '30000', 10);
const WAIT_AFTER_NAV_MS = parseInt(process.env.SCRAPER_WAIT_AFTER_MS || '2500', 10);
const MAX_RETRIES = parseInt(process.env.SCRAPER_MAX_RETRIES || '2', 10);
const MAX_CONTENT_CHARS = parseInt(process.env.SCRAPER_MAX_CHARS || '6000', 10);
const DIAG = (process.env.SCRAPER_DIAG || '0') === '1';
const PROXY = process.env.SCRAPER_PROXY || '';

const DEFAULT_SKIP = [
  'linkedin.com','cl.linkedin.com','www.linkedin.com','accounts.google.com'
];
const SKIP_LIST = (process.env.SCRAPER_SKIP_DOMAINS || DEFAULT_SKIP.join(','))
  .split(',').map(s => s.trim()).filter(Boolean);
const BLOCK_DOMAINS = new Set(SKIP_LIST);

const ALLOW_SOCIAL = process.env.SCRAPER_ALLOW_SOCIAL === '1';

const USER_AGENT = process.env.SCRAPER_USER_AGENT || [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
  'AppleWebKit/537.36 (KHTML, like Gecko)',
  'Chrome/124.0.0.0 Safari/537.36'
].join(' ');

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

let puppeteerModule = null;
async function loadPuppeteer() {
  if (puppeteerModule) return puppeteerModule;
  const m = await import('puppeteer');
  puppeteerModule = m.default || m;
  return puppeteerModule;
}

let browserPromise = null;
async function getBrowser() {
  if (!browserPromise) {
    const puppeteer = await loadPuppeteer();
    const args = [
      '--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage',
      '--disable-infobars','--window-position=0,0','--ignore-certificate-errors'
    ];
    if (PROXY) args.push(`--proxy-server=${PROXY}`);
    browserPromise = puppeteer.launch({
      headless: HEADLESS,
      args,
      defaultViewport: { width: 1280, height: 800 }
    });
  }
  return browserPromise;
}

function isSocial(host) {
  host = host.toLowerCase();
  return (
    /(^|\.)facebook\.com$/.test(host) ||
    /(^|\.)m\.facebook\.com$/.test(host) ||
    /(^|\.)web\.facebook\.com$/.test(host) ||
    /(^|\.)instagram\.com$/.test(host) ||
    /(^|\.)x\.com$/.test(host) ||
    /(^|\.)twitter\.com$/.test(host) ||
    /(^|\.)youtube\.com$/.test(host) ||
    /(^|\.)youtu\.be$/.test(host)
  );
}

function shouldSkip(urlStr) {
  try {
    const u = new URL(urlStr);
    const host = u.hostname.replace(/^www\./, '').toLowerCase();
    if (isSocial(host) && ALLOW_SOCIAL) return false;
    return BLOCK_DOMAINS.has(host);
  } catch {
    return false;
  }
}

async function withRetries(fn, retries, backoffBase = 600) {
  let lastErr;
  for (let i = 0; i <= retries; i++) {
    try { return await fn(); }
    catch (e) { lastErr = e; await sleep(backoffBase * (i + 1)); }
  }
  throw lastErr;
}

function normalizeSocialUrl(url) {
  if (!url) return '';
  let u = url.trim();
  if (u.startsWith('//')) u = 'https:' + u;
  if (!/^https?:\/\//i.test(u) && !u.startsWith('mailto:') && !u.startsWith('tel:')) {
    if (/^@[\w._-]+$/.test(u)) return 'https://x.com/' + u.slice(1);
    u = 'https://' + u.replace(/^\/+/, '');
  }
  u = u.replace(/#.*$/, '');
  u = u.replace(/twitter\.com/i, 'x.com');
  return u.replace(/\/+$/, '');
}

function filtrarLinksSociales(hrefs) {
  const socialPatterns = [
    /facebook\.com/i,
    /instagram\.com/i,
    /x\.com/i,
    /twitter\.com/i,
    /linkedin\.com/i,
    /youtube\.com/i,
    /youtu\.be/i,
    /tiktok\.com/i
  ];
  return hrefs.filter(href => socialPatterns.some(re => re.test(href)));
}

async function autoScrollToBottom(page, step = 600, pause = 250) {
  try {
    await page.evaluate(async (s, p) => {
      await new Promise(resolve => {
        let y = 0;
        const h = document.body.scrollHeight;
        (function scroll() {
          y += s;
          window.scrollTo(0, y);
          if (y < h) setTimeout(scroll, p);
          else resolve();
        })();
      });
    }, step, pause);
  } catch {}
}

async function autoConsent(page) {
  try {
    await page.evaluate(() => {
      const tryClick = (selector) => { const el = document.querySelector(selector); if (el) el.click(); };
      ['#onetrust-accept-btn-handler','#onetrust-reject-all-handler',
       'button[aria-label="Accept all"]','button[aria-label="Aceptar todo"]',
       '.fc-cta-consent','button[mode="primary"]'
      ].forEach(tryClick);
      const btns = Array.from(document.querySelectorAll('button, [role="button"]'));
      const re = /(aceptar|aceptar todo|accept all|agree|consent)/i;
      const target = btns.find(b => re.test((b.innerText || '').trim()));
      if (target) target.click();
    });
    await sleep(400);
  } catch {}
}

async function scrapearContenido(url) {
  if (!url) return null;
  if (shouldSkip(url)) return null;

  const browser = await getBrowser();
  const page = await browser.newPage();

  try {
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      const rtype = req.resourceType();
      if (rtype === 'image' || rtype === 'media' || rtype === 'font') return req.abort();
      return req.continue();
    });

    await page.setUserAgent(USER_AGENT);
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'es-CL,es;q=0.9,en;q=0.8' });
    page.setDefaultNavigationTimeout(NAV_TIMEOUT);

    const doVisit = async () => {
      const resp = await page.goto(url, { waitUntil: ['domcontentloaded','networkidle2'] });
      if (!resp) throw new Error('Sin respuesta del servidor');

      const status = resp.status();
      const finalURL = page.url();
      const ctype = (resp.headers()['content-type'] || '').toLowerCase();

      if (status >= 400) throw new Error(`HTTP ${status}`);
      if (ctype.includes('application/pdf')) throw new Error('PDF detectado');
      if (!ctype.includes('text/html') && !ctype.includes('application/xhtml+xml') && !finalURL.startsWith('http')) {
        throw new Error(`No-HTML: ${ctype || '(desconocido)'}`);
      }

      const hrefsRaw = await page.evaluate(() => {
        const toAbs = (h) => { try { return new URL(h, location.href).href; } catch { return null; } };
        return Array.from(document.querySelectorAll('a[href]'))
          .map(a => a.getAttribute('href'))
          .filter(Boolean)
          .map(toAbs)
          .filter(h => h && /^https?:\/\//i.test(h));
      });

      await autoConsent(page);
      await autoScrollToBottom(page);
      await page.waitForNetworkIdle({ idleTime: 500, timeout: 5000 }).catch(() => {});
      await sleep(WAIT_AFTER_NAV_MS);

      const isBlocked = await page.evaluate(() => {
        const bodyText = (document.body?.innerText || '').toLowerCase();
        return bodyText.includes('captcha') ||
               bodyText.includes('unusual traffic') ||
               (bodyText.includes('cloudflare') && bodyText.includes('verification'));
      });
      if (isBlocked) throw new Error('Contenido bloqueado/captcha');

      const contenido = await page.evaluate((limit) => {
        const text = (document.body?.innerText || '').replace(/\s+/g, ' ').trim();
        return text.slice(0, limit);
      }, MAX_CONTENT_CHARS);

      const uniq = arr => Array.from(new Set(arr));

      const hrefs = uniq(hrefsRaw).map(h => normalizeSocialUrl(h) || h);
      const socialLinks = filtrarLinksSociales(hrefs);

      if ((!contenido || contenido.length < 50) && socialLinks.length === 0) {
        throw new Error('Contenido vacío o muy corto y sin redes sociales');
      }

      const contacts = await page.evaluate(() => {
        const uniq = arr => Array.from(new Set(arr));
        const links = Array.from(document.querySelectorAll('a[href^="mailto:"], a[href^="tel:"]'));
        const mailFromLinks = links
          .filter(a => a.getAttribute('href').toLowerCase().startsWith('mailto:'))
          .map(a => a.getAttribute('href').replace(/^mailto:/i, '').trim());
        const telFromLinks = links
          .filter(a => a.getAttribute('href').toLowerCase().startsWith('tel:'))
          .map(a => a.getAttribute('href').replace(/^tel:/i, '').trim());
        const text = (document.body?.innerText || '').replace(/\s+/g, ' ');
        const emailRegex = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;
        const phoneRegex = /(?:(?:\+?56)\s*)?(?:0\s*)?(?:9\s*)?\d{4}\s*\d{4}/g;
        const mailFromText = text.match(emailRegex) || [];
        const telFromText = text.match(phoneRegex) || [];
        const normPhone = s => s.replace(/[^\d+]/g, '').replace(/^(\+?56)?0?/, '+56').replace(/^\+569?/, '+569');
        const emails = uniq([...mailFromLinks, ...mailFromText].map(e => (e || '').toLowerCase()));
        const phones = uniq([...telFromLinks, ...telFromText].map(normPhone));
        return { emails, phones };
      });

      const socialHints = await page.evaluate(() => {
        const uniq = arr => Array.from(new Set(arr));
        const sameAs = [];
        const relLinks = [];
        const metaHandles = [];

        const scripts = Array.from(document.querySelectorAll('script[type="application/ld+json"]'));
        for (const s of scripts) {
          try {
            const data = JSON.parse(s.textContent || 'null');
            const objects = Array.isArray(data) ? data : [data];
            for (const obj of objects) {
              if (obj && obj.sameAs) {
                const list = Array.isArray(obj.sameAs) ? obj.sameAs : [obj.sameAs];
                list.forEach(v => sameAs.push(String(v)));
              }
            }
          } catch {}
        }

        document.querySelectorAll('link[rel]').forEach(l => {
          const rel = (l.getAttribute('rel') || '').toLowerCase();
          if (/me|author|publisher/.test(rel)) {
            const href = l.getAttribute('href');
            if (href) relLinks.push(href);
          }
        });

        const metas = ['twitter:site','twitter:creator','og:site_name','og:url','og:see_also'];
        metas.forEach(name => {
          const el = document.querySelector(`meta[name="${name}"], meta[property="${name}"]`);
          const val = el?.getAttribute('content')?.trim();
          if (val) metaHandles.push(val);
        });

        const bodyText = (document.body?.innerText || '').replace(/\s+/g, ' ');
        const handles = bodyText.match(/@\w[\w._-]{2,}/g) || [];
        metaHandles.push(...handles);

        return { sameAs: uniq(sameAs), relLinks: uniq(relLinks), metaHandles: uniq(metaHandles) };
      });

      const hrefsFinal = uniq(hrefsRaw).map(h => normalizeSocialUrl(h) || h);
      const socialLinksFinal = filtrarLinksSociales(hrefsFinal);

      const header = [
        '[[CONTACTOS_DETECTADOS]]',
        `emails: ${contacts.emails.length ? contacts.emails.join(', ') : '-'}`,
        `phones: ${contacts.phones.length ? contacts.phones.join(', ') : '-'}`,
        '[[/CONTACTOS_DETECTADOS]]',
        '[[LINKS]]',
        ...hrefsFinal,
        '[[/LINKS]]',
        '[[SOCIAL_LINKS]]',
        ...socialLinksFinal,
        '[[/SOCIAL_LINKS]]',
        '[[SOCIAL_HINTS]]',
        `sameAs: ${socialHints.sameAs.join(' | ')}`,
        `relLinks: ${socialHints.relLinks.join(' | ')}`,
        `metaHandles: ${socialHints.metaHandles.join(' | ')}`,
        '[[/SOCIAL_HINTS]]',
        ''
      ].join('\n');

      const contenidoConContactos = `${header}${contenido}`;

      const redes = {
        facebook: '',
        instagram: '',
        x: '',
        linkedin: '',
        youtube: '',
        tiktok: ''
      };
      for (const link of socialLinksFinal) {
        if (/facebook\.com/i.test(link)) redes.facebook = link;
        else if (/instagram\.com/i.test(link)) redes.instagram = link;
        else if (/x\.com|twitter\.com/i.test(link)) redes.x = link;
        else if (/linkedin\.com/i.test(link)) redes.linkedin = link;
        else if (/youtube\.com|youtu\.be/i.test(link)) redes.youtube = link;
        else if (/tiktok\.com/i.test(link)) redes.tiktok = link;
      }

      return {
        contenido: contenidoConContactos,
        emails: contacts.emails,
        phones: contacts.phones,
        socialLinks: socialLinksFinal,
        redes
      };

      if (DIAG) {
        const ts = Date.now();
        const outDir = path.resolve(__dirname, '../diagnosticos');
        if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
        const fname = `scraped_${ts}`;
        await fs.promises.writeFile(path.join(outDir, `${fname}.html`), await page.content());
        await page.screenshot({ path: path.join(outDir, `${fname}.png`), fullPage: true });
      }
    };

    return await withRetries(doVisit, MAX_RETRIES);

  } catch (error) {
    console.error(`❌ Error en scrapearContenido para URL: ${url}`);
    console.error(`🧨 Mensaje de error: ${error?.message || error}`);
    return null;
  } finally {
    try { await page.close({ runBeforeUnload: false }); } catch {}
  }
}

module.exports = scrapearContenido;
