const puppeteer = require('puppeteer');

async function scrapearContenido(url) {
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });

  // Limpiar elementos comunes innecesarios
  await page.evaluate(() => {
    const eliminar = ['header', 'nav', 'footer', 'form', 'script', 'style'];
    eliminar.forEach(selector => {
      document.querySelectorAll(selector).forEach(el => el.remove());
    });
  });

  // Extraer el texto visible
  const contenido = await page.evaluate(() => {
    return document.body.innerText
      .replace(/\s+/g, ' ')
      .trim()
      .substring(0, 3000); // Limitar a 3000 caracteres
  });

  await browser.close();
  return contenido;
}

module.exports = scrapearContenido;
