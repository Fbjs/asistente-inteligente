try {
  require('dotenv').config();
  const fs = require('fs');
  const XLSX = require('xlsx');

  const generarVariantes = require('./helpers/generarVariantesBusqueda');
  const buscarEnSerper = require('./helpers/buscarEnSerper');
  const priorizarResultados = require('./helpers/priorizarResultados');
  const scrapearContenido = require('./helpers/scrapearContenido');
  const interpretarConGPT = require('./helpers/interpretarConGPT');
  const { getTotalTokens } = require('./helpers/interpretarConGPT');
  const { getTotalConsultas } = require('./helpers/buscarEnSerper');
  const stringSimilarity = require('string-similarity');
  const geocodeDireccion = require('./helpers/geocodeDireccion');

  const criterios = require('./criterios.json');

  // --- utilidades ---
  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Cache de geocoding en memoria para no repetir consultas
  const geoCache = new Map();

  // Normaliza nombres para comparar con dominios
  function limpiarNombreEmpresa(s) {
    return (s || '')
      .toLowerCase()
      .replace(/\b(s\.?a\.?|sa|ltda|s\.?p\.?a\.?|spa|corp|inc|empresa|compa[nñ]ia)\b/g, '')
      .replace(/[^a-z0-9]/g, '')
      .trim();
  }

  function similitudNombreVsDominio(nombre, dominio) {
    const n = limpiarNombreEmpresa(nombre);
    const d = limpiarNombreEmpresa(
      (dominio || '')
        .replace(/^https?:\/\//, '')
        .replace(/www\./, '')
        .split(/[\/?#]/)[0]
    );
    if (!n || !d) return 0;
    return stringSimilarity.compareTwoStrings(n, d);
  }

  // --- normalización y comparación de direcciones ---
  function normalizarDireccion(texto) {
    return texto?.toLowerCase()
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .replace(/\b(av|avda|avenida)\b\.?/g, ' ')
      .replace(/\s+/g, ' ')
      .replace(/[^\w\s]/g, '')
      .trim() || '';
  }

  function extraerDireccionBase(texto) {
    if (!texto) return '';
    const sinComplementos = texto.replace(/\s+\d{1,5}(?:\s.*)?$/, match => {
      const soloNumero = match.match(/\d+/);
      return soloNumero ? ' ' + soloNumero[0] : '';
    });
    return normalizarDireccion(sinComplementos);
  }

  function compararDireccion(gpt, ref) {
    const dirGPT = extraerDireccionBase(gpt?.direccion);
    const comGPT = normalizarDireccion(gpt?.comuna);
    const regGPT = normalizarDireccion(gpt?.region);

    const dirRef = extraerDireccionBase(ref?.direccion);
    const comRef = normalizarDireccion(ref?.comuna);
    const regRef = normalizarDireccion(ref?.region);

    const comunaOK = (comGPT && comRef) ? comGPT === comRef : true;
    const regionOK = (regGPT && regRef) ? regGPT === regRef : true;

    if (
      dirGPT && dirRef &&
      (dirGPT.includes(dirRef) || dirRef.includes(dirGPT)) &&
      comunaOK && regionOK
    ) return 'Exacto';

    return 'Incorrecto';
  }

  // --------- helpers para detectar y scrapear sitio oficial ----------
  function ensureHttp(url) {
    if (!url) return '';
    const u = url.trim();
    if (u.startsWith('http://') || u.startsWith('https://')) return u;
    return 'https://' + u.replace(/^\/+/, '');
  }

  function domainRoot(u) {
    try {
      const { hostname, protocol } = new URL(ensureHttp(u));
      return `${protocol}//${hostname}`;
    } catch { return ''; }
  }

  function buildSiteCandidates(site) {
    const root = domainRoot(site);
    if (!root) return [];
    const paths = [
      '', '/', '/contacto', '/contact', '/about', '/acerca',
      '/contact-us', '/quienes-somos', '/nosotros', '/redes', '/social'
    ];
    return [...new Set(paths.map(p => root + p))];
  }

  // Detectar posibles sitios web desde texto scrapeado de terceros
  function extractWebsitesFromText(text) {
    if (!text) return [];
    const urls = [];
    const re1 = /\bhttps?:\/\/[^\s<>"]+/gi;
    const m1 = text.match(re1) || [];
    urls.push(...m1);
    const re2 = /\b[a-z0-9-]+(\.[a-z0-9-]+)+\b/gi;
    const m2 = (text.match(re2) || []).filter(d => d.includes('.cl') || d.includes('.com') || d.includes('.org'));
    urls.push(...m2.map(ensureHttp));
    return [...new Set(urls)];
  }

  function extractContactsFromString(s) {
    if (!s) return { emails: [], phones: [] };
    const blockMatch = s.match(/\[\[CONTACTOS_DETECTADOS\]\][\s\S]*?\[\[\/CONTACTOS_DETECTADOS\]\]/i);
    let emails = [], phones = [];
    if (blockMatch) {
      const block = blockMatch[0];
      const eLine = block.match(/emails:\s*(.*)/i);
      const pLine = block.match(/phones:\s*(.*)/i);
      if (eLine && eLine[1]) emails = eLine[1].split(',').map(x => x.trim()).filter(x => x && x !== '-');
      if (pLine && pLine[1]) phones = pLine[1].split(',').map(x => x.trim()).filter(x => x && x !== '-');
    }
    const emailRegex = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;
    const phoneRegex = /(?:(?:\+?56)\s*)?(?:0\s*)?(?:9\s*)?\d{4}\s*\d{4}/g;
    const extraE = s.match(emailRegex) || [];
    const extraP = (s.match(phoneRegex) || []).map(x =>
      x.replace(/[^\d+]/g, '').replace(/^(\+?56)?0?/, '+56').replace(/^\+569?/, '+569')
    );
    const uniq = arr => Array.from(new Set(arr));
    return {
      emails: uniq([...emails, ...extraE.map(e => e.toLowerCase())]),
      phones: uniq([...phones, ...extraP])
    };
  }

  // --------- extracción de redes desde [[LINKS]] y [[SOCIAL_HINTS]] ----------
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

  function extractSocialsFromScrapedString(s) {
    const result = { facebook: '', instagram: '', x: '', linkedin: '' };
    if (!s) return result;

    // 1) LINKS block
    const linksBlock = s.match(/\[\[LINKS\]\]([\s\S]*?)\[\[\/LINKS\]\]/i);
    let candidates = [];
    if (linksBlock) {
      candidates = linksBlock[1]
        .split(/\r?\n/)
        .map(l => l.trim())
        .filter(Boolean);
    }

    // 2) SOCIAL_HINTS block
    const hintsBlock = s.match(/\[\[SOCIAL_HINTS\]\]([\s\S]*?)\[\[\/SOCIAL_HINTS\]\]/i);
    if (hintsBlock) {
      const extractLine = (label) => {
        const re = new RegExp(`^${label}:\\s*(.*)$`, 'im');
        const m = hintsBlock[1].match(re);
        return m && m[1] ? m[1].split('|').map(x => x.trim()).filter(Boolean) : [];
        };
      const sameAs = extractLine('sameAs');
      const relLinks = extractLine('relLinks');
      const metaHandles = extractLine('metaHandles');
      candidates.push(...sameAs, ...relLinks, ...metaHandles);
    }

    // 3) Fallback: URLs en el cuerpo si aún vacío
    if (candidates.length === 0) {
      const urlRegex = /\bhttps?:\/\/[^\s<>"')]+/gi;
      candidates = s.match(urlRegex) || [];
    }

    const dedupe = arr => Array.from(new Set(arr.map(normalizeSocialUrl)));

    const facebook = dedupe(candidates.filter(u => /(^https?:\/\/)?(www\.)?facebook\.com\//i.test(u)));
    const instagram = dedupe(candidates.filter(u => /(^https?:\/\/)?(www\.)?instagram\.com\//i.test(u)));
    const x = dedupe(candidates.filter(u =>
      /(^https?:\/\/)?(www\.)?(x\.com|twitter\.com)\//i.test(u) || /^https?:\/\/x\.com\/[\w._-]+$/i.test(u)
    ));
    const linkedin = dedupe(candidates.filter(u => /(^https?:\/\/)?(www\.)?linkedin\.com\//i.test(u)));

    const pick = arr => (arr && arr.length ? arr.sort((a,b)=>a.length-b.length)[0] : '');

    return {
      facebook: pick(facebook),
      instagram: pick(instagram),
      x: pick(x),
      linkedin: pick(linkedin)
    };
  }
  // -------------------------------------------------------------------------

  // --- geocoding con fallback + cache ---
  async function geocodeConFallback(dir, comuna, region) {
    const key = `${dir || ''}|${comuna || ''}|${region || ''}`.toLowerCase().trim();
    if (geoCache.has(key)) return geoCache.get(key);

    const intento = async (d, c, r) => {
      try {
        const res = await geocodeDireccion(d, c, r);
        const lat = res?.lat ?? res?.latitude ?? null;
        const lng = res?.lng ?? res?.longitude ?? null;
        return { lat, lng };
      } catch {
        return { lat: null, lng: null };
      }
    };

    let res = await intento(dir, comuna, region);
    if (!res?.lat || !res?.lng) {
      await sleep(1800);
      res = await intento('', comuna, region);
    }
    if (!res?.lat || !res?.lng) {
      await sleep(1800);
      res = await intento('', '', region);
    }

    geoCache.set(key, res || { lat: null, lng: null });
    return res || { lat: null, lng: null };
  }

  async function procesarEmpresas() {
    // PRUEBA OBLIGATORIA: neighbour.cl
    /*
    try {
      const htmlTest = await scrapearContenido('https://neighbour.cl');
      console.log('🟢 Resultado de scrapearContenido:', htmlTest); // <-- AGREGA ESTA LÍNEA

      if (
        !htmlTest ||
        (
          (!htmlTest.contenido || htmlTest.contenido.length < 50) &&
          (!htmlTest.socialLinks || htmlTest.socialLinks.length === 0)
        )
      ) {
        console.error('❌ No se pudo obtener contenido útil desde https://neighbour.cl (respuesta vacía o muy corta y sin redes sociales). Abortando proceso.');
        process.exit(1);
      }
      console.log('neighbour.cl OK:', (htmlTest.contenido || '').slice(0, 100));
    } catch (e) {
      console.error('❌ Falló el scraping de https://neighbour.cl. Abortando proceso.');
      console.error('🧨 Detalle:', e?.message || e);
      process.exit(1);
    }
    */

    console.log('🧠 INIT...');

    let empresas = [];
    try {
      const wb = XLSX.readFile('empresas.xlsx');
      const sheet = wb.Sheets[wb.SheetNames[0]];
      empresas = XLSX.utils.sheet_to_json(sheet);
    } catch (e) {
      console.error('❌ Error al leer empresas.xlsx:', e?.message || e);
      process.exit(1);
    }

    if (!empresas || empresas.length === 0) {
      console.error('❌ No se encontraron empresas para procesar. Revisa empresas.xlsx y su formato.');
      process.exit(1);
    }

    // Leer archivo Excel de entrada
    //const wb = XLSX.readFile('empresas.xlsx');
    //const sheet = wb.Sheets[wb.SheetNames[0]];
    //const empresas = XLSX.utils.sheet_to_json(sheet);

    const resultados = [];

    console.log('🧠 Asistente iniciado...');
    console.log(`📄 Se encontraron ${empresas.length} empresas para procesar.`);

    for (const empresa of empresas) {
      try {
        const { nombre, rut } = empresa;
        let resultadosEmpresa = [];

        // Generar variantes y buscar URLs
        const variantes = [...new Set(generarVariantes(nombre, rut) || [])];
        let urls = [];
        for (const query of variantes) {
          const resultadosBusqueda = (await buscarEnSerper(query)) || [];
          urls.push(...resultadosBusqueda);
        }
        const urlsUnicas = [...new Set(priorizarResultados(urls, criterios) || [])];

        // Procesar cada URL priorizada
        for (const url of urlsUnicas.slice(0, 6)) {
          try {
            const contenido = await scrapearContenido(url);
            if (!contenido || (!contenido.contenido || contenido.contenido.length < 50)) continue;

            const interpretacion = await interpretarConGPT(nombre, rut, contenido.contenido) || {};

            // Validación de similitud
            if (
              interpretacion.nombre &&
              stringSimilarity.compareTwoStrings(
                limpiarNombreEmpresa(interpretacion.nombre),
                limpiarNombreEmpresa(nombre)
              ) < 0.85
            ) {
              interpretacion.error = 'Datos dudosos: posible mezcla de empresas';
            }

            resultadosEmpresa.push({
              empresa: nombre,
              rut,
              telefono: interpretacion.telefono || '',
              email: interpretacion.email || '',
              sitio_web: interpretacion.sitio_web || '',
              direccion: interpretacion.direccion || '',
              comuna: interpretacion.comuna || '',
              region: interpretacion.region || '',
              descripcion: interpretacion.descripcion || '',
              url_1: url,
              error: interpretacion.error || ''
            });
          } catch (e) {
            resultadosEmpresa.push({
              empresa: empresa?.nombre || '',
              rut: empresa?.rut || '',
              error: e?.message || String(e)
            });
          }
        }

        if (resultadosEmpresa.length === 0) {
          console.warn(`⚠️ No se obtuvo ningún resultado útil para la empresa: ${nombre} (${rut})`);
        }

        // Selecciona el resultado más completo (más campos llenos)
        const mejor = resultadosEmpresa.sort((a, b) => {
          const score = r =>
            [r.telefono, r.email, r.sitio_web, r.direccion, r.comuna, r.region, r.descripcion]
              .filter(x => x && x.length > 0).length;
          return score(b) - score(a);
        })[0];

        if (mejor) {
          resultados.push(mejor);
        } else {
          resultados.push({
            empresa: empresa?.nombre || '',
            rut: empresa?.rut || '',
            error: 'Sin resultados útiles'
          });
        }
      } catch (e) {
        resultados.push({
          empresa: empresa?.nombre || '',
          rut: empresa?.rut || '',
          error: e?.message || String(e)
        });
      }
    }

    // Guardar resultados en Excel con orden de columnas predefinido
    const cols = [
      'empresa','rut','telefono','email','sitio_web',
      'direccion','comuna','region','descripcion','url_1','error'
    ];

    const normalizados = resultados.map(r => {
      const base = {};
      cols.forEach(c => { base[c] = (r[c] !== undefined && r[c] !== null) ? r[c] : ''; });
      return base;
    });

    const ws = XLSX.utils.json_to_sheet(normalizados, { header: cols });
    XLSX.utils.sheet_add_aoa(ws, [cols], { origin: 'A1' });

    const wbFinal = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wbFinal, ws, 'Resultados');
    XLSX.writeFile(wbFinal, 'resultados.xlsx');

    if (!fs.existsSync('resultados.xlsx')) {
      console.error('❌ No se pudo guardar resultados.xlsx. Verifica permisos de escritura.');
    }

    console.log('\n🎉 Proceso finalizado. Resultados guardados en "resultados.xlsx"');
    console.log(`📊 Total de tokens usados en el proceso: ${getTotalTokens()}`);
    console.log(`📈 Total de consultas a serper.dev realizadas: ${getTotalConsultas()}`);

    const tokens = getTotalTokens() || 0;
    const costoUSD = (tokens * 0.01) / 1000;
    console.log(`💵 Costo estimado GPT (referencial): $${costoUSD.toFixed(4)} USD`);
  }

  procesarEmpresas();
} catch (e) {
  console.error('❌ Error cargando dependencias:', e?.message || e);
  process.exit(1);
}
