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

const criterios = require('./criterios.json');

async function procesarEmpresas() {
  // Leer archivo Excel de entrada
  const wb = XLSX.readFile('empresas.xlsx');
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const empresas = XLSX.utils.sheet_to_json(sheet);

  const resultados = [];

  console.log('🧠 Asistente iniciado...');
  console.log(`📄 Se encontraron ${empresas.length} empresas para procesar.`);

  for (const empresa of empresas) {
    const { nombre, rut } = empresa;
    console.log(`\n🔍 Procesando empresa: ${nombre} | RUT: ${rut}`);

    // Generar variantes de búsqueda
    const variantes = generarVariantes(nombre, rut);
    console.log(`📌 Variantes de búsqueda generadas:`);
    variantes.forEach(v => console.log(`   → ${v}`));

    let urls = [];

    // Hacer búsquedas con cada variante
    for (const query of variantes) {
      console.log(`\n🌐 Buscando en Google (serper.dev): "${query}"`);
      const resultadosBusqueda = await buscarEnSerper(query);
      console.log(`🔗 Resultados encontrados: ${resultadosBusqueda.length}`);
      urls.push(...resultadosBusqueda);
    }

    // Priorizar resultados según criterios aprendidos
    const urlsFiltradas = priorizarResultados(urls, criterios);
    const urlsUnicas = [...new Set(urlsFiltradas)];

    console.log(`\n🎯 URLs priorizadas (únicas):`);
    urlsUnicas.slice(0, 6).forEach((url, idx) => console.log(`   [${idx + 1}] ${url}`));

    // Scraping del contenido de las mejores URLs
    const contenidos = [];

    for (const url of urlsUnicas.slice(0, 6)) {
      console.log(`\n🕷️ Haciendo scraping en: ${url}`);
      try {
        const html = await scrapearContenido(url);
        console.log(`✅ Contenido extraído (${html.length} caracteres)`);
        contenidos.push({ url, html });
      } catch (error) {
        console.log(`⚠️ Error al scrapear ${url}`);
      }
    }

    // Interpretar con GPT
    console.log('\n🤖 Enviando contenido a GPT para interpretar...');
    const textoParaAnalizar = contenidos.map(c => `URL: ${c.url}\n${c.html}`).join('\n\n---\n\n');
    const interpretacion = await interpretarConGPT(nombre, rut, textoParaAnalizar);

    // Validar si no hay teléfono
    if (!interpretacion.telefono || interpretacion.telefono.trim() === '') {
      console.warn(`⚠️ No se encontró teléfono para ${nombre}`);
    }

    // Agregar al resultado final
    resultados.push({
      empresa: nombre,
      rut,
      ...interpretacion
    });

    console.log(`📥 Resultado para ${nombre}:`);
    console.log(interpretacion);
    console.log('--------------------------------------------');
  }

  // Guardar resultados en Excel
  const ws = XLSX.utils.json_to_sheet(resultados);
  const wbFinal = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wbFinal, ws, 'Resultados');
  XLSX.writeFile(wbFinal, 'resultados.xlsx');

  // Mostrar resumen de consumo
  console.log('\n🎉 Proceso finalizado. Resultados guardados en "resultados.xlsx"');
  console.log(`📊 Total de tokens usados en el proceso: ${getTotalTokens()}`);
  console.log(`📈 Total de consultas a serper.dev realizadas: ${getTotalConsultas()}`);

  const tokens = getTotalTokens();
  const costoUSD = (tokens * 0.01) / 1000; // Asumiendo GPT-4 solo prompt
  console.log(`💵 Costo estimado GPT-4 (solo entrada): $${costoUSD.toFixed(4)} USD`);
}

procesarEmpresas();
