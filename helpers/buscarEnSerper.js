const axios = require('axios');

const API_KEY = process.env.SERPER_API_KEY;
const URL = 'https://google.serper.dev/search';

let totalConsultas = 0; // contador global

async function buscarEnSerper(query) {
  try {
    totalConsultas++; // contar cada búsqueda
    const response = await axios.post(URL, {
      q: query,
      gl: 'cl',
      hl: 'es'
    }, {
      headers: {
        'X-API-KEY': API_KEY,
        'Content-Type': 'application/json'
      }
    });

    const results = response.data?.organic ?? [];
    return results.map(result => result.link);
  } catch (error) {
    console.error('❌ Error en búsqueda Serper:', error.message);
    return [];
  }
}

// Exportar también el contador
module.exports = buscarEnSerper;
module.exports.getTotalConsultas = () => totalConsultas;
